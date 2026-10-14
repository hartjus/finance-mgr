import { describe, expect, it } from 'vitest';
import { config } from '../apps/api/src/config.js';

describe('runtime configuration', () => {
  it('loads validated database, session, encryption, origin, and server settings', () => {
    expect(config.DATABASE_URL).toMatch(/^postgres(?:ql)?:\/\//);
    expect(config.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(config.ACCOUNT_ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(40);
    expect(config.WEB_ORIGIN).toMatch(/^https?:\/\//);
    expect(config.PORT).toBeGreaterThan(0);
    expect(['development', 'test', 'production']).toContain(config.NODE_ENV);
  });
});
