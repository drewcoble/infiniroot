import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";
import { evaluate, type Standing } from "@playoffRules/evaluate";
import type { PlayoffFormat } from "@playoffRules/format";
import { GlassSectionDivider } from "@shared/glass/GlassSectionDivider";
import { GlassSegmented } from "@shared/glass/GlassSegmented";
import { pillStyle } from "@shared/glass/pills";
import classes from "@shared/glass/GlassMatchupCard.module.css";
import { TeamRow } from "../../../components/TeamRow";
import { currentInput } from "../../../lib/engineInput";
import type { TeamOdds } from "../../../lib/odds";
import { useSeasonData, type SeasonData } from "../../../lib/seasonData";
import { useOdds } from "../../../lib/useOdds";

export const Route = createFileRoute("/league/$leagueId/")({
  component: PicturePage,
});

type View = "now" | "projected";

// Tier pill colors, top tier first.
const TIER_COLORS = ["yellow", "teal", "blue", "gray", "grape", "orange"];

function percent(p: number | undefined): string {
  if (p === undefined) return "—";
  if (p > 0 && p < 0.005) return "<1%";
  if (p < 1 && p >= 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

// Where the playoff line falls in plain standings: the last seed the
// championship stage takes straight from the regular season.
function playoffLine(format: PlayoffFormat): number | null {
  const stage = format.stages.find((s) => s.id === format.championshipStageId);
  const seeds = stage?.entrants.find((source) => source.from === "seeds");
  return seeds?.from === "seeds" ? seeds.lastSeed : null;
}

function tierForSeed(format: PlayoffFormat, seed: number): string | null {
  return format.tiers.find((t) => seed >= t.firstSeed && seed <= t.lastSeed)?.name ?? null;
}

// The playoff picture: standings now (or projected to the end of the
// regular season), split by tier or the playoff line, with each team's
// odds from simulating the rest of the season through the league's format.
function PicturePage() {
  const { data, error, rules, format } = useSeasonData();
  const [view, setView] = useState<View>("now");

  const state = useMemo(
    () => (data && format ? evaluate(format, currentInput(data, format, rules)) : undefined),
    [data, format, rules],
  );
  const oddsRequest = useMemo(
    () =>
      data && format
        ? { format, input: currentInput(data, format, rules), projected: data.projected }
        : null,
    [data, format, rules],
  );
  const odds = useOdds(oddsRequest);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!data || format === undefined || !state) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (format === null) {
    return <Text c="dimmed">This league doesn't have playoffs.</Text>;
  }

  const oddsByTeam = new Map(odds?.map((o) => [o.teamId, o]));
  const regularSeasonLeft = format.regularSeasonEndWeek - data.finalThroughWeek;
  const showProjected = regularSeasonLeft > 0 && view === "projected";

  return (
    <Stack gap="md">
      {regularSeasonLeft > 0 && (
        <GlassSegmented
          label="Standings"
          value={view}
          onChange={setView}
          options={[
            { value: "now", label: "Now" },
            { value: "projected", label: "Projected" },
          ]}
        />
      )}
      <span className={classes.sectionLabel}>
        {regularSeasonLeft > 0
          ? `Week ${data.currentWeek} · ${regularSeasonLeft} regular-season ` +
            (regularSeasonLeft === 1 ? "week left" : "weeks left")
          : "Regular season final"}
      </span>
      {showProjected ? (
        <ProjectedList data={data} format={format} odds={odds} standings={state.standings} />
      ) : (
        <NowList data={data} format={format} oddsByTeam={oddsByTeam} standings={state.standings} />
      )}
    </Stack>
  );
}

interface ListRow {
  teamId: string;
  rank: number;
  primary: string;
  secondaryLeft: string;
  odds: TeamOdds | undefined;
  stats: { label: string; items: { label: string; value: string }[] }[];
}

function Rows({
  rows,
  data,
  format,
}: {
  rows: ListRow[];
  data: SeasonData;
  format: PlayoffFormat;
}) {
  const teamById = new Map<string, SeasonData["teams"][number]>(
    data.teams.map((team) => [team.teamId, team]),
  );
  const line = format.tiers.length === 0 ? playoffLine(format) : null;
  return (
    <Stack gap={8}>
      {rows.map((row) => {
        const team = teamById.get(row.teamId);
        const tier = tierForSeed(format, row.rank);
        const tierIndex = format.tiers.findIndex((t) => t.name === tier);
        const startsTier = format.tiers[tierIndex]?.firstSeed === row.rank;
        const odds = row.odds;
        const oddsLine = odds ? `${percent(odds.playoffs)} playoffs` : "";
        return (
          <Fragment key={row.teamId}>
            {startsTier && <GlassSectionDivider label={`${tier} tier`} />}
            {line !== null && row.rank === line + 1 && (
              <GlassSectionDivider label="Outside the playoffs" />
            )}
            <TeamRow
              data={{
                teamId: row.teamId,
                name: team?.name ?? "Unknown team",
                rank: row.rank,
                isMine: team?.isMine ?? false,
                ...(tier
                  ? {
                      nameBadges: (
                        <span
                          className={classes.pill}
                          style={pillStyle(TIER_COLORS[tierIndex] ?? "gray")}
                        >
                          {tier}
                        </span>
                      ),
                    }
                  : {}),
                primary: row.primary,
                secondaryLeft: <span className="num">{row.secondaryLeft}</span>,
                secondaryRight: <span className="num">{oddsLine}</span>,
                summary: [row.secondaryLeft, oddsLine].filter(Boolean).join(", "),
                stats: [
                  ...row.stats,
                  ...(odds
                    ? [
                        {
                          label: "Odds",
                          items: [
                            ...format.tiers.map((t) => ({
                              label: `${t.name} tier`,
                              value: percent(odds.tiers[t.name] ?? 0),
                            })),
                            { label: "Playoffs", value: percent(odds.playoffs) },
                            { label: "Title", value: percent(odds.title) },
                          ],
                        },
                      ]
                    : []),
                ],
              }}
            />
          </Fragment>
        );
      })}
    </Stack>
  );
}

function record(row: Pick<Standing, "wins" | "losses" | "ties">): string {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
}

function NowList({
  data,
  format,
  standings,
  oddsByTeam,
}: {
  data: SeasonData;
  format: PlayoffFormat;
  standings: Standing[];
  oddsByTeam: Map<string, TeamOdds>;
}) {
  const rows: ListRow[] = standings.map((row) => ({
    teamId: row.teamId,
    rank: row.seed,
    primary: record(row),
    secondaryLeft: `${row.pointsFor.toFixed(1)} PF`,
    odds: oddsByTeam.get(row.teamId),
    stats: [
      {
        label: "Season",
        items: [
          { label: "Record", value: record(row) },
          { label: "For", value: row.pointsFor.toFixed(1) },
          { label: "Against", value: row.pointsAgainst.toFixed(1) },
        ],
      },
    ],
  }));
  return <Rows rows={rows} data={data} format={format} />;
}

// Teams in order of their average simulated seed, with the average final
// record - wins rounded, losses whatever's left of the schedule.
function ProjectedList({
  data,
  format,
  odds,
  standings,
}: {
  data: SeasonData;
  format: PlayoffFormat;
  odds: TeamOdds[] | undefined;
  standings: Standing[];
}) {
  if (!odds) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  const nowByTeam = new Map(standings.map((row) => [row.teamId, row]));
  const rows: ListRow[] = [...odds]
    .sort((a, b) => a.seed - b.seed)
    .map((o, index) => {
      const games = Math.round(o.wins + o.losses);
      const wins = Math.round(o.wins);
      const now = nowByTeam.get(o.teamId);
      const nowLine = now ? `Now ${record(now)}, #${now.seed}` : "";
      return {
        teamId: o.teamId,
        rank: index + 1,
        primary: `${wins}-${games - wins}`,
        secondaryLeft: nowLine,
        odds: o,
        stats: [
          {
            label: "Projected",
            items: [
              { label: "Record", value: `${wins}-${games - wins}` },
              { label: "Avg seed", value: o.seed.toFixed(1) },
              { label: "Points", value: o.pointsFor.toFixed(0) },
            ],
          },
        ],
      };
    });
  return <Rows rows={rows} data={data} format={format} />;
}
