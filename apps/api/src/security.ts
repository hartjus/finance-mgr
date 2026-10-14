import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

const key = Buffer.from(config.ACCOUNT_ENCRYPTION_KEY, 'base64');
if (key.length !== 32) throw new Error('ACCOUNT_ENCRYPTION_KEY must decode to exactly 32 bytes');

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken() { return randomBytes(32).toString('base64url'); }

export function encryptAccountNumber(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), lastFour: value.slice(-4) };
}

export function decryptAccountNumber(ciphertext: Buffer, iv: Buffer, authTag: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
