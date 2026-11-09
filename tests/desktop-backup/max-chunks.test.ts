import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../../src/modules/desktop-backup/domain/contracts";
import { CHUNK_BYTES, maxChunks } from "../../src/modules/desktop-backup/infrastructure/encryption";

describe("backup chunk limit", () => {
  it("derives maxChunks from totalBytes and block size", () => {
    expect(maxChunks(DEFAULT_LIMITS)).toBe(Math.ceil(DEFAULT_LIMITS.totalBytes / CHUNK_BYTES) + 2);
  });
});
