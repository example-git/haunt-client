# Haunt brand kit

This directory preserves Haunt's source artwork, original visual specification and
reproducible platform exports. `Haunt-brand-spec.pdf` describes the original kit;
the application's current surface and accent tokens are in
`apps/web/src/brand-tokens.css`.

The product display name is **Haunt**. The approved ghost owl is unchanged.

## Contents

- `Haunt-brand-spec.pdf`: four-page visual specification.
- `brand.json` and `brand-tokens.css`: standalone brand values.
- `source/`: byte-for-byte original logo.
- `png/`, `web/`, `desktop/`, `android/`: 57 derived image exports plus platform resource examples.
- `asset-manifest.json`: original and export hashes, dimensions and formats.
- `contrast-report.json`: computed contrast values for opaque token pairs.
- `tools/export_assets.py`: reproducible size/format exports using Pillow.
- `SHA256SUMS.txt`: hashes of kit files, excluding this checksum list itself.

The client build verifies installed icons against `asset-manifest.json`. The source
artwork and exported assets are required repository inputs, not build-directory
output. Original development handoff notes are kept outside the tracked source.
