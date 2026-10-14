import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, dateOnly, money } from '../apps/web/src/api';

describe('web API client and formatters', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('formats USD cents and date-only values consistently', () => {
    expect(money(-12345)).toBe('-$123.45');
    expect(money('0')).toBe('$0.00');
    expect(dateOnly('2026-10-07T23:59:00.000Z')).toBe('Oct 7, 2026');
    expect(dateOnly('not-a-date')).toBe('not-a-date');
  });

  it('sends JSON only when a request has a body and includes credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await api('/health');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ credentials: 'include', headers: expect.any(Headers) }));
    const noBodyHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(noBodyHeaders.has('Content-Type')).toBe(false);

    await api('/transactions', { method: 'POST', body: JSON.stringify({ amountCents: 100 }) });
    const bodyHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers;
    expect(bodyHeaders.get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for 204 responses and exposes server error titles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api('/logout', { method: 'POST' })).resolves.toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Not allowed' }), { status: 403 }));
    await expect(api('/restricted')).rejects.toThrow('Not allowed');
  });
});
