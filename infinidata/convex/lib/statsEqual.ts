// Order-insensitive equality for the per-category stat maps stored on
// playerPoints/projections/providerProjections - lets their daily upserts
// skip rewriting a row whose data hasn't actually changed. An absent map
// (rows written before `stats` existed) only equals another empty one.
export function statsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a![key] === b?.[key]);
}
