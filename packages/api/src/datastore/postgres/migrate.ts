import fs from 'fs';
import path from 'path';

import logger from '@/utils/logger';

import { query, withClient } from './client';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export async function runPostgresMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const existing = await query<{ id: string }>(
      'SELECT id FROM schema_migrations WHERE id = $1',
      [id],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [
          id,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    logger.info({ migration: id }, 'Applied PostgreSQL migration');
  }
}
