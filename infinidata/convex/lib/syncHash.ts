// SHA-256 of a JSON-shaped value, key order normalized (lib/sameJson.ts's
// rule) - a sync's "has this changed since last time" fingerprint, stored
// in syncHashes (see convex/syncHashes.ts) so an unchanged batch can be
// skipped without reading the rows it would otherwise compare against.
import { stableStringify } from "./sameJson";

export async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
