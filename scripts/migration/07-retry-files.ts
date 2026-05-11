import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { pool } from './lib/supabase-pg';
import { tableRenames, columnRenames } from './lib/overrides';

// Inverse map: pgTable → xanoTable (for looking up column renames)
const inverseTableRenames: Record<string, string> = {};
for (const [xano, pg] of Object.entries(tableRenames)) inverseTableRenames[pg] = xano;

function pgColumnFor(pgTable: string, xanoCol: string): string {
  const xanoTable = inverseTableRenames[pgTable] ?? pgTable;
  return columnRenames[xanoTable]?.[xanoCol] ?? xanoCol;
}

dotenv.config({ path: path.resolve(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = 'attachments';
const ERRORS_FILE = path.resolve(__dirname, 'output', 'file-errors.json');
const REMAINING_FILE = path.resolve(__dirname, 'output', 'file-errors-remaining.json');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface FileError {
  table: string;
  row_id: any;
  column: string;
  path: string;
  stage: 'download' | 'upload';
  message: string;
}

function slugifyFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function publicUrl(objectPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

function buildArrayLiteral(arr: any[]): string {
  if (arr.length === 0) return '{}';
  const items = arr.map(v => `"${JSON.stringify(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${items.join(',')}}`;
}

async function retryOne(err: FileError): Promise<{ ok: boolean; message?: string }> {
  // Fetch the current stored jsonb from DB; find the element still pointing at the Xano path.
  const { rows } = await pool.query(
    `SELECT "${pgColumnFor(err.table, err.column)}" AS val FROM "${err.table}" WHERE id = $1`,
    [err.row_id]
  );
  if (rows.length === 0) return { ok: false, message: `row not found: ${err.row_id}` };

  const current = rows[0].val;
  const isList = Array.isArray(current);
  let target: any;
  if (isList) {
    target = (current as any[]).find(e => e?.path === err.path);
  } else if (current?.path === err.path) {
    target = current;
  }
  if (!target || !target.url) return { ok: false, message: 'element not found or no url' };

  // Re-download
  let buffer: Buffer;
  try {
    const resp = await axios.get<ArrayBuffer>(target.url, {
      responseType: 'arraybuffer',
      timeout: 90_000,
      maxContentLength: 100 * 1024 * 1024,
    });
    buffer = Buffer.from(resp.data);
  } catch (e: any) {
    return { ok: false, message: `download: ${e?.response?.status ?? e.message}` };
  }

  const filename = slugifyFilename(target.name);
  const objectPath = `${err.table}/${err.row_id}/${filename}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: target.mime ?? 'application/octet-stream',
    upsert: true,
  });
  if (upErr) return { ok: false, message: `upload: ${upErr.message}` };

  const newMeta = {
    path: objectPath,
    name: target.name,
    size: target.size,
    mime: target.mime,
    meta: target.meta,
    url: publicUrl(objectPath),
  };

  if (isList) {
    const updated = (current as any[]).map(e => (e?.path === err.path ? newMeta : e));
    const literal = buildArrayLiteral(updated);
    await pool.query(
      `UPDATE "${err.table}" SET "${pgColumnFor(err.table, err.column)}" = $1::jsonb[] WHERE id = $2`,
      [literal, err.row_id]
    );
  } else {
    await pool.query(
      `UPDATE "${err.table}" SET "${pgColumnFor(err.table, err.column)}" = $1::jsonb WHERE id = $2`,
      [JSON.stringify(newMeta), err.row_id]
    );
  }

  return { ok: true };
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  if (!fs.existsSync(ERRORS_FILE)) {
    console.error(`No errors file at ${ERRORS_FILE}`);
    process.exit(0);
  }
  const errors: FileError[] = JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8'));
  console.log(`> Retrying ${errors.length} file error(s) with concurrency=10`);

  const remaining: (FileError & { retry_message: string })[] = [];
  let ok = 0;
  let done = 0;

  await runWithConcurrency(errors, 10, async (err) => {
    const res = await retryOne(err);
    done++;
    if (res.ok) {
      ok++;
    } else {
      remaining.push({ ...err, retry_message: res.message ?? 'unknown' });
    }
    if (done % 20 === 0 || done === errors.length) {
      console.log(`  ${done}/${errors.length} done (ok=${ok}, still_failing=${remaining.length})`);
    }
  });

  console.log(`\n✓ Retry complete: ${ok} recovered, ${remaining.length} still failing`);

  if (remaining.length > 0) {
    fs.writeFileSync(REMAINING_FILE, JSON.stringify(remaining, null, 2));
    console.log(`  Remaining written to ${REMAINING_FILE}`);
    const byMsg: Record<string, number> = {};
    for (const r of remaining) byMsg[r.retry_message] = (byMsg[r.retry_message] ?? 0) + 1;
    console.log('\nStill failing by message:');
    Object.entries(byMsg).sort((a, b) => b[1] - a[1]).forEach(([m, c]) => console.log(`  ${c}  ${m}`));
  } else {
    if (fs.existsSync(REMAINING_FILE)) fs.unlinkSync(REMAINING_FILE);
  }

  await pool.end();
}

main().catch(async err => {
  console.error('FAILED:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
