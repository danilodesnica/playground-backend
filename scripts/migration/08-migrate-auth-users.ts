import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { pool } from './lib/supabase-pg';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in scripts/migration/.env');
}

const CONCURRENCY = 8;
const OUTPUT_DIR = path.resolve(__dirname, 'output');
const REPORT_FILE = path.join(OUTPUT_DIR, 'auth-migration.json');
const ERRORS_FILE = path.join(OUTPUT_DIR, 'auth-migration-errors.json');

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
}

interface Outcome {
  id: string;
  email: string;
  status: 'created' | 'already_exists' | 'error';
  message?: string;
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

function classifyError(msg: string): 'already_exists' | 'error' {
  const lower = msg.toLowerCase();
  if (lower.includes('already been registered') || lower.includes('already registered') || lower.includes('duplicate')) {
    return 'already_exists';
  }
  return 'error';
}

async function main(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('> Loading profiles from public.users...');
  const { rows: profiles } = await pool.query<ProfileRow>(
    `SELECT id, email, name, is_admin FROM public.users ORDER BY created_at`
  );
  console.log(`  ${profiles.length} profile row(s)`);

  // Pre-fetch existing auth.users ids via SQL (supabase.auth.admin.listUsers is paginated 50 at a time)
  const { rows: existingAuth } = await pool.query<{ id: string }>(`SELECT id FROM auth.users`);
  const existingIds = new Set(existingAuth.map(r => r.id));
  console.log(`  ${existingIds.size} user(s) already in auth.users — will skip`);

  const todo = profiles.filter(p => !existingIds.has(p.id));
  console.log(`  ${todo.length} user(s) to create\n`);

  if (todo.length === 0) {
    console.log('✓ nothing to do');
    await pool.end();
    return;
  }

  const outcomes: Outcome[] = [];
  const startTime = Date.now();
  let processed = 0;
  const logEvery = Math.max(20, Math.floor(todo.length / 20));

  await runWithConcurrency(todo, CONCURRENCY, async (p) => {
    const { error } = await supabase.auth.admin.createUser({
      id: p.id,
      email: p.email,
      email_confirm: true,
      user_metadata: { name: p.name },
    });

    if (error) {
      const cls = classifyError(error.message);
      outcomes.push({ id: p.id, email: p.email, status: cls, message: error.message });
    } else {
      outcomes.push({ id: p.id, email: p.email, status: 'created' });
    }

    processed++;
    if (processed % logEvery === 0 || processed === todo.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = Math.round((todo.length - processed) / rate);
      const created = outcomes.filter(o => o.status === 'created').length;
      const existed = outcomes.filter(o => o.status === 'already_exists').length;
      const errors = outcomes.filter(o => o.status === 'error').length;
      console.log(`  progress: ${processed}/${todo.length}  (${rate.toFixed(1)}/s, ETA ${eta}s)  created=${created}  already_existed=${existed}  errors=${errors}`);
    }
  });

  const created = outcomes.filter(o => o.status === 'created').length;
  const existed = outcomes.filter(o => o.status === 'already_exists').length;
  const errors = outcomes.filter(o => o.status === 'error');

  fs.writeFileSync(REPORT_FILE, JSON.stringify({ total: todo.length, created, already_existed: existed, errors: errors.length, outcomes }, null, 2));
  console.log(`\n✓ Report: ${REPORT_FILE}`);

  if (errors.length > 0) {
    fs.writeFileSync(ERRORS_FILE, JSON.stringify(errors, null, 2));
    console.log(`! ${errors.length} error(s) written to ${ERRORS_FILE}`);
    console.log('\nTop error messages:');
    const byMsg: Record<string, number> = {};
    for (const e of errors) byMsg[e.message ?? 'unknown'] = (byMsg[e.message ?? 'unknown'] ?? 0) + 1;
    Object.entries(byMsg).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([m, c]) => console.log(`  ${c}  ${m}`));
  }

  console.log('\n=== Summary ===');
  console.log(`  total_profiles:       ${profiles.length}`);
  console.log(`  already_in_auth:      ${existingIds.size}`);
  console.log(`  created_now:          ${created}`);
  console.log(`  already_existed_now:  ${existed}`);
  console.log(`  errors:               ${errors.length}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('FAILED:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
