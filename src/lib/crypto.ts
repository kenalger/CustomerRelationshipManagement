import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Provider OAuth tokens are encrypted at rest — Connection.encryptedTokens is
// never a plaintext column. AES-256-GCM so tampering is detected, not just hidden.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (openssl rand -hex 32)");
  }
  return buf;
}

/** Returns `iv.ciphertext.authTag`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, enc, cipher.getAuthTag()]
    .map((b) => b.toString("base64url"))
    .join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(".");
  if (!ivB64 || !dataB64 || !tagB64) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
