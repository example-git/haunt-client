import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fillSignin } from "./signin-fields.mjs";

export async function checkImageViewer(browser, fixtures) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  try {
    await page.goto(fixtures.rtc.url);
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const pictures = [];
    for (const [index, width, height] of [
      [1, 1600, 900],
      [2, 720, 1200],
      [3, 420, 420],
    ]) {
      const data = await page.evaluate(
        ({ index, width, height }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          const gradient = ctx.createLinearGradient(0, 0, width, height);
          gradient.addColorStop(0, "#e9a6b7");
          gradient.addColorStop(1, "#465875");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "#24262b";
          ctx.fillRect(
            width * 0.12,
            height * 0.17,
            width * 0.76,
            height * 0.66,
          );
          ctx.fillStyle = "#f4d8df";
          ctx.font = `${Math.round(width / 15)}px sans-serif`;
          ctx.fillText(`Image ${index}`, width * 0.2, height * 0.5);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        { index, width, height },
      );
      const picture = {
        name: `viewer-${index}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      };
      pictures.push(picture);
      await page.locator(".composer input[type=file]").setInputFiles(picture);
      await expect(page.locator(".attachment-chips")).toContainText(
        picture.name,
      );
      await page
        .getByLabel("Message", { exact: true })
        .fill(`Viewer picture ${index}`);
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: `Enlarge ${picture.name}`,
          exact: true,
        }),
      ).toBeVisible();
    }
    const dialog = page.getByRole("dialog", { name: "Image preview" });
    const image = dialog.locator(".viewer-image");
    const scale = dialog.getByRole("button", { name: "Fit image to window" });
    const open = async (index) => {
      await page
        .getByRole("button", {
          name: `Enlarge viewer-${index}.png`,
          exact: true,
        })
        .click();
      await expect(dialog).toBeVisible();
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute("alt", `viewer-${index}.png`);
      await expect
        .poll(() => image.evaluate((el) => el.naturalWidth))
        .toBeGreaterThan(0);
    };
    const chrome = async () => {
      const actual = await dialog.evaluate((el) => {
        const css = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const img = getComputedStyle(el.querySelector(".viewer-image"));
        return {
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y,
          border: css.borderTopWidth,
          radius: css.borderRadius,
          shadow: css.boxShadow,
          background: css.backgroundColor,
          imageBorder: img.borderTopWidth,
          imageShadow: img.boxShadow,
        };
      });
      assert.deepEqual(actual, {
        width: page.viewportSize().width,
        height: page.viewportSize().height,
        x: 0,
        y: 0,
        border: "0px",
        radius: "0px",
        shadow: "none",
        background: "rgba(0, 0, 0, 0)",
        imageBorder: "0px",
        imageShadow: "none",
      });
      const download = await dialog
        .getByRole("link", { name: "Download image" })
        .boundingBox();
      const close = await dialog
        .getByRole("button", { name: "Close image preview" })
        .boundingBox();
      const zoom = await dialog.locator(".viewer-zoom").boundingBox();
      assert(close.x > download.x && close.y < 20);
      assert(Math.abs(zoom.x + zoom.width / 2 - actual.width / 2) < 1);
      assert(actual.height - zoom.y - zoom.height < 30);
    };
    await open(2);
    await chrome();
    await expect(
      dialog.getByRole("button", { name: "Previous image" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Next image" }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/viewer-desktop-portrait.png" });
    await page.keyboard.press("ArrowLeft");
    await expect(image).toHaveAttribute("alt", "viewer-1.png");
    await expect(
      dialog.getByRole("button", { name: "Previous image" }),
    ).toHaveCount(0);
    await expect(image).toBeVisible();
    const fit = await scale.textContent();
    await image.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(scale).not.toHaveText(fit);
    await page.keyboard.press("+");
    const before = await image.boundingBox();
    await page.mouse.move(720, 500);
    await page.mouse.down();
    await page.mouse.move(810, 550, { steps: 5 });
    await page.mouse.up();
    const after = await image.boundingBox();
    assert(after.x > before.x, "Zoomed image can pan horizontally");
    await expect(dialog).toBeVisible();
    await scale.click();
    await expect(scale).toHaveText(fit);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -300);
    await expect(scale).not.toHaveText(fit);
    await page.keyboard.press("0");
    await expect(scale).toHaveText(fit);
    await image.dblclick();
    await expect(scale).not.toHaveText(fit);
    await image.dblclick();
    await expect(scale).toHaveText(fit);
    await page.screenshot({
      path: "test-results/viewer-desktop-landscape.png",
    });
    const downloadEvent = page.waitForEvent("download");
    await dialog.getByRole("link", { name: "Download image" }).click();
    const downloaded = await downloadEvent;
    assert.equal(downloaded.suggestedFilename(), "viewer-1.png");
    assert.deepEqual(
      await fs.readFile(await downloaded.path()),
      pictures[0].buffer,
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(image).toHaveAttribute("alt", "viewer-3.png");
    await expect(
      dialog.getByRole("button", { name: "Next image" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Enlarge viewer-2.png", exact: true }),
    ).toBeFocused();
    await open(1);
    await page.mouse.click(70, 80);
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const hideMembers = page.getByRole("button", {
      name: "Hide member list",
      exact: true,
    });
    if (await hideMembers.isVisible()) await hideMembers.click();
    await open(2);
    await chrome();
    await page.screenshot({ path: "test-results/viewer-mobile-portrait.png" });
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([x, y, id]) => ({ x, y, id })),
      });
    const mobileFit = await scale.textContent();
    await touch("touchStart", [
      [155, 380, 1],
      [235, 460, 2],
    ]);
    await touch("touchMove", [
      [100, 320, 1],
      [290, 520, 2],
    ]);
    await touch("touchEnd", []);
    await expect(scale).not.toHaveText(mobileFit);
    await expect(dialog).toBeVisible();
    await scale.click();
    await expect(scale).toHaveText(mobileFit);
    await touch("touchStart", [[280, 450, 1]]);
    await touch("touchMove", [[100, 450, 1]]);
    await touch("touchEnd", []);
    await expect(image).toHaveAttribute("alt", "viewer-3.png");
    await dialog.getByRole("button", { name: "Previous image" }).click();
    await expect(image).toHaveAttribute("alt", "viewer-2.png");
    await dialog.getByRole("button", { name: "Previous image" }).click();
    await expect(image).toHaveAttribute("alt", "viewer-1.png");
    await page.screenshot({ path: "test-results/viewer-mobile-landscape.png" });
    await dialog.getByRole("button", { name: "Close image preview" }).click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS actual attachment viewer: desktop/mobile full overlay, gallery boundaries, keyboard, zoom/pan, pinch/swipe, download bytes, Escape/backdrop close, focus restoration",
    );
  } finally {
    await context.close();
  }
}
