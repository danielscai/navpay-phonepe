import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sqlite } from "@/lib/db";

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const root = process.cwd();
  const dataDir = path.join(root, "data");
  ensureDir(dataDir);

  const migrationsDir = path.join(root, "drizzle");
  if (!fs.existsSync(migrationsDir)) {
    console.error("Missing migrations dir:", migrationsDir);
    process.exit(1);
  }

  sqlite.exec(`
    create table if not exists _migrations (
      id text primary key,
      applied_at_ms integer not null
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set<string>(
    sqlite
      .prepare("select id from _migrations")
      .all()
      .map((r: any) => String(r.id)),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare("insert into _migrations (id, applied_at_ms) values (?, ?)")
        .run(file, Date.now());
    });
    tx();
    console.log("applied", file);
  }
}

main();
