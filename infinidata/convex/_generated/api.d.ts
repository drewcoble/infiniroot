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
import type * as billing_actions from "../billing/actions.js";
import type * as billing_entitlements from "../billing/entitlements.js";
import type * as billing_mutations from "../billing/mutations.js";
import type * as billing_pricing from "../billing/pricing.js";
import type * as billing_queries from "../billing/queries.js";
import type * as billing_stripeClient from "../billing/stripeClient.js";
import type * as billing_webhookHandler from "../billing/webhookHandler.js";
import type * as crons from "../crons.js";
import type * as draft_auth from "../draft/auth.js";
import type * as draft_board from "../draft/board.js";
import type * as draft_budgetAutoAdjust from "../draft/budgetAutoAdjust.js";
import type * as draft_consistency from "../draft/consistency.js";
import type * as draft_customPlayers from "../draft/customPlayers.js";
import type * as draft_draftOrder from "../draft/draftOrder.js";
import type * as draft_fetchHelpers from "../draft/fetchHelpers.js";
import type * as draft_history from "../draft/history.js";
import type * as draft_insights from "../draft/insights.js";
import type * as draft_keeperRules from "../draft/keeperRules.js";
import type * as draft_lifecycle from "../draft/lifecycle.js";
import type * as draft_lineupOptimizer from "../draft/lineupOptimizer.js";
import type * as draft_manualHistory from "../draft/manualHistory.js";
import type * as draft_nominationOrder from "../draft/nominationOrder.js";
import type * as draft_pickOrder from "../draft/pickOrder.js";
import type * as draft_pickSlots from "../draft/pickSlots.js";
import type * as draft_picks from "../draft/picks.js";
import type * as draft_plan from "../draft/plan.js";
import type * as draft_playerDetail from "../draft/playerDetail.js";
import type * as draft_reportCard from "../draft/reportCard.js";
import type * as draft_slots from "../draft/slots.js";
import type * as draft_status from "../draft/status.js";
import type * as draft_tags from "../draft/tags.js";
import type * as draft_teams from "../draft/teams.js";
import type * as draft_tiers from "../draft/tiers.js";
import type * as draftType from "../draftType.js";
import type * as draftValues from "../draftValues.js";
import type * as email_resendClient from "../email/resendClient.js";
import type * as espn_client from "../espn/client.js";
import type * as espn_rankings from "../espn/rankings.js";
import type * as fantasyPros_client from "../fantasyPros/client.js";
import type * as fetchAllData from "../fetchAllData.js";
import type * as gemini_client from "../gemini/client.js";
import type * as gemini_preDraftInsights from "../gemini/preDraftInsights.js";
import type * as gemini_reportSummary from "../gemini/reportSummary.js";
import type * as genericLeague from "../genericLeague.js";
import type * as http from "../http.js";
import type * as injuries from "../injuries.js";
import type * as injurySnapshots from "../injurySnapshots.js";
import type * as leagues from "../leagues.js";
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
import type * as scoring from "../scoring.js";
import type * as season_faabValues from "../season/faabValues.js";
import type * as season_rosterPlayers from "../season/rosterPlayers.js";
import type * as season_standings from "../season/standings.js";
import type * as season_teamRoster from "../season/teamRoster.js";
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
import type * as yahoo_client from "../yahoo/client.js";
import type * as yahoo_league from "../yahoo/league.js";
import type * as yahoo_leagueSettingsMapping from "../yahoo/leagueSettingsMapping.js";
import type * as yahoo_oauth from "../yahoo/oauth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authPasswordReset: typeof authPasswordReset;
  "billing/actions": typeof billing_actions;
  "billing/entitlements": typeof billing_entitlements;
  "billing/mutations": typeof billing_mutations;
  "billing/pricing": typeof billing_pricing;
  "billing/queries": typeof billing_queries;
  "billing/stripeClient": typeof billing_stripeClient;
  "billing/webhookHandler": typeof billing_webhookHandler;
  crons: typeof crons;
  "draft/auth": typeof draft_auth;
  "draft/board": typeof draft_board;
  "draft/budgetAutoAdjust": typeof draft_budgetAutoAdjust;
  "draft/consistency": typeof draft_consistency;
  "draft/customPlayers": typeof draft_customPlayers;
  "draft/draftOrder": typeof draft_draftOrder;
  "draft/fetchHelpers": typeof draft_fetchHelpers;
  "draft/history": typeof draft_history;
  "draft/insights": typeof draft_insights;
  "draft/keeperRules": typeof draft_keeperRules;
  "draft/lifecycle": typeof draft_lifecycle;
  "draft/lineupOptimizer": typeof draft_lineupOptimizer;
  "draft/manualHistory": typeof draft_manualHistory;
  "draft/nominationOrder": typeof draft_nominationOrder;
  "draft/pickOrder": typeof draft_pickOrder;
  "draft/pickSlots": typeof draft_pickSlots;
  "draft/picks": typeof draft_picks;
  "draft/plan": typeof draft_plan;
  "draft/playerDetail": typeof draft_playerDetail;
  "draft/reportCard": typeof draft_reportCard;
  "draft/slots": typeof draft_slots;
  "draft/status": typeof draft_status;
  "draft/tags": typeof draft_tags;
  "draft/teams": typeof draft_teams;
  "draft/tiers": typeof draft_tiers;
  draftType: typeof draftType;
  draftValues: typeof draftValues;
  "email/resendClient": typeof email_resendClient;
  "espn/client": typeof espn_client;
  "espn/rankings": typeof espn_rankings;
  "fantasyPros/client": typeof fantasyPros_client;
  fetchAllData: typeof fetchAllData;
  "gemini/client": typeof gemini_client;
  "gemini/preDraftInsights": typeof gemini_preDraftInsights;
  "gemini/reportSummary": typeof gemini_reportSummary;
  genericLeague: typeof genericLeague;
  http: typeof http;
  injuries: typeof injuries;
  injurySnapshots: typeof injurySnapshots;
  leagues: typeof leagues;
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
  scoring: typeof scoring;
  "season/faabValues": typeof season_faabValues;
  "season/rosterPlayers": typeof season_rosterPlayers;
  "season/standings": typeof season_standings;
  "season/teamRoster": typeof season_teamRoster;
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
  "yahoo/client": typeof yahoo_client;
  "yahoo/league": typeof yahoo_league;
  "yahoo/leagueSettingsMapping": typeof yahoo_leagueSettingsMapping;
  "yahoo/oauth": typeof yahoo_oauth;
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
