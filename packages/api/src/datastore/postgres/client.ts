import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import * as config from '@/config';

let pool: Pool | null = null;

function buildSslConfig(connectionString: string) {
  // node-pg: sslmode in the URL overrides the `ssl` option, so strip it and
  // pass TLS explicitly. Aiven Runtime injects PROJECT_CA_CERT (base64).
  const needsTls =
    connectionString.includes('sslmode=require') ||
    connectionString.includes('sslmode=verify-ca') ||
    connectionString.includes('sslmode=verify-full') ||
    Boolean(process.env.PROJECT_CA_CERT);
  if (!needsTls) {
    return undefined;
  }
  if (process.env.PROJECT_CA_CERT) {
    return {
      ca: Buffer.from(process.env.PROJECT_CA_CERT, 'base64').toString(),
      rejectUnauthorized: true,
    };
  }
  // Local/dev without the project CA: encrypt but skip server auth.
  return { rejectUnauthorized: false };
}

export function getPool(): Pool {
  if (pool == null) {
    if (config.DATABASE_URL == null) {
      throw new Error('DATABASE_URL is not set');
    }
    const url = new URL(config.DATABASE_URL);
    url.searchParams.delete('sslmode');
    pool = new Pool({
      connectionString: url.toString(),
      ssl: buildSslConfig(config.DATABASE_URL),
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
