// Mirrors convex/infinileague/auction/eligibility.ts's CycleType - the
// three ways an fpid can be bid-eligible right now (see that file's header
// comment). Shared by every auction-board-shaped hook/type in this
// workspace rather than each redefining its own copy.
export type CycleType = "weekly" | "playerDrop" | "manual";
