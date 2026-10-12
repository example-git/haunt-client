import { describe, expect, it } from "vitest";
import { emojiTokens } from "../packages/core/src/emojis";
describe("server emoji tokens", () => {
  it("finds names without interpreting code, links or unknown markup", () => {
    const text =
      ":Wave: :wave_2: `:code:` ```\n:hidden:\n``` https://example.test/:url: <script>:safe:</script>";
    expect(emojiTokens(text).map((t) => t.name)).toEqual([
      "wave",
      "wave_2",
      "safe",
    ]);
    for (const t of emojiTokens(text))
      expect(text.slice(t.start, t.end).toLowerCase()).toBe(`:${t.name}:`);
  });
  it("leaves invalid names and ordinary punctuation alone", () => {
    expect(
      emojiTokens("10:30 hello :x: :bad-name: :" + "a".repeat(33) + ":"),
    ).toEqual([]);
  });
});
