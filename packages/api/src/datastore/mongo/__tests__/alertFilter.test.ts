import type { AlertCursor, AlertFilter } from '@/datastore/alertRepositories';
import { buildMongoAlertFilter } from '@/datastore/mongo/alertFilter';
import { AlertSource, AlertState } from '@/models/alert';

const TEAM_ID = '6500000000000000000000aa';
const ALERT_ID = '6500000000000000000000bb';

const buildFilter = (filter: AlertFilter = {}, cursor?: AlertCursor) =>
  buildMongoAlertFilter(TEAM_ID, filter, cursor);

describe('buildMongoAlertFilter', () => {
  it('scopes to the team and nothing else when unfiltered', () => {
    expect(buildFilter()).toEqual({ team: TEAM_ID });
  });

  it('matches any requested tag', () => {
    expect(buildFilter({ tag: ['prod', 'web'] }).tags).toEqual({
      $in: ['prod', 'web'],
    });
  });

  it('matches documents with no source field when saved_search is requested', () => {
    // `source` postdates the first alerts; those documents are saved searches.
    expect(
      buildFilter({ source: [AlertSource.SAVED_SEARCH, AlertSource.TILE] })
        .source,
    ).toEqual({ $in: [AlertSource.SAVED_SEARCH, AlertSource.TILE, null] });

    expect(buildFilter({ source: [AlertSource.TILE] }).source).toEqual({
      $in: [AlertSource.TILE],
    });
  });

  it('matches documents with no state field when ok is requested', () => {
    // `state` postdates the first alerts; those documents hydrate as OK.
    expect(
      buildFilter({ state: [AlertState.OK, AlertState.ALERT] }).state,
    ).toEqual({ $in: [AlertState.OK, AlertState.ALERT, null] });

    expect(buildFilter({ state: [AlertState.ALERT] }).state).toEqual({
      $in: [AlertState.ALERT],
    });
  });

  it('filters on state and createdBy by equality', () => {
    const filter = buildFilter({
      state: [AlertState.ALERT],
      createdBy: ALERT_ID,
    });
    expect(filter.state).toEqual({ $in: [AlertState.ALERT] });
    expect(filter.createdBy).toBe(ALERT_ID);
  });

  it('treats regex metacharacters in search as literals', () => {
    expect(buildFilter({ search: 'a.b(c' }).displayName).toEqual({
      $regex: 'a\\.b\\(c',
      $options: 'i',
    });
  });

  it('adds no displayName predicate for a blank search', () => {
    // A cleared search box sends `search=`, and trimming a whitespace-only one
    // lands in the same place. Neither may become a match-everything regex.
    expect(buildFilter({ search: '' }).displayName).toBeUndefined();
  });

  it('pages past a named alert with a scoped tie-break', () => {
    const filter = buildFilter({}, { displayName: 'Checkout', id: ALERT_ID });

    // The _id tie-break is scoped to the cursor's own name so neither branch
    // rescans the run of rows sharing it.
    expect(filter.displayName).toBeUndefined();
    expect(filter.$or).toEqual([
      { displayName: { $gt: 'Checkout' } },
      { displayName: 'Checkout', _id: { $gt: ALERT_ID } },
    ]);
  });

  it('pages out of the unnamed block into the named alerts', () => {
    const filter = buildFilter({}, { displayName: null, id: ALERT_ID });

    expect(filter.displayName).toBeUndefined();
    expect(filter.$or).toEqual([
      { displayName: null, _id: { $gt: ALERT_ID } },
      { displayName: { $gte: '' } },
    ]);
  });

  it('keeps the search predicate alongside a named cursor', () => {
    const filter = buildFilter(
      { search: 'err' },
      { displayName: 'Checkout', id: ALERT_ID },
    );

    expect(filter.displayName).toEqual({ $regex: 'err', $options: 'i' });
    expect(filter.$or).toEqual([
      { displayName: { $gt: 'Checkout' } },
      { displayName: 'Checkout', _id: { $gt: ALERT_ID } },
    ]);
  });

  it('keeps the search predicate alongside a null cursor', () => {
    const filter = buildFilter(
      { search: 'err' },
      { displayName: null, id: ALERT_ID },
    );

    expect(filter.displayName).toEqual({ $regex: 'err', $options: 'i' });
    expect(filter.$or).toEqual([
      { displayName: null, _id: { $gt: ALERT_ID } },
      { displayName: { $gte: '' } },
    ]);
  });

  it('leaves $or to the cursor when the widened filters are applied', () => {
    // The missing-field branches spell "documents with no source/state field"
    // as `$in: [..., null]` rather than a second `$or`, which would overwrite
    // the cursor's and silently restart the walk.
    const filter = buildFilter(
      { source: [AlertSource.SAVED_SEARCH], state: [AlertState.OK] },
      { displayName: null, id: ALERT_ID },
    );

    expect(filter.source).toEqual({ $in: [AlertSource.SAVED_SEARCH, null] });
    expect(filter.state).toEqual({ $in: [AlertState.OK, null] });
    expect(filter.$or).toEqual([
      { displayName: null, _id: { $gt: ALERT_ID } },
      { displayName: { $gte: '' } },
    ]);
  });
});
