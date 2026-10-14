// Runs the production ledger SELECT against isolated, rolled-back PostgreSQL temp tables.
// Requires the project's API Docker container; never reads/writes application tables.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const source = readFileSync(new URL('../apps/api/src/server.ts', import.meta.url), 'utf8');
const sql = source.match(/pool\.query\(`(\s*WITH ledger AS[\s\S]*?)`,/)[1];
async function verify(sql) {
  const { default: pg } = await import('pg');
  const { default: assert } = await import('node:assert/strict');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp');
    await client.query(`CREATE TEMP TABLE accounts (id uuid, starting_balance_cents bigint);
      CREATE TEMP TABLE categories (id uuid, name text);
      CREATE TEMP TABLE transactions (id uuid, account_id uuid, category_id uuid, occurred_on date, created_at timestamptz, amount_cents bigint, status text, deleted_at timestamptz, reconciled_at timestamptz, description text);
      INSERT INTO accounts VALUES ('11111111-1111-4111-8111-111111111111',10000);
      INSERT INTO categories VALUES ('22222222-2222-4222-8222-222222222222','Test category');
      INSERT INTO transactions SELECT lpad(i::text,32,'0')::uuid, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '2026-01-01', '2026-01-01', 100, 'posted', NULL, NULL, CASE WHEN i%2=0 THEN 'Even' ELSE 'Odd' END FROM generate_series(1,151) i;
      INSERT INTO transactions VALUES ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-02-01','2026-02-01',999999,'posted',now(),NULL,'Deleted');`);
    const get = async (page, size = 75, description = null) => (await client.query(sql, ['11111111-1111-4111-8111-111111111111', null, null, description, null, size, page])).rows[0];
    const first = await get(1), second = await get(2), last = await get(999);
    assert.equal(Number(first.total_items),151);
    assert.equal(first.transactions.length,75);
    assert.equal(second.transactions.length,75);
    assert.equal(first.transactions[0].running_balance_cents,'25100');
    assert.equal(first.transactions[0].amount_cents,'100');
    assert.equal(second.transactions[0].running_balance_cents,'17600');
    assert.equal(last.page,3);
    assert.equal(last.transactions.length,1);
    assert.equal(last.transactions[0].running_balance_cents,'10100');
    assert.equal(new Set([...first.transactions,...second.transactions,...last.transactions].map(t=>t.id)).size,151);
    const filtered = await get(2,25,'Even');
    assert.equal(Number(filtered.total_items),75);
    assert.equal(filtered.transactions[0].running_balance_cents,'20000');
    const empty = await get(99,75,'Absent');
    assert.equal(empty.page,1); assert.equal(empty.total_pages,1); assert.deepEqual(empty.transactions,[]);
    await client.query('DELETE FROM transactions WHERE id=$1', [last.transactions[0].id]);
    assert.equal((await get(3)).page,2);
    await client.query("UPDATE transactions SET status='pending' WHERE deleted_at IS NULL");
    assert.equal((await get(1)).transactions[0].running_balance_cents,'10000');
    console.log('PostgreSQL pagination verified: stable tie ordering, disjoint pages, counts, full-ledger balances, filters, soft deletion, empty/clamped pages, deletion clamp, and pending-only balances.');
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
const result = spawnSync('docker', ['exec', '-i', 'finance-mgr-api-1', 'node', '--input-type=module'], {
  input: `await (${verify.toString()})(${JSON.stringify(sql)});`, encoding: 'utf8',
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
