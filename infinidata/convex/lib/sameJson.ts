// Deep equality for plain JSON-shaped data (cache documents' row arrays) -
// lets a cache refresh skip rewriting a document whose contents haven't
// changed. Object keys are compared order-insensitively, since a stored
// document's key order isn't guaranteed to match the order it was built in;
// array order still matters.
export function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : val,
  );
}
