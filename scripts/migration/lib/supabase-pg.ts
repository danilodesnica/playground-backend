import { Pool, PoolClient } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL || DB_URL.includes('<PASSWORD>')) {
  throw new Error('SUPABASE_DB_URL missing or still contains placeholder in scripts/migration/.env');
}

export const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 15,
});

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function listPublicTables(): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return rows.map(r => r.tablename);
}
