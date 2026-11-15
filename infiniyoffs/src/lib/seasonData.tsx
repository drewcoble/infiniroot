import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import type { PlayoffFormat } from "@playoffRules/format";
import { platformFormat } from "./platformFormat";

export type SeasonData = FunctionReturnType<typeof api.infiniyoffs.season.getSeasonData>;
export type PlayoffRules = FunctionReturnType<typeof api.infiniyoffs.rules.getRules>;

// Live scores move every few minutes during games.
const RELOAD_MS = 2 * 60 * 1000;

interface SeasonDataValue {
  data: SeasonData | undefined;
  error: string | null;
  rules: PlayoffRules | undefined;
  // The commissioner's format, else one built from the platform's own
  // playoffs. Null for a league with no playoffs at all.
  format: PlayoffFormat | null | undefined;
  isCustom: boolean;
}

const SeasonDataContext = createContext<SeasonDataValue>({
  data: undefined,
  error: null,
  rules: undefined,
  format: undefined,
  isCustom: false,
});

// Loads the league's season data once per league visit for every tab -
// syncing rosters first if they're stale - and reloads it every couple of
// minutes for live scores.
export function SeasonDataProvider({
  seasonId,
  children,
}: {
  seasonId: Id<"seasons">;
  children: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const getSeasonData = useAction(api.infiniyoffs.season.getSeasonData);
  const refreshIfStale = useAction(api.infiniyoffs.refresh.refreshIfStale);
  const rules = useQuery(api.infiniyoffs.rules.getRules, isAuthenticated ? { seasonId } : "skip");
  const [data, setData] = useState<SeasonData | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const load = () =>
      getSeasonData({ seasonId })
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(getErrorMessage(err, "Failed to load the league."));
        });
    setData(undefined);
    void load();
    // A finished sync changes rosters, names and projections.
    refreshIfStale({ seasonId })
      .then((ran) => {
        if (ran) void load();
      })
      .catch(() => {});
    const timer = setInterval(() => void load(), RELOAD_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [seasonId, isAuthenticated, getSeasonData, refreshIfStale]);

  const custom = (rules?.format ?? null) as PlayoffFormat | null;
  const format =
    rules === undefined || data === undefined ? undefined : (custom ?? platformFormat(data));

  return (
    <SeasonDataContext.Provider value={{ data, error, rules, format, isCustom: custom !== null }}>
      {children}
    </SeasonDataContext.Provider>
  );
}

export function useSeasonData(): SeasonDataValue {
  return useContext(SeasonDataContext);
}
