import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getConfig } from "../config/env";

/**
 * StorageAdapter (ТЗ 17.3, 20.4): доменная логика не зависит от физического пути.
 * Ключ хранения — непрозрачный идентификатор без исходного имени файла. путь наружу не выдаётся.
 * Замена на S3-совместимое хранилище — новая реализация интерфейса без изменения бизнес-сущностей.
 */
export interface StoredObject {
  storageKey: string;
  size: number;
  sha256: string;
}

export interface StorageAdapter {
  readonly provider: string;
  put(data: Buffer, opts?: { prefix?: string }): Promise<StoredObject>;
  read(storageKey: string): Promise<{ stream: Readable; size: number }>;
  remove(storageKey: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{8,200}$/;

export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = "local";
  constructor(private readonly root: string) {}

  private resolve(storageKey: string): string {
    if (!KEY_RE.test(storageKey) || storageKey.includes("..")) throw new Error("invalid storage key");
    const full = path.resolve(this.root, storageKey);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("storage key escapes root");
    return full;
  }

  async put(data: Buffer, opts: { prefix?: string } = {}): Promise<StoredObject> {
    const now = new Date();
    const prefix = opts.prefix ?? "documents";
    const storageKey = `${prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
    const full = this.resolve(storageKey);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.part`;
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, full);
    return { storageKey, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }

  async read(storageKey: string): Promise<{ stream: Readable; size: number }> {
    const full = this.resolve(storageKey);
    const s = await stat(full);
    return { stream: createReadStream(full), size: s.size };
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }
}

let adapter: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (!adapter) adapter = new LocalStorageAdapter(path.resolve(getConfig().FILE_STORAGE_PATH));
  return adapter;
}

/** Только для тестов. */
export function resetStorage(): void {
  adapter = null;
}
