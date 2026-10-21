![Haunt](../../assets/haunt-wordmark.png)

# Client test fixtures

`audio-plugin/` is a gain-only WebAssembly fixture for the server audio plugin ABI.
It contains no noise-suppression model. Other media fixtures exercise capture,
playback and attachment handling. Tests never need a privately installed plugin.

`narrator-tone.mp3` is a generated 880 Hz, 0.6 second tone, with no third-party
audio. The narrator browser check installs an executable test extension that
returns this tone and measures the real playback element. It exercises dynamic
extension menus, process invocation and playback, not upstream voice availability
or pronunciation. Regenerate with:

```sh
ffmpeg -f lavfi -i sine=frequency=880:duration=0.6:sample_rate=24000 \
  -c:a libmp3lame -b:a 48k -threads 1 -y tests/fixtures/narrator-tone.mp3
```
