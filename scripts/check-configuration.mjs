import { fillSignin } from "./signin-fields.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function checkConfiguration(page, fixtures, label = "browser") {
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
    await expect(page.getByRole("status")).toHaveText(
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
    await expect(page.getByRole("status")).toContainText(
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
    await expect(page.getByRole("status")).toContainText("Connection verified");
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
    await expect(page.getByRole("status")).toContainText(
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
    await expect(page.getByRole("status")).toContainText(
      "Server configuration saved",
    );
    await page.getByLabel("Future image limit", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Save configuration", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Server configuration saved",
    );
    await page.screenshot({
      path: `test-results/server-configuration-${label}.png`,
    });
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
