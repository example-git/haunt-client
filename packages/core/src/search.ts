import { cachedMessage } from "./message-content.js";
import type { Message } from "./types.js";

export interface SearchOptions {
  before?: number;
  limit?: number;
  signal?: AbortSignal;
  onProgress?: (indexed: number) => void;
}
export interface SearchPage {
  messages: Message[];
  hasMore: boolean;
}
export function searchWords(text: string) {
  return [
    ...new Set(
      text
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu) ?? [],
    ),
  ];
}
export function searchableWords(raw: Message) {
  const message = cachedMessage(raw);
  return message.deleted ||
    message.security === "pending" ||
    message.security === "unavailable"
    ? []
    : searchWords(message.body);
}
export function searchLimit(options: SearchOptions) {
  return Math.max(1, Math.min(100, options.limit ?? 50));
}
