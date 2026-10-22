import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { authPool, pool } from './db.js';
import { encryptAccountNumber, hashToken, newToken } from './security.js';
import { BulkError, commitBulk } from './bulk-transactions.js';
import { saveForecastMethodSql } from './forecast-method.js';
import type { PoolClient } from 'pg';
import { BudgetError, copyBudgetYear, copyJanuary, createBudgetLine, mutateBudgetLine } from './budget-copy.js';

type AuthUser = { id: string; email: string; role: 'admin' | 'user' };
declare module 'fastify' { interface FastifyRequest { user?: AuthUser } }

const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.body.password', 'req.body.accountNumber'] } });
await app.register(cookie, { secret: config.SESSION_SECRET });
await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });

const body = <T extends z.ZodTypeAny>(schema: T, request: FastifyRequest) => schema.parse(request.body);
async function budgetWrite(reply: FastifyReply, work: (client: PoolClient) => Promise<unknown>, status = 204) {
  const client = await pool.connect();
  try {
    const result = await work(client);
    return status === 204 ? reply.code(204).send() : reply.code(status).send(result);
  } catch (error) {
    if (error instanceof BudgetError) return reply.code(error.status).send({ code: error.code, title: error.message });
    return reply.code(500).send({ code: 'BUDGET_SAVE_FAILED', title: 'Could not save the budget. Reload the saved budget before retrying.' });
  } finally { client.release(); }
}
const emailSchema = z.string().email().max(320).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const transactionInput = z.object({
  occurredOn: z.string().date(), amountCents: z.number().int().refine((value) => value !== 0),
  description: z.string().min(1).max(500), categoryId: z.string().uuid(), identifier: z.string().max(255).optional(), notes: z.string().max(5000).optional(), version: z.number().int().optional()
});

async function createSystemCategory(userId: string) {
  await pool.query("INSERT INTO categories (user_id, name, is_system, system_key) VALUES ($1, 'Xfer Accounts', true, 'XFER_ACCOUNTS') ON CONFLICT (user_id, system_key) DO NOTHING", [userId]);
}

async function attachUser(request: FastifyRequest) {
  const token = request.cookies.finance_session;
  if (!token) return;
  const result = await authPool.query<AuthUser>(`SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [hashToken(token)]);
  request.user = result.rows[0];
}
app.addHook('onRequest', attachUser);

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) reply.code(401).send({ code: 'UNAUTHORIZED', title: 'Sign in is required' });
}
async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) { reply.code(401).send({ code: 'UNAUTHORIZED', title: 'Sign in is required' }); return; }
  if (request.user.role !== 'admin') reply.code(403).send({ code: 'FORBIDDEN', title: 'Administrator access is required' });
}
async function permission(accountId: string, userId: string) {
  const result = await pool.query<{ permission: 'owner' | 'editor' | 'viewer'; is_active: boolean }>(`SELECT m.permission, a.is_active FROM account_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.account_id=$1 AND m.user_id=$2`, [accountId, userId]);
  return result.rows[0];
}
async function requireAccount(request: FastifyRequest, reply: FastifyReply, accountId: string, write = false) {
  if (!request.user) { requireUser(request, reply); return; }
  const access = await permission(accountId, request.user.id);
  if (!access) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Account not found' });
  if (write && (!access.is_active || access.permission === 'viewer')) return reply.code(403).send({ code: 'FORBIDDEN', title: 'You cannot update this account' });
  return access;
}
function setSession(reply: FastifyReply, token: string) {
  reply.setCookie('finance_session', token, { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 14 });
}
async function signIn(user: AuthUser, reply: FastifyReply) {
  const token = newToken();
  await authPool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval \'14 days\')', [user.id, hashToken(token)]);
  setSession(reply, token);
}

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async (_request, reply) => { await pool.query('SELECT 1'); return reply.send({ status: 'ok' }); });
app.get('/api/v1/auth/setup-status', async () => ({ setupRequired: (await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount === 0 }));

app.post('/api/v1/auth/setup', async (request, reply) => {
  const input = body(z.object({ email: emailSchema, password: passwordSchema }), request);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = await client.query('SELECT count(*)::int AS count FROM users');
    if (count.rows[0].count > 0) return reply.code(409).send({ code: 'SETUP_COMPLETE', title: 'Initial setup is already complete' });
    const result = await client.query<AuthUser>('INSERT INTO users (email,password_hash,role) VALUES ($1,$2,\'admin\') RETURNING id,email,role', [input.email, await argon2.hash(input.password, { type: argon2.argon2id })]);
    await client.query("INSERT INTO categories (user_id,name,is_system,system_key) VALUES ($1,'Xfer Accounts',true,'XFER_ACCOUNTS')", [result.rows[0].id]);
    await client.query('COMMIT');
    await signIn(result.rows[0], reply);
    return reply.code(201).send({ user: result.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.post('/api/v1/auth/login', async (request, reply) => {
  const input = body(z.object({ email: emailSchema, password: z.string() }), request);
  const result = await pool.query<AuthUser & { password_hash: string }>('SELECT id,email,role,password_hash FROM users WHERE email=$1', [input.email]);
  const user = result.rows[0];
  if (!user || !(await argon2.verify(user.password_hash, input.password))) return reply.code(401).send({ code: 'INVALID_CREDENTIALS', title: 'Invalid email or password' });
  await signIn(user, reply);
  return { user: { id: user.id, email: user.email, role: user.role } };
});
app.post('/api/v1/auth/logout', { preHandler: requireUser }, async (request, reply) => { const token = request.cookies.finance_session; if (token) await authPool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [hashToken(token)]); reply.clearCookie('finance_session', { path: '/' }); return reply.code(204).send(); });
app.get('/api/v1/auth/session', { preHandler: requireUser }, async (request) => ({ user: request.user }));

app.post('/api/v1/users', { preHandler: requireAdmin }, async (request, reply) => {
  const input = body(z.object({ email: emailSchema, password: passwordSchema }), request);
  const result = await pool.query<AuthUser>('INSERT INTO users (email,password_hash) VALUES ($1,$2) RETURNING id,email,role', [input.email, await argon2.hash(input.password, { type: argon2.argon2id })]);
  await createSystemCategory(result.rows[0].id);
  return reply.code(201).send({ user: result.rows[0] });
});
app.get('/api/v1/users', { preHandler: requireAdmin }, async () => ({ users: (await pool.query('SELECT id,email,role,created_at FROM users ORDER BY email')).rows }));

app.get('/api/v1/accounts', { preHandler: requireUser }, async (request) => ({ accounts: (await pool.query(`SELECT a.id,a.name,a.account_number_last_four,a.starting_balance_cents,a.is_active,m.permission, COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='posted' AND t.deleted_at IS NULL),0)::bigint + a.starting_balance_cents AS current_balance_cents, COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='posted' AND t.deleted_at IS NULL AND t.reconciled_at IS NOT NULL),0)::bigint + a.starting_balance_cents AS reconciled_balance_cents, COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='posted' AND t.deleted_at IS NULL AND t.reconciled_at IS NULL AND t.amount_cents < 0),0)::bigint AS unreconciled_debits_cents, COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='posted' AND t.deleted_at IS NULL AND t.reconciled_at IS NULL AND t.amount_cents > 0),0)::bigint AS unreconciled_credits_cents FROM accounts a JOIN account_memberships m ON m.account_id=a.id LEFT JOIN transactions t ON t.account_id=a.id WHERE m.user_id=$1 GROUP BY a.id,m.permission ORDER BY a.is_active DESC,a.name`, [request.user!.id])).rows }));
app.post('/api/v1/accounts', { preHandler: requireUser }, async (request, reply) => {
  const input = body(z.object({ name: z.string().min(1).max(120), accountNumber: z.string().regex(/^\d{4,34}$/), startingBalanceCents: z.number().int().default(0) }), request);
  const encrypted = encryptAccountNumber(input.accountNumber);
  const client = await pool.connect();
  try { await client.query('BEGIN'); const account = await client.query(`INSERT INTO accounts (owner_user_id,name,account_number_ciphertext,account_number_iv,account_number_auth_tag,account_number_last_four,starting_balance_cents) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,account_number_last_four,starting_balance_cents,is_active`, [request.user!.id,input.name,encrypted.ciphertext,encrypted.iv,encrypted.authTag,encrypted.lastFour,input.startingBalanceCents]); await client.query("INSERT INTO account_memberships (account_id,user_id,permission) VALUES ($1,$2,'owner')", [account.rows[0].id,request.user!.id]); await client.query('COMMIT'); return reply.code(201).send({ account: account.rows[0] }); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.patch('/api/v1/accounts/:accountId', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
  const input = body(z.object({ name: z.string().trim().min(1).max(120).optional(), isActive: z.boolean().optional() }).strict().refine(value => value.name !== undefined || value.isActive !== undefined), request);
  const result = await pool.query('UPDATE accounts SET name=COALESCE($1,name),is_active=COALESCE($2,is_active),updated_at=now() WHERE id=$3 AND owner_user_id=$4 RETURNING id,name,is_active,account_number_last_four', [input.name ?? null, input.isActive ?? null, accountId, request.user!.id]);
  if (!result.rowCount) return reply.code(403).send({ code: 'FORBIDDEN', title: 'Only the account owner can manage this account' });
  return { account: result.rows[0] };
});

app.get('/api/v1/categories', { preHandler: requireUser }, async (request) => ({ categories: (await pool.query('SELECT id,name,is_archived,is_system FROM categories WHERE user_id=$1 ORDER BY is_archived,name', [request.user!.id])).rows }));
app.post('/api/v1/categories', { preHandler: requireUser }, async (request, reply) => { const input = body(z.object({ name: z.string().trim().min(1).max(100) }), request); const result = await pool.query('INSERT INTO categories (user_id,name) VALUES ($1,$2) RETURNING id,name,is_archived,is_system', [request.user!.id,input.name]); return reply.code(201).send({ category: result.rows[0] }); });
app.patch('/api/v1/categories/:categoryId', { preHandler: requireUser }, async (request, reply) => {
  const categoryId = z.string().uuid().parse((request.params as { categoryId: string }).categoryId);
  const input = body(z.object({ name: z.string().trim().min(1).max(100).optional(), isArchived: z.boolean().optional() }).refine((value) => value.name !== undefined || value.isArchived !== undefined), request);
  const existing = await pool.query<{ is_system: boolean }>('SELECT is_system FROM categories WHERE id=$1 AND user_id=$2', [categoryId, request.user!.id]);
  if (!existing.rowCount) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Category not found' });
  if (existing.rows[0].is_system) return reply.code(403).send({ code: 'PROTECTED_CATEGORY', title: 'The transfer category cannot be changed' });
  const result = await pool.query('UPDATE categories SET name=COALESCE($1,name),is_archived=COALESCE($2,is_archived),updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id,name,is_archived,is_system', [input.name ?? null,input.isArchived ?? null,categoryId,request.user!.id]);
  return { category: result.rows[0] };
});

app.post('/api/v1/accounts/:accountId/transactions', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); if (!await requireAccount(request, reply, accountId, true)) return;
  const input = body(transactionInput, request); const category = await pool.query('SELECT 1 FROM categories WHERE id=$1 AND user_id=$2 AND is_archived=false', [input.categoryId,request.user!.id]); if (!category.rowCount) return reply.code(422).send({ code: 'INVALID_CATEGORY', title: 'Choose an active category' });
  const result = await pool.query(`INSERT INTO transactions (user_id,account_id,occurred_on,amount_cents,description,category_id,identifier,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [request.user!.id,accountId,input.occurredOn,input.amountCents,input.description,input.categoryId,input.identifier ?? null,input.notes ?? null]); return reply.code(201).send({ transaction: result.rows[0] });
});

app.post('/api/v1/accounts/:accountId/transactions/bulk', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
  const parsed = z.object({
    requestId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    transactions: z.array(transactionInput.omit({ version: true }).extend({
      amountCents: z.number().int().safe().refine(value => value !== 0),
      description: z.string().trim().min(1).max(500),
    }).strict()).min(1).max(500),
  }).strict().safeParse(request.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const row = typeof issue.path[1] === 'number' ? `Row ${issue.path[1] + 1}: ` : '';
    return reply.code(422).send({ code: 'VALIDATION_ERROR', title: `${row}Check batch fields (${issue.path.join('.') || 'body'})` });
  }
  const client = await pool.connect();
  try {
    const result = await commitBulk(client, request.user!.id, accountId, parsed.data.requestId, parsed.data.transactions);
    return reply.code(201).send(result);
  } catch (error) {
    if (error instanceof BulkError) return reply.code(error.status).send({ code: error.code, title: error.message });
    // PostgreSQL errors may include a failing financial row; do not log the raw exception.
    return reply.code(500).send({ code: 'BULK_SAVE_FAILED', title: 'Could not save the batch. Retry the unchanged batch; no partial batch is saved.' });
  } finally { client.release(); }
});

app.get('/api/v1/accounts/:accountId/ledger', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); if (!await requireAccount(request, reply, accountId)) return;
  const query = z.object({
    page: z.coerce.number().int().min(1).max(2147483647).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    occurredOn: z.string().date().optional(), categoryId: z.string().uuid().optional(),
    description: z.string().max(100).optional(), reconciled: z.enum(['true','false']).optional()
  }).parse(request.query);
  const pageSize = query.pageSize ?? query.limit ?? 75;
  const result = await pool.query(`
    WITH ledger AS (
      SELECT t.*, c.name AS category_name,
        a.starting_balance_cents
        + COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='posted') OVER (),0)
        - COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='posted')
          OVER (ORDER BY t.occurred_on DESC,t.created_at DESC,t.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS running_balance_cents
      FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN categories c ON c.id=t.category_id
      WHERE t.account_id=$1 AND t.deleted_at IS NULL
    ), filtered AS (
      SELECT * FROM ledger WHERE ($2::date IS NULL OR occurred_on=$2)
        AND ($3::uuid IS NULL OR category_id=$3)
        AND ($4::text IS NULL OR description ILIKE '%' || $4 || '%')
        AND ($5::boolean IS NULL OR (reconciled_at IS NOT NULL)=$5)
    ), totals AS (
      SELECT count(*) AS total_items, GREATEST(1,ceil(count(*)::numeric / $6::integer))::integer AS total_pages FROM filtered
    ), metadata AS (
      SELECT *, LEAST($7::integer,total_pages) AS page FROM totals
    )
    SELECT metadata.*, COALESCE((
      SELECT json_agg(to_jsonb(p) || jsonb_build_object(
        'amount_cents',p.amount_cents::text,'running_balance_cents',p.running_balance_cents::text
      ) ORDER BY p.occurred_on DESC,p.created_at DESC,p.id DESC)
      FROM (SELECT * FROM filtered ORDER BY occurred_on DESC,created_at DESC,id DESC
        LIMIT $6 OFFSET (metadata.page::bigint - 1) * $6) p
    ),'[]'::json) AS transactions FROM metadata
  `, [accountId, query.occurredOn ?? null, query.categoryId ?? null, query.description ?? null,
    query.reconciled ? query.reconciled === 'true' : null, pageSize, query.page]);
  const row = result.rows[0];
  const page = Number(row.page), totalPages = Number(row.total_pages);
  return { transactions: row.transactions, pagination: {
    page, pageSize, totalItems: Number(row.total_items), totalPages,
    hasNextPage: page < totalPages, hasPreviousPage: page > 1
  } };
});

app.get('/api/v1/accounts/:accountId/reconciliation', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); if (!await requireAccount(request, reply, accountId)) return;
  const result = await pool.query(`SELECT t.*, c.name AS category_name FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.account_id=$1 AND t.status='posted' AND t.deleted_at IS NULL AND t.reconciled_at IS NULL ORDER BY t.occurred_on DESC,t.created_at DESC,t.id DESC`, [accountId]);
  return { transactions: result.rows };
});

app.put('/api/v1/accounts/:accountId/forecast-methods/:categoryId', { preHandler: requireUser }, async (request, reply) => {
  const { accountId, categoryId } = z.object({ accountId: z.string().uuid(), categoryId: z.string().uuid() }).parse(request.params);
  const { method } = body(z.object({ method: z.enum(['fixed', 'variable']) }).strict(), request);
  const access = await requireAccount(request, reply, accountId, true);
  if (!access || reply.sent) return;
  const result = await pool.query(saveForecastMethodSql, [accountId, categoryId, request.user!.id, method]);
  if (!result.rowCount) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Category is unavailable for forecasting in this account' });
  return result.rows[0];
});

app.get('/api/v1/accounts/:accountId/forecast', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
  const { month } = z.object({ month: z.string().regex(/^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/) }).parse(request.query);
  const access = await requireAccount(request, reply, accountId);
  if (!access || reply.sent) return;
  const today = new Date().toISOString().slice(0, 10);
  const [year, number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const cutoff = end < today ? end : today;
  // One snapshot for plan, daily actuals and cash balance. No transaction details exposed.
  const result = await pool.query(`WITH forecast_plans AS (
    SELECT l.category_id,c.name AS category_name,l.line_type,sum(m.amount_cents)::text AS amount_cents
    FROM budget_lines l JOIN budget_line_months m ON m.budget_line_id=l.id
    JOIN categories c ON c.id=l.category_id
    WHERE l.account_id=$1 AND l.budget_year=extract(year FROM $2::date)
      AND m.month=extract(month FROM $2::date) AND l.deleted_at IS NULL AND NOT c.is_system
    GROUP BY l.category_id,c.name,l.line_type
  ), forecast_daily AS (
    SELECT t.category_id,c.name AS category_name,to_char(t.occurred_on,'YYYY-MM-DD') AS date,
      CASE WHEN t.amount_cents < 0 THEN 'expense' ELSE 'income' END AS line_type,
      sum(abs(t.amount_cents))::text AS amount_cents
    FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.account_id=$1 AND t.status='posted' AND t.deleted_at IS NULL
      AND t.transfer_id IS NULL AND NOT c.is_system
      AND t.occurred_on >= $2::date AND t.occurred_on < $2::date + interval '1 month'
      AND t.occurred_on <= $3::date
    GROUP BY t.category_id,c.name,t.occurred_on,line_type
  ) SELECT
    COALESCE((SELECT json_agg(p ORDER BY p.line_type,p.category_name) FROM forecast_plans p),'[]') AS plans,
    COALESCE((SELECT json_agg(d ORDER BY d.date,d.category_name) FROM forecast_daily d),'[]') AS daily,
    COALESCE((SELECT json_agg(json_build_object('category_id',f.category_id,'method',f.method) ORDER BY f.category_id)
      FROM account_category_forecast_methods f WHERE f.account_id=$1),'[]') AS methods,
    (a.starting_balance_cents + COALESCE((SELECT sum(t.amount_cents) FROM transactions t
      WHERE t.account_id=a.id AND t.status='posted' AND t.deleted_at IS NULL AND t.occurred_on <= $3::date),0))::text AS balance_cents
    FROM accounts a WHERE a.id=$1`, [accountId, `${month}-01`, cutoff]);
  return { month, today, cutoff, ...result.rows[0] };
});

app.get('/api/v1/accounts/:accountId/budget', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); if (!await requireAccount(request, reply, accountId)) return;
  const query = z.object({ year: z.coerce.number().int().min(1900).max(2200) }).parse(request.query);
  const lines = await pool.query(`SELECT l.*, c.name AS category_name, COALESCE(json_agg(json_build_object('month',m.month,'amount_cents',m.amount_cents,'checked_at',m.checked_at) ORDER BY m.month) FILTER (WHERE m.id IS NOT NULL),'[]') AS months FROM budget_lines l JOIN categories c ON c.id=l.category_id LEFT JOIN budget_line_months m ON m.budget_line_id=l.id WHERE l.account_id=$1 AND l.budget_year=$2 AND l.deleted_at IS NULL GROUP BY l.id,c.name ORDER BY l.line_type,l.name`, [accountId, query.year]);
  const actuals = await pool.query(`SELECT t.category_id, CASE WHEN t.amount_cents < 0 THEN 'expense' ELSE 'income' END AS line_type, extract(month from t.occurred_on)::int AS month, COALESCE(sum(abs(t.amount_cents)),0)::bigint AS amount_cents FROM transactions t WHERE t.account_id=$1 AND t.status='posted' AND t.deleted_at IS NULL AND extract(year from t.occurred_on)=$2 GROUP BY t.category_id,line_type,month ORDER BY line_type,t.category_id,month`, [accountId, query.year]);
  return { year: query.year, lines: lines.rows, actuals: actuals.rows };
});

app.post('/api/v1/accounts/:accountId/budget/lines', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
  const input = body(z.object({ year: z.number().int().min(1900).max(2200), lineType: z.enum(['income','expense']), name: z.string().trim().min(1).max(200), categoryId: z.string().uuid() }), request);
  return budgetWrite(reply,client => createBudgetLine(client,request.user!.id,accountId,input),201);
});

app.post('/api/v1/accounts/:accountId/budget/copy-next-year', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
  const input = body(z.object({ sourceYear: z.number().int().min(1900).max(2199), confirmed: z.literal(true) }).strict(), request);
  return budgetWrite(reply,client => copyBudgetYear(client,request.user!.id,accountId,input.sourceYear),201);
});

app.post('/api/v1/budget-lines/:lineId/copy-january', { preHandler: requireUser }, async (request, reply) => {
  const lineId = z.string().uuid().parse((request.params as { lineId: string }).lineId);
  return budgetWrite(reply,client => copyJanuary(client,request.user!.id,lineId));
});

app.patch('/api/v1/budget-lines/:lineId/months', { preHandler: requireUser }, async (request, reply) => {
  const lineId = z.string().uuid().parse((request.params as { lineId: string }).lineId); const input = body(z.object({ month: z.number().int().min(1).max(12), amountCents: z.number().int().nonnegative(), checked: z.boolean() }), request);
  return budgetWrite(reply,client => mutateBudgetLine(client,request.user!.id,lineId,async () => {
    await client.query('UPDATE budget_line_months SET amount_cents=$1,checked_at=CASE WHEN $2 THEN COALESCE(checked_at,now()) ELSE NULL END WHERE budget_line_id=$3 AND month=$4', [input.amountCents,input.checked,lineId,input.month]);
  }));
});

app.post('/api/v1/budget-lines/:lineId/replicate', { preHandler: requireUser }, async (request, reply) => {
  const lineId = z.string().uuid().parse((request.params as { lineId: string }).lineId); const input = body(z.object({ amountCents: z.number().int().nonnegative(), fromMonth: z.number().int().min(1).max(12) }), request);
  return budgetWrite(reply,client => mutateBudgetLine(client,request.user!.id,lineId,async () => {
    await client.query('UPDATE budget_line_months SET amount_cents=$1 WHERE budget_line_id=$2 AND month >= $3', [input.amountCents,lineId,input.fromMonth]);
  }));
});

app.delete('/api/v1/budget-lines/:lineId', { preHandler: requireUser }, async (request, reply) => {
  const lineId = z.string().uuid().parse((request.params as { lineId: string }).lineId);
  return budgetWrite(reply,client => mutateBudgetLine(client,request.user!.id,lineId,async () => {
    await client.query('UPDATE budget_lines SET deleted_at=now(),updated_at=now() WHERE id=$1', [lineId]);
  }));
});

app.post('/api/v1/accounts/:accountId/reconciliation', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); if (!await requireAccount(request, reply, accountId, true)) return;
  const input = body(z.object({ transactionIds: z.array(z.string().uuid()).min(1), confirmed: z.literal(true) }), request);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE transactions SET reconciled_at=now(),reconciled_by_user_id=$1,version=version+1 WHERE account_id=$2 AND id=ANY($3::uuid[]) AND status='posted' AND deleted_at IS NULL AND reconciled_at IS NULL RETURNING id`, [request.user!.id, accountId, input.transactionIds]);
    if (result.rowCount !== input.transactionIds.length) { await client.query('ROLLBACK'); return reply.code(409).send({ code: 'RECONCILIATION_CONFLICT', title: 'One or more transactions changed; refresh and try again' }); }
    await client.query('COMMIT'); return { reconciledCount: result.rowCount };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.patch('/api/v1/transactions/:transactionId', { preHandler: requireUser }, async (request, reply) => {
  const transactionId = z.string().uuid().parse((request.params as { transactionId: string }).transactionId);
  const input = body(transactionInput.extend({ version: z.number().int() }), request);
  const existing = await pool.query<{ account_id: string; transfer_id: string | null; reconciled_at: string | null; status: string; amount_cents: number }>('SELECT account_id,transfer_id,reconciled_at,status,amount_cents FROM transactions WHERE id=$1 AND deleted_at IS NULL', [transactionId]);
  if (!existing.rowCount) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Transaction not found' });
  if (existing.rows[0].transfer_id || existing.rows[0].reconciled_at || existing.rows[0].status !== 'posted') return reply.code(409).send({ code: 'LOCKED_TRANSACTION', title: 'This transaction cannot be changed' });
  if (!await requireAccount(request, reply, existing.rows[0].account_id, true)) return;
  if ((existing.rows[0].amount_cents < 0) !== (input.amountCents < 0)) return reply.code(422).send({ code: 'DIRECTION_CHANGE_NOT_ALLOWED', title: 'Debit or credit direction cannot be changed' });
  const category = await pool.query('SELECT 1 FROM categories WHERE id=$1 AND user_id=$2 AND is_archived=false', [input.categoryId, request.user!.id]);
  if (!category.rowCount) return reply.code(422).send({ code: 'INVALID_CATEGORY', title: 'Choose an active category' });
  const result = await pool.query(`UPDATE transactions SET occurred_on=$1,amount_cents=$2,description=$3,category_id=$4,identifier=$5,notes=$6,version=version+1,updated_at=now() WHERE id=$7 AND version=$8 AND reconciled_at IS NULL AND transfer_id IS NULL RETURNING *`, [input.occurredOn,input.amountCents,input.description,input.categoryId,input.identifier ?? null,input.notes ?? null,transactionId,input.version]);
  if (!result.rowCount) return reply.code(409).send({ code: 'VERSION_CONFLICT', title: 'This transaction has changed; refresh and try again' });
  return { transaction: result.rows[0] };
});

app.delete('/api/v1/transactions/:transactionId', { preHandler: requireUser }, async (request, reply) => {
  const transactionId = z.string().uuid().parse((request.params as { transactionId: string }).transactionId);
  const existing = await pool.query<{ account_id: string; transfer_id: string | null; reconciled_at: string | null }>('SELECT account_id,transfer_id,reconciled_at FROM transactions WHERE id=$1 AND deleted_at IS NULL', [transactionId]);
  if (!existing.rowCount) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Transaction not found' });
  if (existing.rows[0].transfer_id || existing.rows[0].reconciled_at) return reply.code(409).send({ code: 'LOCKED_TRANSACTION', title: 'This transaction cannot be deleted' });
  if (!await requireAccount(request, reply, existing.rows[0].account_id, true)) return;
  await pool.query('UPDATE transactions SET deleted_at=now(),deleted_by_user_id=$1,version=version+1 WHERE id=$2', [request.user!.id,transactionId]);
  return reply.code(204).send();
});

app.post('/api/v1/transactions/:transactionId/restore', { preHandler: requireUser }, async (request, reply) => {
  const transactionId = z.string().uuid().parse((request.params as { transactionId: string }).transactionId);
  const existing = await pool.query<{ account_id: string; transfer_id: string | null; reconciled_at: string | null }>('SELECT account_id,transfer_id,reconciled_at FROM transactions WHERE id=$1 AND deleted_at IS NOT NULL', [transactionId]);
  if (!existing.rowCount) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Deleted transaction not found' });
  if (existing.rows[0].transfer_id || existing.rows[0].reconciled_at) return reply.code(409).send({ code: 'LOCKED_TRANSACTION', title: 'This transaction cannot be restored' });
  if (!await requireAccount(request, reply, existing.rows[0].account_id, true)) return;
  await pool.query('UPDATE transactions SET deleted_at=NULL,deleted_by_user_id=NULL,version=version+1,updated_at=now() WHERE id=$1', [transactionId]);
  return reply.code(204).send();
});

app.post('/api/v1/transactions/:transactionId/reconcile', { preHandler: requireUser }, async (request, reply) => {
  const transactionId = z.string().uuid().parse((request.params as { transactionId: string }).transactionId);
  body(z.object({ confirmed: z.literal(true) }), request);
  const existing = await pool.query<{ account_id: string; status: string; deleted_at: string | null; reconciled_at: string | null }>('SELECT account_id,status,deleted_at,reconciled_at FROM transactions WHERE id=$1', [transactionId]);
  if (!existing.rowCount) return reply.code(404).send({ code: 'NOT_FOUND', title: 'Transaction not found' });
  if (!await requireAccount(request, reply, existing.rows[0].account_id, true)) return;
  if (existing.rows[0].status !== 'posted' || existing.rows[0].deleted_at || existing.rows[0].reconciled_at) return reply.code(409).send({ code: 'INVALID_RECONCILIATION', title: 'This transaction cannot be reconciled' });
  const result = await pool.query('UPDATE transactions SET reconciled_at=now(),reconciled_by_user_id=$1,version=version+1 WHERE id=$2 RETURNING reconciled_at', [request.user!.id,transactionId]);
  return { reconciledAt: result.rows[0].reconciled_at };
});

app.post('/api/v1/transfers', { preHandler: requireUser }, async (request, reply) => {
  const input = body(z.object({ sourceAccountId: z.string().uuid(), destinationAccountId: z.string().uuid(), occurredOn: z.string().date(), amountCents: z.number().int().positive(), description: z.string().min(1).max(200), notes: z.string().max(5000).optional() }), request);
  if (input.sourceAccountId === input.destinationAccountId) return reply.code(422).send({ code: 'INVALID_TRANSFER', title: 'Choose two distinct accounts' });
  if (!await requireAccount(request, reply, input.sourceAccountId, true) || !await requireAccount(request, reply, input.destinationAccountId, true)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const category = await client.query("SELECT id FROM categories WHERE user_id=$1 AND system_key='XFER_ACCOUNTS'", [request.user!.id]);
    const transfer = await client.query('INSERT INTO transfers (user_id,occurred_on,notes) VALUES ($1,$2,$3) RETURNING id', [request.user!.id,input.occurredOn,input.notes ?? null]);
    await client.query("INSERT INTO transactions (user_id,account_id,occurred_on,amount_cents,description,category_id,transfer_id,notes) VALUES ($1,$2,$3,-$4,$5,$6,$7,$8),($1,$9,$3,$4,$5,$6,$7,$8)", [request.user!.id,input.sourceAccountId,input.occurredOn,input.amountCents,input.description,category.rows[0].id,transfer.rows[0].id,input.notes ?? null,input.destinationAccountId]);
    await client.query('COMMIT');
    return reply.code(201).send({ transferId: transfer.rows[0].id });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
});

app.get('/api/v1/budgets', { preHandler: requireUser }, async (request) => {
  const query = z.object({ periodType: z.enum(['monthly','yearly']), periodStart: z.string().date() }).parse(request.query);
  return { budgets: (await pool.query('SELECT b.*,c.name AS category_name FROM budgets b JOIN categories c ON c.id=b.category_id WHERE b.user_id=$1 AND b.period_type=$2 AND b.period_start=$3 ORDER BY c.name', [request.user!.id,query.periodType,query.periodStart])).rows };
});
app.put('/api/v1/budgets', { preHandler: requireUser }, async (request, reply) => {
  const input = body(z.object({ categoryId: z.string().uuid(), periodType: z.enum(['monthly','yearly']), periodStart: z.string().date(), plannedAmountCents: z.number().int() }), request);
  const result = await pool.query(`INSERT INTO budgets (user_id,category_id,period_type,period_start,planned_amount_cents) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,category_id,period_type,period_start) DO UPDATE SET planned_amount_cents=EXCLUDED.planned_amount_cents,updated_at=now() RETURNING *`, [request.user!.id,input.categoryId,input.periodType,input.periodStart,input.plannedAmountCents]);
  return reply.code(200).send({ budget: result.rows[0] });
});

app.get('/api/v1/accounts/:accountId/analysis/monthly', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId);
  if (!await requireAccount(request, reply, accountId)) return;
  const query = z.object({ year: z.coerce.number().int().min(1900).max(2200) }).parse(request.query);
  const result = await pool.query(`SELECT CASE WHEN t.amount_cents < 0 THEN 'debit' ELSE 'credit' END AS transaction_type, c.id AS category_id, c.name AS category_name, extract(month from t.occurred_on)::int AS month, sum(t.amount_cents)::bigint AS amount_cents
    FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.account_id=$1 AND t.status='posted' AND t.deleted_at IS NULL AND extract(year from t.occurred_on)=$2
    GROUP BY transaction_type,c.id,c.name,month ORDER BY transaction_type,c.name,month`, [accountId, query.year]);
  return { year: query.year, rows: result.rows };
});

app.get('/api/v1/accounts/:accountId/members', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); const access = await requireAccount(request, reply, accountId); if (!access) return; if (access.permission !== 'owner') return reply.code(403).send({ code: 'FORBIDDEN', title: 'Only the owner can manage members' });
  return { members: (await pool.query('SELECT u.id,u.email,m.permission FROM account_memberships m JOIN users u ON u.id=m.user_id WHERE m.account_id=$1 ORDER BY u.email', [accountId])).rows };
});
app.post('/api/v1/accounts/:accountId/members', { preHandler: requireUser }, async (request, reply) => {
  const accountId = z.string().uuid().parse((request.params as { accountId: string }).accountId); const access = await requireAccount(request, reply, accountId); if (!access) return; if (access.permission !== 'owner') return reply.code(403).send({ code: 'FORBIDDEN', title: 'Only the owner can manage members' });
  const input = body(z.object({ userId: z.string().uuid(), permission: z.enum(['editor','viewer']) }), request); await pool.query('INSERT INTO account_memberships (account_id,user_id,permission) VALUES ($1,$2,$3) ON CONFLICT (account_id,user_id) DO UPDATE SET permission=EXCLUDED.permission', [accountId,input.userId,input.permission]); return reply.code(204).send();
});

app.setErrorHandler((error, _request, reply) => { if (error instanceof z.ZodError) return reply.code(422).send({ code: 'VALIDATION_ERROR', title: 'Check the highlighted fields', fieldErrors: error.flatten().fieldErrors }); if ((error as { code?: string }).code === '23505') return reply.code(409).send({ code: 'CONFLICT', title: 'That value already exists' }); app.log.error(error); return reply.code(500).send({ code: 'INTERNAL_ERROR', title: 'Unexpected server error' }); });

export { app };

if (!process.env.VITEST) {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}
