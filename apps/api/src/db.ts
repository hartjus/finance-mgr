import pg from 'pg';
import { config } from './config.js';

const connectionOptions = {
  connectionString: config.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  idleTimeoutMillis: 30000
};

export const pool = new pg.Pool({ ...connectionOptions, max: 10 });

// Authentication runs on a small isolated pool so a stalled or expensive
// application query cannot prevent session validation from completing.
export const authPool = new pg.Pool({ ...connectionOptions, max: 3 });
