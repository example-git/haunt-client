import { expect, it } from "vitest";
import {
  messageDay,
  messageDayLabel,
  messageTimestamp,
} from "../packages/browser/src/message-dates";

it("adds the date at 24 hours, retaining time for newer and future messages", () => {
  const sent = new Date(2026, 9, 18, 18, 39);
  const iso = sent.toISOString();
  const time = sent.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  expect(messageTimestamp(iso, +sent + 86_399_999)).toBe(time);
  expect(messageTimestamp(iso, +sent - 1000)).toBe(time);
  expect(messageTimestamp(iso, +sent + 86_400_000)).toContain("2026");
  expect(messageTimestamp(iso, +sent + 86_400_000)).toContain(time);
});

it("divides by the viewer's calendar day rather than rolling 24-hour buckets", () => {
  const before = new Date(2026, 9, 18, 23, 59);
  const after = new Date(2026, 9, 19, 0, 1);
  expect(messageDay(before.toISOString())).not.toBe(
    messageDay(after.toISOString()),
  );
  expect(messageDay(after.toISOString())).toBe(
    messageDay(new Date(2026, 9, 19, 23, 59).toISOString()),
  );
  expect(messageDayLabel(before.toISOString())).toBe(
    before.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  );
});
