// Builds src/schema.ts from migrations/*.sql so the worker can set up its own database.
// Run: node scripts/schema.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const create = [], alter = [];
for (const f of files) {
  const sql = readFileSync(new URL(f, dir), "utf8").replace(/--[^\n]*/g, "");
  let after = false; // anything after the first ALTER in a file may use the new columns, so it runs in order with them
  for (let s of sql.split(";")) {
    s = s.replace(/\s+/g, " ").trim();
    if (!s) continue;
    s = s.replace(/^CREATE TABLE (?!IF NOT EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
         .replace(/^CREATE INDEX (?!IF NOT EXISTS)/i, "CREATE INDEX IF NOT EXISTS ")
         .replace(/^CREATE UNIQUE INDEX (?!IF NOT EXISTS)/i, "CREATE UNIQUE INDEX IF NOT EXISTS ");
    if (/^ALTER TABLE/i.test(s)) after = true;
    (after ? alter : create).push(s);
  }
}
const q = (a) => a.map((s) => " " + JSON.stringify(s)).join(",\n");
writeFileSync(new URL("../src/schema.ts", import.meta.url),
`// Generated from migrations/*.sql by scripts/schema.mjs. Runs once per worker instance.
// SCHEMA statements are idempotent; ALTERS run one by one and "duplicate column" errors are ignored.
export const SCHEMA: string[] = [
${q(create)},
];
export const ALTERS: string[] = [
${q(alter)},
];
`);
console.log(`schema.ts: ${create.length} statements, ${alter.length} column changes`);
