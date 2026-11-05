/** ObjectId (or string) to its hex string; passes null/undefined through. */
export function idOf(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

type ObjectLike = { toObject(options?: object): Record<string, unknown> };

/**
 * Hydrated doc to a plain object with string ids. `refs` names the ObjectId
 * fields (team, createdBy, ...) that records expose as strings.
 */
export function toPlain(
  doc: ObjectLike,
  refs: string[] = [],
): Record<string, unknown> {
  const { _id, __v, ...rest } = doc.toObject({
    flattenMaps: true,
    virtuals: false,
    versionKey: false,
  });
  const out: Record<string, unknown> = {
    ...rest,
    _id: String(_id),
    id: String(_id),
  };
  for (const ref of refs) {
    if (out[ref] != null) {
      out[ref] = String(out[ref]);
    }
  }
  return out;
}
