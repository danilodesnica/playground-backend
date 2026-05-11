import * as fs from 'fs';
import * as path from 'path';
import { listTables, getTable, getTableSchema, XanoTable, XanoColumn } from './lib/xano-client';

const OUTPUT_DIR = path.resolve(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'xano-schema.json');

interface NormalizedTable {
  id: number;
  name: string;
  auth: boolean;
  description?: string;
  columns: XanoColumn[];
}

async function main(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('> Listing tables from Xano workspace...');
  const tables: XanoTable[] = await listTables();
  console.log(`  Found ${tables.length} table(s):`);
  for (const t of tables) console.log(`    - [${t.id}] ${t.name}${t.auth ? ' (auth)' : ''}`);

  const normalized: NormalizedTable[] = [];

  for (const t of tables) {
    console.log(`\n> Fetching schema for "${t.name}" (id=${t.id})...`);
    let columns: XanoColumn[] = [];
    try {
      columns = await getTableSchema(t.id);
    } catch (err: any) {
      const status = err?.response?.status;
      console.warn(`    /schema failed (${status ?? err.message}) — falling back to table detail`);
      const detail = await getTable(t.id);
      columns = detail.schema ?? [];
    }
    console.log(`    ${columns.length} column(s)`);
    for (const c of columns) {
      const extra = c.type === 'tableref'
        ? ` → table ${c.tableref_id ?? c.config?.tableref_id ?? '?'}`
        : c.type === 'enum'
        ? ` [${(c.values ?? []).join(', ')}]`
        : '';
      console.log(`      · ${c.name}: ${c.type}${extra}`);
    }
    normalized.push({
      id: t.id,
      name: t.name,
      auth: t.auth ?? false,
      description: t.description,
      columns,
    });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(normalized, null, 2));
  console.log(`\n✓ Wrote ${OUTPUT_FILE}`);
  console.log(`  ${normalized.length} table(s), ${normalized.reduce((n, t) => n + t.columns.length, 0)} columns total`);
}

main().catch(err => {
  console.error('FAILED:', err?.response?.status, err?.response?.data ?? err.message);
  process.exit(1);
});
