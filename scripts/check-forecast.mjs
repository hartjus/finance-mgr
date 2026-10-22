// Synthetic PostgreSQL verification in a disposable container; never application data.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const server = readFileSync(new URL('../apps/api/src/server.ts', import.meta.url), 'utf8');
const sql = server.match(/`(WITH forecast_plans AS \([\s\S]+?FROM accounts a WHERE a.id=\$1)`/)?.[1];
if (!sql) throw new Error('Forecast SQL not found');
const methodSql = readFileSync(new URL('../apps/api/src/forecast-method.ts', import.meta.url), 'utf8').match(/= `([\s\S]+)`;/)?.[1];
if (!methodSql) throw new Error('Forecast method SQL not found');
const migrations = readdirSync(new URL('../apps/api/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(new URL(`../apps/api/migrations/${name}`, import.meta.url), 'utf8') }));
async function verify(sql, methodSql, migrations) {
  const { default: pg } = await import('pg');
  const { default: assert } = await import('node:assert/strict');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE TABLE accounts (id text PRIMARY KEY, starting_balance_cents bigint);
      CREATE TABLE categories (id text PRIMARY KEY,name text,is_system boolean);
      CREATE TABLE budget_lines (id text PRIMARY KEY,account_id text,category_id text,line_type text,budget_year int,deleted_at timestamptz);
      CREATE TABLE budget_line_months (budget_line_id text,month int,amount_cents bigint,checked_at timestamptz);
      CREATE TABLE transactions (account_id text,category_id text,occurred_on date,amount_cents bigint,status text,deleted_at timestamptz,transfer_id text);
      CREATE TABLE account_category_forecast_methods (account_id text,category_id text,method text);
      INSERT INTO accounts VALUES ('a',100000),('b',0);
      INSERT INTO categories VALUES ('food','Food',false),('pay','Pay',false),('xfer','Xfer Accounts',true),('extra','Unbudgeted',false);
      INSERT INTO budget_lines VALUES ('one','a','food','expense',2026,NULL),('two','a','food','expense',2026,NULL),('pay','a','pay','income',2026,NULL),('deleted','a','food','expense',2026,now()),('transfer','a','xfer','expense',2026,NULL),('foreign','b','food','expense',2026,NULL);
      INSERT INTO budget_line_months VALUES ('one',10,20000,now()),('two',10,10000,NULL),('pay',10,100000,NULL),('deleted',10,99000,NULL),('transfer',10,99000,NULL),('foreign',10,99000,NULL),('one',11,99000,NULL);
      INSERT INTO transactions VALUES
        ('a','food','2026-09-01',-1000,'posted',NULL,NULL),
        ('a','food','2026-10-02',-20000,'posted',NULL,NULL),
        ('a','pay','2026-10-03',50000,'posted',NULL,NULL),
        ('a','extra','2026-10-04',-100,'posted',NULL,NULL),
        ('a','food','2026-10-04',-99000,'pending',NULL,NULL),
        ('a','food','2026-10-04',-99000,'posted',now(),NULL),
        ('a','xfer','2026-10-05',-2000,'posted',NULL,'paired'),
        ('a','xfer','2026-10-06',-3000,'posted',NULL,NULL),
        ('a','food','2026-10-06',-4000,'posted',NULL,'paired'),
        ('a','food','2026-10-20',-99000,'posted',NULL,NULL),
        ('a','food','2026-11-01',-99000,'posted',NULL,NULL),
        ('b','food','2026-10-01',-99000,'posted',NULL,NULL);`);
    const { rows: [result] } = await client.query(sql, ['a','2026-10-01','2026-10-10']);
    assert.equal(result.balance_cents, '119900');
    assert.deepEqual(result.plans.map(p => [p.category_id,p.amount_cents]), [['food','30000'],['pay','100000']]);
    assert.deepEqual(result.daily.map(d => [d.category_id,d.date,d.amount_cents]), [['food','2026-10-02','20000'],['pay','2026-10-03','50000'],['extra','2026-10-04','100']]);
    const future = (await client.query(sql, ['a','2026-11-01','2026-10-10'])).rows[0];
    assert.deepEqual(future.daily, []);
    assert.equal(future.balance_cents, '119900');
    console.log('PASS: forecast SQL aggregates checked plans and unbudgeted actuals; excludes pending/deleted/foreign/out-of-period/transfer spending; includes posted transfers in cutoff balance.');

    // Apply the real migration chain in an isolated schema, then verify writes
    // and read-back against its constraints rather than mock tables.
    await client.query('CREATE SCHEMA forecast_migration_test; SET search_path TO forecast_migration_test,public');
    await client.query('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const migration of migrations) {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
    }
    const owner = '11111111-1111-4111-8111-111111111111', account = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
    const category = '44444444-4444-4444-8444-444444444444', system = '55555555-5555-4555-8555-555555555555', unrelated = '66666666-6666-4666-8666-666666666666', editor = '77777777-7777-4777-8777-777777777777';
    await client.query("INSERT INTO users(id,email,password_hash) VALUES ($1,'owner@example.test','synthetic-not-a-password-hash'),($2,'editor@example.test','synthetic-not-a-password-hash')", [owner, editor]);
    await client.query(`INSERT INTO accounts(id,owner_user_id,name,account_number_ciphertext,account_number_iv,account_number_auth_tag,account_number_last_four)
      SELECT id::uuid,$1,'Synthetic account',decode('00','hex'),decode('00','hex'),decode('00','hex'),'0000' FROM unnest($2::text[]) AS id`, [owner, [account, other]]);
    await client.query("INSERT INTO account_memberships VALUES ($1,$3,'owner'),($2,$3,'owner'),($1,$4,'editor')", [account,other,owner,editor]);
    await client.query("INSERT INTO categories(id,user_id,name,is_system) VALUES ($1,$4,'Food',false),($2,$4,'Transfer',true),($3,$4,'Unrelated',false)", [category,system,unrelated,owner]);
    await client.query("INSERT INTO budget_lines(user_id,account_id,budget_year,line_type,name,category_id) VALUES ($1,$2,2026,'expense','Plan',$3),($1,$2,2026,'expense','Transfer',$4)", [owner,account,category,system]);
    const read = async id => (await client.query(sql, [id,'2026-10-01','2026-10-10'])).rows[0];
    const save = (id,cat,user,method) => client.query(methodSql, [id,cat,user,method]);
    assert.deepEqual((await read(account)).methods, []);
    await client.query('INSERT INTO account_category_forecast_methods(account_id,category_id) VALUES ($1,$2)', [account,category]);
    assert.equal((await read(account)).methods[0].method, 'fixed');
    await assert.rejects(client.query('INSERT INTO account_category_forecast_methods(account_id,category_id) VALUES ($1,$2)', [account,category]), { code: '23505' });
    await assert.rejects(client.query('INSERT INTO account_category_forecast_methods(account_id,category_id) VALUES ($1,$2)', [account,editor]), { code: '23503' });
    assert.equal((await save(account,category,editor,'variable')).rowCount, 1); // Shared-account editor.
    assert.deepEqual((await read(account)).methods, [{ category_id: category, method: 'variable' }]);
    assert.deepEqual((await read(other)).methods, []);
    assert.equal((await client.query(sql, [account,'2026-11-01','2026-10-10'])).rows[0].methods[0].method, 'variable');
    assert.equal((await save(account,category,owner,'variable')).rowCount, 1); // Idempotent retry.
    assert.equal((await save(account,category,owner,'fixed')).rowCount, 1);
    assert.equal((await read(account)).methods[0].method, 'fixed');
    await assert.rejects(save(account,category,owner,'invalid'), { code: '23514' });
    for (const [id,cat,user] of [[account,system,owner],[account,unrelated,owner],[other,category,owner],[other,category,editor]]) {
      assert.equal((await save(id,cat,user,'variable')).rowCount, 0);
    }
    await client.query('UPDATE categories SET is_archived=true WHERE id=$1', [category]);
    assert.equal((await save(account,category,editor,'variable')).rowCount, 1);
    await client.query("UPDATE account_memberships SET permission='viewer' WHERE user_id=$1", [editor]);
    assert.equal((await save(account,category,editor,'fixed')).rowCount, 0);
    await client.query('UPDATE accounts SET is_active=false WHERE id=$1', [account]);
    assert.equal((await save(account,category,owner,'fixed')).rowCount, 0);
    assert.equal((await read(account)).methods[0].method, 'variable');
    await client.query('UPDATE accounts SET is_active=true WHERE id=$1', [account]);
    await client.query('UPDATE budget_lines SET deleted_at=now() WHERE account_id=$1', [account]);
    assert.equal((await save(account,category,owner,'fixed')).rowCount, 0);
    await client.query("INSERT INTO transactions(user_id,account_id,occurred_on,amount_cents,description,category_id) VALUES ($1,$2,'2026-10-01',-100,'Synthetic unbudgeted debit',$3)", [owner,other,category]);
    assert.equal((await save(other,category,owner,'fixed')).rowCount, 1); // Unbudgeted category.
    await client.query('DELETE FROM transactions WHERE account_id=$1', [other]);
    await client.query('DELETE FROM accounts WHERE id=$1', [other]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM account_category_forecast_methods WHERE account_id=$1', [other])).rows[0].count, 0);
    console.log('PASS: all migrations, Fixed default, unique/FK/check constraints, shared-editor upsert/read/retry, account isolation, cross-month persistence, archived/unbudgeted support and permission/category protections.');
  } finally { await client.end(); }
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
    input: `await (${verify.toString()})(${JSON.stringify(sql)},${JSON.stringify(methodSql)},${JSON.stringify(migrations)});`, encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); process.exitCode = result.status ?? 1;
} finally {
  if (spawnSync('docker',['stop',id],{ encoding: 'utf8' }).status !== 0) { process.stderr.write('Could not stop disposable database.\n'); process.exitCode = 1; }
}
