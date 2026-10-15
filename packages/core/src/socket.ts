import type { Runtime, SocketLike, WireEvent } from "./types.js";
import { APIError } from "./api.js";
/** A single bounded command queue: the protocol has no command correlation IDs. */
export class EventSocket {
  private socket?: SocketLike;
  private pending?: {
    match: (event: WireEvent) => boolean;
    resolve: (event: WireEvent) => void;
    reject: (error: Error) => void;
  };
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private closed = false;
  onEvent: (event: WireEvent) => void = () => {};
  onClose: () => void = () => {};
  constructor(
    private runtime: Runtime,
    private url: string,
  ) {}
  async open(token: string, instance: string): Promise<WireEvent> {
    const ws = this.runtime.socket(this.url);
    this.socket = ws;
    ws.onmessage = (event) => {
      try {
        if (typeof event.data !== "string" || event.data.length > 1_048_576)
          throw Error("Invalid event frame");
        const message = JSON.parse(event.data) as WireEvent;
        if (!message || typeof message.type !== "string")
          throw Error("Invalid event");
        const pending = this.pending;
        if (pending && message.type === "error") {
          this.pending = undefined;
          pending.reject(new APIError(400, String(message.error)));
        } else if (pending?.match(message)) {
          this.pending = undefined;
          pending.resolve(message);
        }
        this.onEvent(message);
      } catch {
        ws.close();
      }
    };
    ws.onclose = () => {
      this.pending?.reject(Error("Connection closed"));
      this.pending = undefined;
      if (!this.closed) this.onClose();
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(Error("Connection timed out"));
      }, 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(Error("Connection failed"));
      };
    });
    const ready = await this.command({ type: "authenticate", token }, "ready");
    if (ready.instance_id !== instance) {
      this.close();
      throw Error("Server identity changed. Sign in again.");
    }
    return ready;
  }
  command(
    command: WireEvent,
    reply: string,
    match: (event: WireEvent) => boolean = () => true,
  ): Promise<WireEvent> {
    if (++this.queued > 64) {
      this.queued--;
      return Promise.reject(Error("Too many pending commands"));
    }
    const run = this.tail
      .then(
        () =>
          new Promise<WireEvent>((resolve, reject) => {
            if (this.closed || this.socket?.readyState !== 1) {
              reject(Error("Not connected"));
              return;
            }
            const timer = setTimeout(() => {
              this.pending = undefined;
              reject(Error("Server response timed out"));
              this.socket?.close();
            }, 12_000);
            this.pending = {
              match: (event) => event.type === reply && match(event),
              resolve: (event) => {
                clearTimeout(timer);
                resolve(event);
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            };
            this.socket.send(JSON.stringify(command));
          }),
      )
      .finally(() => {
        this.queued--;
      });
    this.tail = run.catch(() => {});
    return run;
  }
  close() {
    this.closed = true;
    this.pending?.reject(Error("Connection closed"));
    this.pending = undefined;
    this.socket?.close();
  }
}
