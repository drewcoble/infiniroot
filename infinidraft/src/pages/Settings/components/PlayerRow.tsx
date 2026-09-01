import { Fragment } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Group,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { Ban, ChevronDown, ChevronUp, Target } from "lucide-react";
import type { Doc } from "@infinidata/dataModel";
import type { PlayerTag, ScoringConfig, ValueGap } from "../../../types";
import { POSITION_COLORS } from "@shared/positionColors";
import { injuryColor } from "@shared/injuryColor";
import { pointsForScoringConfig } from "../../../lib/relevantPlayers";
import type { ConsistencyLabel } from "../../../lib/consistency";
import type { StandardValueRow } from "../../../lib/standardValues";
import { playerTagStyle } from "../../../lib/playerTagStyle";
import { ConsistencyIcon } from "./ConsistencyIcon";
import { ValueGapIcon } from "./ValueGapIcon";
import { RookieBadge } from "@shared/RookieBadge";
import { StandardValueLabel } from "../../../components/StandardValueLabel";
import { AdpValueLabel } from "../../../components/AdpValueLabel";

// One player's keeper status for the pre-draft rankings' Keeper column - the
// actual price/streak entered on the Keepers tab (see KeepersTab.tsx's
// addKeeper) for this player's current-season keeper pick, not a projected
// cost. See PlayersTable.tsx's keeperInfoByFpid.
export interface KeeperInfo {
  // Optional since draftPicks.price is (SNAKE_DRAFT.md §3.2) - this dollar
  // display is auction-only in practice (round-based keeper cost is a
  // separate, phase-2 concept), so it's always real here today.
  price: number | undefined;
  // Consecutive seasons kept, including this one - undefined defaults to 1
  // wherever read, same convention as the draftPicks.keeperStreak field.
  streak: number | undefined;
}

interface PlayerRowProps {
  row: Doc<"projections">;
  index: number;
  scoringConfig: ScoringConfig;
  injury: { status: string; statusShort: string } | undefined;
  isRookie: boolean;
  draftValue:
    | {
        dollarValue: number;
        usedFallback: boolean;
        tier: number;
        tierLabel: string;
      }
    | undefined;
  standardValue: StandardValueRow | undefined;
  // Auction: $ / vs. market (draftValue/standardValue above). Snake/linear:
  // ADP / vs ADP (adp/ourRank below) - see PlayersTable.tsx's
  // blendedAdpByFpid/ourRankByFpid for how these are built.
  isAuction: boolean;
  adp: number | undefined;
  ourRank: number | undefined;
  valueGap: ValueGap | undefined;
  showValueColumn: boolean;
  tag: PlayerTag | undefined;
  onCycleTag: (() => void) | undefined;
  onSelectPlayer: (fpid: number) => void;
  consistency: ConsistencyLabel | undefined;
  showConsistencyColumn: boolean;
  keeperInfo: KeeperInfo | undefined;
  showKeeperColumn: boolean;
  showKeeperYear: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function PlayerRow({
  row,
  index,
  scoringConfig,
  injury,
  isRookie,
  draftValue,
  standardValue,
  isAuction,
  adp,
  ourRank,
  valueGap,
  showValueColumn,
  tag,
  onCycleTag,
  onSelectPlayer,
  consistency,
  showConsistencyColumn,
  keeperInfo,
  showKeeperColumn,
  showKeeperYear,
  isExpanded,
  onToggleExpand,
}: PlayerRowProps) {
  // Keeper is the only thing still tucked behind the expand chevron (see
  // PlayersTable.tsx's header) - Target/Avoid moved into the main row below,
  // so there's nothing to expand into when no league (and therefore no
  // Keeper data) is selected.
  const showChevron = showKeeperColumn;
  // Rank, FPTS, $ + vs. market + Tier (when shown, 3 columns), Target/Avoid,
  // Pos, Player, Tags, Team, plus the chevron itself when shown - kept in
  // sync with the header column count in PlayersTable.tsx so the expanded
  // Keeper row's colSpan always spans the full table width.
  const columnCount = 7 + (showValueColumn ? 3 : 0) + (showChevron ? 1 : 0);

  return (
    <Fragment>
      <Table.Tr
        onClick={showChevron ? onToggleExpand : undefined}
        style={showChevron ? { cursor: "pointer" } : undefined}
      >
        <Table.Td>{index + 1}</Table.Td>
        <Table.Td>
          {pointsForScoringConfig(row, scoringConfig).toFixed(1)}
        </Table.Td>
        {showValueColumn && (
          <Table.Td>
            {isAuction ? (
              draftValue ? (
                draftValue.usedFallback ? (
                  <Tooltip
                    label="Approximate: this position's replacement-level player isn't in our data yet, so this uses a fallback estimate"
                    multiline
                    w={260}
                    withArrow
                  >
                    <Text span size="sm" fs="italic" c="dimmed">
                      ${Math.round(draftValue.dollarValue)}
                    </Text>
                  </Tooltip>
                ) : (
                  `$${Math.round(draftValue.dollarValue)}`
                )
              ) : (
                "—"
              )
            ) : adp !== undefined ? (
              Math.round(adp)
            ) : (
              "—"
            )}
          </Table.Td>
        )}
        {showValueColumn && (
          <Table.Td>
            {isAuction ? (
              <StandardValueLabel
                draftValue={draftValue?.dollarValue}
                standardValue={standardValue}
                showLabel={false}
              />
            ) : (
              <AdpValueLabel ourRank={ourRank} adp={adp} showLabel={false} />
            )}
          </Table.Td>
        )}
        {showValueColumn && (
          <Table.Td>
            {draftValue && (
              <Tooltip label={draftValue.tierLabel} withArrow>
                <Badge size="sm" variant="light" color="gray" circle>
                  {draftValue.tier}
                </Badge>
              </Tooltip>
            )}
          </Table.Td>
        )}
        <Table.Td>
          <Tooltip
            label={
              !onCycleTag
                ? "Select a league to mark targets/avoids"
                : tag === "target"
                  ? "Target - click to mark avoid"
                  : tag === "avoid"
                    ? "Avoid - click to clear"
                    : "Click to mark as target"
            }
          >
            <ActionIcon
              size={32}
              disabled={!onCycleTag}
              onClick={(event) => {
                event.stopPropagation();
                onCycleTag?.();
              }}
              aria-label="Cycle target/avoid"
              {...(tag
                ? playerTagStyle(tag)
                : { variant: "subtle", color: "gray" })}
            >
              {tag === "avoid" ? <Ban size={16} /> : <Target size={16} />}
            </ActionIcon>
          </Tooltip>
        </Table.Td>
        <Table.Td miw={70}>
          <Badge
            size="sm"
            color={POSITION_COLORS[row.position]}
            variant="light"
          >
            {row.position}
          </Badge>
        </Table.Td>
        <Table.Td miw={220}>
          <Group gap={6}>
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onSelectPlayer(row.fpid);
              }}
            >
              {row.name}
            </Anchor>
            {isRookie && <RookieBadge />}
            {injury && (
              <Badge
                color={injuryColor(injury.status)}
                size="sm"
                variant="light"
              >
                {injury.statusShort}
              </Badge>
            )}
          </Group>
        </Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            <Box w={28} style={{ display: "flex", justifyContent: "center" }}>
              {valueGap && (
                <ValueGapIcon valueGap={valueGap} position={row.position} />
              )}
            </Box>
            {showConsistencyColumn && consistency && (
              <ConsistencyIcon label={consistency} />
            )}
          </Group>
        </Table.Td>
        <Table.Td>{row.team ?? "—"}</Table.Td>
        {showChevron && (
          <Table.Td>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={isExpanded ? "Hide details" : "Show details"}
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </ActionIcon>
          </Table.Td>
        )}
      </Table.Tr>
      {showChevron && isExpanded && (
        <Table.Tr>
          <Table.Td colSpan={columnCount}>
            <Group gap={6} py={4}>
              <Text size="xs" fw={600} c="dimmed">
                Keeper:
              </Text>
              <Text size="xs">
                {keeperInfo
                  ? showKeeperYear
                    ? `$${keeperInfo.price ?? 0} · Yr ${keeperInfo.streak ?? 1}`
                    : `$${keeperInfo.price ?? 0}`
                  : "—"}
              </Text>
            </Group>
          </Table.Td>
        </Table.Tr>
      )}
    </Fragment>
  );
}
