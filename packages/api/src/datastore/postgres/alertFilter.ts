import type { AlertCursor, AlertFilter } from '@/datastore/alertRepositories';
import { AlertSource } from '@/models/alert';

const escapeLike = (value: string) => value.replace(/[\\%_]/g, c => `\\${c}`);

/**
 * WHERE clause (and params) for an alert list filter, mirroring the Mongo
 * semantics in `mongo/alertFilter.ts`. `state` is a column that always holds a
 * value; `source` defaults to saved_search when missing from the doc.
 */
export function alertFilterSql(
  teamId: string,
  filter: AlertFilter,
  cursor?: AlertCursor,
): { where: string; params: unknown[] } {
  const params: unknown[] = [teamId];
  const clauses = ['team_id = $1'];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filter.tag != null) {
    clauses.push(`doc->'tags' ?| ${add(filter.tag)}::text[]`);
  }
  if (filter.state != null) {
    clauses.push(`state = ANY(${add(filter.state)}::text[])`);
  }
  if (filter.source != null) {
    clauses.push(
      `COALESCE(doc->>'source', '${AlertSource.SAVED_SEARCH}') = ANY(${add(filter.source)}::text[])`,
    );
  }
  if (filter.search) {
    clauses.push(
      `doc->>'displayName' ILIKE ${add(`%${escapeLike(filter.search)}%`)} ESCAPE '\\'`,
    );
  }
  if (filter.createdBy != null) {
    clauses.push(`doc->>'createdBy' = ${add(filter.createdBy)}`);
  }

  if (cursor != null) {
    const name = `(doc->>'displayName') COLLATE "C"`;
    const id = add(cursor.id);
    if (cursor.displayName === null) {
      // The previous page ended inside the null-displayName block.
      clauses.push(`((${name} IS NULL AND id > ${id}) OR ${name} IS NOT NULL)`);
    } else {
      const after = add(cursor.displayName);
      clauses.push(
        `(${name} > ${after}::text COLLATE "C" OR (${name} = ${after}::text COLLATE "C" AND id > ${id}))`,
      );
    }
  }

  return { where: clauses.join(' AND '), params };
}
