import { argon2id } from "hash-wasm";
import { b64 } from "./encoding";

// Fixed protocol parameters; never accept cheaper values from a storage host.
export async function deriveSecretRoot(password: string, keyword: string) {
  if (!password || !keyword || password.length > 4096 || keyword.length > 4096)
    throw Error("Enter both your master password and private sync keyword.");
  const salt = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(["haunt-sync-secret-root-v1", keyword]),
    ),
  );
  const bytes = await argon2id({
    password,
    salt: new Uint8Array(salt),
    iterations: 3,
    memorySize: 65536,
    parallelism: 4,
    hashLength: 32,
    outputType: "binary",
  });
  const root = b64(new Uint8Array(bytes));
  bytes.fill(0);
  return root;
}
