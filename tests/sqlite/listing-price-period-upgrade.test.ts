import { it,expect } from "vitest";
import { mkdtempSync,readFileSync,readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import Database from "better-sqlite3";
import { applySqliteMigrations } from "../../scripts/desktop/database-lifecycle";
import { sqliteFilePath } from "@/shared/db/sqlite-adapter";
import { db,resetDatabase,seedBase } from "../helpers/fixtures";

it("upgrades populated pre-AI-02 SQLite preserving linked history and all indexes",async()=>{
  await resetDatabase();const users=await seedBase();
  const listing=await db.externalListing.create({data:{source:"onrealt",sourceListingId:"synthetic-upgrade",url:"https://onrealt.ru/123",sourceMethod:"scraper",operation:"rent",priceUnit:"total",priceRub:"80000"}});
  const run=await db.searchRun.create({data:{userId:users.realtor1.userId,filters:{operation:"rent"},status:"success"}});
  await db.externalListingSnapshot.create({data:{listingId:listing.id,searchRunId:run.id,fetchedAt:new Date(),normalized:{priceUnit:null}}});
  await db.searchRunResult.create({data:{listingId:listing.id,runId:run.id,verdict:"needs_review"}});
  const file=join(mkdtempSync(join(tmpdir(),"crm-period-upgrade-")),"upgrade.db"),native=new Database(file);
  const latest="20261108210000_unknown_listing_price_period";
  let indexes:unknown[];
  try {
    const migrations=resolve("prisma/sqlite/migrations");
    for(const name of readdirSync(migrations).filter(n=>/^\d/.test(n)&&n<latest).sort()) native.exec(readFileSync(join(migrations,name,"migration.sql"),"utf8"));
    native.prepare("ATTACH DATABASE ? AS source").run(sqliteFilePath(process.env.DATABASE_URL!));
    native.exec(`CREATE TABLE _prisma_migrations AS SELECT * FROM source._prisma_migrations WHERE migration_name <> '${latest}'`);
    for(const table of ["users","external_listings","search_runs","external_listing_snapshots","search_run_results"]) native.exec(`INSERT INTO main.${table} SELECT * FROM source.${table}`);
    indexes=native.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='external_listings' ORDER BY name").all();
    expect(native.pragma("foreign_key_check")).toEqual([]);
  } finally { native.close(); }
  applySqliteMigrations(file);
  const check=new Database(file);
  try {
    expect(check.prepare("SELECT price_unit FROM external_listings WHERE id=?").get(listing.id)).toEqual({price_unit:null});
    expect(check.prepare("SELECT count(*) AS n FROM search_run_results WHERE listing_id=?").get(listing.id)).toEqual({n:1});
    expect(check.prepare("SELECT count(*) AS n FROM external_listing_snapshots WHERE listing_id=?").get(listing.id)).toEqual({n:1});
    expect(check.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='external_listings' ORDER BY name").all()).toEqual(indexes!);
    expect(check.pragma("foreign_key_check")).toEqual([]);
    expect(check.pragma("integrity_check",{simple:true})).toBe("ok");
  } finally { check.close(); }
// Full migration chain on a populated database: ~55 s on hosted Windows runners.
},180_000);
