import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  BanknoteArrowDown,
  BatteryLow,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Crosshair,
  HandCoins,
  Rocket,
  ShieldCheck,
  TrendingDown,
  TrendingUpDown,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import type { Doc, Id } from "@infinidata/dataModel";
import { POSITION_COLORS } from "@shared/positionColors";
import { GenericValueBadge } from "../../../components/GenericValueBadge";
import type { PlanSlotMatch } from "../../../lib/planRecommendation";
import type { StandardValueRow } from "../../../lib/standardValues";
import { StandardValueLabel } from "../../../components/StandardValueLabel";
import {
  consistencyColor,
  type ConsistencyLabel,
} from "../../../lib/consistency";
import { playerTagStyle } from "../../../lib/playerTagStyle";
import type { PlayerTag, Position, ValueGap } from "../../../types";
import {
  BOTTOM_NAV_BOTTOM_OFFSET,
  BOTTOM_NAV_HEIGHT,
} from "../../../constants/general";
import { useHoldRepeat } from "../../../hooks/useHoldRepeat";
import { SearchBody, type SearchResult } from "./NominationPanel";
import { BottomSheet, DraftFab, TeamChipRow } from "./mobileDraftSheet";

interface MobileNominationProps {
  nominationOrderEnabled: boolean;
  turnTeamId: Id<"seasonTeams"> | null | undefined;
  onSetTurnTeam: (teamId: Id<"seasonTeams"> | null) => void;

  teams: Doc<"seasonTeams">[];
  selfTeamId: Id<"seasonTeams">;

  activeNomination: Doc<"draftNominations"> | undefined;
  nominatedPlayer: { name: string; team: string | null } | undefined;
  nominatedValue: { dollarValue: number } | undefined;
  nominatedStandardValue: StandardValueRow | undefined;
  planMatch: PlanSlotMatch | undefined;
  // Same target/avoid tag, value-gap, and consistency badges SearchBody's
  // touchFriendly rows show, but for whichever player is actively
  // nominated - see DraftTopBar.tsx for where these are looked up.
  activeTag: PlayerTag | undefined;
  activeValueGap: ValueGap | undefined;
  activeConsistency: ConsistencyLabel | undefined;
  onCycleTag: (fpid: number) => void;
  onBumpBid: (delta: number) => void;
  onSetBid: (amount: number) => void;
  onAssignWinner: (teamId: Id<"seasonTeams">) => void;
  // Cancels the active nomination without recording a pick, restoring
  // "whose turn" back to whoever made it - see the AssignDrawerBody Undo
  // button/DraftTopBar.tsx's undoNomination mutation call.
  onUndo: () => void;

  search: string;
  onSearchChange: (value: string) => void;
  searchResults: SearchResult[];
  activePositions: Position[];
  draftValueByFpid: Map<number, { dollarValue: number }>;
  onNominate: (fpid: number) => void;
  onAddCustomPlayer: (name: string, position: Position) => void;

  // See NominationPanelProps.usingGenericValues.
  usingGenericValues: boolean;

  onSelectPlayer: (fpid: number) => void;
}

// Same icon choices NominationPanel.tsx's SearchBody uses for the same
// consistency ratings - kept in sync there rather than imported, same
// duplication convention PlayerBar.tsx/PlayerTableRow.tsx already share.
const CONSISTENCY_ICON: Record<ConsistencyLabel, typeof ShieldCheck> = {
  Reliable: ShieldCheck,
  "Boom/Bust": TrendingUpDown,
  "Low Output": BatteryLow,
};

type SheetMode = "closed" | "search" | "assign";

// Bottom offset for both minimized "peek" cards below - overlaps
// BottomNav's top edge by exactly its own "xl" corner radius (BottomNav
// always keeps that radius, on every corner, whether or not a peek card is
// attached - see BottomNav.tsx). The peek card sits behind BottomNav (see
// its own zIndex comment) so this overlap is purely a backing color: it's
// invisible everywhere BottomNav actually paints, and only shows through in
// the sliver BottomNav's rounded corner leaves open - matching this depth
// exactly is what closes that gap with no residual, rather than leaving
// some of the curve still exposed.
const PEEK_BOTTOM_OFFSET = `calc(${BOTTOM_NAV_BOTTOM_OFFSET}px + ${BOTTOM_NAV_HEIGHT}px - var(--mantine-radius-xl) + env(safe-area-inset-bottom))`;

// The peek card's own bottom padding needs to be at least this deep so
// BottomNav's overlap (see PEEK_BOTTOM_OFFSET) only ever covers empty
// padding, never the card's actual name/price/etc. row - the +6px is just
// breathing room past the exact radius depth.
const PEEK_BOTTOM_PADDING = "calc(var(--mantine-radius-xl) + 6px)";

// Mobile replacement for the desktop NominationPanel card (hidden below the
// "sm" breakpoint via visibleFrom="sm" on that component - see
// DraftTopBar.tsx). A gavel FAB sits over the center of the bottom nav bar
// and drives a single bottom Drawer that's shared by both the search/
// nominate form and the bid/assign controls, swapping bodies depending on
// `mode`. The Drawer can be minimized without losing the in-progress
// nomination/search - while minimized, a small floating "peek" card takes
// its place above the bottom nav so the auction can still be tracked
// one-handed without the sheet covering the rest of the screen.
export function MobileNomination({
  nominationOrderEnabled,
  turnTeamId,
  onSetTurnTeam,
  teams,
  selfTeamId,
  activeNomination,
  nominatedPlayer,
  nominatedValue,
  nominatedStandardValue,
  planMatch,
  activeTag,
  activeValueGap,
  activeConsistency,
  onCycleTag,
  onBumpBid,
  onSetBid,
  onAssignWinner,
  onUndo,
  search,
  onSearchChange,
  searchResults,
  activePositions,
  draftValueByFpid,
  onNominate,
  onAddCustomPlayer,
  usingGenericValues,
  onSelectPlayer,
}: MobileNominationProps) {
  const [mode, setMode] = useState<SheetMode>("closed");
  const [minimized, setMinimized] = useState(false);
  const hasActiveNomination = !!activeNomination;

  // Mirrors the server: once a nomination lands (whether this device made it
  // or another team's client did), the sheet takes over in the expanded
  // assign state. Once it resolves/passes, drop back to fully closed rather
  // than lingering on a stale assign sheet - but leave an in-progress search
  // alone, since the absence of a nomination is the expected state while
  // searching for one to make.
  useEffect(() => {
    if (hasActiveNomination) {
      setMode("assign");
      setMinimized(false);
    } else {
      setMode((current) => (current === "assign" ? "closed" : current));
    }
  }, [hasActiveNomination]);

  // Guards the single render tick between the server clearing
  // activeNomination and the effect above catching up, so the sheet/peek
  // never flash stale assign content with nothing behind it.
  const effectiveMode: SheetMode =
    mode === "assign" && !activeNomination ? "closed" : mode;
  const sheetOpen = effectiveMode !== "closed" && !minimized;
  const peeking = effectiveMode !== "closed" && minimized;

  // Same "dismiss" the scrim tap and Escape key trigger, reused as the
  // swipe-to-close target below - search cancels outright, assign only
  // minimizes (the nomination itself is still live on the server).
  const dismiss = () => {
    if (effectiveMode === "search") {
      setMode("closed");
    } else {
      setMinimized(true);
    }
  };

  const currentTeamName =
    teams.find((team) => team._id === turnTeamId)?.name ?? null;

  const nominatingTeam = activeNomination
    ? teams.find((team) => team._id === activeNomination.nominatingTeamId)
    : undefined;

  let fabIcon: ReactNode = <UserPlus size={24} />;
  let fabLabel = "Nominate a player";
  let fabAction = () => setMode("search");
  if (effectiveMode === "search") {
    fabIcon = <X size={24} />;
    fabLabel = "Close nominate a player";
    fabAction = () => {
      setMode("closed");
      setMinimized(false);
    };
  } else if (effectiveMode === "assign" && !minimized) {
    fabIcon = <ChevronDown size={24} />;
    fabLabel = "Minimize nomination";
    fabAction = () => setMinimized(true);
  } else if (effectiveMode === "assign" && minimized) {
    fabIcon = <ChevronUp size={24} />;
    fabLabel = "Resume nomination";
    fabAction = () => setMinimized(false);
  }

  return (
    <>
      <DraftFab icon={fabIcon} label={fabLabel} onClick={fabAction} />

      <BottomSheet opened={sheetOpen} onDismiss={dismiss}>
            {effectiveMode === "search" && (
              <Stack gap={10}>
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={700} size="lg">
                    Nominate a Player
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <ActionIcon
                      variant="default"
                      radius="xl"
                      onClick={() => setMinimized(true)}
                      aria-label="Minimize"
                      title="Minimize - keeps your search in progress"
                    >
                      <ChevronDown size={18} />
                    </ActionIcon>
                    <ActionIcon
                      variant="default"
                      radius="xl"
                      onClick={() => setMode("closed")}
                      aria-label="Close"
                    >
                      <X size={18} />
                    </ActionIcon>
                  </Group>
                </Group>

                {usingGenericValues && (
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" c="dimmed">
                      Values shown are estimates
                    </Text>
                    <GenericValueBadge />
                  </Group>
                )}
                {nominationOrderEnabled && (
                  <Stack gap={4}>
                    <Text size="sm" c="dimmed">
                      Nominating team
                    </Text>
                    <TeamChipRow
                      teams={[
                        ...teams.map((team) => ({
                          id: team._id,
                          label: team.name,
                        })),
                        // Not part of the configured turn order - an escape
                        // hatch back to picking the nominating team by hand
                        // on the search form below, same as before.
                        { id: null, label: "Manual" },
                      ]}
                      selectedId={turnTeamId ?? null}
                      onSelect={onSetTurnTeam}
                    />
                  </Stack>
                )}
                <SearchBody
                  search={search}
                  onSearchChange={onSearchChange}
                  searchResults={searchResults}
                  activePositions={activePositions}
                  draftValueByFpid={draftValueByFpid}
                  onNominate={(fpid) => {
                    onNominate(fpid);
                    setMode("closed");
                    setMinimized(false);
                  }}
                  onAddCustomPlayer={(name, position) => {
                    onAddCustomPlayer(name, position);
                    setMode("closed");
                    setMinimized(false);
                  }}
                  onSelectPlayer={onSelectPlayer}
                  touchFriendly
                />
              </Stack>
            )}

            {effectiveMode === "assign" && activeNomination && (
              <AssignDrawerBody
                activeNomination={activeNomination}
                nominatedPlayer={nominatedPlayer}
                nominatedValue={nominatedValue}
                nominatedStandardValue={nominatedStandardValue}
                planMatch={planMatch}
                tag={activeTag}
                valueGap={activeValueGap}
                consistency={activeConsistency}
                onCycleTag={() => onCycleTag(activeNomination.fpid)}
                nominatingTeam={nominatingTeam}
                teams={teams}
                selfTeamId={selfTeamId}
                onBumpBid={onBumpBid}
                onSetBid={onSetBid}
                onAssignWinner={onAssignWinner}
                onUndo={onUndo}
                onSelectPlayer={onSelectPlayer}
                usingGenericValues={usingGenericValues}
                onMinimize={() => setMinimized(true)}
              />
            )}
      </BottomSheet>

      {peeking && effectiveMode === "search" && (
        <SearchPeekCard
          label={
            nominationOrderEnabled
              ? `${currentTeamName ?? "Manual"} is nominating`
              : "Search a player to nominate"
          }
          onClick={() => setMinimized(false)}
        />
      )}

      {peeking && effectiveMode === "assign" && activeNomination && (
        <AssignPeekCard
          activeNomination={activeNomination}
          nominatedPlayer={nominatedPlayer}
          nominatedValue={nominatedValue}
          usingGenericValues={usingGenericValues}
          onClick={() => setMinimized(false)}
        />
      )}
    </>
  );
}

interface AssignDrawerBodyProps {
  activeNomination: Doc<"draftNominations">;
  nominatedPlayer: { name: string; team: string | null } | undefined;
  nominatedValue: { dollarValue: number } | undefined;
  nominatedStandardValue: StandardValueRow | undefined;
  planMatch: PlanSlotMatch | undefined;
  tag: PlayerTag | undefined;
  valueGap: ValueGap | undefined;
  consistency: ConsistencyLabel | undefined;
  onCycleTag: () => void;
  nominatingTeam: Doc<"seasonTeams"> | undefined;
  teams: Doc<"seasonTeams">[];
  selfTeamId: Id<"seasonTeams">;
  onBumpBid: (delta: number) => void;
  onSetBid: (amount: number) => void;
  onAssignWinner: (teamId: Id<"seasonTeams">) => void;
  onUndo: () => void;
  onSelectPlayer: (fpid: number) => void;
  usingGenericValues: boolean;
  onMinimize: () => void;
}

function AssignDrawerBody({
  activeNomination,
  nominatedPlayer,
  nominatedValue,
  nominatedStandardValue,
  planMatch,
  tag,
  valueGap,
  consistency,
  onCycleTag,
  nominatingTeam,
  teams,
  selfTeamId,
  onBumpBid,
  onSetBid,
  onAssignWinner,
  onUndo,
  onSelectPlayer,
  usingGenericValues,
  onMinimize,
}: AssignDrawerBodyProps) {
  // Self team always listed first - it's the common case, and with the
  // dedicated "I won" button gone on mobile, picking it from this list is
  // now the only way to log a self-win.
  const orderedTeams = [
    ...teams.filter((team) => team._id === selfTeamId),
    ...teams.filter((team) => team._id !== selfTeamId),
  ];

  const [winnerTeamId, setWinnerTeamId] =
    useState<Id<"seasonTeams">>(selfTeamId);
  const [bidDraft, setBidDraft] = useState<number | string>(
    activeNomination.currentBid,
  );
  const [editingBid, setEditingBid] = useState(false);

  useEffect(() => {
    setWinnerTeamId(selfTeamId);
  }, [activeNomination._id, selfTeamId]);

  useEffect(() => {
    if (!editingBid) setBidDraft(activeNomination.currentBid);
  }, [activeNomination._id, activeNomination.currentBid, editingBid]);

  const commitBidDraft = () => {
    setEditingBid(false);
    const amount =
      typeof bidDraft === "number" ? bidDraft : parseFloat(bidDraft);
    if (Number.isFinite(amount) && amount !== activeNomination.currentBid) {
      onSetBid(amount);
    } else {
      setBidDraft(activeNomination.currentBid);
    }
  };

  const decrementBidHold = useHoldRepeat(() => onBumpBid(-1));
  const incrementBidHold = useHoldRepeat(() => onBumpBid(1));

  const ConsistencyRowIcon = consistency
    ? CONSISTENCY_ICON[consistency]
    : undefined;

  return (
    <Stack gap={20}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {nominatingTeam
            ? `Nominated by ${nominatingTeam.name}`
            : "Active nomination"}
        </Text>
        <ActionIcon
          variant="default"
          radius="xl"
          onClick={onMinimize}
          aria-label="Minimize"
          title="Minimize - keeps this nomination in view"
        >
          <ChevronDown size={18} />
        </ActionIcon>
      </Group>

      <Stack gap={8}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Badge
            size="sm"
            variant="light"
            color={POSITION_COLORS[activeNomination.position]}
          >
            {activeNomination.position}
          </Badge>
          {nominatedPlayer ? (
            <Text
              fw={700}
              size="lg"
              truncate
              style={{ flex: 1, minWidth: 0 }}
              onClick={() => onSelectPlayer(activeNomination.fpid)}
            >
              {nominatedPlayer.name}
            </Text>
          ) : (
            <Text fw={700} size="lg" truncate style={{ flex: 1, minWidth: 0 }}>
              Player #{activeNomination.fpid}
            </Text>
          )}
          {nominatedPlayer?.team && (
            <Badge size="sm" variant="outline" color="gray">
              {nominatedPlayer.team}
            </Badge>
          )}
        </Group>

        <Group gap={10} wrap="wrap" align="center">
          <Button
            size="compact-xs"
            {...(tag ? playerTagStyle(tag) : { variant: "default" })}
            leftSection={
              tag === "avoid" ? (
                <CircleSlash size={12} />
              ) : (
                <Crosshair size={12} />
              )
            }
            onClick={onCycleTag}
          >
            {tag === "target" ? "Target" : tag === "avoid" ? "Avoid" : "+ Tag"}
          </Button>
          {valueGap?.direction === "undervalued" ? (
            <Tooltip label="Undervalued" withArrow>
              <ThemeIcon size="sm" color="gold" variant="light">
                <HandCoins size={14} />
              </ThemeIcon>
            </Tooltip>
          ) : valueGap?.direction === "breakout" ? (
            <Tooltip label="Breakout Player" withArrow>
              <ThemeIcon size="sm" color="grape" variant="light">
                <Rocket size={14} />
              </ThemeIcon>
            </Tooltip>
          ) : valueGap?.direction === "falloff" ? (
            <Tooltip label="Falloff Player" withArrow>
              <ThemeIcon size="sm" color="red" variant="light">
                <TrendingDown size={14} />
              </ThemeIcon>
            </Tooltip>
          ) : (
            valueGap?.direction === "overvalued" && (
              <Tooltip label="Overvalued" withArrow>
                <ThemeIcon size="sm" color="red" variant="light">
                  <BanknoteArrowDown size={14} />
                </ThemeIcon>
              </Tooltip>
            )
          )}
          {consistency && ConsistencyRowIcon && (
            <Tooltip label={consistency} withArrow>
              <ThemeIcon
                size="sm"
                variant="light"
                color={consistencyColor(consistency)}
              >
                <ConsistencyRowIcon size={14} />
              </ThemeIcon>
            </Tooltip>
          )}
        </Group>
      </Stack>

      {/* A filled bar (not Divider's default hairline border) in the app's
          own dark-green surface shade in dark mode - see BottomNav.tsx's
          comment on dark-5 vs dark-6 for where that palette lives - with a
          light-mode fallback so this doesn't go bare-dark on that theme. */}
      <Box
        style={{
          height: 2,
          borderRadius: 999,
          background:
            "light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-5))",
        }}
      />

      <Stack gap={4}>
        <Text size="xs" c="dimmed">
          Winning team
        </Text>
        <TeamChipRow
          teams={orderedTeams.map((team) => ({
            id: team._id,
            label: team.isSelf ? `${team.name} (me)` : team.name,
          }))}
          selectedId={winnerTeamId}
          onSelect={(id) => id && setWinnerTeamId(id)}
        />
      </Stack>

      <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
        {nominatedValue && (
          <Text size="sm" fw={700} c="teal" style={{ whiteSpace: "nowrap" }}>
            Est. ${Math.round(nominatedValue.dollarValue)}
          </Text>
        )}
        <StandardValueLabel
          draftValue={nominatedValue?.dollarValue}
          standardValue={nominatedStandardValue}
        />
        {planMatch && (
          <Text size="xs" c="dimmed" truncate>
            {planMatch.slotLabel} budget:{" "}
            <Text
              component="span"
              inherit
              fw={700}
              c="var(--mantine-color-text)"
            >
              ${Math.round(planMatch.amount)}
            </Text>
          </Text>
        )}
        {usingGenericValues && <GenericValueBadge />}
      </Group>

      <Stack gap={8}>
        <Text size="xs" c="dimmed">
          Final price
        </Text>
        <Group gap={8} wrap="nowrap">
          <ActionIcon
            size={40}
            variant="default"
            onClick={() => onBumpBid(-1)}
            {...decrementBidHold}
          >
            −
          </ActionIcon>
          <NumberInput
            hideControls
            min={1}
            value={bidDraft}
            onChange={setBidDraft}
            onFocus={() => setEditingBid(true)}
            onBlur={commitBidDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            prefix="$"
            style={{ flex: 1 }}
            size="md"
            styles={{
              input: {
                fontFamily: "var(--mantine-font-family-monospace)",
                fontWeight: 700,
                textAlign: "center",
                fontSize: "var(--mantine-font-size-lg)",
                color: "var(--mantine-color-saddlebrown-5)",
              },
            }}
          />
          <ActionIcon
            size={40}
            variant="default"
            onClick={() => onBumpBid(1)}
            {...incrementBidHold}
          >
            +
          </ActionIcon>
        </Group>
      </Stack>

      <Group gap={10} wrap="nowrap">
        <ActionIcon
          size={44}
          variant="default"
          onClick={onUndo}
          aria-label="Undo nomination"
          title="Undo - cancels this nomination, no pick recorded, and keeps it this team's turn to nominate again"
        >
          <Undo2 size={18} />
        </ActionIcon>
        <Button
          size="md"
          color="saddlebrown"
          style={{ flex: 1 }}
          onClick={() => onAssignWinner(winnerTeamId)}
        >
          Assign for ${activeNomination.currentBid}
        </Button>
      </Group>
    </Stack>
  );
}

// Shared floating-card chrome for both minimized states below - same frosted
// glass treatment as BottomNav.tsx/AppHeader.tsx and the drawer it stands in
// for while minimized. Square bottom corners, overlapping BottomNav by
// PEEK_BOTTOM_OFFSET's own amount - deliberately behind BottomNav in
// z-index (see below), which is what makes that overlap safe (see
// PEEK_BOTTOM_PADDING for how it stays clear of this card's own content).
//
// Portaled to document.body - same reasoning as DraftFab/MobileStatsRow:
// a plain pos="fixed" Box, not one of Mantine's Portal-backed overlays, so
// it needs to escape MobileNomination's own mount point (the auction
// sidebar's Group column) to resolve `bottom` against the viewport rather
// than that ancestor.
function PeekCard({
  children,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return createPortal(
    <Box
      hiddenFrom="sm"
      pos="fixed"
      left={12}
      right={12}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
      style={{
        bottom: PEEK_BOTTOM_OFFSET,
        // Below BottomNav's own 200 (not above, like the peek card used to
        // be) - the two rectangles only actually overlap in the small sliver
        // this card extends into BottomNav's own territory, and in that
        // sliver BottomNav's real pixels should win: its rounded top corners
        // leave a little of that sliver open, and this card's own color
        // showing through there (rather than being painted over by it) is
        // what closes the gap, while BottomNav's icons stay fully visible
        // and clickable everywhere it does paint.
        zIndex: 195,
        maxWidth: 480,
        margin: "0 auto",
        padding: `10px 14px ${PEEK_BOTTOM_PADDING}`,
        borderTopLeftRadius: "var(--mantine-radius-xl)",
        borderTopRightRadius: "var(--mantine-radius-xl)",
        borderLeft: "1px solid var(--mantine-color-default-border)",
        borderRight: "1px solid var(--mantine-color-default-border)",
        borderTop: "1px solid var(--mantine-color-default-border)",
        // Same background as BottomNav.tsx (not Card/Popover's) so the two
        // are indistinguishable at the shared edge.
        background:
          "light-dark(color-mix(in srgb, var(--mantine-color-body) 65%, transparent), color-mix(in srgb, var(--mantine-color-dark-5) 50%, transparent))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        cursor: "pointer",
      }}
    >
      {children}
    </Box>,
    document.body,
  );
}

function SearchPeekCard({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <PeekCard onClick={onClick} ariaLabel="Resume nominating a player">
      <Group gap={8} wrap="nowrap" justify="space-between">
        <Text size="sm" fw={600} truncate style={{ flex: 1, minWidth: 0 }}>
          {label}
        </Text>
        <ChevronUp size={16} />
      </Group>
    </PeekCard>
  );
}

interface AssignPeekCardProps {
  activeNomination: Doc<"draftNominations">;
  nominatedPlayer: { name: string; team: string | null } | undefined;
  nominatedValue: { dollarValue: number } | undefined;
  usingGenericValues: boolean;
  onClick: () => void;
}

function AssignPeekCard({
  activeNomination,
  nominatedPlayer,
  nominatedValue,
  usingGenericValues,
  onClick,
}: AssignPeekCardProps) {
  return (
    <PeekCard onClick={onClick} ariaLabel="Resume nomination">
      <Group gap={10} wrap="nowrap">
        <Badge
          size="sm"
          variant="light"
          color={POSITION_COLORS[activeNomination.position]}
        >
          {activeNomination.position}
        </Badge>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>
            {nominatedPlayer?.name ?? `Player #${activeNomination.fpid}`}
          </Text>
          {nominatedValue && (
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                ~${Math.round(nominatedValue.dollarValue)}
              </Text>
              {usingGenericValues && <GenericValueBadge />}
            </Group>
          )}
        </Stack>
        <Text
          size="md"
          fw={700}
          style={{ color: "var(--mantine-color-saddlebrown-5)" }}
        >
          ${activeNomination.currentBid}
        </Text>
        <ChevronUp size={16} />
      </Group>
    </PeekCard>
  );
}
