import { useQuery } from "convex/react";
import { api } from "@infinidata/api";

// No isAuthenticated gate - matches every existing call site (infinidraft/
// infinileague/infinifaab's own AppHeaders all call this unconditionally),
// since the query itself already returns null for a signed-out caller
// rather than throwing.
export function useCurrentUser() {
  return useQuery(api.users.getCurrentUser);
}
