import { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

// One defense's matchup grade at one position, in the league's scoring -
// see convex/lib/matchupDifficulty.ts. rank 1 = the easiest of `of`
// defenses at the position; tier is the color (WR is always "neutral" -
// graded, but no measurable signal to color).
export type MatchupGrade = NonNullable<
  FunctionReturnType<typeof api.infinileague.season.matchupDifficulty.getMatchupDifficulty>
>[number];

export type MatchupGrades = Map<string, MatchupGrade>;

const gradeKey = (defense: string, position: string) => `${defense}|${position}`;

// The viewed week's grades, keyed for matchupGradeFor. Undefined while
// loading, before week 5, or before any defense set exists.
export function useMatchupGrades(
  seasonId: string | undefined,
  week: string | null | undefined,
): MatchupGrades | undefined {
  const { isAuthenticated } = useConvexAuth();
  const grades = useQuery(
    api.infinileague.season.matchupDifficulty.getMatchupDifficulty,
    isAuthenticated && seasonId && week ? { seasonId: seasonId as Id<"seasons">, week } : "skip",
  );
  return useMemo(
    () =>
      grades ? new Map(grades.map((grade) => [gradeKey(grade.defense, grade.position), grade])) : undefined,
    [grades],
  );
}

export function matchupGradeFor(
  grades: MatchupGrades | undefined,
  opponent: string,
  position: string,
): MatchupGrade | undefined {
  return grades?.get(gradeKey(opponent, position));
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

const CATEGORY_LABEL: Record<MatchupGrade["categories"][number]["category"], string> = {
  pass: "Pass",
  rush: "Rush",
  rec: "Rec",
};

// The popover's one line: "6th easiest vs. RB · Rush 7th · Rec 2nd".
// A single-category position (TE) skips the breakdown - it'd repeat the rank.
export function matchupSummary(grade: MatchupGrade): string {
  const parts = [`${ordinal(grade.rank)} easiest vs. ${grade.position}`];
  if (grade.categories.length > 1) {
    for (const category of grade.categories) {
      parts.push(`${CATEGORY_LABEL[category.category]} ${ordinal(category.rank)}`);
    }
  }
  return parts.join(" · ");
}
