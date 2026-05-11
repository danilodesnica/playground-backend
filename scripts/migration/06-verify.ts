import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { pool } from './lib/supabase-pg';
import { XanoColumn } from './lib/xano-client';
import { renameTable, renameColumn, isSkipped } from './lib/overrides';

const SCHEMA_FILE = path.resolve(__dirname, 'output', 'xano-schema.json');
const DATA_DIR = path.resolve(__dirname, 'output', 'data');

interface SchemaTable {
  id: number;
  name: string;
  columns: XanoColumn[];
}

const FILE_TYPES = new Set(['image', 'video', 'audio', 'attachment', 'storage']);

interface CheckResult { name: string; pass: boolean; detail: string; }
const results: CheckResult[] = [];

function ok(name: string, detail: string) { results.push({ name, pass: true, detail }); }
function fail(name: string, detail: string) { results.push({ name, pass: false, detail }); }

async function checkRowCounts(tables: SchemaTable[]): Promise<void> {
  console.log('\n> Row count check');
  for (const t of tables) {
    const pgTable = renameTable(t.name);
    const dataFile = path.join(DATA_DIR, `${t.name}.json`);
    if (!fs.existsSync(dataFile)) continue;
    const xanoRows: any[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const { rows } = await pool.query<{ c: string }>(`SELECT COUNT(*)::text as c FROM "${pgTable}"`);
    const pgCount = parseInt(rows[0].c, 10);
    const xanoCount = xanoRows.length;
    const label = `${pgTable}: xano=${xanoCount} supabase=${pgCount}`;
    if (pgCount === xanoCount) {
      console.log(`  ✓ ${label}`);
      ok(`count:${pgTable}`, label);
    } else {
      console.log(`  ✗ ${label}`);
      fail(`count:${pgTable}`, label);
    }
  }
}

interface FkSpec { child: string; childCol: string; parent: string; parentCol: string; }

function buildFkSpecs(tables: SchemaTable[]): FkSpec[] {
  const byId = new Map(tables.map(t => [t.id, t]));
  const fks: FkSpec[] = [];
  for (const t of tables) {
    const childPg = renameTable(t.name);
    for (const c of t.columns) {
      if (isSkipped(t.name, c.name)) continue;
      if (c.style === 'list') continue;
      if (!c.tableref_id) continue;
      const parent = byId.get(c.tableref_id);
      if (!parent) continue;
      fks.push({
        child: childPg,
        childCol: renameColumn(t.name, c.name),
        parent: renameTable(parent.name),
        parentCol: 'id',
      });
    }
  }
  return fks;
}

async function checkFkIntegrity(tables: SchemaTable[]): Promise<void> {
  console.log('\n> FK integrity');
  for (const fk of buildFkSpecs(tables)) {
    const sql = `
      SELECT COUNT(*)::text as c
      FROM "${fk.child}" c
      WHERE c."${fk.childCol}" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "${fk.parent}" p WHERE p."${fk.parentCol}" = c."${fk.childCol}")
    `;
    const { rows } = await pool.query<{ c: string }>(sql);
    const orphans = parseInt(rows[0].c, 10);
    const label = `${fk.child}.${fk.childCol} → ${fk.parent}.${fk.parentCol}: ${orphans} orphan(s)`;
    if (orphans === 0) {
      console.log(`  ✓ ${label}`);
      ok(`fk:${fk.child}.${fk.childCol}`, label);
    } else {
      console.log(`  ✗ ${label}`);
      fail(`fk:${fk.child}.${fk.childCol}`, label);
    }
  }
}

async function checkFileAccessibility(tables: SchemaTable[]): Promise<void> {
  console.log('\n> File accessibility (HEAD)');
  const sampled: { table: string; col: string; url: string }[] = [];

  for (const t of tables) {
    const pgTable = renameTable(t.name);
    const fileCols = t.columns.filter(c => FILE_TYPES.has(c.type));
    if (fileCols.length === 0) continue;

    for (const col of fileCols) {
      const pgCol = renameColumn(t.name, col.name);
      const isList = col.style === 'list';
      const urlExpr = isList
        ? `(SELECT elem->>'url' FROM jsonb_array_elements(to_jsonb("${pgCol}")) elem WHERE elem->>'url' IS NOT NULL LIMIT 1)`
        : `"${pgCol}"->>'url'`;
      const sql = `SELECT ${urlExpr} AS u FROM "${pgTable}" WHERE "${pgCol}" IS NOT NULL LIMIT 2`;
      try {
        const { rows } = await pool.query<{ u: string | null }>(sql);
        for (const r of rows) if (r.u) sampled.push({ table: pgTable, col: pgCol, url: r.u });
      } catch (err: any) {
        console.log(`  (skip ${pgTable}.${pgCol}: ${err.message})`);
      }
    }
  }

  if (sampled.length === 0) {
    console.log('  (no file URLs to check)');
    return;
  }

  const toCheck = sampled.slice(0, 10);
  for (const s of toCheck) {
    try {
      const resp = await axios.head(s.url, { timeout: 20_000, validateStatus: () => true });
      const pass = resp.status === 200;
      const label = `${s.table}.${s.col}: HTTP ${resp.status}  ${s.url}`;
      if (pass) { console.log(`  ✓ ${label}`); ok(`file:${s.table}.${s.col}`, label); }
      else { console.log(`  ✗ ${label}`); fail(`file:${s.table}.${s.col}`, label); }
    } catch (err: any) {
      console.log(`  ✗ ${s.table}.${s.col}: ${err.message}  ${s.url}`);
      fail(`file:${s.table}.${s.col}`, err.message);
    }
  }
}

async function sampleDiff(tables: SchemaTable[]): Promise<void> {
  console.log('\n> Random-sample diff (3 rows per table — eyeball check)');
  for (const t of tables) {
    const pgTable = renameTable(t.name);
    const dataFile = path.join(DATA_DIR, `${t.name}.json`);
    if (!fs.existsSync(dataFile)) continue;
    const xanoRows: any[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (xanoRows.length === 0) continue;
    const picks = Array.from({ length: Math.min(3, xanoRows.length) }, () =>
      xanoRows[Math.floor(Math.random() * xanoRows.length)]
    );
    for (const x of picks) {
      const { rows } = await pool.query(`SELECT * FROM "${pgTable}" WHERE id = $1`, [x.id]);
      const pg = rows[0];
      if (!pg) { console.log(`  ✗ ${pgTable} id=${x.id} NOT FOUND`); fail(`sample:${pgTable}:${x.id}`, 'not found'); continue; }
      console.log(`  • ${pgTable} id=${x.id} OK (xano_cols=${Object.keys(x).length}, pg_cols=${Object.keys(pg).length})`);
    }
  }
}

async function main(): Promise<void> {
  const tables: SchemaTable[] = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));

  await checkRowCounts(tables);
  await checkFkIntegrity(tables);
  await checkFileAccessibility(tables);
  await sampleDiff(tables);

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log('\n=== Verification Summary ===');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter(r => !r.pass)) console.log(`  ✗ ${r.name}: ${r.detail}`);
  }

  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(async err => {
  console.error('FAILED:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
