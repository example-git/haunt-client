const retained = new Map<string, string>();
let subscribed = false;
async function downloadBlob(source: string) {
  const parts: Blob[] = [];
  let offset = 0,
    total: number | undefined,
    type = "";
  do {
    const response = await fetch(source, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: offset
        ? {
            Range: `bytes=${offset}-${Math.min(total! - 1, offset + 8 * 1024 * 1024 - 1)}`,
          }
        : undefined,
    });
    if (!response.ok) throw Error("The download source is unavailable.");
    if (!offset && response.status === 200) return response.blob();
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      response.headers.get("Content-Range") || "",
    );
    const end = Number(range?.[2]),
      size = Number(range?.[3]);
    const nextType =
      response.headers.get("Content-Type") || "application/octet-stream";
    if (
      response.status !== 206 ||
      !range ||
      Number(range[1]) !== offset ||
      !Number.isSafeInteger(size) ||
      size <= end ||
      end < offset ||
      (total !== undefined && size !== total) ||
      (type && nextType !== type)
    ) {
      await response.body?.cancel();
      throw Error("The download returned an incomplete or changed byte range.");
    }
    const part = await response.blob();
    if (part.size !== end + 1 - offset)
      throw Error("The download ended before all bytes arrived.");
    parts.push(part);
    offset += part.size;
    total = size;
    type = nextType;
  } while (offset < total);
  return new Blob(parts, { type });
}
export async function saveMedia(source: string, filename: string) {
  const downloads = window.hauntDesktop?.downloads;
  if (downloads) {
    if (!subscribed) {
      subscribed = true;
      downloads.subscribe((items) => {
        const ids = new Set(
          items
            .filter((item) => item.state !== "completed")
            .map((item) => item.sourceKey),
        );
        for (const [id, url] of retained)
          if (!ids.has(id)) {
            URL.revokeObjectURL(url);
            retained.delete(id);
          }
      });
    }
    const owned = source.startsWith("blob:")
      ? URL.createObjectURL(await (await fetch(source)).blob())
      : undefined;
    try {
      const id = await downloads.start(owned ?? source, filename.slice(0, 255));
      if (owned) {
        const entry = (await downloads.list()).find((item) => item.id === id);
        if (entry && entry.state !== "completed")
          retained.set(entry.sourceKey, owned);
        else URL.revokeObjectURL(owned);
      }
    } catch (error) {
      if (owned) URL.revokeObjectURL(owned);
      throw error;
    }
  } else {
    const owned = source.startsWith("blob:")
      ? undefined
      : URL.createObjectURL(await downloadBlob(source));
    const link = document.createElement("a");
    link.href = owned ?? source;
    link.download = filename;
    link.click();
    if (owned) setTimeout(() => URL.revokeObjectURL(owned), 60000);
  }
}
