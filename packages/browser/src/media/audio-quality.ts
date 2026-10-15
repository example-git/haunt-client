// Small private rooms default to high-quality Opus without a user-facing tier.
// WebRTC may still adapt to the actual connection's available bandwidth.
export const audioBitrate = 510_000;

/** Declare full-band/stereo receive capability. Apply per audio section, never
 * to a video codec's fmtp or to a non-Opus payload. */
export function fullBandOpus(sdp: string) {
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith("m=audio ")) return section;
      const payload = /^a=rtpmap:(\d+) opus\/48000(?:\/2)?\r?$/im.exec(
        section,
      )?.[1];
      if (!payload) return section;
      const re = new RegExp(`^a=fmtp:${payload} ([^\\r\\n]*)`, "m");
      const existing = re.exec(section)?.[1] ?? "";
      const values = new Map(
        existing
          .split(";")
          .filter(Boolean)
          .map((p) => {
            const [name, value] = p.trim().split("=");
            return [name, value];
          }),
      );
      for (const [key, value] of Object.entries({
        maxaveragebitrate: String(audioBitrate),
        maxplaybackrate: "48000",
        stereo: "1",
        useinbandfec: "1",
      }))
        values.set(key, value);
      const line = `a=fmtp:${payload} ${[...values].map(([k, v]) => `${k}=${v}`).join(";")}`;
      return re.test(section)
        ? section.replace(re, line)
        : section + line + "\r\n";
    })
    .join("");
}
