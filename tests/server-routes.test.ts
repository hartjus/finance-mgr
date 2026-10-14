import { beforeEach, describe, expect, it, vi } from 'vitest';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', role: 'admin' as const };
const accountId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const lineId = '44444444-4444-4444-8444-444444444444';

const state = vi.hoisted(() => ({ authenticated: false, queries: [] as string[] }));
const pool = vi.hoisted(() => ({
  query: vi.fn(async (sql: string) => {
    state.queries.push(sql);
    if (sql.includes('FROM users LIMIT 1')) return { rowCount: 0, rows: [] };
    if (sql.includes('WITH ledger AS')) return { rowCount: 1, rows: [{ transactions: [], page: 1, total_items: '0', total_pages: 1 }] };
    if (sql.includes('SELECT 1')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM account_memberships')) return { rowCount: 1, rows: [{ permission: 'owner', is_active: true }] };
    if (sql.includes('FROM categories WHERE id=')) return { rowCount: 1, rows: [{ is_system: false }] };
    if (sql.includes('FROM budget_lines')) return { rowCount: 1, rows: [{ id: lineId, account_id: accountId }] };
    if (sql.includes('INSERT INTO categories')) return { rowCount: 1, rows: [{ id: categoryId, name: 'Meals', is_archived: false, is_system: false }] };
    if (sql.includes('UPDATE categories')) return { rowCount: 1, rows: [{ id: categoryId, name: 'Meals', is_archived: true, is_system: false }] };
    if (sql.includes('SELECT id,name,is_archived,is_system FROM categories')) return { rowCount: 1, rows: [{ id: categoryId, name: 'Meals', is_archived: false, is_system: false }] };
    if (sql.includes('UPDATE budget_lines')) return { rowCount: 1, rows: [] };
    return { rowCount: 0, rows: [] };
  }),
  connect: vi.fn()
}));
const authPool = vi.hoisted(() => ({ query: vi.fn(async () => state.authenticated ? { rowCount: 1, rows: [user] } : { rowCount: 0, rows: [] }) }));

vi.mock('../apps/api/src/db.js', () => ({ pool, authPool }));
vi.mock('argon2', () => ({ default: { hash: vi.fn(async () => 'hash'), verify: vi.fn(async () => false), argon2id: 2 } }));

const { app } = await import('../apps/api/src/server.js');

describe('Fastify API routes', () => {
  beforeEach(() => {
    state.authenticated = false;
    state.queries.length = 0;
    vi.clearAllMocks();
  });

  const request = (path: string, options: Parameters<typeof app.inject>[0] = {}) => app.inject({ ...options, url: path });
  const authenticated = (path: string, options: Parameters<typeof app.inject>[0] = {}) => request(path, { ...options, headers: { ...(options.headers ?? {}), cookie: 'finance_session=test-token' } });

  it('serves liveness/readiness and setup status', async () => {
    expect((await request('/health/live')).json()).toEqual({ status: 'ok' });
    expect((await request('/health/ready')).statusCode).toBe(200);
    expect((await request('/api/v1/auth/setup-status')).json()).toEqual({ setupRequired: true });
  });

  it('rejects protected routes without a session', async () => {
    const response = await request('/api/v1/accounts');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('restricts account settings to the owner and validates changes', async () => {
    const url = `/api/v1/accounts/${accountId}`;
    expect((await request(url, { method: 'PATCH', payload: { name: 'Daily' } })).statusCode).toBe(401);
    state.authenticated = true;
    expect((await authenticated(url, { method: 'PATCH', payload: {} })).statusCode).toBe(422);
    expect((await authenticated(url, { method: 'PATCH', payload: { name: ' ' } })).statusCode).toBe(422);
    expect((await authenticated(url, { method: 'PATCH', payload: { startingBalanceCents: 123 } })).statusCode).toBe(422);
    expect((await authenticated(url, { method: 'PATCH', payload: { isActive: false } })).statusCode).toBe(403);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: accountId, name: 'Daily', is_active: false }] } as never);
    const updated = await authenticated(url, { method: 'PATCH', payload: { name: 'Daily', isActive: false } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().account).toMatchObject({ name: 'Daily', is_active: false });
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('AND owner_user_id=$4'), ['Daily', false, accountId, user.id]);
  });

  it('returns the session and account/category resources for an authenticated user', async () => {
    state.authenticated = true;
    const session = await authenticated('/api/v1/auth/session');
    expect(session.json()).toEqual({ user });
    const accounts = await authenticated('/api/v1/accounts');
    expect(accounts.statusCode).toBe(200);
    const categories = await authenticated('/api/v1/categories');
    expect(categories.json().categories[0].name).toBe('Meals');
  });

  it('creates and archives a category with validation', async () => {
    state.authenticated = true;
    const created = await authenticated('/api/v1/categories', { method: 'POST', payload: { name: ' Meals ' } });
    expect(created.statusCode).toBe(201);
    const invalid = await authenticated('/api/v1/categories', { method: 'POST', payload: { name: '' } });
    expect(invalid.statusCode).toBe(422);
    const updated = await authenticated(`/api/v1/categories/${categoryId}`, { method: 'PATCH', payload: { isArchived: true } });
    expect(updated.statusCode).toBe(200);
  });

  it('enforces account write permissions and soft-deletes budget lines', async () => {
    state.authenticated = true;
    const response = await authenticated(`/api/v1/budget-lines/${lineId}`, { method: 'DELETE' });
    expect(response.statusCode).toBe(204);
    expect(state.queries.some((query) => query.includes('UPDATE budget_lines SET deleted_at'))).toBe(true);
  });

  it('returns consistent validation errors for malformed route identifiers', async () => {
    state.authenticated = true;
    const response = await authenticated('/api/v1/budget-lines/not-a-uuid', { method: 'DELETE' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('defaults ledger pagination to 75 and returns empty metadata', async () => {
    state.authenticated = true;
    const response = await authenticated(`/api/v1/accounts/${accountId}/ledger`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ transactions: [], pagination: { page: 1, pageSize: 75, totalItems: 0, totalPages: 1, hasNextPage: false, hasPreviousPage: false } });
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('WITH ledger AS'), [accountId, null, null, null, null, 75, 1]);
  });

  it('validates ledger pages and page sizes and preserves read authorization', async () => {
    const url = `/api/v1/accounts/${accountId}/ledger`;
    expect((await request(url)).statusCode).toBe(401);
    state.authenticated = true;
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=no', 'page=2147483648', 'pageSize=0', 'pageSize=101', 'pageSize=1.5', 'pageSize=no', 'limit=0']) {
      expect((await authenticated(`${url}?${query}`)).statusCode).toBe(422);
    }
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect((await authenticated(url)).statusCode).toBe(404);
  });

  it('passes page and filters to snapshot query and returns navigation metadata', async () => {
    state.authenticated = true;
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ permission: 'viewer', is_active: true }] } as never);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ transactions: [{ id: 'row', running_balance_cents: 1234 }], page: 2, total_items: '151', total_pages: 3 }] } as never);
    const response = await authenticated(`/api/v1/accounts/${accountId}/ledger?page=2&pageSize=75&limit=25&description=Lunch&reconciled=false&occurredOn=2026-01-01&categoryId=${categoryId}`);
    expect(response.json()).toMatchObject({ transactions: [{ running_balance_cents: 1234 }], pagination: { page: 2, pageSize: 75, totalItems: 151, totalPages: 3, hasPreviousPage: true, hasNextPage: true } });
    expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('metadata.page::bigint'), [accountId, '2026-01-01', categoryId, 'Lunch', false, 75, 2]);
    await authenticated(`/api/v1/accounts/${accountId}/ledger?limit=25`);
    expect(pool.query).toHaveBeenLastCalledWith(expect.any(String), [accountId, null, null, null, null, 25, 1]);
  });
});
