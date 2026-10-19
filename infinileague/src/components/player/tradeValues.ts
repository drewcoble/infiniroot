import { createContext, useContext, useEffect } from "react";
import type { TradeValueRow } from "../../types/season";

// The league's shared trade values - see TradeValuesProvider.
export interface TradeValuesState {
  // undefined until requested and loaded.
  byFpid: Map<number, TradeValueRow> | undefined;
  rows: TradeValueRow[] | undefined;
  error: string | null;
  request: () => void;
}

export const TradeValuesContext = createContext<TradeValuesState | null>(null);

// The league's trade values - asks for them on mount. Outside a league
// (no provider) it's always empty.
export function useTradeValues(): Omit<TradeValuesState, "request"> {
  const state = useContext(TradeValuesContext);
  const request = state?.request;
  useEffect(() => {
    request?.();
  }, [request]);
  return {
    rows: state?.rows,
    byFpid: state?.byFpid,
    error: state?.error ?? null,
  };
}
