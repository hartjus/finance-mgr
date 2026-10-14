import { describe, expect, it } from 'vitest';
import { decryptAccountNumber, encryptAccountNumber, hashToken, newToken } from '../apps/api/src/security.js';

describe('security helpers', () => {
  it('hashes tokens deterministically without exposing the token', () => {
    const token = 'session-token';
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toContain(token);
  });

  it('creates URL-safe random session tokens', () => {
    const first = newToken();
    const second = newToken();
    expect(first).toHaveLength(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
  });

  it('encrypts and decrypts account numbers while exposing only the last four', () => {
    const encrypted = encryptAccountNumber('1234567890');
    expect(encrypted.lastFour).toBe('7890');
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('1234567890');
    expect(decryptAccountNumber(encrypted.ciphertext, encrypted.iv, encrypted.authTag)).toBe('1234567890');
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptAccountNumber('5555444433332222');
    encrypted.ciphertext[0] ^= 1;
    expect(() => decryptAccountNumber(encrypted.ciphertext, encrypted.iv, encrypted.authTag)).toThrow();
  });
});
