import { dmStorageChanged } from "../dm-storage";
import type { InstanceClient, Schemas } from "@haunt/core";
import { cryptoDB, type SecretImage } from "./storage";
import { un64, bytes64, utf8 } from "./engine";
const maxSource = 20 * 1024 * 1024;
// Read dimensions before allocating an image bitmap. No SVG or arbitrary files.
export function rasterInfo(b: Uint8Array): {
  width: number;
  height: number;
  type: string;
} {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength),
    ascii = (s: number, n: number) =>
      String.fromCharCode(...b.subarray(s, s + n));
  let width = 0,
    height = 0,
    type = "";
  if (
    b.length >= 24 &&
    ascii(1, 3) === "PNG" &&
    b[0] === 137 &&
    ascii(12, 4) === "IHDR"
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
    type = "image/png";
  } else if (b.length >= 10 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
    type = "image/gif";
  } else if (
    b.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    const chunk = ascii(12, 4);
    type = "image/webp";
    if (chunk === "VP8X") {
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (
      chunk === "VP8 " &&
      b[23] === 0x9d &&
      b[24] === 1 &&
      b[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === "VP8L" && b[20] === 0x2f) {
      width = 1 + ((b[22] & 0x3f) << 8) + b[21];
      height = 1 + ((b[24] & 0xf) << 10) + (b[23] << 2) + (b[22] >> 6);
    }
  } else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    type = "image/jpeg";
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i++] !== 255) break;
      while (i < b.length && b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > b.length) break;
      const length = view.getUint16(i);
      if (length < 2 || i + length > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = view.getUint16(i + 3);
        width = view.getUint16(i + 5);
        break;
      }
      i += length;
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16_777_216
  )
    throw Error(
      "Choose a raster image up to 16 megapixels and 8192 pixels per side",
    );
  return { width, height, type };
}
async function compress(file: Blob, limit: number) {
  if (!file.size || file.size > maxSource)
    throw Error("Choose an image up to 20 MiB before compression");
  const info = rasterInfo(new Uint8Array(await file.arrayBuffer()));
  const bitmap = await createImageBitmap(new Blob([file], { type: info.type }));
  try {
    let scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale)),
        height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
      const encode = (type: string) =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(Error("Image compression failed")),
            type,
            attempt ? 0.72 : 0.84,
          ),
        );
      let blob = await encode("image/webp");
      if (blob.type !== "image/webp") blob = await encode("image/jpeg");
      canvas.width = canvas.height = 1;
      if (blob.size + 29 <= limit) return blob;
      scale *= 0.65;
    }
    throw Error("This image could not fit the server’s encrypted image limit");
  } finally {
    bitmap.close();
  }
}
const aad = (
  instance: InstanceClient,
  image: Pick<SecretImage, "conversation" | "author" | "token">,
) =>
  utf8(
    JSON.stringify([
      "haunt-dm-image-v1",
      instance.account.instance.instance_id,
      image.conversation,
      image.author,
      image.token,
    ]),
  );
export async function encryptImage(
  instance: InstanceClient,
  conversation: string,
  file: Blob,
  filename: string,
) {
  const policy = instance.account.instance.limits.dm;
  if (!policy?.images_enabled)
    throw Error("This server has disabled DM image uploads");
  const normalized = await compress(file, policy.image_max_bytes);
  const key = crypto.getRandomValues(new Uint8Array(32)),
    nonce = crypto.getRandomValues(new Uint8Array(12));
  const secret: SecretImage = {
    id: "",
    conversation,
    author: instance.account.login.user.id,
    token: crypto.randomUUID(),
    key: bytes64(key),
    type: normalized.type,
    name:
      (filename
        .replace(/[\x00-\x1f]/g, "_")
        .replace(/\.[^.]+$/u, "")
        .slice(0, 100) || "image") +
      (normalized.type === "image/webp" ? ".webp" : ".jpg"),
    bytes: normalized.size,
  };
  const imported = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
  ]);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(instance, secret) },
    imported,
    await normalized.arrayBuffer(),
  );
  const blob = new Blob([new Uint8Array([1]), nonce, cipher], {
    type: "application/octet-stream",
  });
  return {
    blob,
    finish: async (attachment: Schemas["AttachmentsAttachment"]) => {
      if (
        !attachment.encrypted ||
        attachment.conversation_id !== conversation ||
        attachment.user_id !== secret.author
      )
        throw Error("Server returned an invalid encrypted upload");
      secret.id = attachment.id;
      await (
        await cryptoDB()
      ).put("images", secret, [instance.scope, secret.id]);
      dmStorageChanged(instance);
    },
  };
}
export async function decryptImage(
  instance: InstanceClient,
  id: string,
  blob: Blob,
) {
  const secret = await (await cryptoDB()).get("images", [instance.scope, id]);
  if (!secret) throw Error("The image key is unavailable on this device");
  if (blob.size !== secret.bytes + 29 || blob.size > maxSource + 29)
    throw Error("Encrypted image length mismatch");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 1) throw Error("Unsupported encrypted image format");
  const imported = await crypto.subtle.importKey(
    "raw",
    un64(secret.key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes.subarray(1, 13),
      additionalData: aad(instance, secret),
    },
    imported,
    bytes.subarray(13),
  );
  const info = rasterInfo(new Uint8Array(clear));
  if (
    info.type !== secret.type ||
    !["image/webp", "image/jpeg"].includes(info.type)
  )
    throw Error("DM attachment is not an allowed image");
  const image = new Blob([clear], { type: info.type });
  // This runs on cache misses only; cachedMedia stores the authenticated, decoded image.
  const bitmap = await createImageBitmap(image);
  const valid =
    bitmap.width <= 8192 &&
    bitmap.height <= 8192 &&
    bitmap.width * bitmap.height <= 16_777_216;
  bitmap.close();
  if (!valid) throw Error("Decoded image exceeds dimension limits");
  return image;
}
