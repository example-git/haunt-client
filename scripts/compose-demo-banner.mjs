import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// Composite the unmodified app captures in the same private browser as the demo.
export async function composeDemoBanner(browser, directory, theme) {
  const files = ["09-voice-pip.png", "07-audio-plugin.png", "08-voice.png"];
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const inputs = await Promise.all(
    files.map(async (file) => ({
      file,
      bytes: await fs.readFile(path.join(directory, file)),
    })),
  );
  const context = await browser.newContext({
    viewport: { width: 4880, height: 1040 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><style>
      html,body{margin:0;background:transparent}
      #banner{box-sizing:border-box;width:4880px;height:1040px;padding:20px;
        display:flex;gap:20px;background:#000;border-radius:32px;overflow:hidden}
      img{display:block;flex:none;width:1600px;height:1000px;border-radius:12px}
      </style><div id="banner">${inputs
        .map(
          ({ bytes }) =>
            `<img src="data:image/png;base64,${bytes.toString("base64")}" alt="">`,
        )
        .join("")}</div>`);
    const dimensions = await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((img) => img.decode()));
      return images.map((img) => [img.naturalWidth, img.naturalHeight]);
    });
    assert.deepEqual(
      dimensions,
      files.map(() => [1600, 1000]),
    );
    const file = "Multiple-Horizontal.png";
    const output = await page.screenshot({
      path: path.join(directory, file),
      omitBackground: true,
      animations: "disabled",
    });
    // Verify the encoded result, including outer transparency and black gutters.
    const pixels = await page.evaluate(async (base64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      return {
        corners: [
          [0, 0],
          [4879, 0],
          [0, 1039],
          [4879, 1039],
        ].map(([x, y]) => at(x, y)),
        gutters: [
          [100, 10],
          [1630, 500],
          [3250, 500],
          [100, 1030],
        ].map(([x, y]) => at(x, y)),
        innerCorners: [20, 1640, 3260].map((x) => at(x, 20)),
      };
    }, output.toString("base64"));
    assert(
      pixels.corners.every((rgba) => rgba[3] === 0),
      "Outer corners must be transparent",
    );
    for (const rgba of [...pixels.gutters, ...pixels.innerCorners])
      assert.deepEqual(rgba, [0, 0, 0, 255]);
    const git = (...args) =>
      execFileSync("git", args, { encoding: "utf8" }).trim();
    await fs.writeFile(
      path.join(directory, "banner.json"),
      JSON.stringify(
        {
          kind: "Three actual browser screenshots; rounded black frame with transparent outer corners",
          generatedAt: new Date().toISOString(),
          clientCommit: git("rev-parse", "HEAD"),
          clientModified: Boolean(git("status", "--porcelain")),
          theme,
          width: 4880,
          height: 1040,
          padding: 20,
          gap: 20,
          outerRadius: 32,
          innerRadius: 12,
          sources: inputs.map(({ file, bytes }) => ({
            file,
            sha256: sha256(bytes),
            width: 1600,
            height: 1000,
          })),
          output: { file, sha256: sha256(output) },
          verified: {
            transparentOuterCorners: true,
            blackGutters: true,
            roundedInnerCorners: true,
            unscaledSources: true,
          },
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Banner verified: ${path.join(directory, file)} (4880 × 1040)`);
  } finally {
    await context.close();
  }
}
