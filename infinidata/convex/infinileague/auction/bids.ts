import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireSeasonParticipant, requireTeamAccess } from "../../lib/access";
import type { CycleType } from "./eligibility";
import { listOpenCyclesForSeason, resolveOpenCycleForFpid } from "./cycleScope";
import { getPlayerDisplayInfoByFpid, type PlayerDisplayInfo } from "./players";
import { POSITIONS } from "../../positions";

const DEFAULT_MIN_INCREMENT = 1;
const DEFAULT_STARTING_BID = 1;
const DEFAULT_ANTI_SNIPE_MINUTES = 5;
const MS_PER_MINUTE = 60 * 1000;

// The eBay-style proxy bidding engine - see AUCTION_PLAN's "Bidding engine"
// section for the full design. Every check here is a hard rejection, not a
// warning: raise-only per team/player, a hard FAAB cap across every player
// a team is CURRENTLY WINNING across EVERY currently-open cycle this season
// (a bid it's been outbid on doesn't lock up that money - see the cap check
// below for why that's safe), and waiver eligibility re-checked at bid time
// (not just "not currently rostered").
export const placeBid = mutation({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.id("seasonTeams"),
    fpid: v.number(),
    maxBid: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const { season } = await requireTeamAccess(ctx, args.seasonId, args.teamId);
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }

    // >= 0, not > 0 - a league can configure startingBid as $0 (a free
    // waiver claim), and the requiredMin check below already enforces the
    // real per-context floor (startingBid for a player's first bid,
    // currentPrice + minIncrement after that) - this is only a sanity check
    // that the amount is a real whole dollar figure at all, not itself the
    // source of truth for what's actually biddable right now.
    if (!Number.isInteger(args.maxBid) || args.maxBid < 0) {
      throw new Error("Bid must be a whole dollar amount, $0 or more.");
    }

    const now = Date.now();
    // Resolves which of the season's potentially-several open cycles (the
    // weekly one, or this fpid's own dedicated playerDrop/manual cycle)
    // this bid actually belongs to - see cycleScope.ts's own comment. Null
    // covers both "no open cycle at all" and "not currently eligible",
    // which under this model are really the same question.
    const cycle = await resolveOpenCycleForFpid(ctx, season, args.fpid);
    if (!cycle) {
      throw new Error("This player isn't currently up for bid.");
    }
    if (cycle.closesAt <= now) {
      throw new Error("This auction cycle has already closed.");
    }

    const settings = await ctx.db
      .query("faAuctionSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    const minIncrement = settings?.minIncrement ?? DEFAULT_MIN_INCREMENT;
    const startingBid = settings?.startingBid ?? DEFAULT_STARTING_BID;
    const antiSnipeMinutes = settings?.antiSnipeMinutes ?? DEFAULT_ANTI_SNIPE_MINUTES;
    const tieBreakMode = settings?.tieBreakMode ?? "earliest";

    const existingBid = await ctx.db
      .query("faAuctionBids")
      .withIndex("by_cycle_fpid_team", (q) =>
        q.eq("cycleId", cycle._id).eq("fpid", args.fpid).eq("teamId", args.teamId),
      )
      .unique();
    if (existingBid && args.maxBid <= existingBid.maxBid) {
      throw new Error(
        `Your bid must be higher than your current max ($${existingBid.maxBid}).`,
      );
    }

    const state = await ctx.db
      .query("faAuctionState")
      .withIndex("by_cycle_fpid", (q) =>
        q.eq("cycleId", cycle._id).eq("fpid", args.fpid),
      )
      .unique();

    // The current leader may freely raise their own max with no extra
    // floor; anyone else's bid (new or a re-raise after being outbid) must
    // clear the visible price by at least minIncrement.
    const alreadyLeading = state?.leadingTeamId === args.teamId;
    if (!alreadyLeading) {
      const requiredMin = state ? state.currentPrice + minIncrement : startingBid;
      if (args.maxBid < requiredMin) {
        throw new Error(`Your bid must be at least $${requiredMin}.`);
      }
    }

    if (existingBid) {
      await ctx.db.patch(existingBid._id, { maxBid: args.maxBid, updatedAt: now });
    } else {
      await ctx.db.insert("faAuctionBids", {
        cycleId: cycle._id,
        seasonId: args.seasonId,
        fpid: args.fpid,
        teamId: args.teamId,
        bidderUserId: userId,
        maxBid: args.maxBid,
        createdAt: now,
        updatedAt: now,
      });
    }

    const allBids = await ctx.db
      .query("faAuctionBids")
      .withIndex("by_cycle_fpid", (q) =>
        q.eq("cycleId", cycle._id).eq("fpid", args.fpid),
      )
      .collect();

    const sorted = [...allBids];
    if (tieBreakMode === "waiverOrder") {
      const teams = await ctx.db
        .query("seasonTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .collect();
      const waiverPositionByTeam = new Map(
        teams.map((t) => [t._id, t.waiverPosition]),
      );
      sorted.sort((a, b) => {
        if (b.maxBid !== a.maxBid) return b.maxBid - a.maxBid;
        const posA = waiverPositionByTeam.get(a.teamId);
        const posB = waiverPositionByTeam.get(b.teamId);
        // Falls back to earliest-bid if either team has no synced waiver
        // position (only meaningful for a priority-waiver league - see
        // schema.ts's seasonTeams.waiverPosition comment) - keeps a tie
        // resolvable rather than silently unordered.
        if (posA !== undefined && posB !== undefined && posA !== posB) {
          return posA - posB;
        }
        return a.createdAt - b.createdAt;
      });
    } else {
      sorted.sort((a, b) =>
        b.maxBid !== a.maxBid ? b.maxBid - a.maxBid : a.createdAt - b.createdAt,
      );
    }

    const leader = sorted[0];
    if (!leader) {
      throw new Error("Bid recorded but no bids found - this should never happen.");
    }
    const second = sorted[1];
    const newCurrentPrice = second
      ? Math.min(leader.maxBid, second.maxBid + minIncrement)
      : startingBid;

    if (state) {
      await ctx.db.patch(state._id, {
        currentPrice: newCurrentPrice,
        leadingTeamId: leader.teamId,
        bidCount: sorted.length,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("faAuctionState", {
        cycleId: cycle._id,
        seasonId: args.seasonId,
        fpid: args.fpid,
        currentPrice: newCurrentPrice,
        leadingTeamId: leader.teamId,
        bidCount: sorted.length,
        updatedAt: now,
      });
    }

    // Hard FAAB cap: sum of this team's max bids across only the players
    // it's CURRENTLY WINNING, across EVERY currently-open cycle this season
    // (not just this one) - must never exceed remaining FAAB. Several
    // cycles (the weekly one plus any number of playerDrop/manual ones) can
    // be open at once now, and a team can hold winning bids in more than
    // one simultaneously, so the cap has to look across all of them or a
    // team could pass this check independently in each and collectively
    // over-commit. A bid the team has been outbid on doesn't lock up that
    // money, since a losing bid can never spontaneously become winning
    // without the team actively raising it (raise-only), and any such raise
    // re-runs this exact check with fresh data at that time. A bid whose own
    // cycle has already closed doesn't count either - that cycle's outcome
    // is already reflected in team.faabSpent. Since actual price paid is
        // always <= a winner's own max (second-price rule), summing max bids
    // (not resolved prices) is still a safe, conservative bound.
    const teamBids = await ctx.db
      .query("faAuctionBids")
      .withIndex("by_season_team", (q) =>
        q.eq("seasonId", args.seasonId).eq("teamId", args.teamId),
      )
      .collect();
    let committedTotal = 0;
    for (const bid of teamBids) {
      const bidCycle = bid.cycleId === cycle._id ? cycle : await ctx.db.get(bid.cycleId);
      if (!bidCycle || bidCycle.status !== "open") continue;
      const otherState = await ctx.db
        .query("faAuctionState")
        .withIndex("by_cycle_fpid", (q) =>
          q.eq("cycleId", bid.cycleId).eq("fpid", bid.fpid),
        )
        .unique();
      if (otherState?.leadingTeamId === args.teamId) {
        committedTotal += bid.maxBid;
      }
    }
    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new Error("Team not found.");
    }
    const remainingFaab =
      (team.faabBudgetOverride ?? season.faabBudget ?? 0) - (team.faabSpent ?? 0);
    if (committedTotal > remainingFaab) {
      throw new Error(
        `Winning this bid would commit $${committedTotal} total across your winning bids - more than your $${remainingFaab} remaining FAAB.`,
      );
    }

    // Anti-snipe: a bid inside the window extends the close and reschedules
    // the exact close job - the standard "soft close" pattern silent
    // auctions use to stop last-second sniping. Applies the same way
    // regardless of cycle type.
    const msRemaining = cycle.closesAt - now;
    if (msRemaining < antiSnipeMinutes * MS_PER_MINUTE) {
      const newClosesAt = now + antiSnipeMinutes * MS_PER_MINUTE;
      if (cycle.closeJobId) {
        await ctx.scheduler.cancel(cycle.closeJobId);
      }
      const newJobId = await ctx.scheduler.runAt(
        newClosesAt,
        internal.infinileague.auction.cycles.closeCycle,
        { cycleId: cycle._id },
      );
      await ctx.db.patch(cycle._id, { closesAt: newClosesAt, closeJobId: newJobId });
    }
  },
});

export interface AuctionBoardRow {
  fpid: number;
  cycleId: Id<"faAuctionCycles">;
  cycleType: CycleType;
  closesAt: number;
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
}

// The public board across every currently-open cycle - currentPrice/
// leadingTeamName only, never any team's real max (see faAuctionBids' own
// comment). Players with no bids yet simply have no row here; the Players
// tab merges this against its own waiver-eligible player list and falls
// back to the season's startingBid for anything absent.
export const getAuctionBoardState = query({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ openCycles: Doc<"faAuctionCycles">[]; rows: AuctionBoardRow[] }> => {
    await requireSeasonParticipant(ctx, args.seasonId);
    const openCycles = await listOpenCyclesForSeason(ctx, args.seasonId);
    if (openCycles.length === 0) return { openCycles: [], rows: [] };

    const stateRowsByCycle = await Promise.all(
      openCycles.map((cycle) =>
        ctx.db
          .query("faAuctionState")
          .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
          .collect(),
      ),
    );

    const allStateRows = stateRowsByCycle.flat();
    const teamIds = [
      ...new Set(
        allStateRows
          .map((s) => s.leadingTeamId)
          .filter((id): id is Id<"seasonTeams"> => id !== undefined),
      ),
    ];
    const teams = await Promise.all(teamIds.map((id) => ctx.db.get(id)));
    const teamNameById = new Map(
      teams
        .filter((t): t is Doc<"seasonTeams"> => t !== null)
        .map((t) => [t._id, t.name]),
    );

    const rows: AuctionBoardRow[] = openCycles.flatMap((cycle, index) =>
      stateRowsByCycle[index]!.map((s) => ({
        fpid: s.fpid,
        cycleId: cycle._id,
        cycleType: cycle.type ?? "weekly",
        closesAt: cycle.closesAt,
        currentPrice: s.currentPrice,
        leadingTeamName:
          s.leadingTeamId !== undefined ? teamNameById.get(s.leadingTeamId) ?? null : null,
        bidCount: s.bidCount,
      })),
    );

    return { openCycles, rows };
  },
});

export interface MyBidRow {
  fpid: number;
  cycleId: Id<"faAuctionCycles">;
  cycleType: CycleType;
  closesAt: number;
  teamId: Id<"seasonTeams">;
  teamName: string;
  maxBid: number;
}

// The signed-in user's own outstanding max bids, across every currently-open
// cycle - private to them (never another team's bid). Powers infinifaab's
// Players tab "Your max" line and the Bids tab's grouping across
// potentially-several concurrently-open cycles. Uses displayTeamIds (this
// user's own actual team), NOT teamIds (every team the commissioner can
// administratively bid as) - see requireSeasonParticipant's own comment for
// why conflating the two made every team's bid read as the commissioner's
// own.
export const getMyBids = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<MyBidRow[]> => {
    const { displayTeamIds: teamIds } = await requireSeasonParticipant(ctx, args.seasonId);
    const openCycles = await listOpenCyclesForSeason(ctx, args.seasonId);
    if (openCycles.length === 0) return [];

    const rows: MyBidRow[] = [];
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team) continue;
      for (const cycle of openCycles) {
        const bids = await ctx.db
          .query("faAuctionBids")
          .withIndex("by_cycle_team", (q) =>
            q.eq("cycleId", cycle._id).eq("teamId", teamId),
          )
          .collect();
        for (const bid of bids) {
          rows.push({
            fpid: bid.fpid,
            cycleId: cycle._id,
            cycleType: cycle.type ?? "weekly",
            closesAt: cycle.closesAt,
            teamId,
            teamName: team.name,
            maxBid: bid.maxBid,
          });
        }
      }
    }
    return rows;
  },
});

export interface AuctionDashboardRow {
  teamId: Id<"seasonTeams">;
  teamName: string;
  faabRemaining: number;
  activeWinningBids: number;
}

// infinifaab's Dashboard tab - exactly the three fields asked for: team
// name, FAAB remaining, and how many players this team is currently
// leading on, across every currently-open cycle. Sorted FAAB-remaining
// descending.
//
// faabRemaining is deliberately budget - spent ONLY, as of before any open
// cycle's bidding started - NOT further reduced by the team's own
// currently-committed open-cycle max bids (placeBid's internal FAAB-cap
// check does subtract those, but only when computing a team's own ceiling
// for its own next bid - never exposed to any other team). Originally this
// query subtracted committed bids here too, which leaked exactly what
// placeBid's privacy rule exists to prevent: seeing a team's FAAB drop from
// $100 to $70 after they place their only active bid tells you their max
// is $30. This dashboard must only ever show pre-window numbers - never
// anything that moves as bids come in.
export const getAuctionDashboard = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<AuctionDashboardRow[]> => {
    const { season } = await requireSeasonParticipant(ctx, args.seasonId);
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .collect();

    const openCycles = await listOpenCyclesForSeason(ctx, args.seasonId);

    const winningCountByTeam = new Map<Id<"seasonTeams">, number>();
    for (const cycle of openCycles) {
      const stateRows = await ctx.db
        .query("faAuctionState")
        .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
        .collect();
      for (const state of stateRows) {
        if (state.leadingTeamId === undefined) continue;
        winningCountByTeam.set(
          state.leadingTeamId,
          (winningCountByTeam.get(state.leadingTeamId) ?? 0) + 1,
        );
      }
    }

    const rows: AuctionDashboardRow[] = teams.map((team) => ({
      teamId: team._id,
      teamName: team.name,
      faabRemaining: (team.faabBudgetOverride ?? season.faabBudget ?? 0) - (team.faabSpent ?? 0),
      activeWinningBids: winningCountByTeam.get(team._id) ?? 0,
    }));

    rows.sort((a, b) => b.faabRemaining - a.faabRemaining);
    return rows;
  },
});

// Extends PlayerDisplayInfo (+ rosteredByTeamName) so this satisfies
// @shared/PlayerCard's PlayerCardRow directly - the Bids tab renders the
// same PlayerCard the Players tab does.
export interface BidBoardRow extends PlayerDisplayInfo {
  fpid: number;
  cycleId: Id<"faAuctionCycles">;
  cycleType: CycleType;
  closesAt: number;
  rosteredByTeamName: null;
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
  // Only populated for a player one of the caller's own teams has bid on -
  // never another team's max (same privacy rule as everywhere else in this
  // file). category is derived from these: "winning" if myMaxBid exists
  // and leadingTeamName is one of my teams, "outbid" if myMaxBid exists but
  // someone else leads, "other" if I haven't bid on this player at all.
  myMaxBid: number | null;
  myTeamName: string | null;
  category: "winning" | "outbid" | "other";
}

const CATEGORY_ORDER: Record<BidBoardRow["category"], number> = {
  winning: 0,
  outbid: 1,
  other: 2,
};

// Every player with at least one active bid across every currently-open
// cycle, across every team in the league - infinifaab's Bids tab. Grouped
// winning-mine-first, outbid-mine-second, everyone else's activity third;
// sorted within each group by current price descending, then by the same
// rest-of-season rank the Players tab uses (0/no-rank-data sentinel falls
// back to alphabetical - see players.ts's getWaiverEligiblePlayers for the
// identical fallback). Never exposes another team's real max - "other"
// rows only ever carry the same public currentPrice/leadingTeamName/
// bidCount getAuctionBoardState shows.
export const getBidsBoard = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<BidBoardRow[]> => {
    // displayTeamIds (this user's own actual team), NOT teamIds (every team
    // the commissioner can administratively bid as) - see
    // requireSeasonParticipant's own comment. Using the full admin list
    // here made every active bid read as "winning" for the commissioner,
    // since every team's leadingTeamId was trivially a member of that set.
    const { displayTeamIds: teamIds } = await requireSeasonParticipant(ctx, args.seasonId);
    const teamIdSet = new Set(teamIds);

    const openCycles = await listOpenCyclesForSeason(ctx, args.seasonId);
    if (openCycles.length === 0) return [];

    // (cycle, state) pairs, not a fpid-keyed flattening - a fpid can in
    // principle have a lingering state row in more than one currently-open
    // cycle at once (e.g. a stale weekly-cycle row from before it was
    // re-rostered-then-dropped into a fresh playerDrop cycle), so every
    // lookup below is keyed by `${cycleId}:${fpid}`, never fpid alone.
    const statePairsByCycle = await Promise.all(
      openCycles.map(async (cycle) => ({
        cycle,
        states: await ctx.db
          .query("faAuctionState")
          .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
          .collect(),
      })),
    );
    const statePairs = statePairsByCycle.flatMap(({ cycle, states }) =>
      states.map((state) => ({ cycle, state })),
    );
    if (statePairs.length === 0) return [];

    const key = (cycleId: Id<"faAuctionCycles">, fpid: number) => `${cycleId}:${fpid}`;

    const myBidByKey = new Map<string, { teamName: string; maxBid: number }>();
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team) continue;
      for (const cycle of openCycles) {
        const bids = await ctx.db
          .query("faAuctionBids")
          .withIndex("by_cycle_team", (q) =>
            q.eq("cycleId", cycle._id).eq("teamId", teamId),
          )
          .collect();
        for (const bid of bids) {
          myBidByKey.set(key(cycle._id, bid.fpid), { teamName: team.name, maxBid: bid.maxBid });
        }
      }
    }

    const leadingTeamIds = [
      ...new Set(
        statePairs
          .map(({ state }) => state.leadingTeamId)
          .filter((id): id is Id<"seasonTeams"> => id !== undefined),
      ),
    ];
    const leadingTeams = await Promise.all(leadingTeamIds.map((id) => ctx.db.get(id)));
    const teamNameById = new Map(
      leadingTeams
        .filter((t): t is Doc<"seasonTeams"> => t !== null)
        .map((t) => [t._id, t.name]),
    );

    const fpidSet = new Set(statePairs.map(({ state }) => state.fpid));
    const displayByFpid = await getPlayerDisplayInfoByFpid(ctx, args.seasonId, fpidSet);
    const hasRankData = [...displayByFpid.values()].some((d) => d.rosRank > 0);

    const rows: BidBoardRow[] = statePairs.map(({ cycle, state }) => {
      const display = displayByFpid.get(state.fpid);
      const mine = myBidByKey.get(key(cycle._id, state.fpid));
      const leadingTeamName =
        state.leadingTeamId !== undefined ? teamNameById.get(state.leadingTeamId) ?? null : null;
      const iAmLeading = state.leadingTeamId !== undefined && teamIdSet.has(state.leadingTeamId);
      const category: BidBoardRow["category"] = mine
        ? iAmLeading
          ? "winning"
          : "outbid"
        : "other";
      return {
        fpid: state.fpid,
        cycleId: cycle._id,
        cycleType: cycle.type ?? "weekly",
        closesAt: cycle.closesAt,
        // display should always be found - every fpid here came from a real
        // bid, which itself requires the player to already exist (see
        // eligibility.ts) - but this stays a safe fallback rather than a
        // non-null assertion.
        name: display?.name ?? `Player #${state.fpid}`,
        position: display?.position ?? POSITIONS[0],
        team: display?.team ?? null,
        rosRank: display?.rosRank ?? 0,
        positionRank: display?.positionRank ?? 0,
        rosPpg: display?.rosPpg ?? 0,
        actualPpg: display?.actualPpg ?? 0,
        rosteredByTeamName: null,
        ...(display?.injury ? { injury: display.injury } : {}),
        currentPrice: state.currentPrice,
        leadingTeamName,
        bidCount: state.bidCount,
        myMaxBid: mine?.maxBid ?? null,
        myTeamName: mine?.teamName ?? null,
        category,
      };
    });

    rows.sort((a, b) => {
      if (CATEGORY_ORDER[a.category] !== CATEGORY_ORDER[b.category]) {
        return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      }
      if (b.currentPrice !== a.currentPrice) return b.currentPrice - a.currentPrice;
      if (hasRankData) {
        const rankA = a.rosRank || Infinity;
        const rankB = b.rosRank || Infinity;
        if (rankA !== rankB) return rankA - rankB;
      }
      return a.name.localeCompare(b.name);
    });

    return rows;
  },
});
