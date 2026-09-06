import { ConnectSleeperLeague } from "@infiniroot/shared";

// Step 2 (team picker) only renders after a live Sleeper account lookup
// succeeds - internal state, unreachable via props. See NOTES.md.
export function Default() {
  return <ConnectSleeperLeague onConnected={() => {}} onCancel={() => {}} />;
}
