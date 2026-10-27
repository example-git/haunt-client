import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export async function checkConfiguration(
  page,
  fixtures,
  label = "browser",
  desktop,
) {
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const storagePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-storage-ui-"),
  );
  try {
    await page.getByRole("button", { name: "Add server", exact: true }).click();
    await fillSignin(page, fixtures.rtc.url, "owner");
    await page.getByLabel("Password", { exact: true }).fill(fixtures.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".connection")).toHaveText("Connected");
    const openSettings = async () => {
      await page
        .getByRole("button", { name: "Server settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Limits & access", exact: true })
        .click();
    };
    await openSettings();
    const maximum = page.getByLabel("Maximum image upload (MiB)", {
      exact: true,
    });
    await expect(maximum).toBeVisible();
    await maximum.fill("25");
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
      "Server configuration saved and applied.",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await openSettings();
    await expect(maximum).toHaveValue("25");
    await page
      .getByRole("button", { name: "Storage providers", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Register storage provider", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill(`${label} network share`);
    await page
      .getByLabel("Storage type", { exact: true })
      .selectOption("local");
    await page
      .getByLabel("Absolute server path", { exact: true })
      .fill(storagePath);
    await page
      .getByRole("button", { name: "Test & register", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Storage verified and registered",
    );
    const provider = page
      .locator(".storage-provider")
      .filter({ hasText: `${label} network share` });
    await provider
      .getByRole("button", { name: "Use for new uploads", exact: true })
      .click();
    await expect(provider).toContainText("Active");
    await expect(
      provider.getByRole("button", { name: "Remove", exact: true }),
    ).toBeDisabled();
    await provider
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Connection verified",
    );
    await page
      .locator(".storage-provider")
      .filter({ hasText: "Built-in local storage" })
      .getByRole("button", { name: "Use for new uploads", exact: true })
      .click();
    await expect(
      provider.getByRole("button", { name: "Remove", exact: true }),
    ).toBeEnabled();
    await provider.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(provider).toHaveCount(0);
    await page
      .getByRole("button", { name: "Register storage provider", exact: true })
      .click();
    await page.getByLabel("Storage type", { exact: true }).selectOption("s3");
    for (const [preset, region, pathStyle] of [
      ["r2", "auto", true],
      ["b2", "", true],
      ["spaces", "us-east-1", false],
      ["minio", "us-east-1", true],
      ["custom", "us-east-1", true],
      ["s3", "us-east-1", false],
    ]) {
      await page
        .getByLabel("Storage type", { exact: true })
        .selectOption(preset);
      await expect(page.getByLabel("Region", { exact: true })).toHaveValue(
        region,
      );
      await expect(
        page.getByLabel(
          "Path-style requests (MinIO and some compatible hosts)",
          { exact: true },
        ),
      ).toBeChecked({ checked: pathStyle });
      await expect(
        page.getByLabel("Endpoint (leave empty for Amazon S3)", {
          exact: true,
        }),
      ).toHaveJSProperty("required", preset !== "s3");
    }
    await expect(
      page.getByLabel("Secret key", { exact: true }),
    ).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Limits & access", exact: true })
      .click();
    await maximum.fill("2");
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Server configuration saved",
    );
    // A new page/field can arrive from the server without a client component.
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.route("**/api/v1/menus/server", async (route) => {
      const response = await route.fetch(),
        menu = await response.json();
      const page = structuredClone(
        menu.pages.find((p) => p.id === "configuration"),
      );
      page.id = "future-policy";
      page.label = "Future server policy";
      page.form.fields[0].label = "Future image limit";
      menu.pages.push(page);
      await route.fulfill({ response, json: menu });
    });
    await page
      .getByRole("button", { name: "Server settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Future server policy", exact: true })
      .click();
    await expect(
      page.getByLabel("Future image limit", { exact: true }),
    ).toHaveValue("2");
    await page.getByLabel("Future image limit", { exact: true }).fill("3");
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Server configuration saved",
    );
    await page.getByLabel("Future image limit", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Server configuration saved",
    );
    await page.screenshot({
      path: `test-results/server-configuration-${label}.png`,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", {
        name: /^(Client settings|Account settings)$/,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "History & downloads", exact: true })
      .click();
    const rate = page.getByLabel("Archive download limit (KiB/s)", {
      exact: true,
    });
    const requests = page.getByLabel("Archive requests per minute", {
      exact: true,
    });
    await rate.fill("32");
    await requests.fill("12");
    const automatic = page.getByLabel(
      "Automatically archive the open conversation",
      { exact: true },
    );
    await automatic.uncheck();
    const policy = () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("chatxo-client-preferences-v1"))
            .archive,
      );
    assert.deepEqual(await policy(), {
      automatic: false,
      bytesPerSecond: 32768,
      requestsPerMinute: 12,
    });
    await requests.fill("0");
    await expect(requests).toHaveValue("0");
    assert.equal(
      await requests.evaluate((input) => input.validity.valid),
      false,
    );
    assert.equal((await policy()).requestsPerMinute, 12);
    await requests.fill("30");
    await rate.fill("64");
    await automatic.check();
    await page.screenshot({
      path: `test-results/archive-settings-${label}.png`,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const savedText = `Archive retention ${label} ${Date.now()}`;
    await page.getByLabel("Message", { exact: true }).fill(savedText);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const row = page
      .locator(".message")
      .filter({ has: page.locator(".message-body", { hasText: savedText }) });
    await expect(row).toHaveCount(1);
    await row.hover();
    await row
      .getByRole("button", { name: "Message options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Delete message…", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete message", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await page
      .getByRole("button", {
        name: /^(Client settings|Account settings)$/,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Backup & restore", exact: true })
      .click();
    const archive = page.locator(".text-archive-backups");
    await archive
      .getByRole("button", { name: "Browse saved text", exact: true })
      .click();
    const saved = archive.locator("article").filter({ hasText: savedText });
    await expect(saved).toHaveCount(1);
    const exportFile = async (name) => {
      const destination = path.join(storagePath, name);
      if (desktop) {
        await desktop.evaluate(({ session }, destination) => {
          globalThis.archiveDownloadResult = "pending";
          session
            .fromPartition("persist:chatxo")
            .once("will-download", (_event, item) => {
              item.setSavePath(destination);
              item.once("done", (_event, state) => {
                globalThis.archiveDownloadResult = state;
              });
            });
        }, destination);
        await archive
          .getByRole("button", { name: "Export message text", exact: true })
          .click();
        await expect
          .poll(() => desktop.evaluate(() => globalThis.archiveDownloadResult))
          .toBe("completed");
      } else {
        const completed = page.waitForEvent("download");
        await archive
          .getByRole("button", { name: "Export message text", exact: true })
          .click();
        await (await completed).saveAs(destination);
      }
      return destination;
    };
    const file = await exportFile("saved.jsonl.gz");
    const text = gunzipSync(await fs.readFile(file)).toString("utf8");
    assert.ok(text.includes(savedText));
    assert.ok(!text.includes('"attachment_ids"'));
    assert.ok(!text.includes('"token"'));
    await saved
      .getByRole("button", { name: "Delete from my archive", exact: true })
      .click();
    await expect(saved).toHaveCount(0);
    await archive
      .getByLabel("Message text archive file", { exact: true })
      .setInputFiles(file);
    await archive
      .getByRole("button", { name: "Import message text", exact: true })
      .click();
    await expect(archive.getByRole("status")).toHaveText(
      "Text restored to the private archive. Live chat is unchanged.",
    );
    await expect(saved).toHaveCount(0);
    const removedFile = await exportFile("removed.jsonl.gz");
    assert.ok(
      !gunzipSync(await fs.readFile(removedFile))
        .toString("utf8")
        .includes(savedText),
    );
    await page.screenshot({ path: `test-results/text-archive-${label}.png` });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        check: "server-configuration",
        client: label,
        passed: true,
      }),
    );
  } finally {
    await fs.rm(storagePath, { recursive: true, force: true });
  }
}
