import hashlib
import json
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw

root = Path("test-results/linux-colors")
colors = [
    "000000", "080808", "101010", "181818", "1f1f1f", "242424", "303030", "404040",
    "606060", "808080", "a0a0a0", "c0c0c0", "e0e0e0", "ffffff", "ff0000", "00ff00",
    "0000ff", "00ffff", "ff00ff", "ffff00", "802020", "208020", "202080", "804020",
    "c85040", "d07030", "709050", "408090", "a05080", "c0a080", "703020", "204060",
]


def generate():
    root.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (512, 384))
    draw = ImageDraw.Draw(image)
    for i, color in enumerate(colors):
        x, y = (i % 8) * 64, (i // 8) * 96
        draw.rectangle((x, y, x + 63, y + 95), fill="#" + color)
    image.save(root / "untagged.png")
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    image.save(root / "srgb.png", icc_profile=profile)
    fixtures = []
    for name in ["untagged", "srgb"]:
        source = root / (name + ".png")
        fixtures.append({"name": name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
        target = Path("electron-app/dist") / ("ci-colors-" + name + ".png")
        target.write_bytes(source.read_bytes())
    (root / "fixtures.json").write_text(json.dumps({"colors": colors, "fixtures": fixtures}, indent=2))


def sample(filename, box):
    image = Image.open(root / filename).convert("RGB")
    result = []
    for i in range(len(colors)):
        x = round(box["x"] + (i % 8 + 0.5) * box["width"] / 8)
        y = round(box["y"] + (i // 8 + 0.5) * box["height"] / 4)
        if not 3 <= x < image.width - 3 or not 3 <= y < image.height - 3:
            raise ValueError(f"Sample outside {filename}: {x}, {y}")
        pixels = [image.getpixel((x + dx, y + dy)) for dx in range(-2, 3) for dy in range(-2, 3)]
        values = [int(statistics.median(p[c] for p in pixels)) for c in range(3)]
        result.append(values)
    return result


def distance(a, b):
    return max(abs(x - y) for p, q in zip(a, b) for x, y in zip(p, q))


def analyze():
    report = json.loads((root / "run.json").read_text())
    if not report.get("completed"):
        raise ValueError("The remote rendering matrix did not complete")
    if not report.get("colorManagerAdvertised"):
        raise ValueError("KWin did not advertise wp_color_manager_v1; hypothesis was not exercised")
    expected = [[int(c[n:n + 2], 16) for n in (0, 2, 4)] for c in colors]
    lookup = {}
    lines = ["# Fedora Linux color measurements", "", f"Source: `{report['sourceSha']}`", "",
             "KWin nested on Xvfb; Mesa software rendering. Captures include the final nested compositor output, not a physical monitor.", "",
             "| Mode | Fixture | View | Page #1f1f1f | Compositor #1f1f1f | Max source error |",
             "| --- | --- | --- | --- | --- | --- |"]
    for capture in report["captures"]:
        capture["pagePixels"] = sample(capture["pageFile"], capture["box"])
        capture["outputPixels"] = sample(capture["outputFile"], capture["box"])
        capture["distinctOutputPatches"] = len({tuple(p) for p in capture["outputPixels"]})
        capture["maxSourceError"] = distance(capture["outputPixels"], expected)
        lookup[(capture["mode"], capture["fixture"], capture["view"])] = capture
        rgb = lambda value: "#" + "".join(f"{v:02x}" for v in value)
        lines.append(f"| {capture['mode']} | {capture['fixture']} | {capture['view']} | {rgb(capture['pagePixels'][4])} | {rgb(capture['outputPixels'][4])} | {capture['maxSourceError']} |")
    comparisons = []
    for fixture in ("untagged", "srgb"):
        for mode in report["modes"]:
            viewer = lookup[(mode, fixture, "haunt-viewer")]
            plain = lookup[(mode, fixture, "plain-electron")]
            comparisons.append({"mode": mode, "fixture": fixture, "viewerVsPlainMax": distance(viewer["outputPixels"], plain["outputPixels"])})
        baseline = lookup[("default", fixture, "haunt-viewer")]
        for mode in report["modes"][1:]:
            candidate = lookup[(mode, fixture, "haunt-viewer")]
            comparisons.append({"mode": mode, "fixture": fixture, "defaultVsModeMax": distance(baseline["outputPixels"], candidate["outputPixels"])})
    report["comparisons"] = comparisons
    (root / "measurements.json").write_text(json.dumps(report, indent=2))
    lines += ["", "## Comparisons", "", "```json", json.dumps(comparisons, indent=2), "```", "",
              "A completed matrix establishes these renderer/compositor measurements only. No physical display, ICC calibration, HDR scanout, or vendor GPU driver is covered."]
    (root / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if sys.argv[1:] == ["generate"]:
    generate()
elif sys.argv[1:] == ["analyze"]:
    analyze()
else:
    raise SystemExit("Expected generate or analyze")
