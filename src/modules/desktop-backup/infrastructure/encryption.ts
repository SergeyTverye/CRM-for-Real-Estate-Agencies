import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BackupError, encryptionSchema } from "../domain/contracts";
import type { ArchiveLimits } from "../domain/contracts";
import { canonical, sha256 } from "./fs";
export const CHUNK_BYTES = 1024 * 1024;
const wrapSchema = z.object({ nonce: z.string().regex(/^[a-f0-9]{24}$/), ciphertext: z.string().regex(/^[a-f0-9]{64}$/), tag: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export const headerSchema = z.object({ formatVersion: z.literal(1), encryption: encryptionSchema, noncePrefix: z.string().regex(/^[a-f0-9]{16}$/), phraseWrap: wrapSchema, recoveryWrap: wrapSchema }).strict();
export type Header = z.infer<typeof headerSchema>;
export function newRecoveryKey() {
  const raw = randomBytes(32).toString("hex"); return "CRM1-" + raw + "-" + sha256(raw).slice(0, 12);
}
export function decodeRecoveryKey(value: string) {
  const match = /^CRM1-([a-f0-9]{64})-([a-f0-9]{12})$/.exec(value);
  if (!match || !timingSafeEqual(Buffer.from(match[2]!), Buffer.from(sha256(match[1]!).slice(0, 12)))) throw new BackupError("RECOVERY_KEY_INVALID");
  return Buffer.from(match[1]!, "hex");
}
async function phraseKey(phrase: string, salt: string) {
  if (phrase.length < 12 || phrase.length > 1024) throw new BackupError("PASSPHRASE_LENGTH");
  return new Promise<Buffer>((resolve, reject) => scrypt(phrase, Buffer.from(salt, "hex"), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 }, (err, key) => err ? reject(err) : resolve(key)));
}
function wrap(key: Buffer, contentKey: Buffer, aad: Buffer) {
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(aad);
  return { nonce: nonce.toString("hex"), ciphertext: Buffer.concat([cipher.update(contentKey), cipher.final()]).toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}
function unwrap(key: Buffer, value: z.infer<typeof wrapSchema>, aad: Buffer) {
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.nonce, "hex")); cipher.setAAD(aad); cipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(value.ciphertext, "hex")), cipher.final()]);
}
export async function createHeader(phrase: string, recoveryKey: string) {
  const base = { formatVersion: 1 as const, encryption: { alg: "AES-256-GCM-chunked" as const, kdf: "scrypt" as const, params: { N: 32768 as const, r: 8 as const, p: 1 as const, salt: randomBytes(16).toString("hex") } }, noncePrefix: randomBytes(8).toString("hex") };
  const aad = Buffer.from(canonical(base)); const key = randomBytes(32); const kek = await phraseKey(phrase, base.encryption.params.salt); const recovery = decodeRecoveryKey(recoveryKey);
  try { return { header: { ...base, phraseWrap: wrap(kek, key, aad), recoveryWrap: wrap(recovery, key, aad) }, key }; }
  finally { kek.fill(0); recovery.fill(0); }
}
export async function openHeader(header: Header, credential: { passphrase: string } | { recoveryKey: string }) {
  const { phraseWrap, recoveryWrap, ...base } = header; const aad = Buffer.from(canonical(base));
  const kek = "passphrase" in credential ? await phraseKey(credential.passphrase, header.encryption.params.salt) : decodeRecoveryKey(credential.recoveryKey);
  try { return unwrap(kek, "passphrase" in credential ? phraseWrap : recoveryWrap, aad); }
  catch { throw new BackupError("AUTHENTICATION_FAILED"); } finally { kek.fill(0); }
}
export function cryptChunk(header: Header, key: Buffer, index: number, data: Buffer, final: boolean, tag?: Buffer) {
  if (index >= 0xffffffff) throw new BackupError("TOO_MANY_CHUNKS");
  const nonce = Buffer.alloc(12); Buffer.from(header.noncePrefix, "hex").copy(nonce); nonce.writeUInt32BE(index, 8);
  const aad = Buffer.from(sha256(canonical(header)) + ":" + index + ":" + data.length + ":" + (final ? 1 : 0));
  if (tag) {
    const cipher = createDecipheriv("aes-256-gcm", key, nonce); cipher.setAAD(aad); cipher.setAuthTag(tag);
    try { return { data: Buffer.concat([cipher.update(data), cipher.final()]), tag }; } catch { throw new BackupError("AUTHENTICATION_FAILED"); }
  }
  const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(aad);
  return { data: Buffer.concat([cipher.update(data), cipher.final()]), tag: cipher.getAuthTag() };
}

export function maxChunks(limits: ArchiveLimits): number {
  return Math.ceil(limits.totalBytes / CHUNK_BYTES) + 2;
}
