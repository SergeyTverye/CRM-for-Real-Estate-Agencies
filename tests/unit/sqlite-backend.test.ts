import { describe,expect,it } from "vitest";
import { unicodeLike, sqliteFilePath } from "@/shared/db/sqlite-adapter";
import { loadConfig } from "@/shared/config/env";
import { toSqliteUnits,fromSqliteUnits } from "@/shared/db/sqlite-money";
describe("SQLite backend boundary contracts",()=>{
  it("requires explicit mode, never infers it from a SQLite URL",()=>{
    expect(loadConfig({DATABASE_URL:"file:synthetic.db"}).CRM_DEPLOYMENT_MODE).toBe("server");
    expect(loadConfig({DATABASE_URL:"file:synthetic.db",CRM_DEPLOYMENT_MODE:"desktop"}).CRM_DEPLOYMENT_MODE).toBe("desktop");
    expect(()=>loadConfig({DATABASE_URL:"file:synthetic.db",CRM_DEPLOYMENT_MODE:"typo"})).toThrow();
  });
  it("preserves decimal extrema and scale with no Number path",()=>{
    for(const spec of [{precision:16,scale:2},{precision:16,scale:6},{precision:7,scale:4}]){
      const value="9".repeat(spec.precision-spec.scale)+"."+"9".repeat(spec.scale);
      expect(fromSqliteUnits(toSqliteUnits(value,spec),spec).toFixed(spec.scale)).toBe(value);
      expect(()=>toSqliteUnits("1".padEnd(spec.precision-spec.scale+1,"0"),spec)).toThrow("SQLITE_DECIMAL_RANGE");
    }
  });
  it("matches Unicode wildcard semantics without regex backtracking",()=>{
    expect(unicodeLike("%ёж%","Большой ЁЖ")).toBe(1);
    expect(unicodeLike("_","🦔")).toBe(1);
    expect(unicodeLike("ёж","ёжик")).toBe(0);
    expect(unicodeLike("ёж\\%\\_","ЁЖ%_")).toBe(1);
    expect(unicodeLike("%".repeat(300)+"z","x".repeat(4000))).toBe(0);
  });
  it("rejects URLs outside local files before opening any file",()=>{
    for(const url of ["postgresql://synthetic","file://server/share/a.db","file:\\\\server\\a.db","file:","file:a.db?mode=rw"])
      expect(()=>sqliteFilePath(url)).toThrow();
  });
});

