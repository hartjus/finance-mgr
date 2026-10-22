import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ authenticated: true, permission: 'owner', active: true, member: true, categories: true, failInsert: false, sql: [] as string[] }));
const category = '33333333-3333-4333-8333-333333333333';
const client = vi.hoisted(() => ({ query: vi.fn(async (sql: string) => {
  state.sql.push(sql);
  if (sql.includes('FROM accounts a')) return { rowCount: state.member ? 1 : 0, rows: [{ permission: state.permission, is_active: state.active }] };
  if (sql.includes('FROM idempotency_keys')) return { rowCount: 0, rows: [] };
  if (sql.includes('FROM categories')) return { rowCount: state.categories ? 1 : 0, rows: state.categories ? [{ id: '33333333-3333-4333-8333-333333333333' }] : [] };
  if (state.failInsert && sql.includes('INSERT INTO transactions')) throw new Error('Synthetic database failure');
  return { rowCount: 1, rows: [] };
}), release: vi.fn() }));
vi.mock('../apps/api/src/db.js', () => ({
  pool: { connect: vi.fn(async () => client) },
  authPool: { query: vi.fn(async () => ({ rows: state.authenticated ? [{ id: '11111111-1111-4111-8111-111111111111' }] : [] })) },
}));
const { app } = await import('../apps/api/src/server.js');
const row = { occurredOn: '2026-01-01', amountCents: -1234, description: 'Synthetic purchase', categoryId: category };
const send = (transactions: unknown[], requestId = 'batch-one') => app.inject({ method: 'POST', url: '/api/v1/accounts/22222222-2222-4222-8222-222222222222/transactions/bulk', headers: { cookie: 'finance_session=synthetic' }, payload: { requestId, transactions } });

describe('atomic bulk API', () => {
  beforeEach(() => { Object.assign(state, { authenticated: true, permission: 'owner', active: true, member: true, categories: true, failInsert: false, sql: [] }); vi.clearAllMocks(); });
  it('validates the entire batch before any database write', async () => {
    for (const invalid of [{ ...row, amountCents: 0 }, { ...row, amountCents: 1.5 }, { ...row, description: ' ' }, { ...row, occurredOn: '2026-02-30' }, { ...row, amountCents: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect((await send([row, invalid])).statusCode).toBe(422);
    }
    expect((await send([])).statusCode).toBe(422);
    expect((await send(Array(501).fill(row))).statusCode).toBe(422);
    expect(state.sql).toEqual([]);
  });
  it('requires authentication and active owner/editor membership', async () => {
    state.authenticated = false;
    expect((await send([row])).statusCode).toBe(401);
    state.authenticated = true; state.member = false;
    expect((await send([row])).statusCode).toBe(404);
    state.member = true; state.permission = 'viewer';
    expect((await send([row])).statusCode).toBe(403);
    state.permission = 'editor'; state.active = false;
    expect((await send([row])).statusCode).toBe(403);
    expect(state.sql.some(sql => sql.includes('INSERT'))).toBe(false);
  });
  it('rejects inactive or foreign categories without inserting any rows', async () => {
    state.categories = false;
    const result = await send([row]);
    expect(result.statusCode).toBe(422);
    expect(result.json()).toMatchObject({ code: 'INVALID_CATEGORY' });
    expect(state.sql.at(-1)).toBe('ROLLBACK');
    expect(state.sql.some(sql => sql.includes('INSERT'))).toBe(false);
  });
  it('commits both rows with a receipt and releases the connection', async () => {
    const result = await send([row, { ...row, amountCents: 5000 }]);
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ createdCount: 2 });
    expect(state.sql.filter(sql => sql.includes('INSERT INTO transactions'))).toHaveLength(2);
    expect(state.sql.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('rolls back database failures with no sensitive exception response', async () => {
    state.failInsert = true;
    const result = await send([row]);
    expect(result.statusCode).toBe(500);
    expect(result.json().code).toBe('BULK_SAVE_FAILED');
    expect(result.body).not.toContain('Synthetic database failure');
    expect(state.sql.at(-1)).toBe('ROLLBACK');
  });
});
