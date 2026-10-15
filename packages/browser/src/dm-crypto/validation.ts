import type { PlainPayload, SecretImage } from "./storage";
import { un64 } from "./engine";
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const base64 = (v: unknown, size: number) =>
  typeof v === "string" &&
  v.length <= Math.ceil(size / 3) * 4 &&
  un64(v).length === size;
export function validateImage(i: SecretImage) {
  if (
    !i ||
    !uuid(i.id) ||
    !uuid(i.token) ||
    !uuid(i.author) ||
    !uuid(i.conversation) ||
    !base64(i.key, 32) ||
    !["image/webp", "image/jpeg"].includes(i.type) ||
    typeof i.name !== "string" ||
    i.name.length > 128 ||
    /[\x00-\x1f]/.test(i.name) ||
    !Number.isSafeInteger(i.bytes) ||
    i.bytes < 1 ||
    i.bytes > 20 * 1024 * 1024
  )
    throw Error("Invalid encrypted image metadata");
}
export function validatePlain(p: PlainPayload) {
  if (
    !p ||
    p.version !== 1 ||
    typeof p.instance !== "string" ||
    p.instance.length > 128 ||
    !uuid(p.conversation) ||
    !uuid(p.author) ||
    !uuid(p.device) ||
    !uuid(p.request) ||
    (p.edit !== undefined && !uuid(p.edit)) ||
    typeof p.body !== "string" ||
    p.body.length > 24000 ||
    !Array.isArray(p.images) ||
    p.images.length > 8
  )
    throw Error("Invalid encrypted message");
  for (const image of p.images) {
    validateImage(image);
    if (image.conversation !== p.conversation || image.author !== p.author)
      throw Error("Image belongs to a different conversation");
  }
  if (new Set(p.images.map((i) => i.id)).size !== p.images.length)
    throw Error("Duplicate encrypted image");
}
