// Run npm run build first. Uses a disposable database, never application data.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const source = readFileSync(new URL('../apps/api/dist/bulk-transactions.js', import.meta.url), 'utf8');
async function verify(source) {
  const { default: pg } = await import('pg');
  const { default: assert } = await import('node:assert/strict');
  const { commitBulk } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const concurrent = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect(); await concurrent.connect();
  const user = '11111111-1111-4111-8111-111111111111', account = '22222222-2222-4222-8222-222222222222', category = '33333333-3333-4333-8333-333333333333';
  const row = { occurredOn: '2026-01-01', amountCents: -1234, description: 'Synthetic debit', categoryId: category };
  const rows = [row, { ...row, amountCents: 5000, description: 'Synthetic credit' }];
  const counts = async () => (await client.query('SELECT (SELECT count(*)::int FROM transactions) AS rows,(SELECT count(*)::int FROM idempotency_keys) AS receipts')).rows[0];
  try {
    await client.query(`CREATE SCHEMA bulk_test; SET search_path TO bulk_test;
      CREATE TABLE accounts (id uuid PRIMARY KEY,is_active boolean);
      CREATE TABLE account_memberships (account_id uuid,user_id uuid,permission text);
      CREATE TABLE categories (id uuid PRIMARY KEY,user_id uuid,is_archived boolean DEFAULT false);
      CREATE TABLE transactions (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,user_id uuid,account_id uuid,occurred_on date,amount_cents bigint CHECK(amount_cents<>0),description text CHECK(description<>'Reject'),category_id uuid REFERENCES categories(id),identifier text,notes text,status text DEFAULT 'posted',reconciled_at timestamptz);
      CREATE TABLE idempotency_keys (user_id uuid,key text,response_status int,response_body jsonb,PRIMARY KEY(user_id,key));`);
    await concurrent.query('SET search_path TO bulk_test');
    await client.query('INSERT INTO accounts VALUES ($1,true)', [account]);
    await client.query("INSERT INTO account_memberships VALUES ($1,$2,'owner')", [account,user]);
    await client.query('INSERT INTO categories (id,user_id) VALUES ($1,$2)', [category,user]);
    await assert.rejects(commitBulk(client,user,account,'invalid-category',[row,{ ...row,categoryId: '99999999-9999-4999-8999-999999999999' }]), /Row 2/);
    assert.deepEqual(await counts(), { rows: 0,receipts: 0 });
    await assert.rejects(commitBulk(client,user,account,'db-failure',[row,{ ...row,description: 'Reject' }]));
    assert.deepEqual(await counts(), { rows: 0,receipts: 0 });
    assert.deepEqual(await commitBulk(client,user,account,'success',rows), { createdCount: 2 });
    assert.deepEqual(await counts(), { rows: 2,receipts: 1 });
    assert.deepEqual(await commitBulk(client,user,account,'success',rows), { createdCount: 2 });
    assert.deepEqual(await counts(), { rows: 2,receipts: 1 });
    await assert.rejects(commitBulk(client,user,account,'success',[row]), /different batch/);
    assert.deepEqual(await counts(), { rows: 2,receipts: 1 });
    const [one,two] = await Promise.all([commitBulk(client,user,account,'concurrent',rows),commitBulk(concurrent,user,account,'concurrent',rows)]);
    assert.deepEqual(one,two); assert.deepEqual(await counts(), { rows: 4,receipts: 2 });
    const totals = (await client.query("SELECT sum(amount_cents)::text AS total,count(*) FILTER (WHERE status='posted' AND reconciled_at IS NULL)::int AS posted FROM transactions")).rows[0];
    assert.deepEqual(totals, { total: '7532',posted: 4 });
    await client.query('UPDATE categories SET is_archived=true');
    await assert.rejects(commitBulk(client,user,account,'archived',rows), /active category/);
    await client.query('UPDATE categories SET is_archived=false,user_id=$1', ['99999999-9999-4999-8999-999999999999']);
    await assert.rejects(commitBulk(client,user,account,'foreign',rows), /active category/);
    await client.query("UPDATE account_memberships SET permission='viewer'");
    await assert.rejects(commitBulk(client,user,account,'viewer',rows), /cannot update/);
    await client.query("UPDATE account_memberships SET permission='editor'");
    await client.query('UPDATE accounts SET is_active=false');
    await assert.rejects(commitBulk(client,user,account,'inactive',rows), /cannot update/);
    assert.deepEqual(await counts(), { rows: 4,receipts: 2 });
    console.log('PASS: PostgreSQL bulk rollback, category/permission checks, posted/unreconciled totals, replay, mismatched key, and concurrent duplicate protection.');
  } finally { await client.end(); await concurrent.end(); }
}
const started = spawnSync('docker', ['run','--rm','-d','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'], { encoding: 'utf8' });
if (started.status !== 0) { process.stderr.write(started.stderr ?? 'Docker startup failed'); process.exit(1); }
const id = started.stdout.trim();
if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Unexpected disposable container ID');
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnSync('docker',['exec',id,'pg_isready','-U','postgres']).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve,500));
  }
  if (!ready) throw new Error('Disposable database startup timed out');
  const result = spawnSync('docker',['run','--rm','-i','--network',`container:${id}`,'-e','DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres','--entrypoint','node','finance-mgr-api','--input-type=module'], {
    input: `await (${verify.toString()})(${JSON.stringify(source)});`, encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); process.exitCode = result.status ?? 1;
} finally {
  if (spawnSync('docker',['stop',id],{ encoding: 'utf8' }).status !== 0) { process.stderr.write('Could not stop disposable database.\n'); process.exitCode = 1; }
}
