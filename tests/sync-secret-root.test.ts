import { describe, expect, it } from "vitest";
import { deterministicRoot } from "../packages/browser/src/sync/crypto";

describe("client-only deterministic sync root", () => {
  it("matches an independent Go Argon2id fixture and requires both unchanged secrets", async () => {
    const password = "synthetic deterministic password",
      keyword = "synthetic deterministic keyword";
    // Generated independently with golang.org/x/crypto/argon2.IDKey, v0.58.0.
    const expected = "4JLDj67A48CAdMWVaqMKL8MM0AzPXl4o-RowCd6YIxQ";
    expect(await deterministicRoot(password, keyword)).toBe(expected);
    expect(await deterministicRoot(password, keyword)).toBe(expected);
    expect(await deterministicRoot(password + " changed", keyword)).not.toBe(
      expected,
    );
    expect(await deterministicRoot(password, keyword + " changed")).not.toBe(
      expected,
    );
    await expect(deterministicRoot(password, "")).rejects.toThrow();
  });
});
