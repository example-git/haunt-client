# Authoring an audio plugin

Haunt's browser and Electron clients share a restricted WebAssembly audio host.
Plugins are distributed by a server, run locally and declare their settings as
JSON. The same package works in both clients; it contains no Electron-specific
code. RNNoise is the server's bundled default, not a hard-coded client processor.

The [server guide](https://github.com/example-git/haunt-server/blob/main/docs/audio-plugin-authoring.md)
explains installation and distribution. The [RNNoise adapter guide](https://github.com/example-git/haunt-audio-rnnoise/blob/main/docs/authoring.md)
shows a complete denoiser. This guide starts with the public-domain gain fixture
in [tests/fixtures/audio-plugin](../tests/fixtures/audio-plugin/).

## Working starter package

From a client checkout, copy the example into a separate working directory:

```sh
mkdir -p ../my-audio-plugin/dist
cp tests/fixtures/audio-plugin/{passthrough.c,manifest.json} ../my-audio-plugin/
cd ../my-audio-plugin
```

Edit the manifest's `id`, `name` and `description`. Keep `version: 1`: it identifies
Haunt's ABI/schema, not your release version. Plugin and variant IDs use lowercase
letters, numbers, hyphens or underscores and start with a letter (at most 64
characters); prototype-related names are reserved. Choose a permanent plugin ID.
The sample declares a `default` variant and a `level` slider from 0–100.

With Zig **0.15.2**, compile the example:

```sh
zig cc -target wasm32-wasi -mexec-model=reactor -O2 passthrough.c \
  -Wl,--export=audio_init -Wl,--export=audio_input \
  -Wl,--export=audio_output -Wl,--export=audio_process \
  -Wl,--export=audio_reset -Wl,--initial-memory=131072 \
  -Wl,--max-memory=131072 -Wl,-z,stack-size=16384 \
  -o default.wasm
```

The reactor exports `_initialize` without a Wasm start function. Keep the manifest's
frame length at **720** for this example because the C arrays hold 720 samples.
Then package only declared files:

```sh
python3 - <<'PY'
import hashlib, json, pathlib, zipfile
root = pathlib.Path('.')
manifest = json.loads((root / 'manifest.json').read_text())
files = ['manifest.json'] + [v['file'] for v in manifest['variants']]
if (root / 'LICENSE.txt').exists():
    files.append('LICENSE.txt')
assert len(files) == len(set(files))
assert all(pathlib.Path(f).name == f for f in files)
assert sum((root / f).stat().st_size for f in files) <= 50 * 1024 * 1024
out = root / 'dist'
out.mkdir(exist_ok=True)
with zipfile.ZipFile(out / 'haunt-plugin.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for name in files:
        z.write(root / name, name)
package = out / 'haunt-plugin.zip'
assert package.stat().st_size <= 50 * 1024 * 1024
(out / 'SHA256SUMS').write_text(hashlib.sha256(package.read_bytes()).hexdigest() + '  haunt-plugin.zip\n')
PY
```

This packaging recipe assumes your own trusted source tree. The server and client
still validate the result; these assertions are not a replacement for validation.
Upload the ZIP through **Server settings → Audio plugins**, then select it in
**User settings → Server audio plugins → Active Server Audio Plugin:**. Enable
Noise suppression in Devices. The gain example only changes volume; it does not
remove noise. Test on an isolated development server with headphones and deliberate
microphone monitoring.

## Audio ABI

Every variant exports `memory` and the functions named in `manifest.abi`:

| Manifest key | C-style signature | Host behavior |
| --- | --- | --- |
| `initialize` (optional) | `void initialize(void)` | Called once before creation; `_initialize` for a WASI reactor |
| `create` | `int create(void)` | Initialize state/buffers; return exactly `1` for success |
| `input` | `float *input(void)` | Return a byte offset in exported memory to the input array |
| `output` | `float *output(void)` | Return a byte offset to the output array |
| `process` | `int process(float control, ...)` | Process one frame; return exactly `0` for success |
| `reset` (optional) | `void reset(void)` | Clear delayed audio and state when the host resets the stream |

Input and output are **48,000 Hz mono float32**, normalized to `[-1, 1]`, with
exactly `abi.frame_samples` samples per call (120–960, or 2.5–20 ms). Buffer offsets
must be four-byte aligned and both arrays must fit in memory. The host calls the
pointer functions once after creation. Keep buffers stable and **do not grow
memory after creation**: growth detaches the host's existing typed-array views.
A fixed initial/maximum memory is the simplest arrangement.

The host handles the physical device's sample rate outside this boundary. If a
model operates at another rate or uses int16-scale floats, the adapter must convert
correctly and return 48 kHz normalized float32. Keep recurrent state per instance;
clear it on reset. If blending raw and delayed output, delay the raw path by the
same amount. Do not allocate an unbounded amount of memory or initialize a model
on each frame. There is no destroy callback; ending processing terminates the
worker and releases the whole instance.

## Manifest and settings

The complete runnable manifest is [here](../tests/fixtures/audio-plugin/manifest.json).
The required top-level fields are `version`, `id`, `name`, `description`,
`default_variant`, `abi`, `variants` and `fields` (an empty array is valid).
Use `variants: [{"id":"default","label":"My model","file":"default.wasm"}]`
for one model. Every variant filename must be exactly its ID plus `.wasm`.
All variants must implement the declared ABI and relevant control exports.

A numeric control looks like this:

```json
{
  "key": "strength",
  "label": "Suppression strength",
  "type": "range",
  "min": 0,
  "max": 100,
  "step": 1,
  "default": 100,
  "scale": 0.01,
  "help": "Lower this to blend in some of the original signal."
}
```

Add `"process_controls": ["strength"]` to `abi` and implement
`int audio_process(float strength)`. The UI stores 0–100; the host clamps the value,
multiplies by `scale`, then passes 0–1 in the listed argument order. Up to eight
controls can be passed this way. For a setting that only needs updates when it
changes, use a field `export`, such as `"export":"set_strength"`, with a numeric
setter. Do not list the same control both ways unless the adapter intends that.
Use `type: "number"` for a numeric input instead of a slider.

Fields may declare `variants: ["standard"]` to control visibility and setter
calls. This does **not** remove entries from `process_controls`: its argument
order is fixed. `help`, labels and descriptions are plain text. There are no
checkbox, file-picker, arbitrary HTML, callback or URL controls in ABI version 1.

Optional `diagnostics` entries have `key`, `label`, `export` and optional `variants`.
The export is a zero-argument numeric getter. Finite results are shown only in
the settings microphone monitor; they are not shared with other users. Diagnostics
are sampled every 14 processed frames when enabled. Keep getters cheap.

Selection, selected variant and control values persist per server and plugin in
local preferences and are included in client backups. Selecting a different
plugin replaces the active processor, including during a call. Only one processes
the microphone at a time. Reset noise defaults resets the current plugin's model
and controls and enables suppression; it does not switch other users' settings.

## Sandbox and failure behavior

A ZIP has a maximum of 50 MiB both packed and unpacked, with 16 variants maximum.
`manifest.json` and optional `LICENSE.txt` each have a 64 KiB cap. No extra entries,
symlinks, duplicate entries or nested folders are permitted. There are at most 32
numeric controls and eight diagnostics. Unknown fields are rejected.

Each module must own exactly one nonshared Wasm32 memory capped at 1024 pages
(64 MiB). At most one bounded function table with 8192 entries is permitted. There
is no Wasm start function, imported memory, memory64, GC or host-reference access.
Prefer no imports. The only accepted compatibility imports, from
`wasi_snapshot_preview1`, are `proc_exit`, `fd_write`, `fd_close`, `fd_seek` and
`clock_time_get`. These are inert stubs, not usable filesystem, logging or clock
services; `proc_exit` fails the plugin. There is no network, DOM, GPU or access to
sessions, tokens or other host memory.

The trusted host verifies hashes and resource declarations before instantiation,
then runs the module in a dedicated worker. Initialization has a five-second
budget; missing heartbeats for 1.5 seconds terminate a stalled worker. These are
recovery limits, not acceptable per-frame latency targets. Processing should stay
comfortably below the frame duration on intended devices. Invalid samples, runtime
errors or a failed worker return to raw microphone audio with a visible notice.
Echo cancellation stays disabled.

## Validate and publish

Run the host's existing contract/cache checks from the client root:

```sh
npm test -- tests/audio-plugins.test.ts tests/audio-plugin-cache.test.ts
```

These exercise the bundled fixture and host, not your new artifact automatically.
For your package, use an isolated server to test installation, all variants, actual
PCM output, settings changes, reset, cache reload, interrupted download and call
switching. Save original/filtered voice clips and compare them. Do not rely only
on a WASM compile or synthetic sine-wave test to judge sound quality.

Commit `dist/haunt-plugin.zip` and its checksum to your plugin repository. Publish
the exact full Git revision and ZIP hash; install with the server's GitHub installer
or upload the ZIP. Do not ship secret tokens, private datasets, generated recordings
or weights whose redistribution terms you have not checked.

Implementation references: [contract and resource validation](../packages/browser/src/audio-plugins/contract.ts),
[trusted worker](../packages/browser/src/audio-plugins/processor-worker.ts),
[cache](../packages/browser/src/audio-plugins/cache.ts), and
[selection persistence](../packages/browser/src/audio-plugins/preferences.ts).
