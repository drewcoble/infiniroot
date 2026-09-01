import { query } from "./_generated/server";

// 2026 regular-season bye weeks, keyed by the same team abbreviations
// convex/sleeper/client.ts's DEF_TEAM_FPIDS uses (Sleeper's own convention).
// Unlike DEF_TEAM_FPIDS this genuinely changes every season - Sleeper's API
// doesn't expose bye weeks anywhere (checked live: absent from both the
// bulk /players/nfl payload and every league/roster endpoint), and the only
// real alternative (deriving it from a full schedule API, e.g. ESPN's) is
// a much bigger integration than a hardcoded 32-team map warrants for a
// "keep it simple" first pass. Verified against the real published 2026
// schedule (fantasyfootballcalculator.com/nfl-bye-weeks) and cross-checked
// against NFL.com's own release coverage: Week 5 (KC, CAR) through Week 14
// (DAL, ARI), no Week 12 byes. UPDATE THIS EVERY SEASON.
export const BYE_WEEKS_2026: Record<string, number> = {
  KC: 5,
  CAR: 5,
  MIA: 6,
  CIN: 6,
  DET: 6,
  MIN: 6,
  BUF: 7,
  LAC: 7,
  WAS: 7,
  JAX: 7,
  NYG: 8,
  NO: 8,
  SF: 8,
  HOU: 8,
  TEN: 9,
  PIT: 9,
  DEN: 10,
  PHI: 10,
  CHI: 10,
  TB: 10,
  NE: 11,
  CLE: 11,
  SEA: 11,
  GB: 11,
  ATL: 11,
  LAR: 11,
  IND: 13,
  NYJ: 13,
  LV: 13,
  BAL: 13,
  DAL: 14,
  ARI: 14,
};

export const getByeWeeks = query({
  args: {},
  handler: async () => BYE_WEEKS_2026,
});
