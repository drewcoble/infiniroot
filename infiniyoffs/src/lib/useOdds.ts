import { useEffect, useRef, useState } from "react";
import type { OddsRequest, TeamOdds } from "./odds";

const RUNS = 2000;

// Playoff odds for the request, recomputed in a worker whenever it changes
// (new scores, a draft pick, a rules edit). Keeps showing the last result
// while a new one runs.
export function useOdds(request: Omit<OddsRequest, "runs"> | null): TeamOdds[] | undefined {
  const workerRef = useRef<Worker | null>(null);
  const latestId = useRef(0);
  const [odds, setOdds] = useState<TeamOdds[] | undefined>(undefined);

  useEffect(() => {
    const worker = new Worker(new URL("./odds.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; odds: TeamOdds[] }>) => {
      if (event.data.id === latestId.current) setOdds(event.data.odds);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (!request || !workerRef.current) return;
    latestId.current += 1;
    workerRef.current.postMessage({ id: latestId.current, request: { ...request, runs: RUNS } });
  }, [request]);

  return odds;
}
