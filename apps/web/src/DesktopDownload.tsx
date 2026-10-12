import { useEffect, useState, useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import type { InstanceClient } from "@haunt/core";
import updates from "../../../static/updates.json";

type Installer = {
  file: string;
  size: number;
  sha256: string;
  version: string;
};
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export async function verifyInstaller(
  envelope: { schema: number; payload: string; signature: string },
  target: string,
  publicKey = updates.publicKey,
): Promise<Installer> {
  if (
    !publicKey ||
    envelope.schema !== 1 ||
    envelope.payload.length > 128 * 1024
  )
    throw Error("Invalid installer manifest");
  const key = await crypto.subtle.importKey(
    "spki",
    decode(publicKey.replace(/-----[^-]+-----|\s/g, "")),
    "Ed25519",
    false,
    ["verify"],
  );
  const payload = decode(envelope.payload);
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      decode(envelope.signature),
      payload,
    ))
  )
    throw Error("Installer signature could not be verified");
  const manifest = JSON.parse(new TextDecoder().decode(payload));
  const file = manifest.targets?.[target]?.installer;
  const extension = target.startsWith("win32")
    ? ".exe"
    : target.startsWith("darwin")
      ? ".dmg"
      : ".AppImage";
  if (
    manifest.schema !== 1 ||
    manifest.repository !== updates.repository ||
    !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(
      manifest.version,
    ) ||
    !file ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(file.file) ||
    !file.file.endsWith(extension) ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > 1024 ** 3
  )
    throw Error("Invalid installer metadata");
  return { ...file, version: manifest.version };
}
export function installerTarget(ua: string) {
  if (/Android|iPhone|iPad/i.test(ua)) return null;
  if (/Macintosh|Mac OS X/i.test(ua)) return "darwin-arm64";
  if (/Windows/i.test(ua)) return "win32-x64";
  if (/Linux/i.test(ua))
    return /aarch64|arm64/i.test(ua) ? "linux-arm64" : "linux-x64";
  return null;
}
export function DesktopDownload({ instance }: { instance: InstanceClient }) {
  const { status } = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
  );
  const [installer, setInstaller] = useState<Installer>();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState("");
  const [controller, setController] = useState<AbortController>();
  const enabled =
    !window.hauntDesktop &&
    instance.account.instance.client_updates?.installers &&
    status === "online";
  const target = installerTarget(navigator.userAgent);
  const base = instance.account.origin + "/api/v1/client-updates/";
  const headers = { Authorization: `Bearer ${instance.account.login.token}` };
  useEffect(() => {
    setInstaller(undefined);
    if (!enabled || !target) return;
    const abort = new AbortController();
    void fetch(base + "installers", {
      headers,
      signal: abort.signal,
      redirect: "error",
      credentials: "omit",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const text = await response.text();
        if (text.length > 192 * 1024)
          throw Error("Installer manifest too large");
        const result = JSON.parse(text);
        if (!result.available?.includes(target)) return;
        const verified = await verifyInstaller(result.manifest, target);
        if (!abort.signal.aborted) setInstaller(verified);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [instance, enabled, target, base]);
  useEffect(() => () => controller?.abort(), [controller]);
  if (!installer || !enabled) return null;
  const download = async () => {
    const abort = new AbortController();
    setController(abort);
    setError("");
    setProgress(0);
    try {
      const response = await fetch(
        `${base}${installer.version}/${installer.file}`,
        {
          headers,
          signal: abort.signal,
          redirect: "error",
          credentials: "omit",
        },
      );
      if (!response.ok || !response.body)
        throw Error("The installer could not be downloaded.");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > installer.size) {
          await reader.cancel();
          throw Error("Installer exceeds its verified size.");
        }
        chunks.push(value);
        setProgress(size / installer.size);
      }
      const blob = new Blob(chunks, { type: "application/octet-stream" });
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      );
      if (
        size !== installer.size ||
        [...digest].map((x) => x.toString(16).padStart(2, "0")).join("") !==
          installer.sha256
      )
        throw Error("Installer checksum could not be verified.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = installer.file;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setProgress(undefined);
    }
  };
  return (
    <div className="desktop-download">
      <button
        className="desktop-update-notice"
        title={error || `Download Haunt ${installer.version} (${target})`}
        disabled={progress !== undefined}
        onClick={() => void download()}
      >
        <Download size={16} />
        <span>
          {progress === undefined
            ? "Desktop app"
            : `${Math.round(progress * 100)}%`}
        </span>
      </button>
      {error && (
        <span className="small error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
