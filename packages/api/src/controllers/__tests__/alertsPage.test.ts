import { MAX_TAGS } from '@hyperdx/common-utils/dist/types';

import { alertsPageQuerySchema } from '@/controllers/alertsPage';
import { AlertSource } from '@/models/alert';
import { encodeCursor } from '@/utils/pagination';

const ALERT_ID = '6500000000000000000000bb';

const parse = (query: Record<string, unknown>) =>
  alertsPageQuerySchema.parse(query);

describe('alertsPageQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(parse({})).toEqual({});
  });

  it('normalizes a repeatable param whether it arrives once or many times', () => {
    expect(parse({ tag: 'prod' }).tag).toEqual(['prod']);
    expect(parse({ tag: ['prod', 'web'] }).tag).toEqual(['prod', 'web']);
    expect(parse({ tag: '' }).tag).toBeUndefined();
  });

  it('rejects more tags than an alert can carry', () => {
    expect(() => parse({ tag: Array(MAX_TAGS + 1).fill('t') })).toThrow();
  });

  it('coerces limit and rejects out-of-range values', () => {
    expect(parse({ limit: '25' }).limit).toBe(25);
    expect(() => parse({ limit: '0' })).toThrow();
    expect(() => parse({ limit: '501' })).toThrow();
    expect(() => parse({ limit: '1.5' })).toThrow();
  });

  it('accepts limit and tag count at their inclusive bounds', () => {
    expect(parse({ limit: '1' }).limit).toBe(1);
    expect(parse({ limit: '500' }).limit).toBe(500);
    expect(parse({ tag: Array(MAX_TAGS).fill('t') }).tag).toHaveLength(
      MAX_TAGS,
    );
  });

  it('trims search and rejects an overlong one', () => {
    expect(parse({ search: '  errors ' }).search).toBe('errors');
    expect(() => parse({ search: 'x'.repeat(513) })).toThrow();
  });

  it('rejects values outside the source and state enums', () => {
    expect(parse({ source: 'tile' }).source).toEqual([AlertSource.TILE]);
    expect(() => parse({ source: 'nope' })).toThrow();
    expect(() => parse({ state: 'nope' })).toThrow();
  });

  it('rejects a non-ObjectId createdBy', () => {
    expect(() => parse({ createdBy: 'not-an-id' })).toThrow();
  });

  it('survives re-parsing its own output', () => {
    // processRequest writes the parsed query back onto req.query, and the
    // handler parses that again to recover the coerced types.
    const once = parse({
      limit: '2',
      tag: ['prod', 'web'],
      source: 'tile',
      state: 'OK',
      search: ' errors ',
      createdBy: ALERT_ID,
    });
    expect(alertsPageQuerySchema.parse(once)).toEqual(once);
  });

  it('rejects a cursor with no limit to continue', () => {
    const cursor = encodeCursor({ n: 'a', id: ALERT_ID });
    expect(() => parse({ cursor })).toThrow('cursor requires limit');
    expect(parse({ cursor, limit: '2' }).cursor).toBe(cursor);
  });

  it.each([
    ['garbage', 'not a cursor!'],
    ['a non-ObjectId id', encodeCursor({ n: 'a', id: 'nope' })],
    // JSON.stringify drops an undefined value, so a writer that doesn't
    // normalize a missing displayName to null issues a cursor like this.
    ['a missing name', encodeCursor({ id: ALERT_ID })],
  ])('rejects a cursor with %s', (_label, cursor) => {
    expect(() => parse({ cursor, limit: '2' })).toThrow('invalid cursor');
  });
});
