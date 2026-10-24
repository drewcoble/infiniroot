import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Center, Group, Loader, Select, Stack, Text, Title } from "@mantine/core";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { DivergingBars, ValueBars } from "../../../components/charts/BarRows";
import { NEUTRAL_MARK, SERIES, STATUS } from "../../../components/charts/chartTheme";
import { RankDumbbell } from "../../../components/charts/RankDumbbell";
import { RankLine } from "../../../components/charts/RankLine";
import { SegmentGauge } from "../../../components/charts/SegmentGauge";
import { SlopeChart, type SlopeRow } from "../../../components/charts/SlopeChart";
import { Sparkline } from "../../../components/charts/Sparkline";
import { WeeklyBars } from "../../../components/charts/WeeklyBars";
import chartClasses from "../../../components/charts/charts.module.css";
import { GlassSegmented } from "../../../components/cards/GlassSegmented";
import cardClasses from "../../../components/cards/GlassMatchupCard.module.css";
import { seasonPositionRanks } from "../../../lib/seasonPositionRanks";
import { UsageChart } from "../../../components/player/UsageChart";
import type { RosVorRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/simpleMode")({
  component: SimpleModePage,
});

// Chart sandbox for simple mode - the visuals that will stand in for the
// app's stat tables (see the simple-mode plan). The player section reads
// this league's real board and game logs, with a PLACEHOLDER usage formula
// (lib/usageScore.ts); everything below it is sample data. Nothing here is
// used by the other tabs yet.

interface NflState {
  season: string;
  week: string;
}

type UsagePosition = "QB" | "RB" | "WR" | "TE";

function isUsagePosition(position: string): position is UsagePosition {
  return position === "QB" || position === "RB" || position === "WR" || position === "TE";
}

// Axis depth per position for the rank dumbbells - about as deep as a
// fantasy-relevant rank goes.
const RANK_AXIS: Record<UsagePosition, number> = { QB: 36, RB: 60, WR: 72, TE: 36 };


// One example: a glass card with the chart's name. No caption - each chart
// should read at a glance on its own (what it replaces is noted in a
// comment at each use).
function Example({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={cardClasses.card} style={{ gap: 10, padding: 14 }}>
      <Text fw={600} size="sm">
        {title}
      </Text>
      {children}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <Stack gap={0}>
        <Title order={4}>{title}</Title>
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      </Stack>
      {children}
    </Stack>
  );
}

function SimpleModePage() {
  const currentUser = useQuery(api.users.getCurrentUser);

  if (currentUser === undefined) {
    return (
      <Center>
        <Loader />
      </Center>
    );
  }

  // Super-admin only - AppHeader hides the link for everyone else; this
  // guards a direct URL visit too.
  if (currentUser?.role !== "super-admin") {
    return (
      <Text c="dimmed" ta="center" py="xl">
        You don&apos;t have access to this page.
      </Text>
    );
  }

  return (
    <Stack gap="xl">
      <Title order={3}>Simple mode</Title>
      <PlayerExamples />
      <TradeExamples />
      <FreeAgentExamples />
      <LeagueExamples />
      <InjuryExamples />
    </Stack>
  );
}

function PlayerExamples() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );
  const board: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const seasonRankByFpid = useMemo(() => seasonPositionRanks(board), [board]);
  const candidates = useMemo(
    () =>
      (board ?? [])
        .filter((row) => isUsagePosition(row.position))
        .sort((a, b) => a.rosRank - b.rosRank)
        .slice(0, 300),
    [board],
  );

  // Defaults to the board's top RB - the position the usage chart was
  // designed around.
  const [pickedFpid, setPickedFpid] = useState<number | null>(null);
  const fpid = pickedFpid ?? candidates.find((row) => row.position === "RB")?.fpid ?? null;
  const player = candidates.find((row) => row.fpid === fpid);

  const seasons = useQuery(
    api.infinileague.season.gameLog.getGameLogSeasons,
    isAuthenticated && fpid !== null ? { seasonId, fpid } : "skip",
  );
  const [pickedYear, setPickedYear] = useState<string | null>(null);
  const years = (seasons ?? []).slice(0, 3).map((season) => season.season);
  const year =
    pickedYear !== null && years.includes(pickedYear)
      ? pickedYear
      : ((seasons ?? []).find((season) => season.gamesPlayed > 0)?.season ?? years[0] ?? null);

  const log = useQuery(
    api.infinileague.season.gameLog.getGameLog,
    isAuthenticated && fpid !== null && year !== null ? { seasonId, fpid, year } : "skip",
  );

  if (board === undefined || nflState === undefined) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }

  return (
    <Section
      title="Player"
      note="Real data from this league. Usage scores use a placeholder formula - not calibrated."
    >
      <Select
        label="Player"
        searchable
        data={candidates.map((row) => ({
          value: String(row.fpid),
          label: `${row.name} · ${row.position}${row.positionRank} · ${row.team ?? "FA"}`,
        }))}
        value={fpid !== null ? String(fpid) : null}
        onChange={(value) => {
          if (value !== null) setPickedFpid(Number(value));
        }}
        allowDeselect={false}
      />
      {years.length > 1 && year !== null && (
        <GlassSegmented
          compact
          label="Season"
          value={year}
          onChange={setPickedYear}
          options={years.map((value) => ({ value, label: value }))}
        />
      )}

      {player && isUsagePosition(player.position) && (
        <>
          {log === undefined ? (
            <Center py="md">
              <Loader size="sm" />
            </Center>
          ) : log === null || log.weeks.length === 0 ? (
            <Text size="sm" c="dimmed">
              No games logged for {year}.
            </Text>
          ) : (
            <>
              {fpid !== null && year !== null && (
                <Example title="Usage score (as in the player popover)">
                  <UsageChart fpid={fpid} year={year} />
                </Example>
              )}
              <PointsExample weeks={log.weeks} position={player.position} />
            </>
          )}
          {/* Replaces the Season | ROS position-rank table and the projected-rank tile. */}
          <Example title="Where he ranks">
            <RankDumbbell
              position={player.position}
              maxRank={RANK_AXIS[player.position]}
              fromLabel="Season so far"
              toLabel="Projected"
              rows={[
                {
                  key: "ros",
                  label: "Rest of season",
                  from: seasonRankByFpid.get(player.fpid),
                  to: player.positionRank,
                },
                {
                  key: "week",
                  label: `Week ${nflState?.week ?? ""}`,
                  from: seasonRankByFpid.get(player.fpid),
                  to: player.weekPositionRank,
                },
              ]}
            />
          </Example>
          {fpid !== null && year !== null && (
            <RankHistoryExample
              fpid={fpid}
              year={year}
              position={player.position}
              maxRank={RANK_AXIS[player.position]}
            />
          )}
        </>
      )}
    </Section>
  );
}

// Experiment: the "Where he ranks" read as a timeline - his season-to-date
// position rank after each week, by points per game (min. half the weeks
// played) and by total points, for comparing which reads better.
function RankHistoryExample({
  fpid,
  year,
  position,
  maxRank,
}: {
  fpid: number;
  year: string;
  position: UsagePosition;
  maxRank: number;
}) {
  const { leagueId } = Route.useParams();
  const { isAuthenticated } = useConvexAuth();
  const history = useQuery(
    api.infinileague.season.rankHistory.getSeasonRankHistory,
    isAuthenticated ? { seasonId: leagueId as Id<"seasons">, fpid, year } : "skip",
  );
  return (
    <Example title="Rank by week">
      {history === undefined ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : history === null || history.weeks.length === 0 ? (
        <Text size="sm" c="dimmed">
          No games logged for {year}.
        </Text>
      ) : (
        <RankLine
          weeks={history.weeks.map((week) => week.week)}
          position={position}
          maxRank={maxRank}
          series={[
            {
              key: "ppg",
              label: "By points per game",
              color: SERIES[0],
              ranks: history.weeks.map((week) => week.ppgRank),
            },
            {
              key: "total",
              label: "By total points",
              // Neutral gray - orange read as "bad" next to the blue.
              color: NEUTRAL_MARK,
              ranks: history.weeks.map((week) => week.totalRank),
            },
          ]}
          ariaLabel={
            `Season-to-date ${position} rank by week: ` +
            history.weeks
              .map(
                (week) =>
                  `week ${week.week} ` +
                  `${week.ppgRank ? `${position}${week.ppgRank}` : "unranked"} per game, ` +
                  `${week.totalRank ? `${position}${week.totalRank}` : "unranked"} total`,
              )
              .join("; ")
          }
        />
      )}
    </Example>
  );
}

function PointsExample({
  weeks,
  position,
}: {
  weeks: Array<{
    week: number;
    kind: "played" | "dnp" | "bye";
    points: number | null;
    positionRank: number | null;
  }>;
  position: string;
}) {
  const played = weeks.filter((week) => week.kind === "played" && week.points !== null);
  const average =
    played.length > 0
      ? played.reduce((sum, week) => sum + (week.points ?? 0), 0) / played.length
      : undefined;
  const best = played.reduce<(typeof played)[number] | undefined>(
    (top, week) => (top === undefined || (week.points ?? 0) > (top.points ?? 0) ? week : top),
    undefined,
  );
  // Replaces the game log's Pts and Rank columns, and the season PPG tile.
  return (
    <Example title="Points by week">
      <WeeklyBars
        data={weeks.map((week) => ({
          week: week.week,
          kind: week.kind,
          values: [Math.max(week.points ?? 0, 0)],
        }))}
        series={[{ key: "points", label: "Points", color: NEUTRAL_MARK }]}
        reference={
          average !== undefined ? { value: average, label: `Avg ${average.toFixed(1)}` } : undefined
        }
        ariaLabel={
          "Fantasy points by week" +
          (average !== undefined ? `, averaging ${average.toFixed(1)}` : "")
        }
        readout={(datum) => {
          if (datum === null) {
            return (
              <>
                <span className={chartClasses.readoutMain}>
                  {average !== undefined ? `${average.toFixed(1)} points per game` : "No games yet"}
                </span>
                {best && (
                  <span className={chartClasses.readoutSub}>
                    {`Best: ${best.points?.toFixed(1)} in week ${best.week}`}
                  </span>
                )}
              </>
            );
          }
          const week = weeks.find((entry) => entry.week === datum.week);
          if (!week || week.kind !== "played" || week.points === null) {
            return (
              <span className={chartClasses.readoutMain}>
                {`Week ${datum.week} · ${datum.kind === "bye" ? "Bye" : "Didn't play"}`}
              </span>
            );
          }
          return (
            <>
              <span className={chartClasses.readoutMain}>
                {`Week ${week.week} · ${week.points.toFixed(1)} pts`}
              </span>
              <span className={chartClasses.readoutSub}>
                {week.positionRank !== null
                  ? `${position}${week.positionRank} that week`
                  : "No rank that week"}
              </span>
            </>
          );
        }}
      />
    </Example>
  );
}

const SAMPLE_POWER: SlopeRow[] = [
  { key: "a", name: "Gridiron Gurus", before: 1, after: 1 },
  { key: "b", name: "Waiver Wire Warriors", before: 2, after: 3 },
  { key: "you", name: "Your team", before: 6, after: 2 },
  { key: "c", name: "Fourth & Long", before: 3, after: 4 },
  { key: "d", name: "Bench Mob", before: 4, after: 5 },
  { key: "partner", name: "Tua Legit", before: 5, after: 7 },
  { key: "e", name: "Kicker Problems", before: 7, after: 6 },
  { key: "f", name: "Hail Mary Club", before: 8, after: 8 },
  { key: "g", name: "Run CMC", before: 9, after: 9 },
  { key: "h", name: "Sunday Scaries", before: 10, after: 10 },
  { key: "i", name: "Bye Week Blues", before: 11, after: 11 },
  { key: "j", name: "The Tankers", before: 12, after: 12 },
];

function TradeExamples() {
  return (
    <Section title="Trade" note="Sample data.">
      {/* Replaces the signal cards' “WR9 / Mkt WR18” pair and the BUY / SELL badge. */}
      <Example title="Buys and sells">
        <RankDumbbell
          position="WR"
          maxRank={48}
          fromLabel="Market"
          toLabel="infini"
          rows={[
            { key: 1, label: "Garrett Wilson · buy", from: 18, to: 9 },
            { key: 2, label: "DeVonta Smith · buy", from: 31, to: 22 },
            { key: 3, label: "Cooper Kupp · sell", from: 14, to: 27 },
          ]}
        />
      </Example>

      {/* Replaces Mkt / Infini / Avg columns, the Value-PPG-Ranks switch, and the 2-for-1 row. */}
      <Example title="Trade value">
        <ValueBars
          color={SERIES[0]}
          barLabel="Our value"
          markerLabel="Market"
          rows={[
            {
              key: "get",
              label: "You get",
              value: 5030,
              valueText: "5,030",
              marker: 5600,
              markerText: "5,600",
            },
            {
              key: "send",
              label: "You send",
              value: 4620,
              valueText: "4,620",
              marker: 4210,
              markerText: "4,210",
            },
          ]}
        />
      </Example>

      {/* Replaces the suggestion card's gain, PPG gain, value net, and rank-move numbers. */}
      <Example title="Who a suggested trade helps">
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Points per week
          </Text>
          <DivergingBars
            rows={[
              { key: "you", label: "You", value: 2.1, valueText: "+2.1" },
              { key: "them", label: "Tua Legit", value: -0.4, valueText: "−0.4" },
            ]}
          />
          <Text size="xs" c="dimmed" mt={6}>
            Power rank
          </Text>
          <DivergingBars
            maxAbs={5}
            rows={[
              { key: "you", label: "You", value: 4, valueText: "+4 spots" },
              { key: "them", label: "Tua Legit", value: -2, valueText: "−2 spots" },
            ]}
          />
        </Stack>
      </Example>

      {/* Replaces the 12-row post-trade rankings list and its bottom sheet. */}
      <Example title="Post-trade power rankings">
        <SlopeChart
          rows={SAMPLE_POWER}
          highlight={["you", "partner"]}
          beforeLabel="Now"
          afterLabel="After trade"
        />
      </Example>
    </Section>
  );
}

// `usage` is the last six weeks' usage score (null = didn't play).
const SAMPLE_FREE_AGENTS = [
  {
    fpid: 1,
    name: "Tyjae Spears",
    detail: "RB · TEN",
    usage: [22, 30, null, 41, 48, 63],
    bid: 14,
    market: 9,
  },
  {
    fpid: 2,
    name: "Jalen McMillan",
    detail: "WR · TB",
    usage: [18, 25, 20, 37, 44, 52],
    bid: 8,
    market: 10,
  },
  {
    fpid: 3,
    name: "Jaylen Warren",
    detail: "RB · PIT",
    usage: [55, 48, 41, 38, 30, 27],
    bid: 2,
    market: 6,
  },
];

function FreeAgentExamples() {
  return (
    <Section title="Free agents" note="Sample data.">
      {/* Replaces the Week / Season views and the Actual / Proj sorts for spotting a breakout. */}
      <Example title="Rising usage at a glance">
        <Stack gap={10}>
          {SAMPLE_FREE_AGENTS.map((player) => {
            const last = player.usage[player.usage.length - 1] ?? 0;
            return (
              <Group key={player.fpid} justify="space-between" wrap="nowrap" gap="sm">
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} truncate>
                    {player.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {player.detail}
                  </Text>
                </Stack>
                <Group gap={8} wrap="nowrap">
                  <Sparkline
                    values={player.usage}
                    color={SERIES[0]}
                    min={0}
                    max={100}
                    ariaLabel={`${player.name} usage, last 6 weeks, now ${last}`}
                  />
                  <Text size="sm" fw={600} w={24} ta="right" className="num">
                    {last}
                  </Text>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Example>

      {/* Replaces the Bid | Mkt pair and the Your bid / Market / Your value tiles. */}
      <Example title="Bid vs. market">
        <ValueBars
          color={SERIES[0]}
          barLabel="Suggested bid"
          markerLabel="Market"
          rows={SAMPLE_FREE_AGENTS.map((player) => ({
            key: player.fpid,
            label: player.name,
            value: player.bid,
            valueText: `$${player.bid}`,
            marker: player.market,
            markerText: `$${player.market}`,
          }))}
        />
      </Example>
    </Section>
  );
}

const SAMPLE_RANK_HISTORY = [
  { name: "Your team", ranks: [9, 8, 8, 6, 5, 4, 3] },
  { name: "Gridiron Gurus", ranks: [1, 1, 2, 1, 1, 1, 1] },
  { name: "Tua Legit", ranks: [3, 4, 5, 5, 6, 6, 7] },
  { name: "Bench Mob", ranks: [6, 6, 4, 4, 4, 5, 5] },
];

function LeagueExamples() {
  return (
    <Section title="League" note="Sample data.">
      {/* Replaces the one-week ▲/▼ badge - the whole climb or slide, not just the
          last step. */}
      <Example title="Power rank over the season">
        <Stack gap={10}>
          {SAMPLE_RANK_HISTORY.map((team) => {
            const now = team.ranks[team.ranks.length - 1] ?? 0;
            return (
              <Group key={team.name} justify="space-between" wrap="nowrap" gap="sm">
                <Text size="sm" fw={600} truncate>
                  {team.name}
                </Text>
                <Group gap={8} wrap="nowrap">
                  <Sparkline
                    values={team.ranks}
                    color={SERIES[0]}
                    min={1}
                    max={12}
                    invert
                    ariaLabel={`${team.name} power rank by week, now ${now}`}
                  />
                  <Text size="sm" fw={600} w={28} ta="right" className="num">
                    #{now}
                  </Text>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Example>
    </Section>
  );
}

function InjuryExamples() {
  return (
    <Section title="Injuries" note="Sample data.">
      {/* Replaces “Questionable (2.31 / 4) conf 78%”, “p 64% · conf 71%”. */}
      <Example title="Injury outlook">
        <Stack gap="sm">
          <SegmentGauge
            title="Next game"
            steps={["Full go", "Likely", "Game-time call", "Unlikely", "Out"]}
            level={2}
            color={STATUS.warning}
            confidence={0.78}
          />
          <SegmentGauge
            title="If he plays"
            steps={["No impact", "Slightly limited", "Limited", "Decoy role"]}
            level={1}
            color={STATUS.warning}
            confidence={0.6}
          />
          <SegmentGauge
            title="Time missed"
            steps={["No games", "≤ 1 game", "2–4 weeks", "5+ weeks", "Season"]}
            level={1}
            color={STATUS.serious}
            confidence={0.71}
          />
        </Stack>
      </Example>
    </Section>
  );
}
