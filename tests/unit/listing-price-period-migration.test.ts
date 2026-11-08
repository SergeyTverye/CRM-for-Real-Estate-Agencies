import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";

const root="prisma/sqlite/migrations",target="20261108210000_unknown_listing_price_period";
it.each([true,false])("price-period rebuild preserves populated history (transaction=%s)",transaction=>{
  const db=new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    for(const name of readdirSync(root).filter(n=>/^\d/.test(n)&&n<target).sort()) db.exec(readFileSync(join(root,name,"migration.sql"),"utf8"));
    db.exec(`INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u','synthetic','Test','manager','synthetic',0);
      INSERT INTO external_listings(id,source,source_listing_id,url,source_method,operation,price_rub,price_unit,updated_at) VALUES('l','onrealt','synthetic','https://onrealt.ru/123','scraper','rent',8000000,'total',0);
      INSERT INTO search_runs(id,user_id,filters,status) VALUES('r','u','{}','success');
      INSERT INTO search_run_results(id,run_id,listing_id,verdict) VALUES('result','r','l','needs_review');
      INSERT INTO external_listing_snapshots(id,listing_id,search_run_id,fetched_at,normalized) VALUES('snapshot','l','r',0,'{"priceUnit":null}');`);
    const schema=()=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name='external_listings' AND type IN ('index','trigger') ORDER BY type,name").all();
    const before=schema();
    expect(before.filter(row=>(row as {type:string}).type==="index")).toHaveLength(12); // 11 explicit + PK
    expect(before.filter(row=>(row as {type:string}).type==="trigger")).toEqual([]);
    expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
    const sql=readFileSync(join(root,target,"migration.sql"),"utf8");
    if(transaction) db.transaction(()=>db.exec(sql))(); else db.exec(sql);
    expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
    expect(db.pragma("defer_foreign_keys",{simple:true})).toBe(0);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check",{simple:true})).toBe("ok");
    expect(schema()).toEqual(before);
    expect(db.prepare("SELECT price_unit,price_rub FROM external_listings WHERE id='l'").get()).toEqual({price_unit:null,price_rub:8000000});
    expect(db.prepare("SELECT listing_id,run_id FROM search_run_results WHERE id='result'").get()).toEqual({listing_id:"l",run_id:"r"});
    expect(db.prepare("SELECT listing_id,normalized FROM external_listing_snapshots WHERE id='snapshot'").get()).toEqual({listing_id:"l",normalized:'{"priceUnit":null}'});
    db.exec("UPDATE external_listings SET price_unit=NULL WHERE id='l'");
    expect(()=>db.exec("UPDATE external_listings SET price_unit='invalid' WHERE id='l'")).toThrow();
    expect(()=>db.exec("DELETE FROM external_listings WHERE id='l'")).toThrow();
    expect(()=>db.exec("INSERT INTO external_listings(id,source,source_listing_id,url,source_method,operation,price_unit,updated_at) VALUES('duplicate','onrealt','synthetic','https://onrealt.ru/456','scraper','rent',NULL,0)")).toThrow();
  } finally { db.close(); }
});
