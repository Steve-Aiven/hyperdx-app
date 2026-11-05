import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import * as config from '@/config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool == null) {
    if (config.DATABASE_URL == null) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      // Aiven PG requires TLS; sslmode in the URL is enough for most clients,
      // but node-pg needs an explicit ssl object when the CA is not mounted.
      ssl: config.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 20,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool != null) {
    await pool.end();
    pool = null;
  }
}
