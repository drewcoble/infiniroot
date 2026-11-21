import { simulateOdds, type OddsRequest } from "./odds";

// Runs the odds simulation off the main thread - a few thousand full
// playoff evaluations would otherwise stall scrolling.
self.onmessage = (event: MessageEvent<{ id: number; request: OddsRequest }>) => {
  const { id, request } = event.data;
  self.postMessage({ id, odds: simulateOdds(request) });
};
