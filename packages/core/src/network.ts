// Receives a hostname canonicalized by URL, never a resolved DNS name.
export function localHTTPHost(host: string): boolean {
  if (host === "localhost" || host === "[::1]") return true;
  if (/^\[f[cd][0-9a-f]{2}:[0-9a-f:]+\]$/.test(host)) return true;
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host);
  const octets = mapped
    ? [
        parseInt(mapped[1], 16) >> 8,
        parseInt(mapped[1], 16) & 255,
        parseInt(mapped[2], 16) >> 8,
        parseInt(mapped[2], 16) & 255,
      ]
    : /^\d+\.\d+\.\d+\.\d+$/.test(host)
      ? host.split(".").map(Number)
      : [];
  if (octets.length !== 4 || octets.some((v) => v < 0 || v > 255)) return false;
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}
