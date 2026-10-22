import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { HEADER, normalizeCsv, parseCsv, identifyRows, summarize, importRows } from '../scripts/import-checkbook.mjs';

const csv = (line = '10/18/26,$12.34,,001,Example store,*,Memo,Groceries,$100.00,$100.00') => `${HEADER.join(',')}\r\n${line}\r\n`;
const parse = (text: string) => normalizeCsv(text, { yearBase: 2000 });
const account = '11111111-1111-4111-8111-111111111111';

describe('Checkbook parser', () => {
  it('maps fields and reconciliation without importing balance columns', () => {
    const rows = parse(csv());
    expect(rows[0]).toEqual({ record: 2, occurredOn: '2026-10-18', amountCents: '-1234', identifier: '001', description: 'Example store', reconciled: true, notes: 'Memo', category: 'Groceries' });
    expect(summarize(rows)).toEqual({ rows: 1, reconciled: 1, unreconciled: 0, netCents: '-1234', reconciledNetCents: '-1234' });
  });
  it('supports BOM, commas, quotes, embedded newlines, credit and blank reconciliation', () => {
    const row = parse('\uFEFF' + csv('2/29/2024,,"$1,234.56",,"A ""quoted"", description",,"First\nSecond",Income,ignored,ignored'))[0];
    expect(row.amountCents).toBe('123456');
    expect(row.description).toBe('A "quoted", description');
    expect(row.notes).toBe('First\nSecond');
    expect(row.reconciled).toBe(false);
  });
  it('requires explicit century and validates real calendar dates', () => {
    expect(() => normalizeCsv(csv())).toThrow('year-base');
    expect(normalizeCsv(csv(), { yearBase: 1900 })[0].occurredOn).toBe('1926-10-18');
    expect(() => parse(csv().replace('10/18/26', '2/29/2025'))).toThrow('invalid Date');
    expect(() => parse(csv().replace('10/18/26', '13/1/2026'))).toThrow('invalid Date');
    expect(() => normalizeCsv(csv(), { yearBase: 2020 })).toThrow('year-base');
  });
  it.each(['-$1.00', '$1.001', '1e3', '1,00.00', '$90071992547410.00', 'SECRET_AMOUNT'])('rejects malformed amount %s without echoing cell content', value => {
    const input = csv().replace('$12.34', `"${value}"`);
    expect(() => parse(input)).toThrow('Debit');
    try { parse(input); } catch (error) { expect(String(error)).not.toContain(value); }
  });
  it('rejects ambiguous amount directions and unexpected markers', () => {
    expect(() => parse(csv().replace('$12.34,,', '$12.34,$1.00,'))).toThrow('exactly one');
    expect(() => parse(csv().replace('$12.34', ''))).toThrow('exactly one');
    expect(() => parse(csv().replace(',*,', ',yes,'))).toThrow('Reconciled');
    expect(parse(csv().replace('$12.34,,', '$12.34,$0.00,'))[0].amountCents).toBe('-1234');
  });
  it('rejects missing text, bad shape, NUL, unsupported header and oversize input', () => {
    expect(() => parse(csv().replace('Example store', ''))).toThrow('Description');
    expect(() => parse(csv().replace('Example store', 'x'.repeat(501)))).toThrow('Description');
    expect(() => parse(csv().replace('Memo', '\0'))).toThrow('NUL');
    expect(() => parse(csv().replace('Date,', 'Wrong,'))).toThrow('headers');
    expect(() => parse(csv('one,two'))).toThrow('columns');
    expect(() => parse(HEADER.join(','))).toThrow('no transactions');
    expect(() => parse('x'.repeat(10 * 1024 * 1024 + 1))).toThrow('10 MiB');
    expect(() => parse(HEADER.join(',') + '\n' + 'x\n'.repeat(20001))).toThrow('20,000');
  });
  it('requires a category or explicit fallback', () => {
    const blank = csv().replace('Groceries', '');
    expect(() => parse(blank)).toThrow('Category');
    expect(normalizeCsv(blank, { yearBase: 2000, defaultCategory: 'Historical' })[0].category).toBe('Historical');
  });
  it('accepts a standalone historical transfer without a matching transaction', () => {
    const rows = parse(csv().replace('Groceries', 'Xfer Accounts'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'Xfer Accounts', amountCents: '-1234', reconciled: true });
    expect(normalizeCsv(csv().replace('Groceries', ''), { yearBase: 2000, defaultCategory: 'Xfer Accounts' })[0].category).toBe('Xfer Accounts');
  });
  it.each([false, true])('imports an active protected category with commit=%s', async commit => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 'owner', permission: 'owner', is_active: true }] })
      .mockResolvedValueOnce({ rows: [] }) // No previously imported IDs
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // No overlapping history
      .mockResolvedValueOnce({ rows: [{ id: 'transfer-category', name: 'Xfer Accounts', is_system: true, is_archived: false }] })
      .mockResolvedValue({ rows: [] });
    const result = await importRows({ query }, parse(csv().replace('Groceries', 'Xfer Accounts')), {
      accountId: account, email: 'owner@example.test', commit, confirmReconciled: true,
    });
    expect(result).toMatchObject({ mode: commit ? 'committed' : 'dry-run', rows: 1, netCents: '-1234', reconciled: 1, categoriesToCreate: 0 });
    const inserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO transactions'));
    expect(inserts).toHaveLength(commit ? 1 : 0);
    if (commit) expect(inserts[0][1]).toEqual([
      expect.any(String), 'owner', account, '2026-10-18', '-1234', 'Example store', 'transfer-category', '001', 'Memo', true,
    ]);
    expect(query).toHaveBeenLastCalledWith(commit ? 'COMMIT' : 'ROLLBACK');
    expect(query).toHaveBeenCalledTimes(commit ? 7 : 6);
  });
  it('still rejects archived protected categories without inserting transactions', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'owner', permission: 'owner', is_active: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'transfer-category', name: 'Xfer Accounts', is_system: true, is_archived: true }] })
      .mockResolvedValue({ rows: [] });
    await expect(importRows({ query }, parse(csv().replace('Groceries', 'Xfer Accounts')), {
      accountId: account, email: 'owner@example.test', commit: true, confirmReconciled: true,
    })).rejects.toThrow('archived');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO transactions'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('rejects malformed quoting and handles trailing/blank records', () => {
    expect(() => parseCsv('a,"unterminated')).toThrow('unterminated');
    expect(() => parseCsv('a,"b"x')).toThrow('closing quote');
    expect(() => parseCsv('a,b"c')).toThrow('unexpected quote');
    expect(parseCsv('a,"b"\r\n\r\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
  });
  it('uses account-scoped stable IDs and preserves repeated identical source rows', () => {
    const row = parse(csv())[0], other = { ...row, description: 'Other' };
    const ids = identifyRows([row, row, other], account).map(r => r.id);
    expect(new Set(ids).size).toBe(3);
    expect(identifyRows([other, row, row], account).map(r => r.id).sort()).toEqual([...ids].sort());
    expect(identifyRows([{ ...row, record: 99 }], account)[0].id).toBe(ids[0]);
    expect(identifyRows([row], '22222222-2222-4222-8222-222222222222')[0].id).not.toBe(ids[0]);
  });
  it('requires target/user and explicit reconciliation acknowledgement before database writes', async () => {
    const db = { query: () => { throw new Error('database must not be called'); } };
    await expect(importRows(db, parse(csv()), { accountId: 'invalid', email: 'owner@example.test' })).rejects.toThrow('UUID');
    await expect(importRows(db, parse(csv()), { accountId: account })).rejects.toThrow('--user');
    await expect(importRows(db, parse(csv()), { accountId: account, email: 'owner@example.test', commit: true })).rejects.toThrow('confirm-reconciled');
  });
  it('CLI validates stdin offline and never echoes sensitive cell content in errors', () => {
    const run = (args: string[], input: string) => spawnSync(process.execPath, ['scripts/import-checkbook.mjs', ...args], { input, encoding: 'utf8' });
    const result = run(['--file', '-', '--year-base', '2000', '--validate-only'], csv());
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'validation-only', rows: 1, reconciled: 1 });
    expect(result.stdout).not.toContain('Example store');
    const invalid = run(['--file', '-', '--year-base', '2000', '--validate-only'], csv().replace('$12.34', 'PRIVATE_CELL'));
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Record 2');
    expect(invalid.stderr).not.toContain('PRIVATE_CELL');
    expect(run(['--validate-only', '--commit'], csv()).status).toBe(1);
    expect(run(['--unknown-secret-value'], csv()).stderr).not.toContain('--unknown-secret-value');
    expect(run(['--help'], '').stdout).toContain('dry-run by default');
  });
});
