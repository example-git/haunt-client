import { afterEach, expect, it, vi } from "vitest";
import { EncodedTransport } from "../packages/browser/src/media/encoded";
import type { TransportContext } from "../packages/browser/src/media/types";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  vi.stubGlobal("WebSocket", { OPEN: 1 });
  const failed = vi.fn();
  const transport = new EncodedTransport({
    failed,
  } as unknown as TransportContext);
  const socket = { readyState: 1, bufferedAmount: 0, send: vi.fn() };
  const publisher = { revision: 1, sequence: 0, key: false, needsKey: false };
  Object.assign(transport, {
    socket,
    stateValue: {
      muted: false,
      deafened: false,
      camera_off: false,
      screen_off: false,
    },
  });
  const send = (type: "key" | "delta", size = 10) =>
    (transport as any).send(
      {
        type,
        byteLength: size,
        copyTo: (data: Uint8Array) => data.fill(1),
        timestamp: 1000,
        duration: 1000,
      },
      "camera",
      publisher,
    );
  return { failed, socket, publisher, send };
}
it("reports oversized selected video frames instead of silently losing every keyframe", () => {
  const { send, failed, socket } = fixture();
  send("key", 600_000);
  expect(socket.send).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining("frame size limit"),
    }),
  );
});
it("waits for a complete keyframe after backpressure drops a reference frame", () => {
  const { send, publisher, socket, failed } = fixture();
  send("key");
  socket.bufferedAmount = 600_000;
  send("delta");
  socket.bufferedAmount = 0;
  send("delta");
  expect(socket.send).toHaveBeenCalledTimes(1);
  expect(publisher.key).toBe(true);
  send("key");
  send("delta");
  expect(socket.send).toHaveBeenCalledTimes(3);
  expect(publisher.sequence).toBe(3);
  expect(failed).not.toHaveBeenCalled();
});
