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
    if (sql.includes('SELECT a.is_active,m.permission')) return { rowCount: 1, rows: [{ permission: 'owner', is_active: true }] };
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
    pool.connect.mockResolvedValue({ query: pool.query, release: vi.fn() });
  });

  const request = (path: string, options: Parameters<typeof app.inject>[0] = {}) => app.inject({ ...options, url: path });
  const authenticated = (path: string, options: Parameters<typeof app.inject>[0] = {}) => request(path, { ...options, headers: { ...(options.headers ?? {}), cookie: 'finance_session=test-token' } });

  it('serves liveness/readiness and setup status', async () => {
    expect((await request('/health/live')).json()).toEqual({ status: 'ok' });
    expect((await request('/health/ready')).statusCode).toBe(200);
    expect((await request('/api/v1/auth/setup-status')).json()).toEqual({ setupRequired: true });
  });

  it('authenticates and validates the read-only forecast endpoint', async () => {
    const path = `/api/v1/accounts/${accountId}/forecast`;
    expect((await request(`${path}?month=2026-10`)).statusCode).toBe(401);
    state.authenticated = true;
    for (const month of ['', '2026-13', '2026-00', '2026-1', '1800-01', '2026-10-01']) {
      expect((await authenticated(`${path}?month=${month}`)).statusCode).toBe(422);
    }
    expect((await authenticated('/api/v1/accounts/not-an-id/forecast?month=2026-10')).statusCode).toBe(422);
  });

  it('denies forecast reads without membership but allows read-only viewers', async () => {
    state.authenticated = true;
    const path = `/api/v1/accounts/${accountId}/forecast?month=2026-10`;
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect((await authenticated(path)).statusCode).toBe(404);
    expect(state.queries.some(sql => sql.includes('WITH forecast_plans'))).toBe(false);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ permission: 'viewer', is_active: false }] } as never);
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ plans: [], daily: [], balance_cents: '12345' }] } as never);
    const result = await authenticated(path);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ month: '2026-10', balance_cents: '12345', plans: [], daily: [] });
    const [sql, params] = pool.query.mock.calls.at(-1)! as unknown as [string, unknown[]];
    expect(sql).toContain('WITH forecast_plans');
    expect(sql).toContain("t.status='posted'");
    expect(sql).toContain('t.deleted_at IS NULL');
    expect(sql).toContain('t.transfer_id IS NULL AND NOT c.is_system');
    expect(sql).toContain('l.deleted_at IS NULL AND NOT c.is_system');
    expect(sql).not.toContain('checked_at');
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(params.slice(0, 2)).toEqual([accountId, '2026-10-01']);
  });

  it('rejects protected routes without a session', async () => {
    const response = await request('/api/v1/accounts');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('validates forecast preference writes including bodyless requests', async () => {
    const path = `/api/v1/accounts/${accountId}/forecast-methods/${categoryId}`;
    expect((await request(path, { method: 'PUT', payload: { method: 'fixed' } })).statusCode).toBe(401);
    state.authenticated = true;
    for (const payload of [undefined, {}, { method: 'unknown' }, { method: 'fixed', extra: true }]) {
      expect((await authenticated(path, { method: 'PUT', payload })).statusCode).toBe(422);
    }
    expect((await authenticated(`/api/v1/accounts/${accountId}/forecast-methods/invalid`, { method: 'PUT', payload: { method: 'fixed' } })).statusCode).toBe(422);
    expect((await authenticated(`/api/v1/accounts/invalid/forecast-methods/${categoryId}`, { method: 'PUT', payload: { method: 'fixed' } })).statusCode).toBe(422);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('denies forecast preference writes for nonmembers, viewers and inactive accounts', async () => {
    state.authenticated = true;
    const path = `/api/v1/accounts/${accountId}/forecast-methods/${categoryId}`;
    for (const [rows, status] of [[[], 404], [[{ permission: 'viewer', is_active: true }], 403], [[{ permission: 'owner', is_active: false }], 403]] as const) {
      pool.query.mockResolvedValueOnce({ rowCount: rows.length, rows } as never);
      expect((await authenticated(path, { method: 'PUT', payload: { method: 'variable' } })).statusCode).toBe(status);
    }
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('persists fixed/variable for editors and rejects unavailable categories', async () => {
    state.authenticated = true;
    const path = `/api/v1/accounts/${accountId}/forecast-methods/${categoryId}`;
    for (const method of ['fixed', 'variable']) {
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ permission: 'editor', is_active: true }] } as never);
      pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ category_id: categoryId, method }] } as never);
      const response = await authenticated(path, { method: 'PUT', payload: { method } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ category_id: categoryId, method });
      expect(pool.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO account_category_forecast_methods'), [accountId, categoryId, user.id, method]);
    }
    pool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ permission: 'owner', is_active: true }] } as never);
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect((await authenticated(path, { method: 'PUT', payload: { method: 'variable' } })).statusCode).toBe(404);
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

  it('validates budget copying and requires authentication and confirmation', async () => {
    const url = `/api/v1/accounts/${accountId}/budget/copy-next-year`;
    expect((await request(url, { method: 'POST', payload: { sourceYear: 2026, confirmed: true } })).statusCode).toBe(401);
    expect((await request(`/api/v1/budget-lines/${lineId}/copy-january`, { method: 'POST' })).statusCode).toBe(401);
    state.authenticated = true;
    for (const payload of [undefined, {}, { sourceYear: 2026 }, { sourceYear: 2026, confirmed: false }, { sourceYear: 2200, confirmed: true }]) {
      expect((await authenticated(url, { method: 'POST', payload })).statusCode).toBe(422);
    }
    expect((await authenticated('/api/v1/budget-lines/invalid/copy-january', { method: 'POST' })).statusCode).toBe(422);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('supports bodyless January copy and returns year-copy metadata', async () => {
    state.authenticated = true;
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT account_id')) return { rowCount: 1, rows: [{ account_id: accountId }] };
      if (sql.includes('SELECT a.is_active')) return { rowCount: 1, rows: [{ permission: 'owner', is_active: true }] };
      if (sql.startsWith('SELECT id')) return { rowCount: 1, rows: [{ id: lineId }] };
      if (sql.startsWith('SELECT amount_cents')) return { rowCount: 1, rows: [{ amount_cents: '12345' }] };
      return { rowCount: 0, rows: [] };
    });
    const release = vi.fn();
    pool.connect.mockResolvedValueOnce({ query, release });
    expect((await authenticated(`/api/v1/budget-lines/${lineId}/copy-january`, { method: 'POST' })).statusCode).toBe(204);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('generate_series(2,12)'), [lineId,'12345']);
    expect(release).toHaveBeenCalled();
    const copyQuery = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rowCount: 1, rows: [{ permission: 'editor', is_active: true }] })
      .mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rows: [{ copied_count: 2 }] }).mockResolvedValue({ rows: [] });
    pool.connect.mockResolvedValueOnce({ query: copyQuery, release });
    const result = await authenticated(`/api/v1/accounts/${accountId}/budget/copy-next-year`, { method: 'POST', payload: { sourceYear: 2026, confirmed: true } });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ sourceYear: 2026, targetYear: 2027, copiedCount: 2 });
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
