import { isAudioPurpose, mediaPurposes } from "@haunt/core";
import { protocol, type Purpose } from "@haunt/core";
const purposes: readonly Purpose[] = mediaPurposes;
export interface EncodedPacket {
  purpose: Purpose;
  revision: number;
  sequence: number;
  timestamp: number;
  duration: number;
  key: boolean;
  data: Uint8Array;
  publisher?: string;
}
export function pack(packet: EncodedPacket): Uint8Array {
  const { timestamp, duration, revision, sequence, purpose, data } = packet;
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    !Number.isInteger(duration) ||
    duration < 0 ||
    duration > 10_000_000 ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    revision > 0xffffffff ||
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > 0xffffffff ||
    !purposes.includes(purpose) ||
    !data.length
  )
    throw Error("Invalid media packet");
  const size = 24 + data.byteLength;
  if (
    size >
    (isAudioPurpose(purpose)
      ? protocol.media.binary.max_audio_input_bytes
      : protocol.media.binary.max_input_bytes)
  )
    throw Error("Media packet too large");
  const out = new Uint8Array(size),
    view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = purposes.indexOf(purpose);
  out[2] = packet.key ? 1 : 0;
  view.setUint32(4, revision);
  view.setBigUint64(8, BigInt(timestamp));
  view.setUint32(16, duration);
  view.setUint32(20, sequence);
  out.set(data, 24);
  return out;
}
export function unpack(buffer: ArrayBuffer): EncodedPacket {
  if (
    buffer.byteLength < 41 ||
    buffer.byteLength > 16 + protocol.media.binary.max_input_bytes
  )
    throw Error("Invalid media frame length");
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const purpose = purposes[bytes[17]],
    timestamp = Number(view.getBigUint64(24)),
    duration = view.getUint32(32);
  if (
    bytes[16] !== 1 ||
    !purpose ||
    bytes[18] > 1 ||
    bytes[19] !== 0 ||
    !Number.isSafeInteger(timestamp) ||
    duration > 10_000_000 ||
    (isAudioPurpose(purpose) &&
      buffer.byteLength > 16 + protocol.media.binary.max_audio_input_bytes)
  )
    throw Error("Invalid media frame");
  const hex = Array.from(bytes.subarray(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    publisher: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    purpose,
    revision: view.getUint32(20),
    timestamp,
    duration,
    sequence: view.getUint32(36),
    key: bytes[18] === 1,
    data: bytes.subarray(40),
  };
}
