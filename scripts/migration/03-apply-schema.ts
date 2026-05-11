import * as fs from 'fs';
import * as path from 'path';
import { pool, listPublicTables, withClient } from './lib/supabase-pg';

const SQL_FILE = path.resolve(__dirname, 'output', '0001_initial_schema.sql');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
const FINAL_SQL = path.join(MIGRATIONS_DIR, '0001_initial_schema.sql');

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  if (!fs.existsSync(SQL_FILE)) {
    console.error(`SQL file not found: ${SQL_FILE}\nRun: npm run migrate:schema:generate`);
    process.exit(1);
  }

  console.log('> Connecting to Supabase...');
  const { rows: meta } = await pool.query<{ version: string; db: string; usr: string }>(
    `SELECT version() as version, current_database() as db, current_user as usr`
  );
  console.log(`  ${meta[0].version.split(',')[0]}`);
  console.log(`  db=${meta[0].db}  user=${meta[0].usr}`);

  const existing = await listPublicTables();
  console.log(`\n> Existing public tables (${existing.length}):`);
  if (existing.length === 0) {
    console.log('  (none — schema is fresh)');
  } else {
    existing.forEach(t => console.log(`  - ${t}`));
    console.log('\n  ! Some tables already exist. The generated SQL opens with DROP TABLE IF EXISTS ... CASCADE,');
    console.log('    which will WIPE these tables and any dependent objects.');
  }

  if (!APPLY) {
    console.log('\n> Dry run only. Re-run with --apply to execute the SQL.');
    await pool.end();
    return;
  }

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  console.log(`\n> Executing ${SQL_FILE} (${sql.length} chars)...`);

  await withClient(async (client) => {
    await client.query(sql);
  });

  console.log('✓ Schema applied');

  const after = await listPublicTables();
  console.log(`\n> Public tables now (${after.length}):`);
  after.forEach(t => console.log(`  - ${t}`));

  if (!fs.existsSync(MIGRATIONS_DIR)) fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
  fs.copyFileSync(SQL_FILE, FINAL_SQL);
  console.log(`\n✓ Copied SQL to ${FINAL_SQL}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('FAILED:', err.message);
  if (err.position) console.error('  at SQL position:', err.position);
  if (err.detail) console.error('  detail:', err.detail);
  await pool.end().catch(() => {});
  process.exit(1);
});
