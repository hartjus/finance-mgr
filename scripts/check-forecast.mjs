// Synthetic PostgreSQL verification in a disposable container; never application data.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const server = readFileSync(new URL('../apps/api/src/server.ts', import.meta.url), 'utf8');
const sql = server.match(/`(WITH forecast_plans AS \([\s\S]+?FROM accounts a WHERE a.id=\$1)`/)?.[1];
if (!sql) throw new Error('Forecast SQL not found');
async function verify(sql) {
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
    input: `await (${verify.toString()})(${JSON.stringify(sql)});`, encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); process.exitCode = result.status ?? 1;
} finally {
  if (spawnSync('docker',['stop',id],{ encoding: 'utf8' }).status !== 0) { process.stderr.write('Could not stop disposable database.\n'); process.exitCode = 1; }
}
