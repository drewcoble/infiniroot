/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authPasswordReset from "../authPasswordReset.js";
import type * as crons from "../crons.js";
import type * as draftType from "../draftType.js";
import type * as draftValues from "../draftValues.js";
import type * as espn_client from "../espn/client.js";
import type * as espn_rankings from "../espn/rankings.js";
import type * as fantasyPros_client from "../fantasyPros/client.js";
import type * as fetchAllData from "../fetchAllData.js";
import type * as genericLeague from "../genericLeague.js";
import type * as http from "../http.js";
import type * as infinidraft_billing_actions from "../infinidraft/billing/actions.js";
import type * as infinidraft_billing_mutations from "../infinidraft/billing/mutations.js";
import type * as infinidraft_billing_pricing from "../infinidraft/billing/pricing.js";
import type * as infinidraft_billing_queries from "../infinidraft/billing/queries.js";
import type * as infinidraft_billing_stripeClient from "../infinidraft/billing/stripeClient.js";
import type * as infinidraft_billing_webhookHandler from "../infinidraft/billing/webhookHandler.js";
import type * as infinidraft_draft_board from "../infinidraft/draft/board.js";
import type * as infinidraft_draft_budgetAutoAdjust from "../infinidraft/draft/budgetAutoAdjust.js";
import type * as infinidraft_draft_consistency from "../infinidraft/draft/consistency.js";
import type * as infinidraft_draft_customPlayers from "../infinidraft/draft/customPlayers.js";
import type * as infinidraft_draft_draftOrder from "../infinidraft/draft/draftOrder.js";
import type * as infinidraft_draft_fetchHelpers from "../infinidraft/draft/fetchHelpers.js";
import type * as infinidraft_draft_history from "../infinidraft/draft/history.js";
import type * as infinidraft_draft_insights from "../infinidraft/draft/insights.js";
import type * as infinidraft_draft_keeperRules from "../infinidraft/draft/keeperRules.js";
import type * as infinidraft_draft_lifecycle from "../infinidraft/draft/lifecycle.js";
import type * as infinidraft_draft_lineupOptimizer from "../infinidraft/draft/lineupOptimizer.js";
import type * as infinidraft_draft_manualHistory from "../infinidraft/draft/manualHistory.js";
import type * as infinidraft_draft_nominationOrder from "../infinidraft/draft/nominationOrder.js";
import type * as infinidraft_draft_pickOrder from "../infinidraft/draft/pickOrder.js";
import type * as infinidraft_draft_pickSlots from "../infinidraft/draft/pickSlots.js";
import type * as infinidraft_draft_picks from "../infinidraft/draft/picks.js";
import type * as infinidraft_draft_plan from "../infinidraft/draft/plan.js";
import type * as infinidraft_draft_playerDetail from "../infinidraft/draft/playerDetail.js";
import type * as infinidraft_draft_reportCard from "../infinidraft/draft/reportCard.js";
import type * as infinidraft_draft_status from "../infinidraft/draft/status.js";
import type * as infinidraft_draft_tags from "../infinidraft/draft/tags.js";
import type * as infinidraft_draft_teams from "../infinidraft/draft/teams.js";
import type * as infinidraft_draft_tiers from "../infinidraft/draft/tiers.js";
import type * as infinidraft_gemini_client from "../infinidraft/gemini/client.js";
import type * as infinidraft_gemini_preDraftInsights from "../infinidraft/gemini/preDraftInsights.js";
import type * as infinidraft_gemini_reportSummary from "../infinidraft/gemini/reportSummary.js";
import type * as infinidraft_yahoo_client from "../infinidraft/yahoo/client.js";
import type * as infinidraft_yahoo_league from "../infinidraft/yahoo/league.js";
import type * as infinidraft_yahoo_leagueSettingsMapping from "../infinidraft/yahoo/leagueSettingsMapping.js";
import type * as infinidraft_yahoo_oauth from "../infinidraft/yahoo/oauth.js";
import type * as infinileague_season_faabValues from "../infinileague/season/faabValues.js";
import type * as infinileague_season_powerRankings from "../infinileague/season/powerRankings.js";
import type * as infinileague_season_rosterPlayers from "../infinileague/season/rosterPlayers.js";
import type * as infinileague_season_standings from "../infinileague/season/standings.js";
import type * as infinileague_season_teamRoster from "../infinileague/season/teamRoster.js";
import type * as infinileague_season_teams from "../infinileague/season/teams.js";
import type * as injuries from "../injuries.js";
import type * as injurySnapshots from "../injurySnapshots.js";
import type * as leagues from "../leagues.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_dataFetch from "../lib/dataFetch.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_entitlements from "../lib/entitlements.js";
import type * as lib_faab from "../lib/faab.js";
import type * as lib_playerValue from "../lib/playerValue.js";
import type * as lib_rosterSlots from "../lib/rosterSlots.js";
import type * as lib_seasonTeams from "../lib/seasonTeams.js";
import type * as nflSchedule from "../nflSchedule.js";
import type * as nflState from "../nflState.js";
import type * as playerNameMatch from "../playerNameMatch.js";
import type * as playerPoints from "../playerPoints.js";
import type * as players from "../players.js";
import type * as positions from "../positions.js";
import type * as projectionBlending from "../projectionBlending.js";
import type * as projections from "../projections.js";
import type * as providerProjections from "../providerProjections.js";
import type * as rankings from "../rankings.js";
import type * as rosVor from "../rosVor.js";
import type * as rosterSync from "../rosterSync.js";
import type * as scoring from "../scoring.js";
import type * as seasonTeams from "../seasonTeams.js";
import type * as sleeper_client from "../sleeper/client.js";
import type * as sleeper_draftSync from "../sleeper/draftSync.js";
import type * as sleeper_league from "../sleeper/league.js";
import type * as sleeper_leagueSettingsMapping from "../sleeper/leagueSettingsMapping.js";
import type * as sleeper_playerLinks from "../sleeper/playerLinks.js";
import type * as sleeper_playerPoints from "../sleeper/playerPoints.js";
import type * as sleeper_projections from "../sleeper/projections.js";
import type * as sleeper_state from "../sleeper/state.js";
import type * as standardValues from "../standardValues.js";
import type * as users from "../users.js";
import type * as valueGaps from "../valueGaps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authPasswordReset: typeof authPasswordReset;
  crons: typeof crons;
  draftType: typeof draftType;
  draftValues: typeof draftValues;
  "espn/client": typeof espn_client;
  "espn/rankings": typeof espn_rankings;
  "fantasyPros/client": typeof fantasyPros_client;
  fetchAllData: typeof fetchAllData;
  genericLeague: typeof genericLeague;
  http: typeof http;
  "infinidraft/billing/actions": typeof infinidraft_billing_actions;
  "infinidraft/billing/mutations": typeof infinidraft_billing_mutations;
  "infinidraft/billing/pricing": typeof infinidraft_billing_pricing;
  "infinidraft/billing/queries": typeof infinidraft_billing_queries;
  "infinidraft/billing/stripeClient": typeof infinidraft_billing_stripeClient;
  "infinidraft/billing/webhookHandler": typeof infinidraft_billing_webhookHandler;
  "infinidraft/draft/board": typeof infinidraft_draft_board;
  "infinidraft/draft/budgetAutoAdjust": typeof infinidraft_draft_budgetAutoAdjust;
  "infinidraft/draft/consistency": typeof infinidraft_draft_consistency;
  "infinidraft/draft/customPlayers": typeof infinidraft_draft_customPlayers;
  "infinidraft/draft/draftOrder": typeof infinidraft_draft_draftOrder;
  "infinidraft/draft/fetchHelpers": typeof infinidraft_draft_fetchHelpers;
  "infinidraft/draft/history": typeof infinidraft_draft_history;
  "infinidraft/draft/insights": typeof infinidraft_draft_insights;
  "infinidraft/draft/keeperRules": typeof infinidraft_draft_keeperRules;
  "infinidraft/draft/lifecycle": typeof infinidraft_draft_lifecycle;
  "infinidraft/draft/lineupOptimizer": typeof infinidraft_draft_lineupOptimizer;
  "infinidraft/draft/manualHistory": typeof infinidraft_draft_manualHistory;
  "infinidraft/draft/nominationOrder": typeof infinidraft_draft_nominationOrder;
  "infinidraft/draft/pickOrder": typeof infinidraft_draft_pickOrder;
  "infinidraft/draft/pickSlots": typeof infinidraft_draft_pickSlots;
  "infinidraft/draft/picks": typeof infinidraft_draft_picks;
  "infinidraft/draft/plan": typeof infinidraft_draft_plan;
  "infinidraft/draft/playerDetail": typeof infinidraft_draft_playerDetail;
  "infinidraft/draft/reportCard": typeof infinidraft_draft_reportCard;
  "infinidraft/draft/status": typeof infinidraft_draft_status;
  "infinidraft/draft/tags": typeof infinidraft_draft_tags;
  "infinidraft/draft/teams": typeof infinidraft_draft_teams;
  "infinidraft/draft/tiers": typeof infinidraft_draft_tiers;
  "infinidraft/gemini/client": typeof infinidraft_gemini_client;
  "infinidraft/gemini/preDraftInsights": typeof infinidraft_gemini_preDraftInsights;
  "infinidraft/gemini/reportSummary": typeof infinidraft_gemini_reportSummary;
  "infinidraft/yahoo/client": typeof infinidraft_yahoo_client;
  "infinidraft/yahoo/league": typeof infinidraft_yahoo_league;
  "infinidraft/yahoo/leagueSettingsMapping": typeof infinidraft_yahoo_leagueSettingsMapping;
  "infinidraft/yahoo/oauth": typeof infinidraft_yahoo_oauth;
  "infinileague/season/faabValues": typeof infinileague_season_faabValues;
  "infinileague/season/powerRankings": typeof infinileague_season_powerRankings;
  "infinileague/season/rosterPlayers": typeof infinileague_season_rosterPlayers;
  "infinileague/season/standings": typeof infinileague_season_standings;
  "infinileague/season/teamRoster": typeof infinileague_season_teamRoster;
  "infinileague/season/teams": typeof infinileague_season_teams;
  injuries: typeof injuries;
  injurySnapshots: typeof injurySnapshots;
  leagues: typeof leagues;
  "lib/access": typeof lib_access;
  "lib/dataFetch": typeof lib_dataFetch;
  "lib/email": typeof lib_email;
  "lib/entitlements": typeof lib_entitlements;
  "lib/faab": typeof lib_faab;
  "lib/playerValue": typeof lib_playerValue;
  "lib/rosterSlots": typeof lib_rosterSlots;
  "lib/seasonTeams": typeof lib_seasonTeams;
  nflSchedule: typeof nflSchedule;
  nflState: typeof nflState;
  playerNameMatch: typeof playerNameMatch;
  playerPoints: typeof playerPoints;
  players: typeof players;
  positions: typeof positions;
  projectionBlending: typeof projectionBlending;
  projections: typeof projections;
  providerProjections: typeof providerProjections;
  rankings: typeof rankings;
  rosVor: typeof rosVor;
  rosterSync: typeof rosterSync;
  scoring: typeof scoring;
  seasonTeams: typeof seasonTeams;
  "sleeper/client": typeof sleeper_client;
  "sleeper/draftSync": typeof sleeper_draftSync;
  "sleeper/league": typeof sleeper_league;
  "sleeper/leagueSettingsMapping": typeof sleeper_leagueSettingsMapping;
  "sleeper/playerLinks": typeof sleeper_playerLinks;
  "sleeper/playerPoints": typeof sleeper_playerPoints;
  "sleeper/projections": typeof sleeper_projections;
  "sleeper/state": typeof sleeper_state;
  standardValues: typeof standardValues;
  users: typeof users;
  valueGaps: typeof valueGaps;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
