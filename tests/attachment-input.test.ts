import { describe, expect, it, vi } from "vitest";
import { AttachmentDraft } from "../packages/browser/src/attachment-input";
import type { InstanceClient } from "@haunt/core";

const file = (name = "image.png", type = "image/png", size = 10) =>
  new File([new Uint8Array(size)], name, { type });
function fixture(dm=false,enabled=true) {
  const requests: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    room: string;
  }[] = [];
  const upload = vi.fn(
    (room, _file, _name, signal) =>
      new Promise((resolve, reject) =>
        requests.push({ resolve, reject, signal, room }),
      ),
  );
  const instance = {
    upload,
    isDM:()=>dm,
    account: {
      instance: { limits: { image_max_bytes: 100, video_max_bytes: 200, dm:{images_enabled:enabled} } },
    },
  } as unknown as InstanceClient;
  return { draft: new AttachmentDraft(instance, "room-a"), requests, upload };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("attachment intake", () => {
  it("allows only compressible images in DMs and honors disabled uploads for every intake source",()=>{
    const active=fixture(true);active.draft.add([file("clip.mp4","video/mp4"),file("pic.png","image/png",101)]);
    expect(active.upload).toHaveBeenCalledTimes(1);expect(active.draft.getSnapshot().error).toContain("images only");active.draft.dispose();
    const disabled=fixture(true,false);disabled.draft.add([file()]);expect(disabled.upload).not.toHaveBeenCalled();expect(disabled.draft.getSnapshot().error).toContain("disabled");disabled.draft.dispose();
  });
  it("reserves slots across simultaneous sources and bounds uploads to two", async () => {
    const { draft, requests, upload } = fixture();
    draft.add(Array.from({ length: 6 }, () => file()));
    draft.add(Array.from({ length: 5 }, () => file()));
    expect(draft.getSnapshot().entries).toHaveLength(8);
    expect(draft.getSnapshot().error).toContain("up to 8");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(draft.lock()).toBe(false);
    requests[1].resolve({ id: "second" });
    await settle();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(draft.getSnapshot().entries[1].attachment?.id).toBe("second");
    draft.dispose();
  });
  it("validates all input sources, tolerates missing MIME, and releases failed slots", async () => {
    const { draft, requests, upload } = fixture();
    draft.add([
      file("huge.png", "image/png", 101),
      file("bad.exe", "application/octet-stream"),
      file("empty.png", "image/png", 0),
      file("camera.PNG", ""),
    ]);
    expect(draft.getSnapshot().entries).toHaveLength(1);
    expect(upload.mock.calls[0][1].type).toBe("image/png");
    requests[0].reject(Error("failed"));
    await settle();
    expect(draft.getSnapshot().entries).toHaveLength(0);
    draft.add([file()]);
    requests[1].resolve({ id: "ready" });
    await settle();
    expect(draft.lock()).toBe(true);
    draft.add([file()]);
    expect(draft.getSnapshot().entries).toHaveLength(1);
    draft.clear();
    draft.unlock();
    draft.add([file()]);
    expect(upload).toHaveBeenCalledTimes(3);
    draft.dispose();
  });
  it("cancels on conversation exit and ignores late results", async () => {
    const { draft, requests, upload } = fixture();
    draft.add([file(), file(), file()]);
    const listener = vi.fn();
    draft.subscribe(listener);
    draft.dispose();
    expect(
      requests.every(
        (request) => request.signal.aborted && request.room === "room-a",
      ),
    ).toBe(true);
    requests[0].resolve({ id: "too-late" });
    await settle();
    expect(listener).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
