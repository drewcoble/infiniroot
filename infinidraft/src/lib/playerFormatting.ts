import { STAT_LABELS } from "../constants/playerStats";

// injuryColor moved to @shared/injuryColor (both apps use it) - import it
// from there directly rather than through this file.

export function formatStatKey(key: string): string {
  return (
    STAT_LABELS[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
