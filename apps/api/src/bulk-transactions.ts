import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

export type BulkTransaction = {
  occurredOn: string; amountCents: number; description: string; categoryId: string;
  identifier?: string; notes?: string;
};
export class BulkError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function commitBulk(
  client: Pick<PoolClient, 'query'>, userId: string, accountId: string,
  requestId: string, transactions: BulkTransaction[],
) {
  const key = `bulk-transactions:${requestId}`;
  const fingerprint = createHash('sha256').update(JSON.stringify({ accountId, transactions })).digest('hex');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${userId}:${key}`]);
    const access = await client.query(`SELECT a.is_active,m.permission FROM accounts a
      JOIN account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND m.user_id=$2 FOR SHARE OF a,m`, [accountId, userId]);
    if (!access.rowCount) throw new BulkError(404, 'NOT_FOUND', 'Account not found');
    if (!access.rows[0].is_active || !['owner', 'editor'].includes(access.rows[0].permission))
      throw new BulkError(403, 'FORBIDDEN', 'You cannot update this account');
    const receipt = await client.query('SELECT response_body FROM idempotency_keys WHERE user_id=$1 AND key=$2', [userId, key]);
    if (receipt.rowCount) {
      if (receipt.rows[0].response_body.fingerprint !== fingerprint)
        throw new BulkError(409, 'IDEMPOTENCY_CONFLICT', 'This request ID was already used for a different batch');
      await client.query('COMMIT');
      return receipt.rows[0].response_body.result as { createdCount: number };
    }
    const categoryIds = [...new Set(transactions.map(row => row.categoryId))];
    const categories = await client.query(`SELECT id FROM categories WHERE user_id=$1 AND id=ANY($2::uuid[])
      AND is_archived=false FOR SHARE`, [userId, categoryIds]);
    const valid = new Set(categories.rows.map(row => row.id));
    const invalid = transactions.findIndex(row => !valid.has(row.categoryId));
    if (invalid !== -1) throw new BulkError(422, 'INVALID_CATEGORY', `Row ${invalid + 1}: choose an active category you own`);
    for (const row of transactions) {
      await client.query(`INSERT INTO transactions (user_id,account_id,occurred_on,amount_cents,description,category_id,identifier,notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [userId, accountId, row.occurredOn, row.amountCents, row.description, row.categoryId, row.identifier ?? null, row.notes ?? null]);
    }
    const result = { createdCount: transactions.length };
    await client.query('INSERT INTO idempotency_keys (user_id,key,response_status,response_body) VALUES ($1,$2,201,$3)', [userId, key, JSON.stringify({ fingerprint, result })]);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
