import init, {
  operation,
} from "../../../../static/dm-crypto/haunt_dm_crypto.js";
const ready = init();
self.onmessage = async (event: MessageEvent<{ id: number; input: string }>) => {
  const { id, input } = event.data;
  try {
    await ready;
    self.postMessage({ id, result: operation(input) });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : "Encryption operation failed",
    });
  }
};
