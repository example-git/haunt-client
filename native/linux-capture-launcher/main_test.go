package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func payload(t *testing.T, header tar.Header, content string) []byte {
	t.Helper()
	var data bytes.Buffer
	compressed := gzip.NewWriter(&data)
	writer := tar.NewWriter(compressed)
	header.Size = int64(len(content))
	if err := writer.WriteHeader(&header); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func executable(t *testing.T, prefix, payload []byte) string {
	t.Helper()
	footer := make([]byte, footerSize)
	binary.BigEndian.PutUint64(footer, uint64(len(payload)))
	digest := sha256.Sum256(payload)
	copy(footer[8:], digest[:])
	copy(footer[40:], magic)
	name := filepath.Join(t.TempDir(), "HauntCaptureWorker")
	if err := os.WriteFile(name, append(append(prefix, payload...), footer...), 0700); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestConcurrentExtractionAndReuse(t *testing.T) {
	b, err := openBundle(executable(t, nil, payload(t, tar.Header{Name: "capture", Mode: 0755, Typeflag: tar.TypeReg}, "fixture")))
	if err != nil {
		t.Fatal(err)
	}
	defer b.file.Close()
	base := t.TempDir()
	var tasks sync.WaitGroup
	for range 12 {
		tasks.Add(1)
		go func() {
			defer tasks.Done()
			root, err := b.extract(base)
			if err != nil {
				t.Error(err)
				return
			}
			data, err := os.ReadFile(filepath.Join(root, "capture"))
			if err != nil || string(data) != "fixture" {
				t.Errorf("capture: %q %v", data, err)
			}
		}()
	}
	tasks.Wait()
	root, err := b.extract(base)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(filepath.Join(root, "capture"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.extract(base); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(filepath.Join(root, "capture"))
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) || after.Mode().Perm() != 0700 {
		t.Fatal("runtime was replaced or permissions changed")
	}
	entries, err := os.ReadDir(base)
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary extractions remain: %v %v", entries, err)
	}
}

func TestRejectMalformedPayload(t *testing.T) {
	for _, header := range []tar.Header{
		{Name: "../escape", Typeflag: tar.TypeReg},
		{Name: "/absolute", Typeflag: tar.TypeReg},
		{Name: "link", Typeflag: tar.TypeSymlink, Linkname: "/tmp"},
	} {
		b, err := openBundle(executable(t, nil, payload(t, header, "")))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := b.extract(t.TempDir()); err == nil {
			t.Errorf("accepted %q", header.Name)
		}
		b.file.Close()
	}
	b, err := openBundle(executable(t, nil, payload(t, tar.Header{Name: "capture", Typeflag: tar.TypeReg}, "fixture")))
	if err != nil {
		t.Fatal(err)
	}
	defer b.file.Close()
	b.digest = strings.Repeat("0", 64)
	if _, err := b.extract(t.TempDir()); err == nil {
		t.Fatal("accepted incorrect checksum")
	}
}

func TestEnvironmentPreservesHostSession(t *testing.T) {
	root := "/private/capture"
	vars := environment(root, []string{
		"DISPLAY=:12", "WAYLAND_DISPLAY=wayland-3", "DBUS_SESSION_BUS_ADDRESS=unix:path=/session/bus",
		"XDG_RUNTIME_DIR=/session", "PULSE_SERVER=unix:/session/pulse/native", "GST_PLUGIN_PATH=/foreign",
		"GST_PLUGIN_SYSTEM_PATH_1_0=/foreign", "GST_REGISTRY=/foreign", "PIPEWIRE_CONFIG_NAME=foreign.conf",
		"PIPEWIRE_CONFIG_PREFIX=foreign", "PIPEWIRE_MODULE_DIR=/foreign", "SPA_PLUGIN_DIR=/foreign", "LD_PRELOAD=/foreign.so",
	})
	values := make(map[string]string)
	for _, entry := range vars {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	for key, want := range map[string]string{
		"DISPLAY": ":12", "WAYLAND_DISPLAY": "wayland-3", "DBUS_SESSION_BUS_ADDRESS": "unix:path=/session/bus",
		"XDG_RUNTIME_DIR": "/session", "PULSE_SERVER": "unix:/session/pulse/native",
		"GST_PLUGIN_PATH": "", "GST_PLUGIN_SYSTEM_PATH_1_0": root + "/plugins", "GST_REGISTRY": root + "/registry.bin",
		"PIPEWIRE_CONFIG_NAME": "client.conf", "PIPEWIRE_CONFIG_PREFIX": "", "PIPEWIRE_MODULE_DIR": root + "/pipewire",
		"SPA_PLUGIN_DIR": root + "/spa", "GST_CUDA_NVRTC_LIBNAME": root + "/lib/libnvrtc.so",
	} {
		if values[key] != want {
			t.Errorf("%s=%q, want %q", key, values[key], want)
		}
	}
	if _, found := values["LD_PRELOAD"]; found {
		t.Fatal("foreign preload remains")
	}
}

func TestLauncherProcess(t *testing.T) {
	if os.Getenv("HAUNT_LAUNCHER_TEST") != "1" {
		return
	}
	if err := run(); err != nil {
		t.Fatal(err)
	}
}

func TestExecPreservesControlAndMediaPipes(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	prefix, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nread -r control\n[ \"$control\" = configure ] || exit 2\nprintf video >&3\nprintf audio >&4\n"
	name := executable(t, prefix, payload(t, tar.Header{Name: "capture", Mode: 0755, Typeflag: tar.TypeReg}, script))
	videoRead, videoWrite, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer videoRead.Close()
	audioRead, audioWrite, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer audioRead.Close()
	cmd := exec.Command(name, "-test.run=^TestLauncherProcess$")
	cmd.Env = append(os.Environ(), "HAUNT_LAUNCHER_TEST=1", "XDG_CACHE_HOME="+t.TempDir())
	cmd.Stdin = strings.NewReader("configure\n")
	cmd.ExtraFiles = []*os.File{videoWrite, audioWrite}
	output, err := cmd.CombinedOutput()
	videoWrite.Close()
	audioWrite.Close()
	if err != nil {
		t.Fatalf("launcher: %s %v", output, err)
	}
	video, _ := io.ReadAll(videoRead)
	audio, _ := io.ReadAll(audioRead)
	if string(video) != "video" || string(audio) != "audio" {
		t.Fatalf("media pipes: %q %q", video, audio)
	}
}
