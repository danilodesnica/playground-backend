import * as fs from 'fs';
import * as path from 'path';
import { metaGet, xanoWorkspaceId } from './lib/xano-client';

const SCHEMA_FILE = path.resolve(__dirname, 'output', 'xano-schema.json');
const DATA_DIR = path.resolve(__dirname, 'output', 'data');

interface SchemaTable {
  id: number;
  name: string;
  auth: boolean;
}

interface XanoPage<T> {
  items?: T[];
  itemsTotal?: number;
  itemsReceived?: number;
  curPage?: number;
  nextPage?: number | null;
  pageTotal?: number;
}

async function fetchAllRows(tableId: number, tableName: string): Promise<any[]> {
  const rows: any[] = [];
  const perPage = 100;
  let page = 1;
  let paramStyle: 'per_page' | 'perPage' = 'per_page';

  while (true) {
    const params = paramStyle === 'per_page'
      ? { page, per_page: perPage }
      : { page, perPage };

    let body: any;
    try {
      body = await metaGet<any>(`/workspace/${xanoWorkspaceId}/table/${tableId}/content`, { params });
    } catch (err: any) {
      if (err?.response?.status === 400 && paramStyle === 'per_page') {
        console.log(`    (falling back to perPage parameter style)`);
        paramStyle = 'perPage';
        continue;
      }
      throw err;
    }

    const pageRows: any[] = Array.isArray(body) ? body : (body.items ?? []);
    rows.push(...pageRows);
    process.stdout.write(`    page ${page}: +${pageRows.length} rows (total ${rows.length})\n`);

    const nextPage = (body as XanoPage<any>).nextPage;
    const pageTotal = (body as XanoPage<any>).pageTotal;

    if (Array.isArray(body)) {
      if (pageRows.length < perPage) break;
      page++;
    } else if (nextPage && nextPage !== page) {
      page = nextPage;
    } else if (pageTotal !== undefined && page >= pageTotal) {
      break;
    } else if (pageRows.length < perPage) {
      break;
    } else {
      page++;
    }
  }
  return rows;
}

async function main(): Promise<void> {
  if (!fs.existsSync(SCHEMA_FILE)) {
    console.error(`Schema file not found: ${SCHEMA_FILE}\nRun: npm run migrate:schema:export`);
    process.exit(1);
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const tables: SchemaTable[] = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const summary: { table: string; rows: number }[] = [];

  for (const t of tables) {
    console.log(`\n> ${t.name} (id=${t.id})${t.auth ? ' [auth]' : ''}`);
    const rows = await fetchAllRows(t.id, t.name);
    const out = path.join(DATA_DIR, `${t.name}.json`);
    fs.writeFileSync(out, JSON.stringify(rows, null, 2));
    console.log(`  ✓ ${rows.length} row(s) → ${path.relative(process.cwd(), out)}`);
    summary.push({ table: t.name, rows: rows.length });
  }

  console.log('\n=== Summary ===');
  for (const s of summary) console.log(`  ${s.table.padEnd(20)} ${s.rows}`);
  console.log(`  ${'TOTAL'.padEnd(20)} ${summary.reduce((n, s) => n + s.rows, 0)}`);
}

main().catch(err => {
  console.error('FAILED:', err?.response?.status, err?.response?.data ?? err.message);
  process.exit(1);
});
