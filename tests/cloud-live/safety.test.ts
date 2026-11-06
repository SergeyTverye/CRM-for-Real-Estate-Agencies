import { describe, expect, it } from "vitest";
import { readSecretAlias, safeResult, LIVE_FLAG, UI_SCOPE, MODULE_SCOPE, validateDisposableBaseUrl } from "../../scripts/acceptance/cloud-backup-live";

describe("cloud live runner safety primitives", () => {
  it("requires explicit opt-in and supports documented environment aliases", () => {
    expect(LIVE_FLAG).toBe("--execute-cloud-live");
    expect(UI_SCOPE).toBe("--scope=ui-config-probe");
    expect(MODULE_SCOPE).toBe("--scope=module-transfer-restore");
    expect(readSecretAlias({ YC_S3_BUCKET: "synthetic-bucket" }, ["YANDEX_S3_BUCKET", "YC_S3_BUCKET"])).toBe("synthetic-bucket");
    expect(readSecretAlias({ MAILRU_EMAIL: "synthetic@example.invalid" }, ["MAILRU_WEBDAV_EMAIL", "MAILRU_EMAIL"])).toBe("synthetic@example.invalid");
    expect(() => readSecretAlias({}, ["NOT_CONFIGURED"])).toThrow("CLOUD_CONFIGURATION_MISSING");
  });

  it("allows only fixed status enums and nonnegative numeric evidence", () => {
    expect(safeResult("UI_CONFIG_PROBE", "COMPLETED", { entities: 0 })).toEqual({ stage: "UI_CONFIG_PROBE", status: "COMPLETED", entities: 0 });
    expect(() => safeResult("LIVE_SMOKE", "SECRET_ACCESS_KEY")).toThrow("UNSAFE_RESULT_REJECTED");
    expect(() => safeResult("RUN_PREFIX", "ALLOCATED", { bytes: -1 })).toThrow("UNSAFE_RESULT_REJECTED");
  });

  it("rejects every non-loopback UI target before any cloud credential read", () => {
    expect(validateDisposableBaseUrl("http://127.0.0.1:3000").hostname).toBe("127.0.0.1");
    expect(validateDisposableBaseUrl("https://localhost:3443").hostname).toBe("localhost");
    expect(validateDisposableBaseUrl("http://[::1]:3000").hostname).toBe("[::1]");
    for (const url of ["https://example.com", "ftp://localhost", "http://127.0.0.1.evil.test", "http://user:pass@localhost"]) {
      expect(() => validateDisposableBaseUrl(url)).toThrow("CRM_LIVE_HOST_NOT_LOOPBACK");
    }
  });
});
