// Same pattern as infinidraft's src/lib/leagueStorage.ts (per-user "last
// selected league" persistence, read by "/" and written by the header's
// league switcher) - key prefixed "infinileague:" rather than
// "infinidraft:" for clarity, though since these are different browser
// origins the keys could never collide anyway.
function leagueStorageKey(userId: string): string {
  return `infinileague:selectedLeagueId:${userId}`;
}

export function getStoredLeagueId(userId: string): string | null {
  return localStorage.getItem(leagueStorageKey(userId));
}

export function setStoredLeagueId(userId: string, leagueId: string): void {
  localStorage.setItem(leagueStorageKey(userId), leagueId);
}
