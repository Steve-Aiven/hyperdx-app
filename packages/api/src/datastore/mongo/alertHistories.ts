import mongoose from 'mongoose';

import type {
  AlertHistoriesRepository,
  AlertHistoryRecord,
  HistoryWindow,
  HistoryWindowRow,
  LatestAlertHistory,
} from '@/datastore/alertRepositories';
import { AlertState } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';

import { toPlain } from './convert';

const oid = (id: string) => new mongoose.Types.ObjectId(id);

function toRecord(doc: object): AlertHistoryRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, ['alert']) as unknown as AlertHistoryRecord;
}

type LatestRow = Omit<LatestAlertHistory, '_id'> & {
  _id: mongoose.Types.ObjectId;
};

const toLatest = (row: LatestRow): LatestAlertHistory => ({
  ...row,
  _id: row._id.toString(),
});

export function createMongoAlertHistoriesRepository(): AlertHistoriesRepository {
  return {
    async create(alertId, input) {
      return toRecord(await AlertHistory.create({ ...input, alert: alertId }));
    },

    async deleteMany({ alertId, state, createdAt }) {
      const result = await AlertHistory.deleteMany({
        alert: oid(alertId),
        ...(state != null && { state }),
        createdAt:
          createdAt instanceof Date
            ? createdAt
            : { $gt: createdAt.gt, $lte: createdAt.lte },
      });
      return result.deletedCount ?? 0;
    },

    async upsertError(alertId, createdAt, errors, analytics) {
      await AlertHistory.updateOne(
        { alert: oid(alertId), createdAt, state: AlertState.ERROR },
        {
          $set: { errors, ...(analytics != null && { analytics }) },
          $setOnInsert: { counts: 0, lastValues: [] },
        },
        { upsert: true },
      );
    },

    async getPrevious(alertId, now, lookbackMs) {
      const rows = await AlertHistory.aggregate<LatestRow>([
        {
          $match: {
            alert: oid(alertId),
            createdAt: {
              $lte: now,
              $gte: new Date(now.getTime() - lookbackMs),
            },
            // ERROR rows are failed evaluations, not evaluated windows.
            state: { $ne: AlertState.ERROR },
          },
        },
        // Index-backed on {alert, group, createdAt}; $first picks the latest.
        { $sort: { alert: 1, group: 1, createdAt: -1 } },
        {
          $group: {
            _id: { alert: '$alert', group: '$group' },
            createdAt: { $first: '$createdAt' },
            state: { $first: '$state' },
            fired: { $first: '$fired' },
            groupValues: { $first: '$groupValues' },
          },
        },
        {
          $project: {
            _id: '$_id.alert',
            createdAt: 1,
            state: 1,
            group: '$_id.group',
            fired: 1,
            groupValues: 1,
          },
        },
      ]);
      return rows.map(toLatest);
    },

    async getConsecutiveWindow(alertId, from, to) {
      const rows = await AlertHistory.aggregate<LatestRow>([
        {
          $match: {
            alert: oid(alertId),
            createdAt: { $gte: from, $lt: to },
            state: { $ne: AlertState.ERROR },
          },
        },
        { $sort: { alert: 1, group: 1, createdAt: -1 } },
        {
          $project: {
            _id: '$alert',
            createdAt: 1,
            state: 1,
            group: 1,
            fired: 1,
          },
        },
      ]);
      return rows.map(toLatest);
    },

    async getWindows(alertId, range, limit) {
      const createdAt = Object.fromEntries(
        Object.entries(range)
          .filter(([, value]) => value != null)
          .map(([key, value]) => [`$${key}`, value]),
      );
      const windows = await AlertHistory.aggregate<{
        _id: Date;
        rows: (HistoryWindowRow & { group?: string })[];
      }>([
        { $match: { alert: oid(alertId), createdAt } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$createdAt',
            rows: {
              $push: {
                group: '$group',
                state: '$state',
                counts: '$counts',
                lastValues: '$lastValues',
                fired: '$fired',
                errors: '$errors',
                analytics: '$analytics',
              },
            },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: limit },
      ]);
      return windows.map(
        (w): HistoryWindow => ({ createdAt: w._id, rows: w.rows }),
      );
    },

    async getTransitionWindows(alertId, from, to) {
      const windows = await AlertHistory.aggregate<{
        _id: Date;
        states: string[];
        bucketStarts: Date[][];
      }>([
        {
          $match: {
            alert: oid(alertId),
            createdAt: { $gte: from, $lte: to },
            state: { $ne: AlertState.ERROR },
          },
        },
        {
          $group: {
            _id: '$createdAt',
            states: { $push: '$state' },
            bucketStarts: { $push: '$lastValues.startTime' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      return windows.map(w => ({
        createdAt: w._id,
        states: w.states,
        bucketStarts: w.bucketStarts,
      }));
    },
  };
}
