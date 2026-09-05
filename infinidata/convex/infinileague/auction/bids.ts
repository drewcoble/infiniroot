import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireSeasonParticipant, requireTeamAccess } from "../../lib/access";
import { isFpidEligible } from "./eligibility";
import { getPlayerDisplayInfoByFpid, type PlayerDisplayInfo } from "./players";
import { POSITIONS } from "../../positions";

const DEFAULT_MIN_INCREMENT = 1;
const DEFAULT_STARTING_BID = 1;
const DEFAULT_ANTI_SNIPE_MINUTES = 5;
const MS_PER_MINUTE = 60 * 1000;

// The eBay-style proxy bidding engine - see AUCTION_PLAN's "Bidding engine"
// section for the full design. Every check here is a hard rejection, not a
// warning: raise-only per team/player, a hard FAAB cap across every player
// a team is CURRENTLY WINNING this cycle (a bid it's been outbid on doesn't
// lock up that money - see the cap check below for why that's safe), and
// waiver eligibility re-checked at bid time (not just "not currently
// rostered").
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
    const cycle = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
    if (!cycle) {
      throw new Error("There's no open auction right now.");
    }
    if (cycle.closesAt <= now) {
      throw new Error("This auction cycle has already closed.");
    }

    if (!(await isFpidEligible(ctx, season, args.fpid))) {
      throw new Error("This player isn't currently on waivers.");
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
    // it's CURRENTLY WINNING this cycle must never exceed remaining FAAB -
    // a bid the team has been outbid on doesn't lock up that money, since a
    // losing bid can never spontaneously become winning without the team
    // actively raising it (raise-only), and any such raise re-runs this
    // exact check with fresh data at that time. Checked after (not before)
    // this fpid's own leader is recomputed above, using that fresh result -
    // if the cap is blown, throwing here rolls back every write this
    // mutation has made so far (the bid upsert and state recompute
    // included), since Convex mutations are atomic transactions. Since
    // actual price paid is always <= a winner's own max (second-price
    // rule), summing max bids (not resolved prices) is still a safe,
    // conservative bound.
    const teamBids = await ctx.db
      .query("faAuctionBids")
      .withIndex("by_cycle_team", (q) =>
        q.eq("cycleId", cycle._id).eq("teamId", args.teamId),
      )
      .collect();
    let committedTotal = 0;
    for (const bid of teamBids) {
      if (bid.fpid === args.fpid) {
        // This fpid's leader was just recomputed above - use that fresh
        // result rather than re-querying the state row this same mutation
        // just wrote.
        if (leader.teamId === args.teamId) committedTotal += bid.maxBid;
        continue;
      }
      const otherState = await ctx.db
        .query("faAuctionState")
        .withIndex("by_cycle_fpid", (q) =>
          q.eq("cycleId", cycle._id).eq("fpid", bid.fpid),
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
    // auctions use to stop last-second sniping.
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
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
}

// The public board for the current open cycle - currentPrice/leadingTeamName
// only, never any team's real max (see faAuctionBids' own comment). Players
// with no bids yet simply have no row here; the Players tab (task 6)
// merges this against its own waiver-eligible player list and falls back
// to the season's startingBid for anything absent.
export const getAuctionBoardState = query({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ cycle: Doc<"faAuctionCycles"> | null; rows: AuctionBoardRow[] }> => {
    await requireSeasonParticipant(ctx, args.seasonId);
    const cycle = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
    if (!cycle) return { cycle: null, rows: [] };

    const stateRows = await ctx.db
      .query("faAuctionState")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
      .collect();

    const teamIds = [
      ...new Set(
        stateRows
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

    return {
      cycle,
      rows: stateRows.map((s) => ({
        fpid: s.fpid,
        currentPrice: s.currentPrice,
        leadingTeamName:
          s.leadingTeamId !== undefined ? teamNameById.get(s.leadingTeamId) ?? null : null,
        bidCount: s.bidCount,
      })),
    };
  },
});

export interface MyBidRow {
  fpid: number;
  teamId: Id<"seasonTeams">;
  teamName: string;
  maxBid: number;
}

// The signed-in user's own outstanding max bids, in the current open cycle
// - private to them (never another team's bid). Powers infinifaab's Players
// tab "Your max" line. Uses displayTeamIds (this user's own actual team),
// NOT teamIds (every team the commissioner can administratively bid as) -
// see requireSeasonParticipant's own comment for why conflating the two
// made every team's bid read as the commissioner's own.
export const getMyBids = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<MyBidRow[]> => {
    const { displayTeamIds: teamIds } = await requireSeasonParticipant(ctx, args.seasonId);
    const cycle = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
    if (!cycle) return [];

    const rows: MyBidRow[] = [];
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team) continue;
      const bids = await ctx.db
        .query("faAuctionBids")
        .withIndex("by_cycle_team", (q) =>
          q.eq("cycleId", cycle._id).eq("teamId", teamId),
        )
        .collect();
      for (const bid of bids) {
        rows.push({ fpid: bid.fpid, teamId, teamName: team.name, maxBid: bid.maxBid });
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
// leading on. Sorted FAAB-remaining descending.
//
// faabRemaining is deliberately budget - spent ONLY, as of before this
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

    const cycle = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();

    const winningCountByTeam = new Map<Id<"seasonTeams">, number>();
    if (cycle) {
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

// Every player with at least one active bid this cycle, across every team
// in the league - infinifaab's Bids tab. Grouped winning-mine-first,
// outbid-mine-second, everyone else's activity third; sorted within each
// group by current price descending, then by the same rest-of-season rank
// the Players tab uses (0/no-rank-data sentinel falls back to alphabetical
// - see players.ts's getWaiverEligiblePlayers for the identical fallback).
// Never exposes another team's real max - "other" rows only ever carry the
// same public currentPrice/leadingTeamName/bidCount getAuctionBoardState
// shows.
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

    const cycle = await ctx.db
      .query("faAuctionCycles")
      .withIndex("by_season_status", (q) =>
        q.eq("seasonId", args.seasonId).eq("status", "open"),
      )
      .first();
    if (!cycle) return [];

    const stateRows = await ctx.db
      .query("faAuctionState")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
      .collect();
    if (stateRows.length === 0) return [];

    const myBidByFpid = new Map<number, { teamName: string; maxBid: number }>();
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team) continue;
      const bids = await ctx.db
        .query("faAuctionBids")
        .withIndex("by_cycle_team", (q) =>
          q.eq("cycleId", cycle._id).eq("teamId", teamId),
        )
        .collect();
      for (const bid of bids) {
        myBidByFpid.set(bid.fpid, { teamName: team.name, maxBid: bid.maxBid });
      }
    }

    const leadingTeamIds = [
      ...new Set(
        stateRows
          .map((s) => s.leadingTeamId)
          .filter((id): id is Id<"seasonTeams"> => id !== undefined),
      ),
    ];
    const leadingTeams = await Promise.all(leadingTeamIds.map((id) => ctx.db.get(id)));
    const teamNameById = new Map(
      leadingTeams
        .filter((t): t is Doc<"seasonTeams"> => t !== null)
        .map((t) => [t._id, t.name]),
    );

    const fpidSet = new Set(stateRows.map((state) => state.fpid));
    const displayByFpid = await getPlayerDisplayInfoByFpid(ctx, args.seasonId, fpidSet);
    const hasRankData = [...displayByFpid.values()].some((d) => d.rosRank > 0);

    const rows: BidBoardRow[] = stateRows.map((state) => {
      const display = displayByFpid.get(state.fpid);
      const mine = myBidByFpid.get(state.fpid);
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
