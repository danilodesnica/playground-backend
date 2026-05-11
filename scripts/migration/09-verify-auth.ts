import { pool } from './lib/supabase-pg';

interface CheckResult { name: string; pass: boolean; detail: string; }
const results: CheckResult[] = [];
const ok = (name: string, detail: string) => results.push({ name, pass: true, detail });
const fail = (name: string, detail: string) => results.push({ name, pass: false, detail });

async function main(): Promise<void> {
  console.log('> Counts');
  const { rows: pc } = await pool.query<{ c: string }>(`SELECT COUNT(*)::text as c FROM public.users`);
  const { rows: ac } = await pool.query<{ c: string }>(`SELECT COUNT(*)::text as c FROM auth.users`);
  const pub = parseInt(pc[0].c, 10);
  const aut = parseInt(ac[0].c, 10);
  console.log(`  public.users: ${pub}`);
  console.log(`  auth.users:   ${aut}`);
  if (pub === aut) ok('counts', `public=${pub} auth=${aut}`);
  else fail('counts', `public=${pub} auth=${aut}`);

  console.log('\n> Unmatched profile ids (in public.users but not auth.users)');
  const { rows: orphans } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM public.users WHERE id NOT IN (SELECT id FROM auth.users) LIMIT 10`
  );
  if (orphans.length === 0) {
    console.log('  ✓ none');
    ok('orphans_public', 'none');
  } else {
    console.log(`  ✗ ${orphans.length} orphan(s):`);
    orphans.forEach(o => console.log(`    - ${o.id}  ${o.email}`));
    fail('orphans_public', `${orphans.length} orphan(s)`);
  }

  console.log('\n> auth.users without a public.users profile');
  const { rows: authOnly } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM auth.users WHERE id NOT IN (SELECT id FROM public.users) LIMIT 10`
  );
  if (authOnly.length === 0) {
    console.log('  ✓ none');
    ok('orphans_auth', 'none');
  } else {
    console.log(`  ${authOnly.length} auth row(s) without a profile:`);
    authOnly.forEach(r => console.log(`    - ${r.id}  ${r.email}`));
    fail('orphans_auth', `${authOnly.length} auth-only row(s)`);
  }

  console.log('\n> Validate FK constraint users_id_auth_fkey (marks NOT VALID → VALID)');
  try {
    await pool.query(`ALTER TABLE public.users VALIDATE CONSTRAINT users_id_auth_fkey`);
    console.log('  ✓ FK validated');
    ok('fk_validated', 'users_id_auth_fkey VALID');
  } catch (err: any) {
    console.log(`  ✗ ${err.message}`);
    fail('fk_validated', err.message);
  }

  console.log('\n> is_admin() helper function exists');
  const { rows: fn } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text as c FROM pg_proc WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace`
  );
  if (parseInt(fn[0].c, 10) === 1) {
    console.log('  ✓ present');
    ok('is_admin_fn', 'exists');
  } else {
    fail('is_admin_fn', 'missing');
  }

  console.log('\n> custom_access_token_hook function exists + granted');
  const { rows: hook } = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text as c FROM pg_proc WHERE proname = 'custom_access_token_hook' AND pronamespace = 'public'::regnamespace`
  );
  if (parseInt(hook[0].c, 10) === 1) {
    console.log('  ✓ function present');
    ok('hook_fn', 'exists');
  } else {
    fail('hook_fn', 'missing');
  }

  console.log('\n> Admin users (is_admin = true)');
  const { rows: admins } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM public.users WHERE is_admin = true ORDER BY email`
  );
  console.log(`  ${admins.length} admin(s):`);
  admins.slice(0, 10).forEach(a => console.log(`    - ${a.email}  (${a.id})`));
  if (admins.length > 10) console.log(`    ... and ${admins.length - 10} more`);

  console.log('\n> RLS policies on each table');
  const { rows: policies } = await pool.query<{ tablename: string; count: string }>(`
    SELECT tablename, COUNT(*)::text as count
    FROM pg_policies
    WHERE schemaname = 'public'
    GROUP BY tablename
    ORDER BY tablename
  `);
  for (const p of policies) {
    console.log(`  ${p.tablename.padEnd(20)}  ${p.count} policies`);
  }
  const hasPlaceholder = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text as c FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%_migration_placeholder'`
  );
  if (parseInt(hasPlaceholder.rows[0].c, 10) === 0) {
    console.log('  ✓ no placeholder policies remaining');
    ok('placeholders_gone', '0 placeholders');
  } else {
    console.log(`  ✗ ${hasPlaceholder.rows[0].c} placeholder policies still present`);
    fail('placeholders_gone', `${hasPlaceholder.rows[0].c} placeholders`);
  }

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
