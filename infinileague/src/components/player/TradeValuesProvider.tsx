import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction, useConvexAuth } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import type { TradeValueRow } from "../../types/season";
import { TradeValuesContext, type TradeValuesState } from "./tradeValues";

// One league's trade values (convex/infinileague/season/tradeValues.ts),
// shared by everything under the league layout - the Trade tab and every
// player popover - and fetched once per league visit, only once something
// asks for them (getTradeValues is an action over the whole league, too
// heavy to run per popover).
export function TradeValuesProvider({
  seasonId,
  children,
}: {
  seasonId: string;
  children: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const getTradeValues = useAction(api.infinileague.season.tradeValues.getTradeValues);
  const [loaded, setLoaded] = useState<{ seasonId: string; rows: TradeValueRow[] } | null>(null);
  const [error, setError] = useState<{ seasonId: string; message: string } | null>(null);
  // Which league a fetch has been started for - at most one per league.
  const requestedRef = useRef<string | null>(null);

  const request = useCallback(() => {
    if (!isAuthenticated || requestedRef.current === seasonId) return;
    requestedRef.current = seasonId;
    const forSeason = seasonId;
    getTradeValues({ seasonId: seasonId as Id<"seasons"> })
      .then((rows) => setLoaded({ seasonId: forSeason, rows }))
      .catch((err) => {
        requestedRef.current = null;
        setError({
          seasonId: forSeason,
          message: getErrorMessage(err, "Couldn't load trade values."),
        });
      });
  }, [getTradeValues, isAuthenticated, seasonId]);

  const rows = loaded?.seasonId === seasonId ? loaded.rows : undefined;
  const value = useMemo<TradeValuesState>(
    () => ({
      rows,
      byFpid: rows ? new Map(rows.map((row) => [row.fpid, row])) : undefined,
      error: error?.seasonId === seasonId ? error.message : null,
      request,
    }),
    [rows, error, seasonId, request],
  );
  return <TradeValuesContext.Provider value={value}>{children}</TradeValuesContext.Provider>;
}
