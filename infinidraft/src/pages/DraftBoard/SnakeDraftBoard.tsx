import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Center, Loader } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { WEEK } from "../../constants/general";
import logo from "@shared/infini_logo.png";
import type { Position } from "../../types";

interface SnakeDraftBoardProps {
  seasonId: Id<"seasons">;
}

// Matches the approved mockup's own palette exactly (Claude Design project
// "Infinidraft UX review", Snake Draft TV Board.dc.html) rather than the
// app's normal POSITION_COLORS/theme - this board is a standalone dark
// broadcast design, not themed Mantine content, and the theme's own `k`
// color (pink) doesn't match the mockup's neutral gray-olive K at all.
const POS_COLORS: Record<Position, string> = {
  QB: "#e0b968",
  RB: "#5aa06f",
  WR: "#5b9bd6",
  TE: "#a679d1",
  DST: "#c56a63",
  K: "#7d8079",
};

// How long the ticker bar's "JUST DRAFTED" flash holds before settling back
// to "LAST PICK" - mirrors the mockup's ANNOUNCE_SECONDS, but driven by a
// real pick actually landing (see the announcing effect below) instead of a
// simulated timer, since no live pick-clock/countdown exists server-side
// (SNAKE_DRAFT.md has no such field - a real countdown would need new
// schema/mutations, out of scope for this board).
const ANNOUNCE_MS = 5000;

// Round-by-round TV board for a snake/linear draft - the round-by-round
// counterpart to DraftBoard.tsx's team-roster view (auction only makes
// sense as "who has what," a snake draft's own shape - one slot per team
// per round, in a fixed order - is much more legible as a grid). Rendered
// by DraftBoard.tsx itself once it resolves draftType, same
// /board/$leagueId public route as its auction sibling, but deliberately
// *not* sharing its useFitScale "shrink everything to fit one screen, no
// scrolling" treatment - a snake board can run to many more rounds than fit
// legibly at any single scale, so it just scrolls instead.
export function SnakeDraftBoard({ seasonId }: SnakeDraftBoardProps) {
  // Same breakpoint/convention as MobileNomination.tsx and keepers.tsx.
  // The header/ticker/footer render entirely different (much more compact,
  // stacked) markup below this breakpoint - on a phone there's no room for
  // the desktop layout's side-by-side stat groups without everything
  // overlapping, and every pixel spent on chrome is a pixel not spent on
  // the actual round grid.
  const isDesktop = useMediaQuery("(min-width: 48em)");
  const settings = useQuery(api.leagues.getSeasonPublic, { seasonId });
  const board = useQuery(api.draft.pickSlots.getSnakeBoardPublic, {
    seasonId,
  });
  const picks = useQuery(api.draft.picks.listDraftPicksPublic, { seasonId });
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });

  const playerByFpid = useMemo(() => {
    const map = new Map<
      number,
      { name: string; team: string | null; position: Position }
    >();
    for (const row of allProjections ?? []) map.set(row.fpid, row);
    return map;
  }, [allProjections]);

  const lastPick = useMemo(() => {
    // Keepers are draftPicks rows too (isKeeper: true), locked in during
    // setup rather than "just drafted" live - without this filter, a
    // keeper-only draft that hasn't started yet would show its
    // most-recently-saved keeper as the ticker's "LAST PICK".
    const realPicks = (picks ?? []).filter((pick) => !pick.isKeeper);
    if (realPicks.length === 0) return undefined;
    return [...realPicks].sort((a, b) => b.sequence - a.sequence)[0];
  }, [picks]);

  // Flashes "JUST DRAFTED" for ANNOUNCE_MS whenever the most recent pick's
  // fpid actually changes - not on first load (nothing "just" happened
  // then, this viewer just opened mid-draft), only on a real transition.
  const [announcing, setAnnouncing] = useState(false);
  const lastAnnouncedFpid = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!lastPick) return;
    if (lastAnnouncedFpid.current === undefined) {
      lastAnnouncedFpid.current = lastPick.fpid;
      return;
    }
    if (lastPick.fpid !== lastAnnouncedFpid.current) {
      lastAnnouncedFpid.current = lastPick.fpid;
      setAnnouncing(true);
      const timer = setTimeout(() => setAnnouncing(false), ANNOUNCE_MS);
      return () => clearTimeout(timer);
    }
  }, [lastPick]);

  // The footer is rendered fixed to the real viewport bottom (see below)
  // instead of inside the scrollable board column, so its "UP NEXT"/color
  // key text stays put on screen instead of scrolling away with the board.
  // That means the scroll area above it needs its height reduced by exactly
  // the footer's own height, or the board would render underneath it.
  const [footerNode, setFooterNode] = useState<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const footerRef = useCallback((node: HTMLDivElement | null) => {
    setFooterNode(node);
  }, []);
  useEffect(() => {
    if (!footerNode) {
      setFooterHeight(0);
      return;
    }
    // Deliberately not `entries[0].contentRect.height` - that's always the
    // content-box size (padding/border excluded) regardless of this node's
    // own box-sizing, so it undercounts the footer's real rendered height by
    // its padding+border and leaves the last round peeking out from behind
    // it. getBoundingClientRect() gives the true border-box size instead.
    const observer = new ResizeObserver(() => {
      setFooterHeight(footerNode.getBoundingClientRect().height);
    });
    observer.observe(footerNode);
    return () => observer.disconnect();
  }, [footerNode]);

  // Same fixed-to-viewport treatment for the header + ticker bar, so the
  // league name/on-clock status/last-pick ticker stay pinned to the real
  // top of the screen instead of scrolling away with the board. The scroll
  // area below needs its top offset by this combined height so the board
  // doesn't render underneath it.
  const [topBarNode, setTopBarNode] = useState<HTMLDivElement | null>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const topBarRef = useCallback((node: HTMLDivElement | null) => {
    setTopBarNode(node);
  }, []);
  useEffect(() => {
    if (!topBarNode) {
      setTopBarHeight(0);
      return;
    }
    // getBoundingClientRect() rather than contentRect - see the footer's
    // measuring effect above for why.
    const observer = new ResizeObserver(() => {
      setTopBarHeight(topBarNode.getBoundingClientRect().height);
    });
    observer.observe(topBarNode);
    return () => observer.disconnect();
  }, [topBarNode]);

  if (!settings || board === undefined) {
    return (
      <Center h="100vh" style={{ background: "#0a0f0d" }}>
        <Loader size="lg" color="orange" />
      </Center>
    );
  }

  const upNext = board
    ? board.rounds
        .flatMap((r) => r.cells)
        .filter(
          (c) =>
            // A keeper can pre-fill a slot well ahead of the current pick
            // pointer, so "overallPick > current" alone isn't enough to
            // mean "still needs a pick made" - exclude anything already
            // resolved (keeper or otherwise), same as forfeited slots.
            !c.isForfeited &&
            !c.pick &&
            c.overallPick > board.currentOverallPick,
        )
        .sort((a, b) => a.overallPick - b.overallPick)
        .slice(0, isDesktop ? 5 : 2)
    : [];

  // Round/pick numbers stay meaningful pre-draft too (keepers already
  // claim slots), so only the LABEL changes based on whether the draft has
  // actually started - see convex/draft/pickSlots.ts's getSnakeBoardPublic.
  const onClockLabel = board?.draftComplete
    ? "Draft complete"
    : !board?.draftStarted
      ? "Draft not started"
      : "On the clock";

  return (
    <>
      {/* Header + ticker bar - fixed to the real viewport top, outside the
          scrollable board below, so they stay put on screen instead of
          scrolling away with it. */}
      <div
        ref={topBarRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          background: "#0a0f0d",
          color: "#e7e8e5",
          fontFamily:
            '-apple-system, "Inter", "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {/* Header */}
        {isDesktop ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 21px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              flexShrink: 0,
              gap: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img src={logo} alt="" style={{ height: 21, width: "auto" }} />
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {/* #8b4513 matches AppLogo.tsx's `saddlebrown.7` - the
                      real brand wordmark color used everywhere else in the
                      app, not this board's own bespoke accent orange
                      (#ca8d3e / burlywood.6, used for on-clock highlights below). */}
                  <span style={{ color: "#8b4513" }}>infini</span>
                  <span style={{ color: "#e7e8e5" }}>draft</span>
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#7d8079",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Snake Draft Board
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 26,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: board?.draftComplete ? "#5aa06f" : "#ca8d3e",
                    animation: "snakeDotBlink 1.6s ease-in-out infinite",
                  }}
                />
                <span style={{ fontSize: 11, color: "#9a9d97" }}>
                  {onClockLabel}
                </span>
                {board?.onClockTeamName && (
                  <span style={{ fontSize: 12, fontWeight: 700 }}>
                    {board.onClockTeamName}
                  </span>
                )}
              </div>
              <div
                style={{
                  width: 1,
                  height: 20,
                  background: "rgba(255,255,255,0.1)",
                }}
              />
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#7d8079" }}>Round</span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {board ? (board.onClockRound ?? board.totalRounds) : "—"}
                </span>
                <span style={{ fontSize: 11, color: "#4d5049" }}>
                  / {board?.totalRounds ?? "—"}
                </span>
                <span
                  style={{ fontSize: 11, color: "#7d8079", marginLeft: 11 }}
                >
                  Pick
                </span>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {board?.currentOverallPick ?? "—"}
                </span>
                <span style={{ fontSize: 11, color: "#4d5049" }}>
                  / {board?.totalPicks ?? "—"}
                </span>
              </div>
              <div
                style={{
                  width: 1,
                  height: 20,
                  background: "rgba(255,255,255,0.1)",
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#cfd1cd" }}>
                {settings.name}
              </div>
            </div>
          </div>
        ) : (
          // Mobile: stacked instead of side-by-side, and trimmed to only
          // what matters mid-draft (who's on the clock, round/pick count) -
          // the subtitle and league name are dropped entirely to keep this
          // to two short lines.
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "8px 14px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <img src={logo} alt="" style={{ height: 16, width: "auto" }} />
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {/* #8b4513 matches AppLogo.tsx's `saddlebrown.7` - the
                      real brand wordmark color used everywhere else in the
                      app, not this board's own bespoke accent orange
                      (#ca8d3e / burlywood.6, used for on-clock highlights below). */}
                  <span style={{ color: "#8b4513" }}>infini</span>
                  <span style={{ color: "#e7e8e5" }}>draft</span>
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9a9d97",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                R{board ? (board.onClockRound ?? board.totalRounds) : "—"}/
                {board?.totalRounds ?? "—"} · P
                {board?.currentOverallPick ?? "—"}/{board?.totalPicks ?? "—"}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: board?.draftComplete ? "#5aa06f" : "#ca8d3e",
                  animation: "snakeDotBlink 1.6s ease-in-out infinite",
                }}
              />
              <span style={{ fontSize: 10, color: "#7d8079", flexShrink: 0 }}>
                {onClockLabel}
              </span>
              {board?.onClockTeamName && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {board.onClockTeamName}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Ticker bar - last/just-drafted pick */}
        {isDesktop ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 17,
              padding: "9px 21px",
              flexShrink: 0,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              boxSizing: "border-box",
              height: 56,
              background: announcing
                ? "linear-gradient(90deg, rgba(90,160,111,0.18), rgba(90,160,111,0.04) 55%, transparent)"
                : "rgba(255,255,255,0.015)",
              borderLeft: `3px solid ${announcing ? "#5aa06f" : "rgba(255,255,255,0.09)"}`,
              animation: announcing
                ? "snakeTickerIn 0.45s ease-out"
                : undefined,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.18em",
                width: 96,
                flexShrink: 0,
                color: announcing ? "#5aa06f" : "#4d5049",
                animation: announcing
                  ? "snakeDotBlink 1s ease-in-out infinite"
                  : undefined,
              }}
            >
              {announcing ? "JUST DRAFTED" : "LAST PICK"}
            </div>
            {lastPick ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 11,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: "#7d8079",
                      letterSpacing: "0.06em",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lastPick.round !== undefined &&
                    lastPick.pickInRound !== undefined
                      ? `${lastPick.round}.${String(lastPick.pickInRound).padStart(2, "0")}  ·  PICK #${lastPick.overallPick ?? ""}`
                      : ""}
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#cfd1cd",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {board?.rounds
                      .flatMap((r) => r.cells)
                      .find((c) => c.pick?.fpid === lastPick.fpid)
                      ?.currentTeamName ?? ""}
                  </span>
                </div>
                <div
                  style={{
                    width: 1,
                    height: 23,
                    background: "rgba(255,255,255,0.1)",
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: announcing ? 21 : 17,
                      fontWeight: 700,
                      letterSpacing: "-0.01em",
                      color: announcing ? "#ffffff" : "#9a9d97",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      transition: "font-size 0.25s ease, color 0.25s ease",
                    }}
                  >
                    {playerByFpid.get(lastPick.fpid)?.name ??
                      `#${lastPick.fpid}`}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: POS_COLORS[lastPick.position],
                      background: `${POS_COLORS[lastPick.position]}24`,
                      border: `1px solid ${POS_COLORS[lastPick.position]}55`,
                      borderRadius: 5,
                      padding: "2px 8px",
                    }}
                  >
                    {lastPick.position}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "#7d8079",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {playerByFpid.get(lastPick.fpid)?.team ?? ""}
                  </span>
                </div>
              </>
            ) : (
              <span style={{ fontSize: 12, color: "#4d5049" }}>
                No picks yet
              </span>
            )}
          </div>
        ) : (
          // Mobile: a single truncating line instead of several nowrap
          // segments side by side - the desktop layout's pieces don't fit a
          // phone width and, without wrapping, were overlapping each other
          // rather than reflowing.
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              flexShrink: 0,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              boxSizing: "border-box",
              height: 30,
              background: announcing
                ? "rgba(90,160,111,0.14)"
                : "rgba(255,255,255,0.015)",
              borderLeft: `2px solid ${announcing ? "#5aa06f" : "rgba(255,255,255,0.09)"}`,
            }}
          >
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.12em",
                flexShrink: 0,
                color: announcing ? "#5aa06f" : "#4d5049",
              }}
            >
              {announcing ? "NEW" : "LAST"}
            </span>
            {lastPick ? (
              <span
                style={{
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                <span style={{ fontWeight: 700, color: "#cfd1cd" }}>
                  {playerByFpid.get(lastPick.fpid)?.name ?? `#${lastPick.fpid}`}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: POS_COLORS[lastPick.position],
                  }}
                >
                  {" "}
                  {lastPick.position}
                </span>
                <span style={{ color: "#7d8079" }}>
                  {" "}
                  →{" "}
                  {board?.rounds
                    .flatMap((r) => r.cells)
                    .find((c) => c.pick?.fpid === lastPick.fpid)
                    ?.currentTeamName ?? ""}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#4d5049" }}>
                No picks yet
              </span>
            )}
          </div>
        )}
      </div>

      <Box
        style={{
          width: "100vw",
          height: `calc(100vh - ${topBarHeight}px - ${footerHeight}px)`,
          marginTop: topBarHeight,
          overflow: "auto",
          background: "#0a0f0d",
          color: "#e7e8e5",
          fontFamily:
            '-apple-system, "Inter", "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <style>{`
        @keyframes snakeOnClockPulse { 0%,100% { background-color: rgba(202,141,62,0.12); } 50% { background-color: rgba(202,141,62,0.26); } }
        @keyframes snakeDotBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        @keyframes snakeLandFlash { 0% { background: rgba(90,160,111,0.18); } 100% { background: rgba(90,160,111,0.07); } }
        @keyframes snakeTickerIn { 0% { opacity: 0; transform: translateY(-8px); } 100% { opacity: 1; transform: translateY(0); } }
      `}</style>
        {/* Board body - scaled down on mobile only, outside the fixed
            header/ticker/footer entirely (they're siblings of this scroll
            area, not descendants, so they're untouched) to fit more of the
            grid in view at a glance without shrinking the fixed chrome
            around it. Uses `zoom`, not `transform: scale` - a transform on
            an ancestor creates a new containing block for `position:
            sticky` descendants (the round-label column and team-header row
            below), so their sticky offsets end up resolved against the
            transformed box instead of the true scroll viewport - visually
            a slow drift instead of a hard pin. `zoom` actually resizes the
            layout box rather than just repainting it, so sticky keeps
            working, and as a bonus the scrollable area's extent shrinks to
            match instead of leaving blank space past the scaled content. */}
        <div
          style={{
            // Mobile gets a snug horizontal inset instead of desktop's 20px
            // - the round-label column (and, mirroring it, the last team
            // column) otherwise sits with a visibly wide gap from the
            // screen edge, wasted space on an already-cramped phone width.
            // Bottom is generously padded instead (140px raw, ~112px once
            // zoomed below) - the last round was otherwise clipped by half
            // under the fixed footer, mobile browsers apparently not quite
            // agreeing with the zoomed content's true scrollHeight down to
            // the pixel, so this trades a bit of extra scroll-past-the-end
            // for guaranteeing the final round always fully clears it.
            padding: isDesktop ? "14px 20px" : "14px 8px 140px",
            ...(!isDesktop ? { zoom: 0.8 } : {}),
          }}
        >
          {!board ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "60vh",
                color: "#7d8079",
                fontSize: 18,
              }}
            >
              Set the draft order before the board can show anything.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                // Explicit floor, not just each column's own minWidth: a
                // block-level flex container's width is normally just
                // "fill the available viewport," and overflowing flex-item
                // content doesn't grow that box - it just paints past its
                // edge. Rows stretch (default align-items) to match this
                // wrapper's own width, so without this floor the sticky
                // header/round-column backgrounds below only ever cover the
                // *original* viewport-width slice of the row, not the true
                // scrolled-to content width, leaving a transparent gap that
                // other rows' unpinned content shows through once you
                // scroll horizontally past that point.
                minWidth: 74 + board.teamOrder.length * (152 + 6),
              }}
            >
              {/* Team header row - sticky to the top of the scrollable board
                  so team names stay visible while scrolling through rounds. */}
              <div
                style={{
                  display: "flex",
                  padding: "0 0 10px",
                  position: "sticky",
                  top: 0,
                  zIndex: 5,
                  background: "#0a0f0d",
                }}
              >
                {/* Corner cell - also sticky left, so it (and by extension
                    this whole row) stays pinned to the top-left while
                    scrolling in either direction, matching the round column
                    below it. */}
                <div
                  style={{
                    width: 74,
                    flexShrink: 0,
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    background: "#0a0f0d",
                  }}
                />
                {board.teamOrder.map((teamId) => {
                  const isOnClock = board.onClockTeamId === teamId;
                  return (
                    <div
                      key={teamId}
                      style={{
                        flex: 1,
                        minWidth: 152,
                        margin: "0 3px",
                        padding: "8px 9px",
                        borderRadius: 8,
                        boxSizing: "border-box",
                        background: isOnClock
                          ? "rgba(202,141,62,0.1)"
                          : "rgba(255,255,255,0.025)",
                        border: `1px solid ${isOnClock ? "rgba(202,141,62,0.45)" : "rgba(255,255,255,0.07)"}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14.5,
                          fontWeight: 700,
                          color: isOnClock ? "#ca8d3e" : "#e7e8e5",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {board.rounds[0]?.cells.find(
                          (c) => c.originalTeamId === teamId,
                        )?.originalTeamName ?? ""}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Round rows */}
              {board.rounds.map((r) => (
                <div
                  key={r.round}
                  style={{ display: "flex", alignItems: "stretch" }}
                >
                  {/* Round column - sticky to the left of the scrollable
                      board so it stays visible while scrolling through
                      teams. */}
                  <div
                    style={{
                      width: 74,
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      position: "sticky",
                      left: 0,
                      zIndex: 4,
                      background: "#0a0f0d",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        color: "#4d5049",
                      }}
                    >
                      RD
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color:
                          r.round === board.onClockRound
                            ? "#ca8d3e"
                            : "#7d8079",
                        lineHeight: 1,
                      }}
                    >
                      {r.round}
                    </div>
                    <div
                      title={
                        r.forward
                          ? "Round order: left to right"
                          : "Round order: right to left (snake)"
                      }
                      style={{ fontSize: 12, color: "#4d5049" }}
                    >
                      {r.forward ? "→" : "←"}
                    </div>
                  </div>

                  {r.cells.map((cell) => {
                    const player = cell.pick
                      ? playerByFpid.get(cell.pick.fpid)
                      : undefined;
                    const base: React.CSSProperties = {
                      flex: 1,
                      minWidth: 152,
                      margin: "0 3px",
                      borderRadius: 8,
                      padding: "7px 9px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      boxSizing: "border-box",
                      height: 68,
                      justifyContent: "center",
                    };
                    let cellStyle: React.CSSProperties;
                    if (cell.isOnClock) {
                      cellStyle = {
                        ...base,
                        background: "rgba(202,141,62,0.12)",
                        border: "1px solid #ca8d3e",
                        // background-color instead of the box-shadow this
                        // used to animate - box-shadow paints outside the
                        // border box even at 0 blur once you add spread,
                        // and combined with the sticky round column/rows
                        // around it that was still visibly leaking into
                        // neighboring rounds. A background pulse can't
                        // escape the cell's own box no matter what.
                        animation:
                          "snakeOnClockPulse 1.8s ease-in-out infinite",
                      };
                    } else if (
                      cell.pick &&
                      cell.pick.fpid === lastPick?.fpid &&
                      announcing
                    ) {
                      cellStyle = {
                        ...base,
                        background: "rgba(90,160,111,0.07)",
                        border: "1px solid rgba(90,160,111,0.45)",
                        // A single slow fade from a soft glow down to this
                        // resting tint - not the repeated 3x pulse this used
                        // to have (kept because it read as too flashy/
                        // distracting for something as small as a routine
                        // pick landing).
                        animation: "snakeLandFlash 1.6s ease-out 1",
                      };
                    } else if (cell.pick || cell.isForfeited) {
                      cellStyle = {
                        ...base,
                        background: "rgba(255,255,255,0.035)",
                        border: `1px solid ${cell.traded ? "rgba(224,185,104,0.28)" : "rgba(255,255,255,0.07)"}`,
                      };
                    } else {
                      cellStyle = {
                        ...base,
                        background: "rgba(255,255,255,0.012)",
                        border: `1px dashed ${cell.traded ? "rgba(224,185,104,0.28)" : "rgba(255,255,255,0.06)"}`,
                      };
                    }

                    const numColor = cell.isOnClock
                      ? "#ca8d3e"
                      : cell.pick || cell.isForfeited
                        ? "#5c5f58"
                        : "#3d403a";

                    return (
                      <div
                        key={cell.originalTeamId}
                        style={cellStyle}
                        title={
                          cell.tradeNote ??
                          (cell.traded
                            ? `Traded pick — originally ${cell.originalTeamName}'s, now owned by ${cell.currentTeamName}`
                            : undefined)
                        }
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                            flexShrink: 0,
                            height: 16,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              color: numColor,
                              fontVariantNumeric: "tabular-nums",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {r.round}.{String(cell.position).padStart(2, "0")} ·
                            #{cell.overallPick}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            {cell.traded && (
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  letterSpacing: "0.06em",
                                  color: "#e0b968",
                                  background: "rgba(224,185,104,0.14)",
                                  border: "1px solid rgba(224,185,104,0.35)",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                → {cell.currentTeamName}
                              </span>
                            )}
                            {cell.pick && (
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  letterSpacing: "0.04em",
                                  color: POS_COLORS[cell.pick.position],
                                  background: `${POS_COLORS[cell.pick.position]}1f`,
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                }}
                              >
                                {cell.pick.position}
                                {cell.pick.isKeeper ? " · K" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            flexShrink: 0,
                            fontSize: 13.5,
                            fontWeight: cell.isOnClock ? 700 : 600,
                            color: cell.isOnClock
                              ? "#ca8d3e"
                              : cell.isForfeited
                                ? "#5c5f58"
                                : cell.pick
                                  ? "#e7e8e5"
                                  : "#3d403a",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            lineHeight: "18px",
                            height: 18,
                          }}
                        >
                          {cell.isForfeited
                            ? "Forfeited"
                            : cell.pick
                              ? (player?.name ?? `#${cell.pick.fpid}`)
                              : cell.isOnClock
                                ? "On the clock"
                                : ""}
                        </div>
                        <div
                          style={{
                            flexShrink: 0,
                            height: 14,
                            lineHeight: "14px",
                            fontSize: 10.5,
                            color: cell.isOnClock
                              ? "rgba(202,141,62,0.75)"
                              : "#5c5f58",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {cell.isForfeited
                            ? (cell.tradeNote ?? "")
                            : cell.pick
                              ? (player?.team ?? "")
                              : cell.isOnClock
                                ? `${cell.currentTeamName} selecting`
                                : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </Box>

      {/* Footer - fixed to the real viewport bottom, outside the scrollable
        board above, so it stays put on screen instead of scrolling away
        with it. */}
      {board && (
        <div
          ref={footerRef}
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isDesktop ? "12px 28px" : "8px 14px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "#0d120e",
            color: "#e7e8e5",
            fontFamily:
              '-apple-system, "Inter", "Helvetica Neue", Arial, sans-serif',
            gap: isDesktop ? 24 : 10,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: isDesktop ? 26 : 10,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: isDesktop ? 11 : 9,
                color: "#4d5049",
                letterSpacing: "0.12em",
                flexShrink: 0,
              }}
            >
              UP NEXT
            </div>
            {upNext.map((cell) => (
              <div
                key={`${cell.overallPick}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: isDesktop ? 11 : 9,
                    color: "#4d5049",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  #{cell.overallPick}
                </span>
                <span
                  style={{
                    fontSize: isDesktop ? 14 : 12,
                    fontWeight: 600,
                    color: "#cfd1cd",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: isDesktop ? undefined : "32vw",
                  }}
                >
                  {cell.currentTeamName}
                </span>
                {cell.traded && isDesktop && (
                  <span
                    title={`Pick acquired from ${cell.originalTeamName}`}
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: "#e0b968",
                      background: "rgba(224,185,104,0.14)",
                      border: "1px solid rgba(224,185,104,0.35)",
                      borderRadius: 4,
                      padding: "1px 5px",
                    }}
                  >
                    via {cell.originalTeamName}
                  </span>
                )}
              </div>
            ))}
          </div>
          {isDesktop && (
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: "rgba(202,141,62,0.2)",
                    border: "1px solid #ca8d3e",
                    display: "inline-block",
                  }}
                />
                <span style={{ fontSize: 11, color: "#7d8079" }}>
                  On the clock
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: "rgba(224,185,104,0.14)",
                    border: "1px solid rgba(224,185,104,0.55)",
                    display: "inline-block",
                  }}
                />
                <span style={{ fontSize: 11, color: "#7d8079" }}>
                  Traded pick
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    border: "1px dashed rgba(255,255,255,0.25)",
                    display: "inline-block",
                  }}
                />
                <span style={{ fontSize: 11, color: "#7d8079" }}>Upcoming</span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
