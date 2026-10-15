# Client test fixtures

`audio-plugin/` is a gain-only WebAssembly fixture for the server audio plugin ABI.
It contains no noise-suppression model. Other media fixtures exercise capture,
playback and attachment handling. Tests never need a privately installed plugin.
