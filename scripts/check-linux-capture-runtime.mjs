import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export async function checkLinuxCaptureRuntime(binary, env = process.env) {
  const bytes = await fs.readFile(binary);
  const offset = Number(bytes.readBigUInt64LE(32));
  for (let i = 0; i < bytes.readUInt16LE(56); i++)
    assert.notEqual(
      bytes.readUInt32LE(offset + i * bytes.readUInt16LE(54)),
      3,
      "The launcher must not require a host dynamic loader",
    );
  const info = JSON.parse(
    (await exec(binary, ["--runtime-info"], { env })).stdout,
  );
  const again = JSON.parse(
    (await exec(binary, ["--runtime-info"], { env })).stdout,
  );
  assert.deepEqual(again, info);
  const core = path.join(info.root, "lib/libgstreamer-1.0.so.0");
  const inspected = (
    await exec(binary, ["--inspect-runtime", "coreelements"], { env })
  ).stdout;
  assert(
    inspected.includes(path.join(info.root, "plugins/libgstcoreelements.so")),
    inspected,
  );
  let selkies;
  if (process.arch === "x64") {
    selkies = JSON.parse(
      await fs.readFile(path.join(info.root, "selkies-manifest.json")),
    );
    assert.equal(selkies.version, "1.24.12");
    for (const [packaged, original] of [
      [core, "libgstreamer-1.0.so.0.2412.0"],
      [
        path.join(info.root, "plugins/libgstnvcodec.so"),
        "gstreamer-1.0/libgstnvcodec.so",
      ],
      [path.join(info.root, "lib/libnvrtc.so"), "libnvrtc.so.11.8.89"],
      [
        path.join(info.root, "lib/libnvrtc-builtins.so.11.8"),
        "libnvrtc-builtins.so.11.8.89",
      ],
    ]) {
      const hash = createHash("sha256")
        .update(await fs.readFile(packaged))
        .digest("hex");
      assert.equal(
        hash,
        selkies.files[`lib/x86_64-linux-gnu/${original}`].sha256,
        packaged,
      );
    }
    const compiled = await exec(
      "python3",
      [
        "-c",
        `
import ctypes, os
lib = ctypes.CDLL(os.path.join(os.environ['HAUNT_RUNTIME_ROOT'], 'lib/libnvrtc.so'))
program = ctypes.c_void_p()
lib.nvrtcCreateProgram.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p]
lib.nvrtcCompileProgram.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
lib.nvrtcDestroyProgram.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
assert lib.nvrtcCreateProgram(ctypes.byref(program), b'extern "C" __global__ void probe(int *p) { p[0] = 1; }', b'probe.cu', 0, None, None) == 0
result = lib.nvrtcCompileProgram(program, 0, None)
assert lib.nvrtcDestroyProgram(ctypes.byref(program)) == 0
assert result == 0, 'Bundled NVRTC compilation failed: ' + str(result)
print('NVRTC compile passed')
`,
      ],
      {
        env: {
          ...env,
          HAUNT_RUNTIME_ROOT: info.root,
          LD_LIBRARY_PATH: path.join(info.root, "lib"),
        },
      },
    );
    assert.match(compiled.stdout, /NVRTC compile passed/);
  }
  return { ...info, selkies: selkies?.version, nvrtc: selkies?.nvrtc };
}
