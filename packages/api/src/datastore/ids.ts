import { ObjectId } from 'mongodb';

/** Generate a 24-char hex id compatible with existing Mongo ObjectId URLs/APIs. */
export function generateId(): string {
  return new ObjectId().toHexString();
}

/** Lowercase hex form of an ObjectId spelling; throws on an invalid id. */
export function canonicalId(id: string): string {
  return new ObjectId(id).toHexString();
}

export function isObjectIdHex(value: string): boolean {
  return ObjectId.isValid(value) && new ObjectId(value).toHexString() === value;
}
