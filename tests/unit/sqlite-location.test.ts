import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { win32 } from "node:path";

const { execFileSync, statfsSync } = vi.hoisted(() => ({ execFileSync: vi.fn(), statfsSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("node:fs", () => ({ statfsSync }));
vi.mock("node:path", async () => {
  const { win32 } = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...win32, win32 };
});

let check: typeof import("@/shared/db/sqlite-location").assertLocalSqliteLocation;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("process", Object.defineProperties(Object.create(process), {
    platform: { value: "win32" }, env: { value: { SystemRoot: "C:\\Windows" } },
  }));
  execFileSync.mockReturnValue("3");
  check = (await import("@/shared/db/sqlite-location")).assertLocalSqliteLocation;
});
afterEach(() => vi.unstubAllGlobals());

describe("Windows SQLite local drive policy", () => {
  it.each(["2", "3", "6"]) ("allows local DriveType %s", kind => {
    execFileSync.mockReturnValue(`${kind}\r\n`);
    expect(() => check("D:\\synthetic\\data")).not.toThrow();
  });

  it.each(["0", "1", "4", "5", "", "Unknown", "3\n4", "7", "03"])("denies untrusted DriveType %j without caching", kind => {
    execFileSync.mockReturnValue(kind);
    expect(() => check("Z:\\synthetic")).toThrow("SQLITE_LOCAL_VOLUME_REQUIRED");
    execFileSync.mockReturnValue("3");
    expect(() => check("Z:\\synthetic")).not.toThrow();
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it.each(["ETIMEDOUT", "ENOENT", "EACCES", "UNKNOWN"])("fails closed and sanitizes %s without caching", code => {
    const original = Object.assign(new Error("sensitive stderr and command"), { code, stderr: "sensitive", path: "sensitive" });
    execFileSync.mockImplementationOnce(() => { throw original; });
    let failure: unknown;
    try { check("D:\\synthetic"); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("SQLITE_LOCAL_VOLUME_REQUIRED");
    expect(failure).not.toBe(original);
    expect(JSON.stringify(failure)).not.toContain("sensitive");
    expect(failure).not.toHaveProperty("cause");
    if (code === "ETIMEDOUT") expect(failure).toHaveProperty("code", "ETIMEDOUT");
    else expect(failure).not.toHaveProperty("code");
    expect(() => check("D:\\synthetic")).not.toThrow();
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it("uses only the validated root, an exact system executable and bounded module-free command", () => {
    check("d:\\synthetic space\\O'Brien; $(throw 'injection')\\данные");
    expect(execFileSync).toHaveBeenCalledWith(
      win32.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'; [Console]::Write([int]([System.IO.DriveInfo]::new('D:\\').DriveType))"],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 1024, cwd: "C:\\Windows", env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PSModulePath: "", NODE_ENV: process.env.NODE_ENV ?? "production" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(String(execFileSync.mock.calls[0])).not.toMatch(/CIM|WMI|Get-CimInstance|Win32_LogicalDisk|Import-Module/i);
  });

  it.each(["\\\\server\\share\\data", "\\\\?\\C:\\data", "\\\\.\\C:\\data", "C:data", "relative", "\\data", "1:\\data", "';throw 'bad'\\data"])("denies invalid/non-drive root %j before spawning", directory => {
    expect(() => check(directory)).toThrow("SQLITE_LOCAL_VOLUME_REQUIRED");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("caches successful checks once per normalized root, not per directory", () => {
    check("d:\\synthetic-one"); check("D:\\synthetic-two"); check("d:/synthetic-four"); check("E:\\synthetic-three");
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it.each(["OneDrive", "OneDriveConsumer", "OneDriveCommercial"])("denies %s roots even after a local drive was cached", variable => {
    check("D:\\synthetic");
    process.env[variable] = "D:\\synthetic cloud";
    for (const directory of ["D:\\synthetic cloud", "D:\\synthetic cloud\\nested", "d:\\SYNTHETIC CLOUD\\nested"]) {
      expect(() => check(directory)).toThrow("SQLITE_CLOUD_PATH_FORBIDDEN");
    }
    expect(() => check("D:\\synthetic cloud-sibling")).not.toThrow();
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it("retains fail-closed mapped-network detection independently for every root", () => {
    check("C:\\synthetic");
    execFileSync.mockReturnValue("4");
    expect(() => check("Z:\\synthetic")).toThrow("SQLITE_LOCAL_VOLUME_REQUIRED");
    expect(() => check("Z:\\synthetic")).toThrow("SQLITE_LOCAL_VOLUME_REQUIRED");
    expect(execFileSync).toHaveBeenCalledTimes(3);
  });

  it("does not enter the confirmed CIM timeout path", () => {
    execFileSync.mockImplementation((_exe: string, args: string[]) => {
      if (args.join(" ").includes("Get-CimInstance")) throw Object.assign(new Error("mock CIM timeout"), { code: "ETIMEDOUT" });
      return "3";
    });
    expect(() => execFileSync("powershell.exe", ["-Command", "(Get-CimInstance Win32_LogicalDisk).DriveType"])).toThrow("mock CIM timeout");
    expect(() => check("D:\\synthetic")).not.toThrow();
  });

  it("uses the system-path default when SystemRoot is absent", () => {
    delete process.env.SystemRoot;
    check("D:\\synthetic");
    expect(execFileSync.mock.calls[0]![0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  it.each(["relative", "\\\\server\\Windows", "C:\\Windows\0bad"])("fails closed for invalid SystemRoot %j", systemRoot => {
    process.env.SystemRoot = systemRoot;
    expect(() => check("D:\\synthetic")).toThrow("SQLITE_LOCAL_VOLUME_REQUIRED");
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
