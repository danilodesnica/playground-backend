import * as fs from 'fs';
import * as path from 'path';
import { pool, withClient, listPublicTables } from './lib/supabase-pg';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.find(a => a.startsWith('--file='))?.slice('--file='.length);

async function main(): Promise<void> {
  if (!fileArg) {
    console.error('Usage: run-migration --file=<path> [--apply]');
    process.exit(1);
  }
  const sqlPath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(sqlPath)) {
    console.error(`File not found: ${sqlPath}`);
    process.exit(1);
  }

  console.log('> Connecting to Supabase...');
  const { rows: meta } = await pool.query<{ version: string; db: string; usr: string }>(
    `SELECT version() as version, current_database() as db, current_user as usr`
  );
  console.log(`  ${meta[0].version.split(',')[0]}`);
  console.log(`  db=${meta[0].db}  user=${meta[0].usr}`);

  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log(`\n> File: ${sqlPath} (${sql.length} chars)`);

  if (!APPLY) {
    console.log('> Dry run only. Re-run with --apply to execute.');
    await pool.end();
    return;
  }

  console.log('> Executing...');
  await withClient(async (client) => {
    await client.query(sql);
  });
  console.log('✓ Migration applied');

  const tables = await listPublicTables();
  console.log(`\n> Public tables (${tables.length}):`);
  tables.forEach(t => console.log(`  - ${t}`));

  await pool.end();
}

main().catch(async (err) => {
  console.error('FAILED:', err.message);
  if (err.position) console.error('  at SQL position:', err.position);
  if (err.detail) console.error('  detail:', err.detail);
  if (err.hint) console.error('  hint:', err.hint);
  await pool.end().catch(() => {});
  process.exit(1);
});
