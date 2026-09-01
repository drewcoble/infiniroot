// Per-user "last selected league" persistence, read by the "/" redirect and
// written whenever the league switcher (AppHeader) changes leagues - purely
// a fallback for the next time a user lands on "/", not the source of truth
// once a leagueId is already in the URL.
function leagueStorageKey(userId: string): string {
  return `infinidraft:selectedLeagueId:${userId}`;
}

export function getStoredLeagueId(userId: string): string | null {
  return localStorage.getItem(leagueStorageKey(userId));
}

export function setStoredLeagueId(userId: string, leagueId: string): void {
  localStorage.setItem(leagueStorageKey(userId), leagueId);
}
