const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

function isVideoTicket(url) {
  return (
    /^\/api\/v1\/conversations\/[a-f0-9-]{36}\/messages\/[a-f0-9-]{36}\/embeds\/video$/.test(
      url.pathname,
    ) && /^[a-f0-9]{48}$/.test(url.searchParams.get("ticket") || "")
  );
}
async function writeRanges(url, destination, fetch, signal, progress) {
  const temporary = destination + "." + randomUUID() + ".part";
  let file;
  try {
    file = await fs.open(temporary, "wx", 0o600);
    let offset = 0,
      total,
      type;
    do {
      signal.throwIfAborted();
      const response = await fetch(url, {
        headers: { Range: `bytes=${offset}-${offset + 8 * 1024 * 1024 - 1}` },
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        response.headers.get("Content-Range") || "",
      );
      const contentType = response.headers.get("Content-Type")?.split(";")[0];
      const end = range ? Number(range[2]) : -1;
      const size = range ? Number(range[3]) : -1;
      if (
        response.status !== 206 ||
        !range ||
        Number(range[1]) !== offset ||
        !Number.isSafeInteger(size) ||
        size <= end ||
        end < offset ||
        end - offset >= 8 * 1024 * 1024 ||
        (total !== undefined && size !== total) ||
        !["video/mp4", "video/webm"].includes(contentType) ||
        (type && type !== contentType) ||
        !response.body
      ) {
        await response.body?.cancel();
        throw Error(
          "Video download returned an incomplete or changed byte range. Open the media and retry.",
        );
      }
      total = size;
      type = contentType;
      const reader = response.body.getReader();
      try {
        for (;;) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          if (done) break;
          if (offset + value.byteLength > end + 1)
            throw Error("Video download exceeded its byte range.");
          let written = 0;
          while (written < value.byteLength) {
            const { bytesWritten } = await file.write(
              value,
              written,
              value.byteLength - written,
              offset + written,
            );
            if (!bytesWritten)
              throw Error("The download file could not be written.");
            written += bytesWritten;
          }
          offset += value.byteLength;
          progress(offset, total);
        }
      } finally {
        await reader.cancel();
      }
      if (offset !== end + 1)
        throw Error("Video download ended before all bytes arrived.");
    } while (offset < total);
    signal.throwIfAborted();
    await file.sync();
    await file.close();
    file = undefined;
    await fs.rename(temporary, destination);
  } finally {
    await file?.close();
    await fs.rm(temporary, { force: true });
  }
}
module.exports = { isVideoTicket, writeRanges };
