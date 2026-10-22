import type { PoolClient } from "pg";
type Client = Pick<PoolClient, "query">;
export class BudgetError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function budgetTransaction<T>(
  client: Client,
  userId: string,
  accountId: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    // All budget writers, including line creation, serialize on the account.
    const access = await client.query(
      `SELECT a.is_active,m.permission FROM accounts a
      JOIN account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND m.user_id=$2 FOR UPDATE OF a,m`,
      [accountId, userId],
    );
    if (!access.rowCount)
      throw new BudgetError(404, "NOT_FOUND", "Account not found");
    if (
      !access.rows[0].is_active ||
      !["owner", "editor"].includes(access.rows[0].permission)
    )
      throw new BudgetError(403, "FORBIDDEN", "You cannot update this account");
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function mutateBudgetLine<T>(
  client: Client,
  userId: string,
  lineId: string,
  work: () => Promise<T>,
) {
  const source = await client.query(
    "SELECT account_id FROM budget_lines WHERE id=$1 AND deleted_at IS NULL",
    [lineId],
  );
  if (!source.rowCount)
    throw new BudgetError(404, "NOT_FOUND", "Budget line not found");
  return budgetTransaction(
    client,
    userId,
    source.rows[0].account_id,
    async () => {
      const current = await client.query(
        "SELECT id FROM budget_lines WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [lineId, source.rows[0].account_id],
      );
      if (!current.rowCount)
        throw new BudgetError(404, "NOT_FOUND", "Budget line not found");
      return work();
    },
  );
}

export async function createBudgetLine(
  client: Client,
  userId: string,
  accountId: string,
  input: { year: number; lineType: string; name: string; categoryId: string },
) {
  return budgetTransaction(client, userId, accountId, async () => {
    const category = await client.query(
      "SELECT 1 FROM categories WHERE id=$1 AND user_id=$2 FOR SHARE",
      [input.categoryId, userId],
    );
    if (!category.rowCount)
      throw new BudgetError(422, "INVALID_CATEGORY", "Choose a valid category");
    const result = await client.query(
      "INSERT INTO budget_lines (user_id,account_id,budget_year,line_type,name,category_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [
        userId,
        accountId,
        input.year,
        input.lineType,
        input.name,
        input.categoryId,
      ],
    );
    await client.query(
      "INSERT INTO budget_line_months (budget_line_id,month,amount_cents) SELECT $1,generate_series(1,12),0",
      [result.rows[0].id],
    );
    return { id: result.rows[0].id };
  });
}

export async function copyJanuary(
  client: Client,
  userId: string,
  lineId: string,
) {
  return mutateBudgetLine(client, userId, lineId, async () => {
    const january = await client.query(
      "SELECT amount_cents FROM budget_line_months WHERE budget_line_id=$1 AND month=1",
      [lineId],
    );
    if (!january.rowCount)
      throw new BudgetError(
        409,
        "MISSING_JANUARY",
        "Save a January amount before copying",
      );
    await client.query(
      `INSERT INTO budget_line_months (budget_line_id,month,amount_cents)
      SELECT $1,generate_series(2,12),$2::bigint
      ON CONFLICT (budget_line_id,month) DO UPDATE SET amount_cents=EXCLUDED.amount_cents`,
      [lineId, january.rows[0].amount_cents],
    );
  });
}

export async function copyBudgetYear(
  client: Client,
  userId: string,
  accountId: string,
  sourceYear: number,
) {
  if (!Number.isInteger(sourceYear) || sourceYear < 1900 || sourceYear > 2199)
    throw new BudgetError(
      422,
      "INVALID_YEAR",
      "Choose a source year from 1900 through 2199",
    );
  return budgetTransaction(client, userId, accountId, async () => {
    const targetYear = sourceYear + 1;
    const existing = await client.query(
      "SELECT 1 FROM budget_lines WHERE account_id=$1 AND budget_year=$2 AND deleted_at IS NULL LIMIT 1",
      [accountId, targetYear],
    );
    if (existing.rowCount)
      throw new BudgetError(
        409,
        "BUDGET_EXISTS",
        `${targetYear} already has budget lines. Nothing was copied or overwritten.`,
      );
    const source = await client.query(
      "SELECT 1 FROM budget_lines WHERE account_id=$1 AND budget_year=$2 AND deleted_at IS NULL LIMIT 1",
      [accountId, sourceYear],
    );
    if (!source.rowCount)
      throw new BudgetError(
        422,
        "EMPTY_BUDGET",
        "There are no budget lines to copy for this year",
      );
    const result = await client.query(
      `WITH source AS MATERIALIZED (
      SELECT l.*,gen_random_uuid() AS new_id FROM budget_lines l
      WHERE l.account_id=$1 AND l.budget_year=$2 AND l.deleted_at IS NULL
    ), inserted AS (
      INSERT INTO budget_lines (id,user_id,account_id,budget_year,line_type,name,category_id)
      SELECT new_id,user_id,account_id,$3,line_type,name,category_id FROM source RETURNING id
    ), months AS (
      INSERT INTO budget_line_months (budget_line_id,month,amount_cents)
      SELECT i.id,n.month,COALESCE(m.amount_cents,0) FROM source s JOIN inserted i ON i.id=s.new_id
      CROSS JOIN generate_series(1,12) AS n(month)
      LEFT JOIN budget_line_months m ON m.budget_line_id=s.id AND m.month=n.month
      RETURNING budget_line_id
    ) SELECT count(*)::integer AS copied_count FROM inserted`,
      [accountId, sourceYear, targetYear],
    );
    return { sourceYear, targetYear, copiedCount: result.rows[0].copied_count };
  });
}
