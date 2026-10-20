import { validatePlain } from "./validation";
import {
  APIError,
  type InstanceClient,
  type Message,
  type PendingMessage,
  type Schemas,
  type DMEncryption,
} from "@haunt/core";
import { engine, bytes64, un64, utf8, text, type EngineResult } from "./engine";
import {
  cryptoDB,
  cryptoLock,
  cipherHash,
  type CryptoAccount,
  type PlainPayload,
  type SecretImage,
} from "./storage";
import { encryptImage, decryptImage } from "./images";
const prefix = "!haunt-mls-v1!";
type Bundle = Schemas["ChatDMCryptoBundle"];
type Control = Schemas["ChatDMCryptoEvent"];
const same = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export class MLSClient implements DMEncryption {
  private started?: Promise<void>;
  private bundles = new Map<string, { value: Bundle; at: number }>();
  private async bundle(id: string, minimum?: number) {
    const cached = this.bundles.get(id);
    if (
      minimum !== undefined &&
      cached &&
      cached.value.revision >= minimum &&
      Date.now() - cached.at < 30000
    )
      return cached.value;
    const value = await this.request<Bundle>(this.path(id));
    if (
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0 ||
      value.revision > 4096 ||
      !Array.isArray(value.devices) ||
      value.devices.length > 1024 ||
      !Array.isArray(value.packages) ||
      value.packages.length > 1024
    )
      throw Error("Invalid DM device directory");
    if (this.bundles.size >= 256)
      this.bundles.delete(this.bundles.keys().next().value!);
    this.bundles.set(id, { value, at: Date.now() });
    return value;
  }
  constructor(readonly instance: InstanceClient) {}
  private request<T>(path: string, method = "GET", body?: unknown) {
    return this.instance.dmRequest(path, method, body) as Promise<T>;
  }
  private path(id: string) {
    return `/api/v1/conversations/${encodeURIComponent(id)}/encryption`;
  }
  private group(id: string) {
    return JSON.stringify([this.instance.account.instance.instance_id, id]);
  }
  private async account() {
    const account = await (
      await cryptoDB()
    ).get("accounts", this.instance.scope);
    if (!account) throw Error("DM encryption is not initialized");
    return account;
  }
  private async save(a: CryptoAccount) {
    const db = await cryptoDB();
    if (a.archive)
      await db.put("archives", a, [this.instance.scope, a.archive]);
    else await db.put("accounts", a, this.instance.scope);
  }
  start() {
    return (this.started ??= cryptoLock(this.instance.scope, async () => {
      const db = await cryptoDB();
      let a = await db.get("accounts", this.instance.scope);
      if (!a) {
        const device = crypto.randomUUID();
        const identity = JSON.stringify([
          this.instance.account.instance.instance_id,
          this.instance.account.login.user.id,
          device,
        ]);
        const result = await engine({ op: "identity", identity });
        a = {
          version: 1,
          device,
          engine: result.state,
          groups: {},
          published: [],
          pins: {},
        };
        await this.save(a);
        void navigator.storage?.persist?.().catch(() => {});
      }
      const proof = await engine({
        op: "sign",
        state: a.engine,
        bytes: Array.from(
          utf8(
            `haunt-dm-device-v1\n${this.instance.account.instance.instance_id}\n${this.instance.account.login.user.id}\n${a.device}`,
          ),
        ),
      });
      await this.request("/api/v1/me/dm-devices", "POST", {
        id: a.device,
        public_key: bytes64(proof.key),
        signature: bytes64(proof.signature!),
      });
      await this.recover(a);
      if (a.published.length) {
        await this.publish(a);
      }
      const available = await this.request<Schemas["ChatDMKeyPackages"]>(
        `/api/v1/me/dm-devices/${a.device}/packages`,
      );
      const count = Math.max(0, 32 - (available.packages?.length ?? 0));
      if (count) {
        const result = await engine({ op: "packages", state: a.engine, count });
        a.engine = result.state;
        a.published = result.packages!.map((data) => ({
          id: crypto.randomUUID(),
          device_id: a!.device,
          data: bytes64(data),
        }));
        await this.save(a);
        await this.publish(a);
      }
    }).catch((error) => {
      this.started = undefined;
      throw error;
    }));
  }
  private async publish(a: CryptoAccount) {
    await this.request(`/api/v1/me/dm-devices/${a.device}/packages`, "PUT", {
      packages: a.published,
    });
    a.published = [];
    a.publishedAt = Date.now();
    await this.save(a);
  }
  private async recover(a: CryptoAccount) {
    if (a.archive || !a.pending) return;
    const pending = a.pending;
    try {
      const result = await this.request<Control>(
        this.path(pending.conversation) + "/events",
        "POST",
        pending.body,
      );
      a.engine = pending.engine;
      a.groups[pending.conversation] = {
        revision: result.revision,
        members: result.devices ?? [],
      };
      a.pending = undefined;
      await this.save(a);
    } catch (error) {
      if (error instanceof APIError && error.code === "dm_epoch_changed") {
        a.pending = undefined;
        await this.save(a);
      } else throw error;
    }
  }
  private checkMembers(
    a: CryptoAccount,
    result: EngineResult,
    bundle: Bundle,
    expected: string[],
  ) {
    if (!result.members || result.members.length !== expected.length)
      throw Error("DM encryption membership mismatch");
    const actual: string[] = [];
    for (const member of result.members) {
      const credential = text(member.credential);
      const device = bundle.devices?.find((d) => d.credential === credential);
      if (
        !device ||
        bytes64(member.key) !== device.public_key ||
        !expected.includes(device.id)
      )
        throw Error("Unrecognized DM encryption identity");
      if (a.pins[device.id] && a.pins[device.id] !== device.public_key)
        throw Error("A DM device's encryption identity changed");
      actual.push(device.id);
    }
    if (!same(actual, expected))
      throw Error("DM encryption membership mismatch");
    for (const d of bundle.devices ?? []) {
      if (actual.includes(d.id)) a.pins[d.id] = d.public_key;
    }
  }
  private async syncUnlocked(a: CryptoAccount, id: string, bundle?: Bundle) {
    await this.recover(a);
    bundle ??= await this.bundle(id);
    let after = a.groups[id]?.revision ?? 0;
    while (after < bundle.revision) {
      const previous = after;
      const page = await this.request<Schemas["ChatDMCryptoEvents"]>(
        this.path(id) + `/events?after=${after}`,
      );
      if (!page.events?.length)
        throw Error("DM encryption history is incomplete");
      for (const event of page.events) {
        if (event.revision <= after || event.revision > bundle.revision)
          continue;
        const existing = a.groups[id];
        let result: EngineResult | undefined;
        if (existing) {
          if (event.revision !== existing.revision + 1)
            throw Error("DM encryption history is out of order");
          result = await engine({
            op: "receive",
            state: a.engine,
            group: this.group(id),
            bytes: Array.from(un64(event.commit)),
          });
          if (!result.committed) throw Error("Invalid DM group transition");
          const actor = bundle.devices?.find((d) => d.id === event.actor);
          if (!actor || text(result.sender!) !== actor.credential)
            throw Error("DM group author does not match");
        } else if (event.devices?.includes(a.device) && event.welcome) {
          result = await engine({
            op: "join",
            state: a.engine,
            group: this.group(id),
            bytes: Array.from(un64(event.welcome)),
          });
        }
        if (result) {
          this.checkMembers(a, result, bundle, event.devices ?? []);
          if (result.epoch !== event.revision)
            throw Error("DM encryption epoch mismatch");
          a.engine = result.state;
          a.groups[id] = {
            revision: event.revision,
            members: event.devices ?? [],
          };
          await this.save(a);
        }
        after = event.revision;
      }
      if (after === previous)
        throw Error("DM encryption history did not advance");
    }
    return bundle;
  }
  async sync(id: string) {
    await this.start();
    return cryptoLock(this.instance.scope, async () => {
      const a = await this.account();
      await this.ensureGroup(a, id);
    });
  }
  private async ensureGroup(a: CryptoAccount, id: string) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const bundle = await this.syncUnlocked(a, id);
      const active = (bundle.devices ?? []).filter((d) => !d.revoked);
      const participants =
        this.instance.snapshot.conversations.find((c) => c.id === id)
          ?.members ?? [];
      if (
        participants.length < 2 ||
        participants.some((u) => !active.some((d) => d.user_id === u))
      )
        throw Error(
          "Waiting for the other participant’s client to set up DM encryption. No plaintext message was sent.",
        );
      const current = a.groups[id];
      if (bundle.revision && !current)
        throw Error(
          "This device is waiting to join the encrypted DM. Open another participating client to connect it.",
        );
      if (
        current &&
        same(
          current.members,
          active.map((d) => d.id),
        )
      )
        return;
      const additions = active.filter(
        (d) => d.id !== a.device && !current?.members.includes(d.id),
      );
      const packages = additions.map((d) => {
        const kp = bundle.packages?.find((k) => k.device_id === d.id);
        if (!kp)
          throw Error(
            "A participant needs to reconnect before encryption can add their device.",
          );
        return kp;
      });
      const removed =
        current?.members.filter((id) => !active.some((d) => d.id === id)) ?? [];
      let indices: number[] = [];
      if (removed.length) {
        const result = await engine({
          op: "members",
          state: a.engine,
          group: this.group(id),
        });
        indices = result
          .members!.filter((m) =>
            removed.some(
              (id) =>
                bundle.devices?.find((d) => d.id === id)?.credential ===
                text(m.credential),
            ),
          )
          .map((m) => m.index);
      }
      const nextMembers = removed.length
        ? current!.members.filter((id) => !removed.includes(id))
        : active.map((d) => d.id);
      const result = await engine({
        op: current ? "update" : "create",
        state: a.engine,
        group: this.group(id),
        packages: removed.length
          ? []
          : packages.map((k) => Array.from(un64(k.data))),
        remove: indices,
      });
      this.checkMembers(a, result, bundle, nextMembers);
      const body: Schemas["ChatDMCryptoCommit"] = {
        expected_revision: bundle.revision,
        request_id: crypto.randomUUID(),
        actor: a.device,
        commit: bytes64(result.commit!),
        welcome: result.welcome ? bytes64(result.welcome) : undefined,
        devices: nextMembers,
        packages: removed.length ? [] : packages.map((k) => k.id),
      };
      a.pending = { conversation: id, body, engine: result.state };
      await this.save(a);
      await this.recover(a);
      if (
        a.groups[id] &&
        same(
          a.groups[id].members,
          active.map((d) => d.id),
        )
      )
        return;
    }
    throw Error("DM devices changed while connecting. Please retry.");
  }
  async encode(
    message: PendingMessage,
    edit?: string,
    renew = false,
  ): Promise<string> {
    await this.start();
    return cryptoLock(this.instance.scope, async () => {
      const db = await cryptoDB(),
        scope = this.instance.scope;
      const old = await db.get("outgoing", [scope, message.request_id]);
      if (old && !renew) return old.wire;
      const a = await this.account();
      await this.ensureGroup(a, message.conversation_id);
      const images: SecretImage[] = [];
      for (const id of message.attachment_ids) {
        const image = await db.get("images", [scope, id]);
        if (
          !image ||
          image.conversation !== message.conversation_id ||
          image.author !== this.instance.account.login.user.id
        )
          throw Error("Encrypted image key is missing on this device");
        images.push(image);
      }
      const payload: PlainPayload = {
        version: 1,
        instance: this.instance.account.instance.instance_id,
        conversation: message.conversation_id,
        author: this.instance.account.login.user.id,
        device: a.device,
        request: message.request_id,
        edit,
        reply: message.reply_to_id,
        body: message.body,
        images,
      };
      const bytes = utf8(JSON.stringify(payload));
      if (bytes.length > 24000)
        throw Error("Encrypted DM exceeds the message size limit");
      const result = await engine({
        op: "send",
        state: a.engine,
        group: this.group(message.conversation_id),
        bytes: Array.from(bytes),
      });
      const wire =
        prefix +
        JSON.stringify({
          device: a.device,
          revision: a.groups[message.conversation_id].revision,
          data: bytes64(result.message!),
        });
      const hash = await cipherHash(wire);
      a.engine = result.state;
      // Durable ratchet update and exact retry ciphertext commit together.
      const tx = db.transaction(
        ["accounts", "outgoing", "decoded"],
        "readwrite",
        { durability: "strict" },
      );
      await tx.objectStore("accounts").put(a, scope);
      await tx
        .objectStore("outgoing")
        .put({ wire, payload }, [scope, message.request_id]);
      await tx.objectStore("decoded").put(payload, [scope, hash]);
      await tx.done;
      return wire;
    });
  }
  async decode(message: Message): Promise<Message> {
    if (message.deleted) return message;
    if (!message.body.startsWith(prefix))
      return { ...message, security: "legacy" };
    try {
      await this.start();
      return await cryptoLock(this.instance.scope, async () => {
        const db = await cryptoDB(),
          scope = this.instance.scope,
          hash = await cipherHash(message.body);
        let payload = await db.get("decoded", [scope, hash]);
        const deliveryKey: [string, string] = [
          scope,
          `${message.author_id}:${message.request_id}`,
        ];
        const delivered = await db.get("delivered", deliveryKey);
        if (delivered && delivered !== message.id)
          throw Error("Replayed DM message identifier");
        if (!payload) {
          const envelope = JSON.parse(message.body.slice(prefix.length));
          if (
            typeof envelope.data !== "string" ||
            envelope.data.length > 66000 ||
            typeof envelope.device !== "string" ||
            !Number.isSafeInteger(envelope.revision)
          )
            throw Error("Invalid encrypted message");
          const candidates = [
            await this.account(),
            ...(await db.getAll(
              "archives",
              IDBKeyRange.bound([scope, ""], [scope, "\uffff"]),
            )),
          ];
          let failure: unknown;
          for (const a of candidates) {
            try {
              const bundle = await this.syncUnlocked(
                a,
                message.conversation_id,
                await this.bundle(message.conversation_id, envelope.revision),
              );
              if (!a.groups[message.conversation_id])
                throw Error("The keys for this message are not on this device");
              const result = await engine({
                op: "receive",
                state: a.engine,
                group: this.group(message.conversation_id),
                bytes: Array.from(un64(envelope.data)),
              });
              if (!result.plaintext)
                throw Error("Encrypted message was not an application message");
              const device = bundle.devices?.find(
                (d) => d.id === envelope.device,
              );
              if (
                !device ||
                device.user_id !== message.author_id ||
                text(result.sender!) !== device.credential
              )
                throw Error("Encrypted sender identity mismatch");
              const decoded = JSON.parse(
                text(result.plaintext),
              ) as PlainPayload;
              this.validatePayload(decoded, message);
              if (decoded.device !== envelope.device)
                throw Error("Encrypted device mismatch");
              a.engine = result.state;
              const tx = db.transaction(
                ["accounts", "archives", "decoded", "images", "delivered"],
                "readwrite",
                { durability: "strict" },
              );
              if (a.archive)
                await tx.objectStore("archives").put(a, [scope, a.archive]);
              else await tx.objectStore("accounts").put(a, scope);
              await tx.objectStore("decoded").put(decoded, [scope, hash]);
              for (const image of decoded.images)
                await tx.objectStore("images").put(image, [scope, image.id]);
              await tx.objectStore("delivered").put(message.id, deliveryKey);
              await tx.done;
              payload = decoded;
              break;
            } catch (error) {
              failure = error;
            }
          }
          if (!payload)
            throw failure ?? Error("No decryption key is available");
        }
        this.validatePayload(payload, message);
        await db.put("delivered", message.id, deliveryKey);
        return { ...message, body: payload.body, security: "encrypted" };
      });
    } catch (error) {
      return {
        ...message,
        body: "Encrypted message unavailable on this device",
        attachment_ids: [],
        security: "unavailable",
        securityError:
          error instanceof Error
            ? error.message
            : "Could not decrypt this message",
      };
    }
  }
  private validatePayload(p: PlainPayload, m: Message) {
    validatePlain(p);
    if (
      !p ||
      p.version !== 1 ||
      p.instance !== this.instance.account.instance.instance_id ||
      p.conversation !== m.conversation_id ||
      p.author !== m.author_id ||
      p.reply !== (m.reply_to_id ?? undefined) ||
      typeof p.body !== "string" ||
      p.body.length > 24000 ||
      !Array.isArray(p.images) ||
      p.images.length > 8 ||
      !same(
        p.images.map((i) => i.id),
        m.attachment_ids ?? [],
      ) ||
      (p.edit ? p.edit !== m.id : p.request !== m.request_id)
    )
      throw Error("Encrypted message context mismatch");
    for (const i of p.images) {
      if (
        i.conversation !== m.conversation_id ||
        i.author !== m.author_id ||
        typeof i.key !== "string" ||
        un64(i.key).length !== 32 ||
        typeof i.token !== "string" ||
        i.token.length > 64 ||
        !["image/webp", "image/jpeg"].includes(i.type) ||
        typeof i.name !== "string" ||
        i.name.length > 128 ||
        !Number.isSafeInteger(i.bytes) ||
        i.bytes < 1 ||
        i.bytes > 20 * 1024 * 1024
      )
        throw Error("Invalid encrypted image metadata");
    }
  }
  async prepareImage(conversation: string, file: Blob, filename: string) {
    return encryptImage(this.instance, conversation, file, filename);
  }
  async image(id: string, blob: Blob) {
    return decryptImage(this.instance, id, blob);
  }
  async imageMetadata(id: string) {
    return (await cryptoDB()).get("images", [this.instance.scope, id]);
  }
}
