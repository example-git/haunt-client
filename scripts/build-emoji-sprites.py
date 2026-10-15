#!/usr/bin/env python3
"""Pack pinned Discord Twemoji PNGs into transparent, lossless WebP sheets.

Run from any directory. Pillow with WebP support is needed only to regenerate.
Order common picker emoji first so related categories share a sheet; include
all remaining artwork for skin tones and emoji pasted directly into messages.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
source = root / "vendor/twemoji/assets/72x72"
output = root / "apps/web/src/emoji-sprites"
output.mkdir(exist_ok=True)
assets = {p.stem: p for p in source.glob("*.png")}
ordered = []
# All category icons share the first sheet, avoiding nine image downloads just
# to open the picker. They retain exactly the same artwork used in messages.
for text in ["😀", "👋", "🐻", "🍕", "🚗", "⚽", "💡", "🔣", "🏳️"]:
    key = "-".join(f"{ord(c):x}" for c in text).replace("-fe0f", "")
    if key in assets:
        ordered.append(key)
for _, entries in json.loads((root / "apps/web/src/emoji-data.json").read_text()):
    for text, _, _ in entries:
        key = "-".join(f"{ord(c):x}" for c in text)
        if key not in assets:
            key = key.replace("-fe0f", "")
        if key in assets and key not in ordered:
            ordered.append(key)
ordered += sorted(assets.keys() - set(ordered))
index = {}
for offset in range(0, len(ordered), 256):
    sheet = Image.new("RGBA", (1152, 1152))
    for slot, key in enumerate(ordered[offset:offset + 256]):
        with Image.open(assets[key]) as icon:
            if icon.size != (72, 72):
                raise ValueError(f"Unexpected dimensions: {assets[key]}")
            sheet.paste(icon, ((slot % 16) * 72, (slot // 16) * 72))
        index[key] = [offset // 256, slot]
    sheet.save(output / f"{offset // 256}.webp", lossless=True, method=6)
(output / "index.json").write_text(json.dumps(index, separators=(",", ":")) + "\n")
files = sorted(output.glob("*.webp")) + [output / "index.json"]
checksums = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
(root / "vendor/twemoji/sprites.json").write_text(json.dumps(checksums, indent=2) + "\n")
print(f"Packed {len(index)} emoji into {len(files) - 1} sheets ({sum(p.stat().st_size for p in files):,} bytes)")
