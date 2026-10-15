import { deriveSecretRoot } from "./root-kdf";

self.onmessage = async (
  event: MessageEvent<{ password: string; keyword: string }>,
) => {
  try {
    self.postMessage({
      root: await deriveSecretRoot(event.data.password, event.data.keyword),
    });
  } catch {
    self.postMessage({
      error: "Could not derive the sync key. Check both secret values.",
    });
  }
};
