import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

export function generateSqliteSchema(source: string) {
  const models = new Set([...source.matchAll(/^model (\w+) \{/gm)].map(m => m[1]!));
  const metadata: Record<string, { table: string; columns: Record<string,string>; lists: Record<string, { type: string; column: string }>; decimals: Record<string, { precision: number; scale: number; column: string }>; relations: Record<string, string> }> = {};
  let model = "";
  const schema = source.split(/\r?\n/).map(original => {
    let line = original;
    const start = line.match(/^model (\w+) \{/);
    if (start) { model = start[1]!; metadata[model] = { table: model, columns: {}, lists: {}, decimals: {}, relations: {} }; }
    const table = line.match(/@@map\("([^"]+)"\)/);
    if (model && table) metadata[model]!.table = table[1]!;
    const field = line.match(/^\s+(\w+)\s+(\w+)(\[\]|\?)?\s*(.*)$/);
    if (model && field) {
      const [, name, type, suffix, attrs] = field;
      const column = attrs!.match(/@map\("([^"]+)"\)/)?.[1] ?? name!;
      metadata[model]!.columns[name!] = column;
      if (models.has(type!)) metadata[model]!.relations[name!] = type!;
      if (suffix === "[]" && (type === "String" || type === "Int")) {
        metadata[model]!.lists[name!] = { type, column };
        line = line.replace(/\b(?:String|Int)\[\]/, "Json").replace(/@default\(\[\]\)/, '@default("[]")');
        if (!attrs!.includes("@default")) line += ' @default("[]")';
      }
      if (type === "Decimal") {
        const native = attrs!.match(/@db.Decimal\((\d+),\s*(\d+)\)/);
        if (!native) throw new Error("Decimal precision missing: " + model + "." + name);
        const scale = Number(native[2]);
        metadata[model]!.decimals[name!] = { precision: Number(native[1]), scale, column };
        line = line.replace(/\bDecimal/, "BigInt").replace(/@default\(([-\d.]+)\)/, (_s, n: string) => {
          // Defaults in the authoritative schema are integers.
          if (!/^-?\d+$/.test(n)) throw new Error("Non-integral decimal default needs explicit conversion");
          return "@default(" + BigInt(n) * 10n ** BigInt(scale) + ")";
        });
      }
    }
    if (line === "}") model = "";
    return line.replace('provider = "postgresql"', 'provider = "sqlite"')
      .replace('"../src/generated/prisma"', '"../../src/generated/prisma-sqlite"')
      .replace(/@default\(dbgenerated\("gen_random_uuid\(\)"\)\)/g, "@default(uuid())")
      .replace(/\s+@db\.\w+(?:\([^)]*\))?/g, "");
  }).join("\n");
  return { schema: "// GENERATED: npm run desktop:schema; edit only prisma/schema.prisma.\n" + schema, metadata };
}
const source = readFileSync("prisma/schema.prisma", "utf8");
const { schema, metadata } = generateSqliteSchema(source);
mkdirSync("prisma/sqlite", { recursive: true });
writeFileSync("prisma/sqlite/schema.prisma", schema);
writeFileSync("prisma/sqlite/compatibility.json", JSON.stringify({ sourceSha256: createHash("sha256").update(source).digest("hex"), models: metadata }, null, 2) + "\n");
console.log("SQLite schema: " + Object.keys(metadata).length + " models");

