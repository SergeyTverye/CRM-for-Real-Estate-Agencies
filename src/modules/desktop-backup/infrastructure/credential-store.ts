import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BackupError, assertBackupId } from "../domain/contracts";
import type { CredentialStore } from "../domain/settings";
import { atomicJson, canonical, protectedDir, regularFile, sha256 } from "./fs";
export interface SecretProtector {
  readonly protection: CredentialStore["protection"]; readonly available: boolean;
  seal(data: Buffer, context: string): Promise<Buffer>;
  open(data: Buffer, context: string): Promise<Buffer>;
}
export class ServerAesProtector implements SecretProtector {
  readonly protection = "server-aes-256-gcm" as const;
  constructor(private readonly loadKey: () => string | undefined) {}
  private key() {
    const value = this.loadKey();
    if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new BackupError("SECRET_STORE_UNAVAILABLE");
    const key = Buffer.from(value, "base64"); if (key.length !== 32) throw new BackupError("SECRET_STORE_UNAVAILABLE"); return key;
  }
  get available() { try { const key = this.key(); key.fill(0); return true; } catch { return false; } }
  async seal(data: Buffer, context: string) {
    const key = this.key(); const nonce = randomBytes(12);
    try { const c = createCipheriv("aes-256-gcm", key, nonce); c.setAAD(Buffer.from(context)); return Buffer.concat([nonce, c.update(data), c.final(), c.getAuthTag()]); }
    finally { key.fill(0); }
  }
  async open(data: Buffer, context: string) {
    if (data.length < 28) throw new BackupError("SECRET_STORE_INVALID");
    const key = this.key();
    try { const c = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12)); c.setAAD(Buffer.from(context)); c.setAuthTag(data.subarray(-16)); return Buffer.concat([c.update(data.subarray(12, -16)), c.final()]); }
    catch { throw new BackupError("SECRET_STORE_INVALID"); } finally { key.fill(0); }
  }
}
export class WindowsDpapiProtector implements SecretProtector {
  readonly protection = "windows-dpapi-current-user" as const;
  get available() { return process.platform === "win32"; }
  private async transform(data: Buffer, context: string, decrypt: boolean) {
    if (!this.available) throw new BackupError("SECRET_STORE_UNAVAILABLE");
    const operation = decrypt ? "Unprotect" : "Protect";
    const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $r=[Console]::In.ReadToEnd() | ConvertFrom-Json; $b=[Convert]::FromBase64String($r.data); $e=[Convert]::FromBase64String($r.entropy); $o=[Security.Cryptography.ProtectedData]::" + operation + "($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))";
    return new Promise<Buffer>((resolve, reject) => {
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      const child = spawn(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = []; let length = 0;
      const timeout = setTimeout(() => { child.kill(); reject(new BackupError("DPAPI_FAILED")); }, 15000);
      child.stdout.on("data", (chunk: Buffer) => { length += chunk.length; if (length > 65536) child.kill(); else chunks.push(chunk); });
      child.stderr.resume(); // Never print provider/PowerShell errors or stdin.
      child.stdin.on("error", () => {});
      child.on("error", () => { clearTimeout(timeout); reject(new BackupError("DPAPI_FAILED")); });
      child.on("close", code => { clearTimeout(timeout); if (code !== 0 || length === 0 || length > 65536) reject(new BackupError("DPAPI_FAILED")); else resolve(Buffer.from(Buffer.concat(chunks).toString("utf8").trim(), "base64")); });
      child.stdin.end(JSON.stringify({ data: data.toString("base64"), entropy: Buffer.from(sha256("RealEstateCRM backup credentials:" + context), "hex").toString("base64") }));
    });
  }
  seal(data: Buffer, context: string) { return this.transform(data, context, false); }
  open(data: Buffer, context: string) { return this.transform(data, context, true); }
}
const encryptedSchema = z.object({ version: z.literal(1), protection: z.enum(["server-aes-256-gcm", "windows-dpapi-current-user"]), data: z.string().max(65536) }).strict();
export class CredentialNotFoundError extends BackupError {
  constructor() { super("SECRET_STORE_NOT_FOUND"); }
}
export class EncryptedFileCredentialStore implements CredentialStore {
  constructor(private readonly root: string, private readonly protector: SecretProtector) {}
  get protection() { return this.protector.protection; }
  get available() { return this.protector.available; }
  private file(ref: string) { return path.join(this.root, assertBackupId(ref) + ".secret.json"); }
  async put(ref: string, value: Record<string, string>) {
    const bytes = Buffer.from(canonical(value)); if (bytes.length > 16384) throw new BackupError("CREDENTIAL_SIZE_LIMIT");
    try { const ciphertext = await this.protector.seal(bytes, ref); await protectedDir(this.root); await atomicJson(this.file(ref), { version: 1, protection: this.protection, data: ciphertext.toString("base64") }); }
    finally { bytes.fill(0); }
  }
  async get(ref: string) {
    let contents: string;
    try {
      await regularFile(this.file(ref)); if ((await stat(this.file(ref))).size > 98304) throw new BackupError("SECRET_STORE_INVALID");
      contents = await readFile(this.file(ref), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new CredentialNotFoundError();
      throw new BackupError("SECRET_STORE_INVALID");
    }
    try {
      const encrypted = encryptedSchema.parse(JSON.parse(contents));
      if (encrypted.protection !== this.protection) throw new BackupError("SECRET_STORE_INVALID");
      const bytes = await this.protector.open(Buffer.from(encrypted.data, "base64"), ref);
      try { return z.record(z.string(), z.string().max(4096)).parse(JSON.parse(bytes.toString("utf8"))); } finally { bytes.fill(0); }
    } catch { throw new BackupError("SECRET_STORE_INVALID"); }
  }
  async delete(ref: string) { await rm(this.file(ref), { force: true }); }
}
