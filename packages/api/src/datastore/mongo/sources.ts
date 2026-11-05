import { SourceKind, SourceSchemaNoId } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import type { SourceRecord, SourcesRepository } from '@/datastore/repositories';
import {
  LogSource,
  MetricSource,
  PromqlSource,
  SessionSource,
  Source,
  TraceSource,
} from '@/models/source';

import { toPlain } from './convert';

// Updates must go through the matching discriminator model so Mongoose knows
// kind-specific fields (e.g. metricTables on MetricSource).
function getModelForKind(kind: SourceKind) {
  switch (kind) {
    case SourceKind.Log:
      return LogSource;
    case SourceKind.Trace:
      return TraceSource;
    case SourceKind.Session:
      return SessionSource;
    case SourceKind.Metric:
      return MetricSource;
    case SourceKind.Promql:
      return PromqlSource;
    default:
      kind satisfies never;
      throw new Error(`${kind} is not a valid SourceKind`);
  }
}

function toRecord(doc: object): SourceRecord {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return toPlain(doc as never, [
    'team',
    'connection',
  ]) as unknown as SourceRecord;
}

const orNull = (doc: object | null | undefined) => (doc ? toRecord(doc) : null);

export function createMongoSourcesRepository(): SourcesRepository {
  return {
    async listByTeam(teamId) {
      return (await Source.find({ team: teamId })).map(toRecord);
    },

    async getById(teamId, sourceId) {
      // A non-ObjectId id is "not found", not a CastError.
      if (!mongoose.Types.ObjectId.isValid(sourceId)) {
        return null;
      }
      try {
        return orNull(await Source.findOne({ _id: sourceId, team: teamId }));
      } catch {
        return null;
      }
    },

    async create(teamId, input) {
      const created = await getModelForKind(input.kind)
        // @ts-expect-error The create method has incompatible type signatures but is actually safe
        .create({ ...input, team: teamId });
      return toRecord(created);
    },

    async replace(teamId, sourceId, input) {
      const existing = await Source.findOne({ _id: sourceId, team: teamId });
      if (!existing) return null;

      // Mongoose resets createdAt on replace unless the replacement carries one.
      const createdAt: Date | undefined = existing.get('createdAt');

      // findOneAndReplace swaps the whole document, so `team` must be in the
      // replacement or the source drops out of every team-scoped query.
      if (existing.kind === input.kind) {
        // @ts-expect-error The findOneAndReplace method has incompatible type signatures but is actually safe
        const replaced = await getModelForKind(input.kind).findOneAndReplace(
          { _id: sourceId, team: teamId },
          { ...input, team: teamId, ...(createdAt && { createdAt }) },
          { new: true },
        );
        return orNull(replaced);
      }

      // Kind changed: the raw collection write below bypasses discriminator
      // validation, so validate through Zod first. The no-id schema is used
      // because callers identify the source via sourceId.
      const parsed = SourceSchemaNoId.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Invalid source data: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        );
      }
      if (!mongoose.Types.ObjectId.isValid(parsed.data.connection)) {
        throw new Error('Invalid source data: connection must be a valid id');
      }

      // replaceOne swaps the document in place (including the discriminator
      // key) in a single atomic write.
      const replacement = {
        ...parsed.data,
        connection: new mongoose.Types.ObjectId(parsed.data.connection),
        _id: existing._id,
        team: existing.team,
        ...(createdAt && { createdAt }),
        updatedAt: new Date(),
      };
      const result = await Source.collection.replaceOne(
        { _id: existing._id, team: existing.team },
        replacement,
      );
      // Deleted concurrently between the findOne and the replace.
      if (result.matchedCount === 0) return null;
      return orNull(getModelForKind(replacement.kind).hydrate(replacement));
    },

    async delete(teamId, sourceId) {
      return orNull(
        await Source.findOneAndDelete({ _id: sourceId, team: teamId }),
      );
    },
  };
}
