# Haunt brand kit

Start with **HANDOFF.md** for implementation instructions and **Haunt-brand-spec.pdf** for the visual specification.

The product display name is **Haunt**. The approved ghost owl is unchanged. Surfaces should read black, with faint cool illumination and warm orange accents. No slogans.

## Contents

- `HANDOFF.md`: main-agent instructions, complete integration map and acceptance checklist.
- `Haunt-brand-spec.pdf`: four-page visual specification.
- `brand.json` and `brand-tokens.css`: standalone brand values.
- `source/`: byte-for-byte original logo.
- `png/`, `web/`, `desktop/`, `android/`: 57 derived image exports plus platform resource examples.
- `asset-manifest.json`: original and export hashes, dimensions and formats.
- `contrast-report.json`: computed contrast values for opaque token pairs.
- `tools/export_assets.py`: reproducible size/format exports using Pillow.
- `SHA256SUMS.txt`: hashes of kit files, excluding this checksum list itself.

No app source, configuration, runtime or server files were changed. No builds were run. Actual application integration, device rendering and packaged OS icons remain for the main agent to verify. Technical project identifiers and existing addresses are not renamed by this kit.
