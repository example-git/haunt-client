package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
)

const magic = "HAUNTCAPTUREv1\n"
const footerSize = 8 + sha256.Size + len(magic)

type bundle struct {
	file   *os.File
	offset int64
	size   int64
	digest string
}

func openBundle(filename string) (*bundle, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*bundle, error) { file.Close(); return nil, err }
	info, err := file.Stat()
	if err != nil {
		return fail(err)
	}
	footer := make([]byte, footerSize)
	if info.Size() < int64(footerSize) {
		return fail(errors.New("capture runtime is missing"))
	}
	if _, err = file.ReadAt(footer, info.Size()-int64(footerSize)); err != nil {
		return fail(err)
	}
	if string(footer[8+sha256.Size:]) != magic {
		return fail(errors.New("capture runtime footer is invalid"))
	}
	size := int64(binary.BigEndian.Uint64(footer[:8]))
	if size <= 0 || size > info.Size()-int64(footerSize) {
		return fail(errors.New("capture runtime size is invalid"))
	}
	return &bundle{file, info.Size() - int64(footerSize) - size, size, hex.EncodeToString(footer[8 : 8+sha256.Size])}, nil
}

func (b *bundle) extract(base string) (string, error) {
	root := filepath.Join(base, b.digest)
	ready := func() bool {
		data, err := os.ReadFile(filepath.Join(root, ".ready"))
		return err == nil && string(data) == b.digest
	}
	if ready() {
		return root, nil
	}
	if err := os.MkdirAll(base, 0700); err != nil {
		return "", err
	}
	temp, err := os.MkdirTemp(base, ".unpack-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	hash := sha256.New()
	compressed := io.TeeReader(io.NewSectionReader(b.file, b.offset, b.size), hash)
	reader, err := gzip.NewReader(compressed)
	if err != nil {
		return "", err
	}
	defer reader.Close()
	archive := tar.NewReader(reader)
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		name := filepath.Clean(header.Name)
		if name == "." && header.Typeflag == tar.TypeDir {
			continue
		}
		if !filepath.IsLocal(name) {
			return "", fmt.Errorf("invalid runtime path: %q", header.Name)
		}
		filename := filepath.Join(temp, name)
		switch header.Typeflag {
		case tar.TypeDir:
			err = os.MkdirAll(filename, 0700)
		case tar.TypeReg, tar.TypeRegA:
			if err = os.MkdirAll(filepath.Dir(filename), 0700); err == nil {
				var file *os.File
				file, err = os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600|os.FileMode(header.Mode)&0100)
				if err == nil {
					_, err = io.Copy(file, archive)
					err = errors.Join(err, file.Close())
				}
			}
		default:
			err = fmt.Errorf("unsupported runtime entry: %q", header.Name)
		}
		if err != nil {
			return "", err
		}
	}
	if _, err = io.Copy(io.Discard, reader); err != nil {
		return "", err
	}
	if _, err = io.Copy(io.Discard, compressed); err != nil {
		return "", err
	}
	if hex.EncodeToString(hash.Sum(nil)) != b.digest {
		return "", errors.New("capture runtime checksum mismatch")
	}
	if err = os.WriteFile(filepath.Join(temp, ".ready"), []byte(b.digest), 0600); err != nil {
		return "", err
	}
	if err = os.Rename(temp, root); err != nil && !ready() {
		return "", err
	}
	return root, nil
}

func environment(root string, inherited []string) []string {
	values := make(map[string]string)
	for _, entry := range inherited {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			values[key] = value
		}
	}
	libraries := []string{filepath.Join(root, "lib"), "/opt/nvidia/deepstream/deepstream/lib", "/usr/lib/aarch64-linux-gnu/tegra"}
	if values["LD_LIBRARY_PATH"] != "" {
		libraries = append(libraries, values["LD_LIBRARY_PATH"])
	}
	values["LD_LIBRARY_PATH"] = strings.Join(libraries, ":")
	delete(values, "LD_PRELOAD")
	values["PATH"] = filepath.Join(root, "bin") + ":" + values["PATH"]
	for _, suffix := range []string{"", "_1_0"} {
		values["GST_PLUGIN_SYSTEM_PATH"+suffix] = filepath.Join(root, "plugins")
		values["GST_PLUGIN_PATH"+suffix] = ""
		values["GST_PLUGIN_SCANNER"+suffix] = filepath.Join(root, "bin/gst-plugin-scanner")
		values["GST_REGISTRY"+suffix] = filepath.Join(root, "registry.bin")
	}
	values["GST_REGISTRY_FORK"] = "no"
	values["PIPEWIRE_MODULE_DIR"] = filepath.Join(root, "pipewire")
	values["PIPEWIRE_CONFIG_DIR"] = filepath.Join(root, "pipewire-config")
	values["PIPEWIRE_CONFIG_PREFIX"] = ""
	values["PIPEWIRE_CONFIG_NAME"] = "client.conf"
	values["SPA_PLUGIN_DIR"] = filepath.Join(root, "spa")
	values["GST_CUDA_NVRTC_LIBNAME"] = filepath.Join(root, "lib/libnvrtc.so")
	result := make([]string, 0, len(values))
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	sort.Strings(result)
	return result
}

func run() error {
	filename, err := os.Executable()
	if err != nil {
		return err
	}
	b, err := openBundle(filename)
	if err != nil {
		return err
	}
	defer b.file.Close()
	cache, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	root, err := b.extract(filepath.Join(cache, "haunt/capture"))
	if err != nil {
		return fmt.Errorf("unpack capture runtime: %w", err)
	}
	args := os.Args[1:]
	if len(args) == 1 && args[0] == "--runtime-info" {
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"root": root, "sha256": b.digest})
	}
	worker := filepath.Join(root, "capture")
	if len(args) > 0 && args[0] == "--inspect-runtime" {
		worker = filepath.Join(root, "bin/gst-inspect-1.0")
		args = args[1:]
	}
	return syscall.Exec(worker, append([]string{worker}, args...), environment(root, os.Environ()))
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Haunt capture:", err)
		os.Exit(1)
	}
}
