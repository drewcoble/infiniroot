import type { Id } from "../../_generated/dataModel";

// Provider-neutral playoff tournaments. A league can run more than one at
// once - today just the championship bracket; a losers' "toilet bowl" is
// meant to slot in later as another kind, built by this same code from the
// provider's losers bracket.
export type TournamentKind = "championship";

export interface TournamentEntrant {
  // Null until the provider (or a decided earlier game) says who's here.
  teamId: Id<"seasonTeams"> | null;
  seed: number | null;
  // Points over the round's weeks - null before the round starts.
  points: number | null;
  // The earlier game this spot is fed by. Null for a team that starts in
  // this round (round 1, or a bye).
  fromGameId: string | null;
}

export interface TournamentGame {
  id: string;
  entrants: [TournamentEntrant, TournamentEntrant];
  winnerTeamId: Id<"seasonTeams"> | null;
}

export interface TournamentRound {
  round: number;
  // "Final", "Semifinals", "Quarterfinals", else "Round N".
  name: string;
  weeks: number[];
  games: TournamentGame[];
}

export interface Tournament {
  kind: TournamentKind;
  name: string;
  rounds: TournamentRound[];
  championTeamId: Id<"seasonTeams"> | null;
}

// One bracket game as the provider knows it - team ids are the provider's
// own, resolved to seasonTeams ids per call (the same cached-native-form
// split as schedule.ts), so a cache never holds stale ids.
export interface ProviderBracketGame {
  id: string;
  round: number;
  teams: [string | null, string | null];
  points: [number | null, number | null];
  winner: string | null;
  // The game each spot is fed by, when the provider says (Sleeper's
  // t1_from/t2_from) - otherwise worked out in buildTournament.
  from?: [string | null, string | null];
}

export interface ProviderBracket {
  // Weeks each round is played over, round 1 first - every round, including
  // ones the provider hasn't filled in yet.
  roundWeeks: number[][];
  // Title-path games only - placement games (3rd, 5th) are left out.
  games: ProviderBracketGame[];
  // Provider team id -> playoff seed, where the provider has seeds.
  seeds: Record<string, number>;
}

function roundName(round: number, roundCount: number): string {
  const fromEnd = roundCount - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

// A bracket's rounds and games in seasonTeams ids. Rounds the provider
// hasn't filled in yet get TBD games - one per pair of games in the round
// before. Each spot's feeder game comes from the provider when it says,
// else from which earlier game its team played in, else the earlier
// round's unclaimed games in order (Sleeper and ESPN both list a round's
// games in bracket order). A TBD spot whose feeder is decided takes that
// game's winner. An empty bracket (playoffs not set yet) has no rounds.
export function buildTournament(
  kind: TournamentKind,
  name: string,
  bracket: ProviderBracket,
  teamIdByProviderId: Map<string, Id<"seasonTeams">>,
  currentWeek: number,
): Tournament {
  if (bracket.games.length === 0) return { kind, name, rounds: [], championTeamId: null };

  const resolve = (providerId: string | null) =>
    providerId === null ? null : (teamIdByProviderId.get(providerId) ?? null);
  const roundCount = bracket.roundWeeks.length;
  const rounds: TournamentRound[] = [];
  const winnerByGameId = new Map<string, Id<"seasonTeams"> | null>();

  for (let round = 1; round <= roundCount; round++) {
    const weeks = bracket.roundWeeks[round - 1] ?? [];
    const started = weeks.length > 0 && weeks[0]! <= currentWeek;
    const previous = rounds[round - 2];
    let providerGames = bracket.games.filter((game) => game.round === round);
    if (providerGames.length === 0 && previous) {
      providerGames = Array.from({ length: Math.ceil(previous.games.length / 2) }, (_, i) => ({
        id: `r${round}g${i + 1}`,
        round,
        teams: [null, null],
        points: [null, null],
        winner: null,
      }));
    }

    const games: TournamentGame[] = providerGames.map((game) => {
      const entrants = game.teams.map((providerId, slot) => {
        const points = game.points[slot] ?? null;
        return {
          teamId: resolve(providerId),
          seed: providerId !== null ? (bracket.seeds[providerId] ?? null) : null,
          points: started ? points : null,
          fromGameId: game.from?.[slot] ?? null,
        };
      }) as [TournamentEntrant, TournamentEntrant];
      return { id: game.id, entrants, winnerTeamId: resolve(game.winner) };
    });

    if (previous) {
      const claimed = new Set(games.flatMap((game) => game.entrants.map((e) => e.fromGameId)));
      for (const entrant of games.flatMap((game) => game.entrants)) {
        if (entrant.fromGameId !== null || entrant.teamId === null) continue;
        const played = previous.games.find(
          (game) =>
            !claimed.has(game.id) &&
            game.entrants.some((other) => other.teamId === entrant.teamId),
        );
        if (played) {
          entrant.fromGameId = played.id;
          claimed.add(played.id);
        }
      }
      const unclaimed = previous.games.filter((game) => !claimed.has(game.id));
      for (const entrant of games.flatMap((game) => game.entrants)) {
        if (entrant.fromGameId !== null || entrant.teamId !== null) continue;
        const feeder = unclaimed.shift();
        if (!feeder) break;
        entrant.fromGameId = feeder.id;
      }
      for (const entrant of games.flatMap((game) => game.entrants)) {
        if (entrant.teamId !== null || entrant.fromGameId === null) continue;
        entrant.teamId = winnerByGameId.get(entrant.fromGameId) ?? null;
      }
    }

    for (const game of games) winnerByGameId.set(game.id, game.winnerTeamId);
    rounds.push({ round, name: roundName(round, roundCount), weeks, games });
  }

  const final = rounds[rounds.length - 1]?.games[0];
  return { kind, name, rounds, championTeamId: final?.winnerTeamId ?? null };
}

// How many rounds a single-elimination bracket of `teamCount` needs, byes
// filling it out to a power of two.
export function bracketRoundCount(teamCount: number): number {
  return teamCount > 1 ? Math.ceil(Math.log2(teamCount)) : 0;
}

// Bracket slot order for a power-of-two bracket - 1 v 8, 4 v 5, 2 v 7,
// 3 v 6 for eight - so the top seeds can only meet in the final.
function seedSlotOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, next - seed]);
  }
  return order;
}

// A standard single-elimination bracket (no reseeding) from teams in seed
// order, top seeds getting the byes - for a bracket the provider hasn't
// set yet, seeded from current or projected standings.
export function seededBracket(seedOrder: string[], roundWeeks: number[][]): ProviderBracket {
  const roundCount = roundWeeks.length;
  const teamCount = Math.min(seedOrder.length, 2 ** roundCount);
  const games: ProviderBracketGame[] = [];
  // Each slot is a team (a bye) or the game it's fed by.
  let slots: { team: string | null; from: string | null }[] = seedSlotOrder(2 ** roundCount).map(
    (seed) => ({ team: seed <= teamCount ? seedOrder[seed - 1]! : null, from: null }),
  );
  for (let round = 1; round <= roundCount; round++) {
    const next: typeof slots = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i]!;
      const b = slots[i + 1]!;
      // Round 1 against an empty slot is a bye straight to round 2.
      if (round === 1 && (a.team === null || b.team === null)) {
        next.push({ team: a.team ?? b.team, from: null });
        continue;
      }
      const id = `r${round}g${games.filter((game) => game.round === round).length + 1}`;
      games.push({
        id,
        round,
        teams: [a.team, b.team],
        points: [null, null],
        winner: null,
        from: [a.from, b.from],
      });
      next.push({ team: null, from: id });
    }
    slots = next;
  }
  return {
    roundWeeks,
    games,
    seeds: Object.fromEntries(seedOrder.slice(0, teamCount).map((team, i) => [team, i + 1])),
  };
}
