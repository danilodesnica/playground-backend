import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { pool, withClient } from './lib/supabase-pg';
import { XanoColumn } from './lib/xano-client';
import { renameTable, renameColumn, isSkipped } from './lib/overrides';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in scripts/migration/.env');
}

const BUCKET = 'attachments';
const SCHEMA_FILE = path.resolve(__dirname, 'output', 'xano-schema.json');
const DATA_DIR = path.resolve(__dirname, 'output', 'data');
const ERRORS_FILE = path.resolve(__dirname, 'output', 'file-errors.json');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface SchemaTable {
  id: number;
  name: string;
  auth: boolean;
  columns: XanoColumn[];
}

const FILE_TYPES = new Set(['image', 'video', 'audio', 'attachment', 'storage']);
const LIST_STYLE = 'list';

interface FileError {
  table: string;
  row_id: any;
  column: string;
  path: string;
  stage: 'download' | 'upload';
  message: string;
}
const fileErrors: FileError[] = [];

// Stats
const stats: Record<string, { inserted: number; skipped: number; files_uploaded: number; file_errors: number }> = {};

function slugifyFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function publicUrl(objectPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

async function ensureBucket(): Promise<void> {
  const { data: existing } = await supabase.storage.listBuckets();
  if (existing?.some(b => b.name === BUCKET)) {
    console.log(`  bucket "${BUCKET}" already exists`);
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '50MB',
  });
  if (error && !error.message.includes('already exists')) throw error;
  console.log(`  bucket "${BUCKET}" created (public)`);
}

async function migrateFile(
  fileMeta: any,
  pgTable: string,
  rowId: any,
  columnName: string
): Promise<any> {
  if (!fileMeta || typeof fileMeta !== 'object' || !fileMeta.url || !fileMeta.name) {
    return fileMeta;
  }

  const filename = slugifyFilename(fileMeta.name);
  const objectPath = `${pgTable}/${rowId}/${filename}`;

  let buffer: Buffer;
  try {
    const resp = await axios.get<ArrayBuffer>(fileMeta.url, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      maxContentLength: 100 * 1024 * 1024,
    });
    buffer = Buffer.from(resp.data);
  } catch (err: any) {
    fileErrors.push({
      table: pgTable,
      row_id: rowId,
      column: columnName,
      path: fileMeta.path ?? fileMeta.url,
      stage: 'download',
      message: err?.response?.status ? `HTTP ${err.response.status}` : err.message,
    });
    return fileMeta;
  }

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: fileMeta.mime ?? 'application/octet-stream',
    upsert: true,
  });
  if (upErr) {
    fileErrors.push({
      table: pgTable,
      row_id: rowId,
      column: columnName,
      path: fileMeta.path ?? fileMeta.url,
      stage: 'upload',
      message: upErr.message,
    });
    return fileMeta;
  }

  stats[pgTable].files_uploaded++;
  return {
    path: objectPath,
    name: fileMeta.name,
    size: fileMeta.size,
    mime: fileMeta.mime,
    meta: fileMeta.meta,
    url: publicUrl(objectPath),
  };
}

function isEpochMsTimestamp(value: unknown): value is number {
  return typeof value === 'number' && value > 1_000_000_000_000 && value < 10_000_000_000_000;
}

async function transformValue(
  xanoTable: string,
  pgTable: string,
  col: XanoColumn,
  value: unknown,
  rowId: any
): Promise<unknown> {
  if (value === null || value === undefined) return value;

  const isList = col.style === LIST_STYLE;
  const isFile = FILE_TYPES.has(col.type);

  if (isFile) {
    if (isList) {
      if (!Array.isArray(value)) return value;
      const out: any[] = [];
      for (const item of value) {
        out.push(await migrateFile(item, pgTable, rowId, col.name));
      }
      return out;
    }
    return await migrateFile(value, pgTable, rowId, col.name);
  }

  if ((col.type === 'timestamp' || col.type === 'date') && isEpochMsTimestamp(value)) {
    return new Date(value as number);
  }

  return value;
}

function pgArrayLiteral(arr: unknown[], elemType: 'text' | 'uuid' | 'jsonb'): string {
  if (arr.length === 0) return `{}`;
  if (elemType === 'jsonb') {
    const items = arr.map(v => `"${JSON.stringify(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    return `{${items.join(',')}}`;
  }
  if (elemType === 'uuid') {
    return `{${arr.map(String).join(',')}}`;
  }
  // text
  const items = arr.map(v => {
    const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${s}"`;
  });
  return `{${items.join(',')}}`;
}

function arrayElemType(col: XanoColumn): 'text' | 'uuid' | 'jsonb' {
  if (col.type === 'uuid') return 'uuid';
  if (col.type === 'text' || col.type === 'email') return 'text';
  return 'jsonb';
}

async function buildInsert(
  xanoTable: string,
  pgTable: string,
  row: any,
  colsToInsert: XanoColumn[]
): Promise<{ sql: string; values: unknown[] }> {
  const placeholders: string[] = [];
  const values: unknown[] = [];
  const colNames: string[] = [];

  let idx = 1;
  for (const col of colsToInsert) {
    const pgCol = renameColumn(xanoTable, col.name);
    const xanoVal = row[col.name];
    const transformed = await transformValue(xanoTable, pgTable, col, xanoVal, row.id);

    colNames.push(`"${pgCol}"`);

    const isList = col.style === LIST_STYLE;
    if (isList) {
      const elemType = arrayElemType(col);
      const arr = Array.isArray(transformed) ? transformed : [];
      const literal = pgArrayLiteral(arr, elemType);
      placeholders.push(`$${idx}::${elemType}[]`);
      values.push(literal);
    } else if (col.type === 'object' || col.type === 'json' || FILE_TYPES.has(col.type)) {
      placeholders.push(`$${idx}::jsonb`);
      values.push(transformed === null || transformed === undefined ? null : JSON.stringify(transformed));
    } else {
      placeholders.push(`$${idx}`);
      values.push(transformed);
    }
    idx++;
  }

  const sql = `INSERT INTO "${pgTable}" (${colNames.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (id) DO NOTHING`;
  return { sql, values };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i], i);
      } catch (err: any) {
        console.error(`  ! row index=${i} failed: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);
}

async function importTable(t: SchemaTable, concurrency: number): Promise<void> {
  const pgTable = renameTable(t.name);
  stats[pgTable] = { inserted: 0, skipped: 0, files_uploaded: 0, file_errors: 0 };

  const dataFile = path.join(DATA_DIR, `${t.name}.json`);
  if (!fs.existsSync(dataFile)) {
    console.log(`  no data file for ${t.name} — skipping`);
    return;
  }
  const rows: any[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

  // Pre-fetch already-inserted IDs so we skip them entirely (saves file uploads)
  const { rows: existing } = await pool.query<{ id: any }>(`SELECT id FROM "${pgTable}"`);
  const existingIds = new Set(existing.map(r => String(r.id)));
  const todo = rows.filter(r => !existingIds.has(String(r.id)));
  const alreadyDone = rows.length - todo.length;

  console.log(`\n> ${t.name} → ${pgTable}: ${rows.length} rows total, ${alreadyDone} already inserted, ${todo.length} to process (concurrency=${concurrency})`);
  stats[pgTable].skipped = alreadyDone;

  if (todo.length === 0) {
    console.log(`  ✓ nothing to do`);
    return;
  }

  const colsToInsert = t.columns.filter(c => !isSkipped(t.name, c.name));
  const errorsStart = fileErrors.length;
  const startTime = Date.now();
  let processed = 0;
  const logEvery = Math.max(10, Math.floor(todo.length / 20));

  await runWithConcurrency(todo, concurrency, async (row) => {
    const { sql, values } = await buildInsert(t.name, pgTable, row, colsToInsert);
    const res = await pool.query(sql, values);
    if (res.rowCount && res.rowCount > 0) stats[pgTable].inserted++;
    else stats[pgTable].skipped++;
    processed++;
    if (processed % logEvery === 0 || processed === todo.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = Math.round((todo.length - processed) / rate);
      console.log(`  progress: ${processed}/${todo.length}  (${rate.toFixed(1)}/s, ETA ${eta}s, files=${stats[pgTable].files_uploaded}, file_errors=${fileErrors.length - errorsStart})`);
    }
  });

  stats[pgTable].file_errors = fileErrors.length - errorsStart;
  console.log(`  ✓ inserted=${stats[pgTable].inserted}  skipped=${stats[pgTable].skipped}  files=${stats[pgTable].files_uploaded}  file_errors=${stats[pgTable].file_errors}`);
}

async function resetSequences(tables: SchemaTable[]): Promise<void> {
  console.log('\n> Resetting sequences for bigint PKs...');
  for (const t of tables) {
    const idCol = t.columns.find(c => c.name === 'id');
    if (!idCol || idCol.type !== 'int') continue;
    const pgTable = renameTable(t.name);
    const sql = `SELECT setval(pg_get_serial_sequence('"${pgTable}"', 'id'), COALESCE((SELECT MAX(id) FROM "${pgTable}"), 0) + 1, false) as next`;
    const { rows } = await pool.query<{ next: string }>(sql);
    console.log(`  ${pgTable}: next id = ${rows[0].next}`);
  }
}

function topoSort(tables: SchemaTable[]): SchemaTable[] {
  const byId = new Map(tables.map(t => [t.id, t]));
  const deps = new Map<number, Set<number>>();
  for (const t of tables) {
    const d = new Set<number>();
    for (const c of t.columns) {
      if (c.style !== LIST_STYLE && c.tableref_id && c.tableref_id !== t.id && byId.has(c.tableref_id)) {
        d.add(c.tableref_id);
      }
    }
    deps.set(t.id, d);
  }
  const out: SchemaTable[] = [];
  const visited = new Set<number>();
  const visit = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    const t = byId.get(id);
    if (t) out.push(t);
  };
  for (const t of tables) visit(t.id);
  return out;
}

async function main(): Promise<void> {
  const tables: SchemaTable[] = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const ordered = topoSort(tables);

  console.log('> Ensuring Supabase Storage bucket...');
  await ensureBucket();

  console.log('\n> Insert order:');
  ordered.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} → ${renameTable(t.name)}`));

  const FILE_HEAVY_CONCURRENCY = 12;
  const FAST_CONCURRENCY = 20;

  for (const t of ordered) {
    const hasFiles = t.columns.some(c => FILE_TYPES.has(c.type));
    const conc = hasFiles ? FILE_HEAVY_CONCURRENCY : FAST_CONCURRENCY;
    await importTable(t, conc);
  }

  await resetSequences(ordered);

  if (fileErrors.length > 0) {
    fs.writeFileSync(ERRORS_FILE, JSON.stringify(fileErrors, null, 2));
    console.log(`\n! ${fileErrors.length} file error(s) written to ${ERRORS_FILE}`);
  } else {
    console.log('\n✓ No file errors');
  }

  console.log('\n=== Summary ===');
  for (const [tbl, s] of Object.entries(stats)) {
    console.log(`  ${tbl.padEnd(20)}  inserted=${s.inserted}  skipped=${s.skipped}  files=${s.files_uploaded}  file_errors=${s.file_errors}`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('FAILED:', err.message);
  if (err.detail) console.error('  detail:', err.detail);
  if (err.hint) console.error('  hint:', err.hint);
  await pool.end().catch(() => {});
  process.exit(1);
});
