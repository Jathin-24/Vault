// Apply supabase/migrations/*.sql in order to the DATABASE_URL project.
// Usage:  npm run db:migrate     (requires DATABASE_URL in .env.local)
//
// Uses a direct Postgres connection (dashboard → Connect → Session mode)
// because DDL cannot run over PostgREST. Each file runs in its own
// transaction; applied files are recorded in schema_migrations.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "supabase", "migrations");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "ERROR: DATABASE_URL is not set.\n" +
      "  1. Copy .env.example to .env.local\n" +
      "  2. Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,\n" +
      "     SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL\n" +
      "     (DATABASE_URL = Dashboard → Connect → Session mode)"
  );
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(
    "create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())"
  );
  const { rows } = await client.query("select filename from schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip   ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`  apply  ${file} ...`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log(`         ok`);
    } catch (err) {
      await client.query("rollback");
      console.error(`         FAILED: ${err.message}`);
      console.error(
        "         If this is the storage policy migration, see the fallback in\n" +
          "         supabase/migrations/0010_storage.sql comments and README."
      );
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}

console.log(process.exitCode ? "\nMigration finished WITH ERRORS." : "\nAll migrations applied.");
