// Executes production importer against session-local temp tables, never public app data.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const source = readFileSync(new URL('./import-checkbook.mjs', import.meta.url), 'utf8');
async function verify(source) {
  const { default: pg } = await import('pg');
  const { default: assert } = await import('node:assert/strict');
  const { normalizeCsv, importRows, listAccounts, HEADER } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const account = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
  const options = { accountId: account, email: 'owner@example.test', createCategories: true };
  const rows = normalizeCsv(HEADER.join(',') + '\n10/18/2026,$12.34,,001,Example,*,Memo,Groceries,,\n10/19/2026,,$25.00,,Income,,,Income,,');
  const count = async (table) => Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  try {
    await client.query(`SET search_path TO pg_temp;
      CREATE TEMP TABLE users (id uuid PRIMARY KEY,email text UNIQUE);
      CREATE TEMP TABLE accounts (id uuid PRIMARY KEY,is_active boolean,starting_balance_cents bigint,name text DEFAULT 'Synthetic account',account_number_last_four text DEFAULT '1234');
      CREATE TEMP TABLE account_memberships (account_id uuid,user_id uuid,permission text);
      CREATE TEMP TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,name text,is_archived boolean DEFAULT false,is_system boolean DEFAULT false,UNIQUE(user_id,name));
      CREATE TEMP TABLE transactions (id uuid PRIMARY KEY,user_id uuid,account_id uuid,occurred_on date,amount_cents bigint CHECK(amount_cents<>0),description text,category_id uuid REFERENCES categories(id),identifier text,notes text,status text,reconciled_at timestamptz,reconciled_by_user_id uuid,created_at timestamptz,deleted_at timestamptz);
    `);
    await client.query('INSERT INTO users VALUES ($1,$2)', [user, options.email]);
    await client.query('INSERT INTO accounts (id,is_active,starting_balance_cents) VALUES ($1,true,10000)', [account]);
    await client.query("INSERT INTO account_memberships VALUES ($1,$2,'owner')", [account, user]);
    assert.deepEqual(await listAccounts(client, options.email), [{ id: account, name: 'Synthetic account', account_number_last_four: '1234' }]);
    await assert.rejects(importRows(client, rows, { ...options, createCategories: false }), /missing categories/);
    assert.equal((await importRows(client, rows, options)).mode, 'dry-run');
    assert.equal(await count('transactions'), 0); assert.equal(await count('categories'), 0);
    for (const permission of ['viewer', 'editor']) {
      await client.query('UPDATE account_memberships SET permission=$1', [permission]);
      if (permission === 'viewer') {
        await assert.rejects(importRows(client, rows, options), /owner\/editor/);
        assert.deepEqual(await listAccounts(client, options.email), []);
      }
      else assert.equal((await importRows(client, rows, options)).rows, 2);
    }
    await assert.rejects(importRows(client, rows, { ...options, email: 'absent@example.test' }), /owner\/editor/);
    await client.query('UPDATE accounts SET is_active=false');
    assert.deepEqual(await listAccounts(client, options.email), []);
    await assert.rejects(importRows(client, rows, options), /active account/);
    await client.query('UPDATE accounts SET is_active=true');
    const committed = { ...options, commit: true, confirmReconciled: true };
    assert.equal((await importRows(client, rows, committed)).rows, 2);
    const stored = (await client.query('SELECT * FROM transactions ORDER BY occurred_on')).rows;
    assert.equal(stored[0].amount_cents, '-1234'); assert.ok(stored[0].reconciled_at);
    assert.equal(stored[0].reconciled_by_user_id, user); assert.equal(stored[1].reconciled_at, null);
    assert.equal(stored[0].identifier, '001'); assert.equal(stored[0].notes, 'Memo');
    const balances = (await client.query(`SELECT 10000+sum(amount_cents) AS current,10000+sum(amount_cents) FILTER(WHERE reconciled_at IS NOT NULL) AS reconciled FROM transactions`)).rows[0];
    assert.equal(balances.current, '11266'); assert.equal(balances.reconciled, '8766');
    assert.equal((await client.query('SELECT starting_balance_cents FROM accounts')).rows[0].starting_balance_cents, '10000');
    assert.equal((await importRows(client, rows, committed)).skippedPreviouslyImported, 2);
    await client.query("UPDATE transactions SET description='Edited',deleted_at=now() WHERE identifier='001'");
    assert.equal((await importRows(client, rows, committed)).rows, 0);
    assert.equal(await count('transactions'), 2);
    await assert.rejects(importRows(client, [{ ...rows[1], category: 'Changed category' }], committed), /overlaps/);
    const newRow = { ...rows[0], description: 'New row', category: 'New category' };
    // Force a database failure on the second INSERT to prove the first row and new category roll back.
    await client.query("ALTER TABLE transactions ADD CHECK (description <> 'Reject row')");
    await assert.rejects(importRows(client, [newRow, { ...newRow, description: 'Reject row' }], committed));
    assert.equal(await count('transactions'), 2); assert.equal(await count('categories'), 2);
    assert.equal((await importRows(client, [newRow, newRow], committed)).rows, 2);
    assert.equal((await importRows(client, [newRow, newRow], committed)).skippedPreviouslyImported, 2);
    await client.query("UPDATE categories SET is_archived=true WHERE name='Groceries'");
    await assert.rejects(importRows(client, [{ ...rows[0], description: 'Archived category test' }], committed), /archived/);
    await client.query("UPDATE categories SET is_archived=false,is_system=true WHERE name='Groceries'");
    await assert.rejects(importRows(client, [{ ...rows[0], description: 'Protected category test' }], committed), /protected/);
    console.log('PASS: Checkbook PostgreSQL checks — dry-run, membership, inactive accounts, categories, atomic rollback, reconciliation metadata, balances, retry/edited/deleted protection, overlap, repeated rows.');
  } finally { await client.end(); }
}
// No ports or persistent volumes; destroy only the disposable container created here.
const started = spawnSync('docker', ['run', '--rm', '-d', '--tmpfs', '/var/lib/postgresql/data',
  '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'], { encoding: 'utf8' });
if (started.status !== 0) { process.stderr.write(started.stderr ?? 'Docker startup failed'); process.exit(1); }
const containerId = started.stdout.trim();
if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Unexpected disposable container ID');
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnSync('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres']).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  const result = spawnSync('docker', ['run', '--rm', '-i', '--network', `container:${containerId}`,
    '-e', 'DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres',
    '--entrypoint', 'node', 'finance-mgr-api', '--input-type=module'], {
    input: `await (${verify.toString()})(${JSON.stringify(source)});`, encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exitCode = result.status ?? 1;
} finally {
  const stopped = spawnSync('docker', ['stop', containerId], { encoding: 'utf8' });
  if (stopped.status !== 0) { process.stderr.write('Could not stop disposable test database.\n'); process.exitCode = 1; }
}
