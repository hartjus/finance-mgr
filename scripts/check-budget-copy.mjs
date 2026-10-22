// Run npm run build first. Only synthetic data in a disposable PostgreSQL container.
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const source = readFileSync(
  new URL("../apps/api/dist/budget-copy.js", import.meta.url),
  "utf8",
);
const migrations = readdirSync(
  new URL("../apps/api/migrations/", import.meta.url),
)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) =>
    readFileSync(
      new URL(`../apps/api/migrations/${name}`, import.meta.url),
      "utf8",
    ),
  );
async function verify(source, migrations) {
  const { default: pg } = await import("pg");
  const { default: assert } = await import("node:assert/strict");
  const { copyBudgetYear, copyJanuary, createBudgetLine } = await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const otherClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  await otherClient.connect();
  try {
    for (const migration of migrations) await client.query(migration);
    const user = "11111111-1111-4111-8111-111111111111",
      account = "22222222-2222-4222-8222-222222222222",
      category = "33333333-3333-4333-8333-333333333333";
    await client.query(
      "INSERT INTO users(id,email,password_hash) VALUES ($1,'owner@example.test','synthetic-not-a-password-hash')",
      [user],
    );
    await client.query(
      "INSERT INTO accounts(id,owner_user_id,name,account_number_ciphertext,account_number_iv,account_number_auth_tag,account_number_last_four) VALUES ($1,$2,'Synthetic account',decode('00','hex'),decode('00','hex'),decode('00','hex'),'0000')",
      [account, user],
    );
    await client.query(
      "INSERT INTO account_memberships(account_id,user_id,permission) VALUES ($1,$2,'owner')",
      [account, user],
    );
    await client.query(
      "INSERT INTO categories(id,user_id,name) VALUES ($1,$2,'Synthetic category')",
      [category, user],
    );
    const expense = await createBudgetLine(client, user, account, {
      year: 2026,
      lineType: "expense",
      name: "Car",
      categoryId: category,
    });
    const income = await createBudgetLine(client, user, account, {
      year: 2026,
      lineType: "income",
      name: "Income",
      categoryId: category,
    });
    const deleted = await createBudgetLine(client, user, account, {
      year: 2026,
      lineType: "expense",
      name: "Deleted",
      categoryId: category,
    });
    await client.query("UPDATE budget_lines SET deleted_at=now() WHERE id=$1", [
      deleted.id,
    ]);
    await client.query(
      "UPDATE budget_line_months SET amount_cents=CASE WHEN month=1 THEN 45000 ELSE month*100 END,checked_at=CASE WHEN month=2 THEN '2026-01-01'::timestamptz END WHERE budget_line_id=$1",
      [expense.id],
    );
    await client.query(
      "UPDATE budget_line_months SET amount_cents=month*10000 WHERE budget_line_id=$1",
      [income.id],
    );
    const months = async (id) =>
      (
        await client.query(
          "SELECT month,amount_cents,checked_at FROM budget_line_months WHERE budget_line_id=$1 ORDER BY month",
          [id],
        )
      ).rows;
    await copyJanuary(client, user, expense.id);
    assert.equal(
      (await months(expense.id)).filter((m) => m.amount_cents === "45000")
        .length,
      12,
    );
    assert.ok((await months(expense.id))[1].checked_at);
    assert.equal((await months(income.id))[1].amount_cents, "20000");
    const snapshot = async (year) =>
      (
        await client.query(
          `SELECT l.id,l.name,l.line_type,l.category_id,m.month,m.amount_cents,m.checked_at
      FROM budget_lines l JOIN budget_line_months m ON m.budget_line_id=l.id WHERE l.account_id=$1 AND l.budget_year=$2 AND l.deleted_at IS NULL ORDER BY l.name,m.month`,
          [account, year],
        )
      ).rows;
    const before = await snapshot(2026);
    assert.deepEqual(await copyBudgetYear(client, user, account, 2026), {
      sourceYear: 2026,
      targetYear: 2027,
      copiedCount: 2,
    });
    const copied = await snapshot(2027);
    assert.equal(copied.length, 24);
    assert.deepEqual(
      copied.map(({ id, checked_at, ...row }) => row),
      before.map(({ id, checked_at, ...row }) => row),
    );
    assert.ok(
      copied.every(
        (row) =>
          row.checked_at === null && !before.some((old) => old.id === row.id),
      ),
    );
    assert.deepEqual(await snapshot(2026), before);
    await assert.rejects(copyBudgetYear(client, user, account, 2026), {
      code: "BUDGET_EXISTS",
    });
    assert.deepEqual(await snapshot(2027), copied);
    const concurrent = await Promise.allSettled([
      copyBudgetYear(client, user, account, 2027),
      copyBudgetYear(otherClient, user, account, 2027),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrent.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason.code === "BUDGET_EXISTS",
      ).length,
      1,
    );
    assert.equal((await snapshot(2028)).length, 24);
    await client.query(`CREATE FUNCTION reject_budget_month() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.month=6 THEN RAISE EXCEPTION 'synthetic month failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_budget_month BEFORE INSERT ON budget_line_months FOR EACH ROW EXECUTE FUNCTION reject_budget_month()`);
    await assert.rejects(
      copyBudgetYear(client, user, account, 2028),
      /synthetic month failure/,
    );
    assert.equal((await snapshot(2029)).length, 0);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM budget_lines WHERE budget_year=2029",
        )
      ).rows[0].n,
      0,
    );
    await client.query(
      "UPDATE budget_line_months SET amount_cents=123 WHERE budget_line_id=$1 AND month=1",
      [expense.id],
    );
    const beforeFailedJanuary = await months(expense.id);
    await assert.rejects(
      copyJanuary(client, user, expense.id),
      /synthetic month failure/,
    );
    assert.deepEqual(await months(expense.id), beforeFailedJanuary);
    await client.query(
      "DROP TRIGGER reject_budget_month ON budget_line_months",
    );
    await client.query(
      "UPDATE budget_line_months SET amount_cents=0 WHERE budget_line_id=$1 AND month=1",
      [expense.id],
    );
    await copyJanuary(client, user, expense.id);
    assert.equal(
      (await months(expense.id)).filter((m) => m.amount_cents === "0").length,
      12,
    );
    await assert.rejects(copyJanuary(client, user, deleted.id), {
      code: "NOT_FOUND",
    });
    await assert.rejects(copyBudgetYear(client, user, account, 2200), {
      code: "INVALID_YEAR",
    });
    await assert.rejects(copyBudgetYear(client, user, account, 2040), {
      code: "EMPTY_BUDGET",
    });
    await client.query("UPDATE account_memberships SET permission='viewer'");
    await assert.rejects(copyJanuary(client, user, expense.id), {
      code: "FORBIDDEN",
    });
    await assert.rejects(copyBudgetYear(client, user, account, 2028), {
      code: "FORBIDDEN",
    });
    await client.query("UPDATE account_memberships SET permission='editor'");
    await client.query("UPDATE accounts SET is_active=false");
    await assert.rejects(copyBudgetYear(client, user, account, 2028), {
      code: "FORBIDDEN",
    });
    await client.query("UPDATE accounts SET is_active=true");
    // A normal line insertion and a year copy use the same account lock.
    const race = await Promise.allSettled([
      createBudgetLine(client, user, account, {
        year: 2029,
        lineType: "expense",
        name: "Manual",
        categoryId: category,
      }),
      copyBudgetYear(otherClient, user, account, 2028),
    ]);
    assert.equal(race[0].status, "fulfilled");
    if (race[1].status === "rejected") {
      assert.equal(race[1].reason.code, "BUDGET_EXISTS");
      assert.equal((await snapshot(2029)).length, 12);
    } else assert.equal((await snapshot(2029)).length, 36);
    await client.query("DELETE FROM account_memberships");
    await assert.rejects(copyBudgetYear(client, user, account, 2030), {
      code: "NOT_FOUND",
    });
    console.log(
      "PASS: January amounts/zero/checkmarks; exact year clone and new IDs; reset marks; empty/conflict/permission checks; atomic rollback; concurrent copy and normal-add safety.",
    );
  } finally {
    await client.end();
    await otherClient.end();
  }
}
const started = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-d",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17-alpine",
  ],
  { encoding: "utf8" },
);
if (started.status !== 0) {
  process.stderr.write(started.stderr ?? "Docker startup failed");
  process.exit(1);
}
const id = started.stdout.trim();
if (!/^[a-f0-9]{64}$/.test(id))
  throw new Error("Unexpected disposable container ID");
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      spawnSync("docker", ["exec", id, "pg_isready", "-U", "postgres"])
        .status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Disposable database startup timed out");
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--network",
      `container:${id}`,
      "-e",
      "DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres",
      "--entrypoint",
      "node",
      "finance-mgr-api",
      "--input-type=module",
    ],
    {
      input: `await (${verify.toString()})(${JSON.stringify(source)},${JSON.stringify(migrations)});`,
      encoding: "utf8",
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
} finally {
  if (spawnSync("docker", ["stop", id], { encoding: "utf8" }).status !== 0) {
    process.stderr.write("Could not stop disposable database.\n");
    process.exitCode = 1;
  }
}
