import { z } from 'zod';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  ACCOUNT_ENCRYPTION_KEY: z.string().min(40),
  WEB_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3010),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
});

export const config = schema.parse(process.env);
