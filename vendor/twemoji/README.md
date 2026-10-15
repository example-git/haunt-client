# Bundled emoji artwork

Twemoji 17.0.3 from [Discord's public fork](https://github.com/discord/twemoji), pinned to commit `187e1b77ee80532eb584bcf62a2266942fa39cf9`. The archive URL and SHA-256 are in `source.sha256`. Only original 72×72 PNGs and licenses are retained here. Graphics are Copyright Twitter, Inc. and other contributors, licensed CC-BY-4.0; see `LICENSE-GRAPHICS` and the packaged `THIRD-PARTY-NOTICES.txt`.

`scripts/build-emoji-sprites.py` packs the original artwork, without a background or visual changes, into sixteen 1152×1152 lossless WebP sheets. Regenerate using Python 3 and Pillow 11.3.0 with WebP support, after `npm run generate:emojis`. The generated lookup and images live in `apps/web/src/emoji-sprites/`. Normal builds verify their pinned checksums and need no Python or downloads.

Sheets are requested only when one of their emoji is displayed. The picker uses the same artwork as messages, virtualizes its rows, and lazily loads the keyword catalog. Original Unicode remains in the message and accessible text; code blocks stay literal.
