import type {
  BracketStage,
  Bonus,
  DoubleElimStage,
  DraftState,
  GroupStage,
  MatchupDraftFormation,
  PlayoffFormat,
  PointsStage,
  Stage,
  TeamSource,
  Tiebreaker,
} from "./format";

// Evaluates a PlayoffFormat against a season's scores. Pure and
// deterministic: the caller decides which scores go in - final and live
// for "where things stand", projections for the projected picture, a
// sampled season per simulation run, or a viewer's what-if picks.

export interface SeasonInput {
  teamIds: string[];
  // Regular-season head-to-head games from the platform schedule.
  schedule: { weeks: number[]; teamIds: [string, string] }[];
  // Every team also plays the week's median score (Sleeper).
  medianGame: boolean;
  // Raw points per team per week, where known.
  points: Record<string, Record<number, number>>;
  // Weeks up to here are final; later weeks' points are live or projected.
  finalThroughWeek: number;
  draft: DraftState;
  // Fill undecided draft and rematch picks with the drafter's weakest
  // option (lower strength = weaker) - simulations only.
  autoPick?: { strength: Record<string, number> } | undefined;
}

export interface Standing {
  teamId: string;
  seed: number;
  tier: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface GameResult {
  id: string;
  weeks: number[];
  teamIds: [string | null, string | null];
  // Points with bonuses - null before any week of the game has points.
  points: [number | null, number | null];
  bonus: [number, number];
  // Set once the game is final.
  winnerId: string | null;
  final: boolean;
  // Bracket games: the earlier game each spot is fed by (null for a team
  // that starts here, including off a bye).
  from?: [string | null, string | null];
}

export interface GroupRow {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  // Group-stage points, bonuses included.
  points: number;
  // Raw points over the ranking's points tiebreaker span (no bonuses) -
  // what decides a tied record. Null when the ranking has no points rule.
  tiebreakPoints: number | null;
}

export interface GroupResult {
  headId: string | null;
  teamIds: string[];
  // Ranked - final games only.
  table: GroupRow[];
  games: GameResult[];
}

export interface RoundResult {
  round: number;
  name: string;
  weeks: number[];
  games: GameResult[];
}

export type DraftPhase =
  | { phase: "slots"; drafterId: string; openSlots: number[] }
  | { phase: "picks"; drafterId: string; pickNumber: number; openWeeks: number[] }
  | { phase: "rematches"; pending: { drafterId: string; week: number; options: string[] }[] }
  | { phase: "done" };

export interface StageResult {
  stageId: string;
  // In seed order within the stage. Null until every source is settled.
  entrants: string[] | null;
  // Both null until the stage is settled.
  advancers: string[] | null;
  eliminated: string[] | null;
  // Stage seed per entrant (1-based).
  seeds: Record<string, number>;
  groups?: GroupResult[];
  draft?: DraftPhase;
  rounds?: RoundResult[];
  // Points stages: entrants ranked by stage points so far.
  table?: { teamId: string; points: number }[];
  doubleElim?: DoubleElimResult;
}

export interface DoubleElimWeek {
  week: number;
  winners: GameResult[];
  losers: GameResult[];
  // Teams sitting the week out, by side.
  byes: { winners: string[]; losers: string[] };
}

export interface DoubleElimResult {
  // Each bracket week played or set so far.
  weeks: DoubleElimWeek[];
  // Who's still alive, after the last decided week.
  unbeaten: string[];
  onceBeaten: string[];
  // Set once the Rumble's field is known.
  rumble: {
    week: number;
    // Ranked by points (with bonuses) once any are in, else by seed.
    entries: { teamId: string; points: number | null }[];
    winnerId: string | null;
    final: boolean;
  } | null;
  // Set once a once-beaten team wins the Rumble.
  final: GameResult | null;
}

export interface PlayoffState {
  standings: Standing[];
  regularSeasonFinal: boolean;
  stages: Record<string, StageResult>;
  championId: string | null;
}

interface Ctx {
  format: PlayoffFormat;
  input: SeasonInput;
  standings: Standing[];
  seedOf: Map<string, number>;
  tierOf: Map<string, string>;
  regularSeasonFinal: boolean;
  stages: Record<string, StageResult>;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function pointsIn(input: SeasonInput, teamId: string, week: number): number | undefined {
  return input.points[teamId]?.[week];
}

function rawPoints(input: SeasonInput, teamId: string, fromWeek: number, toWeek: number) {
  let total = 0;
  for (let week = fromWeek; week <= toWeek; week++) total += pointsIn(input, teamId, week) ?? 0;
  return total;
}

// ---------------------------------------------------------------- ranking

interface RecordBook {
  wins: Map<string, number>;
  losses: Map<string, number>;
  ties: Map<string, number>;
  // Final games, for head-to-head.
  games: { teamIds: [string, string]; winnerId: string | null }[];
}

function winPct(book: RecordBook, teamId: string): number {
  const w = book.wins.get(teamId) ?? 0;
  const l = book.losses.get(teamId) ?? 0;
  const t = book.ties.get(teamId) ?? 0;
  const games = w + l + t;
  return games === 0 ? 0 : (w + t / 2) / games;
}

// Sorts best-first: the first tiebreaker splits the teams into tied
// clusters, and each cluster is ordered by the remaining tiebreakers - so
// head-to-head is only ever counted among the teams actually tied.
function rank(
  teamIds: string[],
  tiebreakers: Tiebreaker[],
  book: RecordBook,
  ctx: Pick<Ctx, "input" | "seedOf">,
): string[] {
  if (teamIds.length <= 1 || tiebreakers.length === 0) {
    return [...teamIds].sort((a, b) => (ctx.seedOf.get(a) ?? 0) - (ctx.seedOf.get(b) ?? 0));
  }
  const [rule, ...rest] = tiebreakers as [Tiebreaker, ...Tiebreaker[]];
  const tied = new Set(teamIds);
  const score = (teamId: string): number => {
    switch (rule.kind) {
      case "winPct":
        return winPct(book, teamId);
      case "pointsFor":
        return rawPoints(ctx.input, teamId, rule.fromWeek, rule.toWeek);
      case "pointsAgainst":
        // Fewer allowed ranks higher.
        return -pointsAgainst(ctx.input, teamId, rule.fromWeek, rule.toWeek);
      case "headToHead": {
        let wins = 0;
        let games = 0;
        for (const game of book.games) {
          if (!game.teamIds.includes(teamId)) continue;
          const other = game.teamIds[0] === teamId ? game.teamIds[1] : game.teamIds[0];
          if (!tied.has(other)) continue;
          games++;
          if (game.winnerId === teamId) wins++;
          else if (game.winnerId === null) wins += 0.5;
        }
        return games === 0 ? 0 : wins / games;
      }
      case "seed":
        return -(ctx.seedOf.get(teamId) ?? 0);
    }
  };
  const scored = teamIds.map((teamId) => ({ teamId, value: score(teamId) }));
  scored.sort((a, b) => b.value - a.value);
  const result: string[] = [];
  for (let i = 0; i < scored.length; ) {
    let j = i + 1;
    while (j < scored.length && Math.abs(scored[j]!.value - scored[i]!.value) < 1e-9) j++;
    const cluster = scored.slice(i, j).map((entry) => entry.teamId);
    result.push(...(cluster.length > 1 ? rank(cluster, rest, book, ctx) : cluster));
    i = j;
  }
  return result;
}

function pointsAgainst(input: SeasonInput, teamId: string, fromWeek: number, toWeek: number) {
  let total = 0;
  for (const game of input.schedule) {
    if (!game.teamIds.includes(teamId)) continue;
    const other = game.teamIds[0] === teamId ? game.teamIds[1] : game.teamIds[0];
    for (const week of game.weeks) {
      if (week >= fromWeek && week <= toWeek) total += pointsIn(input, other, week) ?? 0;
    }
  }
  return total;
}

function emptyBook(): RecordBook {
  return { wins: new Map(), losses: new Map(), ties: new Map(), games: [] };
}

function record(book: RecordBook, game: GameResult) {
  const [a, b] = game.teamIds;
  if (!game.final || a === null || b === null) return;
  const bump = (map: Map<string, number>, teamId: string) =>
    map.set(teamId, (map.get(teamId) ?? 0) + 1);
  if (game.winnerId === null) {
    bump(book.ties, a);
    bump(book.ties, b);
  } else {
    bump(book.wins, game.winnerId);
    bump(book.losses, game.winnerId === a ? b : a);
  }
  book.games.push({ teamIds: [a, b], winnerId: game.winnerId });
}

// ---------------------------------------------------------------- games

// A game over `weeks` - points summed over the weeks that have them, final
// once every week is final. `tieWinner` decides a final tie (brackets: the
// better seed); without one a tie stands.
function playGame(
  input: SeasonInput,
  id: string,
  weeks: number[],
  teamIds: [string | null, string | null],
  bonusPerWeek: [number, number],
  tieWinner?: string | null,
): GameResult {
  const side = (teamId: string | null, bonus: number): number | null => {
    if (teamId === null) return null;
    const played = weeks.filter((week) => pointsIn(input, teamId, week) !== undefined);
    if (played.length === 0) return null;
    return sum(played.map((week) => pointsIn(input, teamId, week)!)) + bonus * played.length;
  };
  const bonus: [number, number] = [bonusPerWeek[0] * weeks.length, bonusPerWeek[1] * weeks.length];
  const points: [number | null, number | null] = [
    side(teamIds[0], bonusPerWeek[0]),
    side(teamIds[1], bonusPerWeek[1]),
  ];
  const final =
    teamIds[0] !== null &&
    teamIds[1] !== null &&
    weeks.every((week) => week <= input.finalThroughWeek) &&
    weeks.every(
      (week) =>
        pointsIn(input, teamIds[0]!, week) !== undefined &&
        pointsIn(input, teamIds[1]!, week) !== undefined,
    );
  let winnerId: string | null = null;
  if (final) {
    const [a, b] = points as [number, number];
    winnerId = a > b ? teamIds[0] : b > a ? teamIds[1] : (tieWinner ?? null);
  }
  return { id, weeks, teamIds, points, bonus, winnerId, final };
}

function bonusFor(
  ctx: Ctx,
  bonus: Bonus | undefined,
  teamId: string | null,
  seed?: number,
  round?: number,
) {
  if (!bonus || teamId === null) return 0;
  let total = 0;
  const tier = ctx.tierOf.get(teamId);
  if (bonus.byTier && tier !== undefined) total += bonus.byTier[tier] ?? 0;
  if (bonus.bySeedRound && seed !== undefined && round !== undefined) {
    total += bonus.bySeedRound[seed]?.[round - 1] ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------- regular season

function regularSeason(format: PlayoffFormat, input: SeasonInput) {
  const end = format.regularSeasonEndWeek;
  const book = emptyBook();
  const games = input.schedule
    .filter((game) => game.weeks.every((week) => week <= end))
    .map((game, i) => playGame(input, `rs${i}`, game.weeks, game.teamIds, [0, 0]));
  for (const game of games) record(book, game);
  if (input.medianGame) {
    for (let week = 1; week <= Math.min(end, input.finalThroughWeek); week++) {
      const scored = input.teamIds.filter((teamId) => pointsIn(input, teamId, week) !== undefined);
      if (scored.length < 2) continue;
      const sorted = scored.map((teamId) => pointsIn(input, teamId, week)!).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
      for (const teamId of scored) {
        const points = pointsIn(input, teamId, week)!;
        const map = points > median ? book.wins : points < median ? book.losses : book.ties;
        map.set(teamId, (map.get(teamId) ?? 0) + 1);
      }
    }
  }
  const finalWeek = Math.min(end, input.finalThroughWeek);
  const seedOf = new Map<string, number>();
  const order = rank(input.teamIds, format.seeding, book, { input, seedOf });
  order.forEach((teamId, i) => seedOf.set(teamId, i + 1));
  const tierOf = new Map<string, string>();
  for (const tier of format.tiers) {
    for (const teamId of order.slice(tier.firstSeed - 1, tier.lastSeed)) {
      tierOf.set(teamId, tier.name);
    }
  }
  const standings: Standing[] = order.map((teamId, i) => ({
    teamId,
    seed: i + 1,
    tier: tierOf.get(teamId) ?? null,
    wins: book.wins.get(teamId) ?? 0,
    losses: book.losses.get(teamId) ?? 0,
    ties: book.ties.get(teamId) ?? 0,
    pointsFor: rawPoints(input, teamId, 1, finalWeek),
    pointsAgainst: pointsAgainst(input, teamId, 1, finalWeek),
  }));
  return { standings, seedOf, tierOf, regularSeasonFinal: input.finalThroughWeek >= end };
}

// ---------------------------------------------------------------- sources

// A source's teams, best first - or null while it isn't settled yet.
function resolveSource(ctx: Ctx, source: TeamSource): string[] | null {
  const bySeed = (teamIds: string[]) =>
    [...teamIds].sort((a, b) => (ctx.seedOf.get(a) ?? 0) - (ctx.seedOf.get(b) ?? 0));
  switch (source.from) {
    case "seeds":
      if (!ctx.regularSeasonFinal) return null;
      return ctx.standings
        .filter((row) => row.seed >= source.firstSeed && row.seed <= source.lastSeed)
        .map((row) => row.teamId);
    case "advancers": {
      const advancers = ctx.stages[source.stageId]?.advancers ?? null;
      return advancers && bySeed(advancers);
    }
    case "eliminated": {
      const eliminated = ctx.stages[source.stageId]?.eliminated ?? null;
      return eliminated && bySeed(eliminated);
    }
    case "nonEntrants": {
      const entrants = ctx.stages[source.stageId]?.entrants ?? null;
      if (!entrants) return null;
      return ctx.standings.map((row) => row.teamId).filter((teamId) => !entrants.includes(teamId));
    }
    case "pointsLeaders": {
      if (!ctx.regularSeasonFinal || source.toWeek > ctx.input.finalThroughWeek) return null;
      const pool = ctx.standings
        .filter((row) => row.seed >= source.firstSeed && row.seed <= source.lastSeed)
        .map((row) => row.teamId);
      const ranked = rank(
        pool,
        [{ kind: "pointsFor", fromWeek: source.fromWeek, toWeek: source.toWeek }],
        emptyBook(),
        ctx,
      );
      return bySeed(ranked.slice(0, source.count));
    }
    case "wildcards": {
      const pools = source.stageIds.map((id) => ctx.stages[id]?.eliminated ?? null);
      if (pools.some((pool) => pool === null)) return null;
      if (source.toWeek > ctx.input.finalThroughWeek) return null;
      const pool = pools.flatMap((p) => p!);
      const ranked = rank(
        pool,
        [{ kind: "pointsFor", fromWeek: source.fromWeek, toWeek: source.toWeek }],
        emptyBook(),
        ctx,
      );
      return ranked.slice(0, source.count);
    }
  }
}

function resolveEntrants(ctx: Ctx, sources: TeamSource[], regularSeasonOrder: boolean) {
  const lists = sources.map((source) => resolveSource(ctx, source));
  if (lists.some((list) => list === null)) return null;
  const all = lists.flatMap((list) => list!);
  if (!regularSeasonOrder) return all;
  return [...all].sort((a, b) => (ctx.seedOf.get(a) ?? 0) - (ctx.seedOf.get(b) ?? 0));
}

// ---------------------------------------------------------------- groups

function unsettled(stageId: string, seeds: Record<string, number>): StageResult {
  return { stageId, entrants: null, advancers: null, eliminated: null, seeds };
}

function weakest(options: string[], strength: Record<string, number>): string {
  return options.reduce((best, teamId) =>
    (strength[teamId] ?? 0) < (strength[best] ?? 0) ? teamId : best,
  );
}

// Draft slots in snake (or straight) order for every pick.
function pickOrder(slotOrder: string[], rounds: number, snake: boolean): string[] {
  const order: string[] = [];
  for (let round = 0; round < rounds; round++) {
    const forward = !snake || round % 2 === 0;
    order.push(...(forward ? slotOrder : [...slotOrder].reverse()));
  }
  return order;
}

interface FormedGroup {
  headId: string | null;
  teamIds: string[];
  // Week -> the week's pairs.
  pairs: Map<number, [string, string][]>;
}

function matchupDraftGroups(
  ctx: Ctx,
  formation: MatchupDraftFormation,
  entrants: string[],
): { groups: FormedGroup[]; draft: DraftPhase } {
  const drafters = entrants.filter((teamId) => ctx.tierOf.get(teamId) === formation.drafterTier);
  const pool = entrants.filter((teamId) => !drafters.includes(teamId));
  const strength = ctx.input.autoPick?.strength;
  const draft = ctx.input.draft;

  // Slots, chosen in seed order.
  const slotByDrafter = new Map(
    draft.slots.filter((s) => drafters.includes(s.drafterId)).map((s) => [s.drafterId, s.slot]),
  );
  for (const drafterId of drafters) {
    if (slotByDrafter.has(drafterId)) continue;
    const taken = new Set(slotByDrafter.values());
    const open = drafters.map((_, i) => i + 1).filter((slot) => !taken.has(slot));
    if (!strength) {
      return {
        groups: drafters.map((headId) => ({ headId, teamIds: [headId], pairs: new Map() })),
        draft: { phase: "slots", drafterId, openSlots: open },
      };
    }
    slotByDrafter.set(drafterId, open[0]!);
  }
  const slotOrder = [...drafters].sort(
    (a, b) => (slotByDrafter.get(a) ?? 0) - (slotByDrafter.get(b) ?? 0),
  );

  // Picks, snaking through the slots.
  const order = pickOrder(slotOrder, formation.draftWeeks.length, formation.snake);
  const picks = [...draft.picks];
  let draftPhase: DraftPhase | null = null;
  for (let i = picks.length; i < order.length; i++) {
    const drafterId = order[i]!;
    const usedWeeks = new Set(picks.filter((p) => p.drafterId === drafterId).map((p) => p.week));
    const openWeeks = formation.draftWeeks.filter((week) => !usedWeeks.has(week));
    if (!strength) {
      draftPhase = { phase: "picks", drafterId, pickNumber: i + 1, openWeeks };
      break;
    }
    const taken = new Set(picks.map((p) => p.opponentId));
    const opponentId = weakest(
      pool.filter((teamId) => !taken.has(teamId)),
      strength,
    );
    picks.push({ drafterId, opponentId, week: openWeeks[0]! });
  }

  const groups: FormedGroup[] = slotOrder.map((headId) => {
    const own = picks.filter((p) => p.drafterId === headId);
    const pairs = new Map<number, [string, string][]>();
    const members = [headId, ...own.map((p) => p.opponentId)];
    // Once the group is full, the head's opponent each week leaves the
    // other two to play each other.
    for (const pick of own) {
      const rest = members.filter((teamId) => teamId !== headId && teamId !== pick.opponentId);
      const weekPairs: [string, string][] = [[headId, pick.opponentId]];
      if (members.length === 4) weekPairs.push([rest[0]!, rest[1]!]);
      pairs.set(pick.week, weekPairs);
    }
    return { headId, teamIds: members, pairs };
  });

  if (draftPhase) return { groups, draft: draftPhase };

  // Rematches - each drafter's choice is independent, so all are open at
  // once.
  const pending: { drafterId: string; week: number; options: string[] }[] = [];
  for (const group of groups) {
    const headId = group.headId!;
    for (const week of formation.rematchWeeks) {
      const options = group.teamIds.filter((teamId) => teamId !== headId);
      let choice = ctx.input.draft.rematches.find(
        (r) => r.drafterId === headId && r.week === week,
      )?.opponentId;
      if (choice === undefined && strength) choice = weakest(options, strength);
      if (choice === undefined) {
        pending.push({ drafterId: headId, week, options });
        continue;
      }
      const rest = options.filter((teamId) => teamId !== choice);
      const weekPairs: [string, string][] = [[headId, choice]];
      if (rest.length === 2) weekPairs.push([rest[0]!, rest[1]!]);
      group.pairs.set(week, weekPairs);
    }
  }
  return {
    groups,
    draft: pending.length > 0 ? { phase: "rematches", pending } : { phase: "done" },
  };
}

// Serpentine groups, each a circle-method round robin over the weeks.
function serpentineGroups(stage: GroupStage, entrants: string[]): FormedGroup[] {
  const groups: FormedGroup[] = Array.from({ length: stage.groupCount }, () => ({
    headId: null,
    teamIds: [],
    pairs: new Map(),
  }));
  entrants.forEach((teamId, i) => {
    const lap = Math.floor(i / stage.groupCount);
    const pos = i % stage.groupCount;
    groups[lap % 2 === 0 ? pos : stage.groupCount - 1 - pos]!.teamIds.push(teamId);
  });
  for (const group of groups) {
    group.headId = group.teamIds[0] ?? null;
    const ring: (string | null)[] = [...group.teamIds];
    if (ring.length % 2 === 1) ring.push(null);
    stage.weeks.forEach((week, w) => {
      const pairs: [string, string][] = [];
      const turn = w % Math.max(ring.length - 1, 1);
      const rotated = [ring[0]!, ...rotate(ring.slice(1), turn)];
      for (let i = 0; i < rotated.length / 2; i++) {
        const a = rotated[i];
        const b = rotated[rotated.length - 1 - i];
        if (a && b) pairs.push([a, b]);
      }
      group.pairs.set(week, pairs);
    });
  }
  return groups;
}

function rotate<T>(values: T[], by: number): T[] {
  if (values.length === 0) return values;
  const k = by % values.length;
  return [...values.slice(values.length - k), ...values.slice(0, values.length - k)];
}

function evaluateGroups(ctx: Ctx, stage: GroupStage): StageResult {
  const entrants = resolveEntrants(ctx, stage.entrants, true);
  const seeds = Object.fromEntries((entrants ?? []).map((teamId, i) => [teamId, i + 1]));
  if (!entrants) return unsettled(stage.id, seeds);

  const formed =
    stage.formation.kind === "matchupDraft"
      ? matchupDraftGroups(ctx, stage.formation, entrants)
      : { groups: serpentineGroups(stage, entrants), draft: undefined };

  let settled = formed.draft === undefined || formed.draft.phase === "done";
  const groups: GroupResult[] = formed.groups.map((group, g) => {
    const book = emptyBook();
    const games: GameResult[] = [];
    for (const week of stage.weeks) {
      for (const [a, b] of group.pairs.get(week) ?? []) {
        const id = `${stage.id}g${g}w${week}${games.length}`;
        const bonus: [number, number] = [
          bonusFor(ctx, stage.bonus, a),
          bonusFor(ctx, stage.bonus, b),
        ];
        const game = playGame(ctx.input, id, [week], [a, b], bonus);
        games.push(game);
        record(book, game);
      }
    }
    if (games.some((game) => !game.final)) settled = false;
    const order = rank(group.teamIds, stage.ranking, book, ctx);
    const pointsRule = stage.ranking.find((rule) => rule.kind === "pointsFor");
    const table = order.map((teamId) => ({
      teamId,
      wins: book.wins.get(teamId) ?? 0,
      losses: book.losses.get(teamId) ?? 0,
      ties: book.ties.get(teamId) ?? 0,
      points: sum(
        games.flatMap((game) =>
          game.teamIds.flatMap((id, side) =>
            id === teamId && game.final ? [game.points[side] ?? 0] : [],
          ),
        ),
      ),
      tiebreakPoints:
        pointsRule?.kind === "pointsFor"
          ? rawPoints(ctx.input, teamId, pointsRule.fromWeek, pointsRule.toWeek)
          : null,
    }));
    return { headId: group.headId, teamIds: group.teamIds, table, games };
  });

  const advancers = settled
    ? groups.flatMap((group) =>
        group.table.slice(0, stage.advancePerGroup).map((row) => row.teamId),
      )
    : null;
  return {
    stageId: stage.id,
    entrants,
    advancers,
    eliminated: advancers && entrants.filter((teamId) => !advancers.includes(teamId)),
    seeds,
    groups,
    ...(formed.draft ? { draft: formed.draft } : {}),
  };
}

// ---------------------------------------------------------------- brackets

export function roundName(round: number, roundCount: number): string {
  const fromEnd = roundCount - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

// Bracket slot order for a power-of-two bracket - 1 v 8, 4 v 5, 2 v 7,
// 3 v 6 for eight - so the top seeds can only meet in the final.
export function seedSlotOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, next - seed]);
  }
  return order;
}

function evaluateBracket(ctx: Ctx, stage: BracketStage): StageResult {
  const roundCount = stage.roundWeeks.length;
  const size = 2 ** roundCount;
  const entrants = resolveEntrants(ctx, stage.entrants, stage.seeding === "regularSeason");
  const seeds = Object.fromEntries((entrants ?? []).map((teamId, i) => [teamId, i + 1]));
  const seedOf = (teamId: string | null) =>
    teamId === null ? Infinity : (seeds[teamId] ?? Infinity);

  // Each slot is a team, a TBD (null), or empty (a bye).
  // `from` is the game that filled the slot.
  type Slot = { teamId: string | null; bye: boolean; from: string | null };
  let slots: Slot[] = seedSlotOrder(size).map((seed) =>
    entrants
      ? { teamId: entrants[seed - 1] ?? null, bye: seed > entrants.length, from: null }
      : { teamId: null, bye: false, from: null },
  );
  const rounds: RoundResult[] = [];
  let settled = entrants !== null;

  for (let round = 1; round <= roundCount; round++) {
    const weeks = stage.roundWeeks[round - 1] ?? [];
    if (stage.reseed && slots.every((slot) => slot.bye || slot.teamId !== null)) {
      const alive = slots
        .filter((slot) => !slot.bye)
        .sort((a, b) => seedOf(a.teamId) - seedOf(b.teamId));
      const reordered = seedSlotOrder(slots.length).map(
        (seed) => alive[seed - 1] ?? { teamId: null, bye: true, from: null },
      );
      slots = reordered;
    }
    const games: GameResult[] = [];
    const next: Slot[] = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i]!;
      const b = slots[i + 1]!;
      if (a.bye || b.bye) {
        next.push(a.bye ? b : a);
        continue;
      }
      const better = seedOf(a.teamId) <= seedOf(b.teamId) ? a.teamId : b.teamId;
      const bonus: [number, number] = [
        bonusFor(ctx, stage.bonus, a.teamId, a.teamId ? seeds[a.teamId] : undefined, round),
        bonusFor(ctx, stage.bonus, b.teamId, b.teamId ? seeds[b.teamId] : undefined, round),
      ];
      // A tie goes to the better seed - so in a toilet bowl, the worse seed
      // moves on.
      const game = playGame(
        ctx.input,
        `${stage.id}r${round}g${games.length + 1}`,
        weeks,
        [a.teamId, b.teamId],
        bonus,
        better,
      );
      game.from = [a.from, b.from];
      games.push(game);
      if (!game.final) {
        settled = false;
        next.push({ teamId: null, bye: false, from: game.id });
        continue;
      }
      const winnerId = game.winnerId!;
      const loserId = winnerId === a.teamId ? b.teamId! : a.teamId!;
      next.push({ teamId: stage.loserAdvances ? loserId : winnerId, bye: false, from: game.id });
    }
    rounds.push({ round, name: roundName(round, roundCount), weeks, games });
    slots = next;
  }

  const championId = settled ? (slots[0]?.teamId ?? null) : null;
  return {
    stageId: stage.id,
    entrants,
    advancers: championId ? [championId] : null,
    eliminated: championId && entrants ? entrants.filter((teamId) => teamId !== championId) : null,
    seeds,
    rounds,
  };
}

// ---------------------------------------------------------------- double elimination

// Best seed vs worst among `teams`; in an odd field the best seed sits out.
function pairBestWorst(teams: string[], seedOf: (teamId: string) => number) {
  const sorted = [...teams].sort((a, b) => seedOf(a) - seedOf(b));
  const byes = sorted.length % 2 === 1 ? [sorted.shift()!] : [];
  const pairs: [string, string][] = [];
  while (sorted.length >= 2) pairs.push([sorted.shift()!, sorted.pop()!]);
  return { pairs, byes };
}

function evaluateDoubleElim(ctx: Ctx, stage: DoubleElimStage): StageResult {
  const entrants = resolveEntrants(ctx, stage.entrants, true);
  const seeds = Object.fromEntries((entrants ?? []).map((teamId, i) => [teamId, i + 1]));
  if (!entrants) return unsettled(stage.id, seeds);
  const seedOf = (teamId: string) => seeds[teamId] ?? Infinity;
  const better = (a: string, b: string) => (seedOf(a) <= seedOf(b) ? a : b);
  const bonus = (teamId: string) => bonusFor(ctx, stage.bonus, teamId, seedOf(teamId), 1);

  let unbeaten = [...entrants];
  let onceBeaten: string[] = [];
  const weeks: DoubleElimWeek[] = [];
  // Every week so far decided - later weeks' pairings depend on it.
  let decided = true;

  for (const week of stage.weeks) {
    const side = (teams: string[], tag: string) => {
      const { pairs, byes } = pairBestWorst(teams, seedOf);
      const games = pairs.map(([a, b], i) =>
        playGame(ctx.input, `${stage.id}${tag}w${week}g${i + 1}`, [week], [a, b], [
          bonus(a),
          bonus(b),
        ], better(a, b)),
      );
      return { games, byes };
    };
    const winners = side(unbeaten, "W");
    const losers = side(onceBeaten, "L");
    weeks.push({
      week,
      winners: winners.games,
      losers: losers.games,
      byes: { winners: winners.byes, losers: losers.byes },
    });
    if ([...winners.games, ...losers.games].some((game) => !game.final)) {
      decided = false;
      break;
    }
    const loserOf = (game: GameResult) =>
      game.winnerId === game.teamIds[0] ? game.teamIds[1]! : game.teamIds[0]!;
    const dropped = winners.games.map(loserOf);
    unbeaten = [...winners.byes, ...winners.games.map((game) => game.winnerId!)];
    onceBeaten = [...losers.byes, ...losers.games.map((game) => game.winnerId!), ...dropped];
  }

  let rumble: DoubleElimResult["rumble"] = null;
  let final: GameResult | null = null;
  let championId: string | null = null;
  if (decided) {
    const field = [...unbeaten, ...onceBeaten];
    const week = stage.rumbleWeek;
    const pointsOf = (teamId: string) => {
      const points = pointsIn(ctx.input, teamId, week);
      return points === undefined ? null : points + bonus(teamId);
    };
    const entries = field
      .map((teamId) => ({ teamId, points: pointsOf(teamId) }))
      .sort(
        (a, b) => (b.points ?? -1) - (a.points ?? -1) || seedOf(a.teamId) - seedOf(b.teamId),
      );
    const rumbleFinal =
      week <= ctx.input.finalThroughWeek && entries.every((entry) => entry.points !== null);
    const winnerId = rumbleFinal ? (entries[0]?.teamId ?? null) : null;
    rumble = { week, entries, winnerId, final: rumbleFinal };
    if (winnerId !== null) {
      if (unbeaten.includes(winnerId)) {
        championId = winnerId;
      } else {
        const unbeatenBest = [...unbeaten].sort((a, b) => seedOf(a) - seedOf(b))[0] ?? null;
        if (unbeatenBest !== null) {
          final = playGame(
            ctx.input,
            `${stage.id}final`,
            [stage.finalWeek],
            [unbeatenBest, winnerId],
            [bonus(unbeatenBest), bonus(winnerId)],
            better(unbeatenBest, winnerId),
          );
          championId = final.winnerId;
        } else {
          championId = winnerId;
        }
      }
    }
  }

  return {
    stageId: stage.id,
    entrants,
    advancers: championId ? [championId] : null,
    eliminated: championId ? entrants.filter((teamId) => teamId !== championId) : null,
    seeds,
    doubleElim: { weeks, unbeaten, onceBeaten, rumble, final },
  };
}

// ---------------------------------------------------------------- points

function evaluatePoints(ctx: Ctx, stage: PointsStage): StageResult {
  const entrants = resolveEntrants(ctx, stage.entrants, true);
  const seeds = Object.fromEntries((entrants ?? []).map((teamId, i) => [teamId, i + 1]));
  if (!entrants) return unsettled(stage.id, seeds);
  const table = entrants
    .map((teamId) => ({
      teamId,
      points: sum(
        stage.weeks.map((week) => {
          const points = pointsIn(ctx.input, teamId, week);
          if (points === undefined) return 0;
          return points + bonusFor(ctx, stage.bonus, teamId, seeds[teamId], 1);
        }),
      ),
    }))
    .sort((a, b) => b.points - a.points || seeds[a.teamId]! - seeds[b.teamId]!);
  const settled = stage.weeks.every((week) => week <= ctx.input.finalThroughWeek);
  const advancers = settled ? table.slice(0, stage.advance).map((row) => row.teamId) : null;
  return {
    stageId: stage.id,
    entrants,
    advancers,
    eliminated: advancers && entrants.filter((teamId) => !advancers.includes(teamId)),
    seeds,
    table,
  };
}

// ---------------------------------------------------------------- entry

export function evaluate(format: PlayoffFormat, input: SeasonInput): PlayoffState {
  const { standings, seedOf, tierOf, regularSeasonFinal } = regularSeason(format, input);
  const ctx: Ctx = { format, input, standings, seedOf, tierOf, regularSeasonFinal, stages: {} };
  for (const stage of format.stages) ctx.stages[stage.id] = evaluateStage(ctx, stage);
  const championId = ctx.stages[format.championshipStageId]?.advancers?.[0] ?? null;
  return { standings, regularSeasonFinal, stages: ctx.stages, championId };
}

function evaluateStage(ctx: Ctx, stage: Stage): StageResult {
  switch (stage.kind) {
    case "groups":
      return evaluateGroups(ctx, stage);
    case "bracket":
      return evaluateBracket(ctx, stage);
    case "points":
      return evaluatePoints(ctx, stage);
    case "doubleElim":
      return evaluateDoubleElim(ctx, stage);
  }
}
