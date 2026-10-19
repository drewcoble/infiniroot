#!/usr/bin/env python3
"""Calibrates the usage score - see docs/usage-score.md.

Fits expected-fantasy-points weights for each opportunity stat (carries,
targets, red-zone looks, pass attempts) against real weekly results, for
every scoring setup a league can have, then builds the percentile tables
the score is read against. Writes infinidata/convex/lib/usageCalibration.ts.

Data: Sleeper's public weekly stats endpoint (the same source the stats
sync uses), cached under ./cache. Re-run once a season, in the offseason,
after bumping BASELINE_SEASONS:

    python3 scripts/usage-calibration/calibrate.py

Pure Python (no numpy) - the fits are a handful of features each.
"""

import bisect
import concurrent.futures
import json
import os
import statistics
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "..", "..", "..", "infinidata", "convex", "lib", "usageCalibration.ts")

BASELINE_SEASONS = ("2023", "2024", "2025")
# Held out of the validation fit to check the weights generalize.
HOLDOUT_SEASON = "2025"
WEEKS = range(1, 19)
POSITIONS = ("QB", "RB", "WR", "TE")

# Each week's comparison group: the top N player-weeks by expected points.
# RB/WR/TE share one group (the score compares across them); QBs get their
# own, since against flex players nearly every QB lands in the 80s-90s.
FLEX_POOL = 60 + 80 + 32
QB_POOL = 32

SCORINGS = {"STD": "pts_std", "HALF": "pts_half_ppr", "PPR": "pts_ppr"}
# Mirrors convex/scoring.ts's TE_BONUS_PER_REC.
TE_BONUS = {"NONE": 0.0, "HALF": 0.5, "FULL": 1.0}

# Opportunity only - never results (yards, catches, TDs). Sleeper's
# rec_air_yd counts completed passes only (air + YAC == rec yards), so it's
# a result, not an opportunity, and stays out. Snaps / snap share / target
# share were tested and add ~nothing to describing a week (+0.005 R^2) -
# see the doc; they belong in a forward-looking score instead.
RUSH = ("rush_att", "rush_rz_att")
REC = ("rec_tgt", "rec_rz_tgt")
PASS = ("pass_att", "pass_rz_att")


def fetch_all():
    os.makedirs(CACHE, exist_ok=True)
    jobs = [(s, w, p) for s in BASELINE_SEASONS for w in WEEKS for p in POSITIONS]

    def get(job):
        season, week, position = job
        path = os.path.join(CACHE, f"{season}_{week}_{position}.json")
        if os.path.exists(path):
            return
        url = (
            f"https://api.sleeper.com/stats/nfl/{season}/{week}"
            f"?season_type=regular&position[]={position}"
        )
        request = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        with open(path, "wb") as file:
            file.write(data)

    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        list(pool.map(get, jobs))


def load():
    """[(season, week, position, stats)] for every player-week with a game played."""
    rows = []
    for season in BASELINE_SEASONS:
        for week in WEEKS:
            for position in POSITIONS:
                path = os.path.join(CACHE, f"{season}_{week}_{position}.json")
                with open(path) as file:
                    for record in json.load(file):
                        stats = record.get("stats") or {}
                        if (stats.get("gp") or 0) > 0:
                            rows.append((season, week, position, stats))
    return rows


def stat(stats, key):
    return stats.get(key, 0) or 0


def solve(matrix, vector):
    n = len(vector)
    m = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for c in range(n):
        pivot = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[pivot] = m[pivot], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def least_squares(samples):
    """No intercept: zero opportunities means zero expected points."""
    k = len(samples[0][0])
    a = [[sum(x[i] * x[j] for x, _ in samples) for j in range(k)] for i in range(k)]
    b = [sum(x[i] * y for x, y in samples) for i in range(k)]
    return solve(a, b)


def r_squared(samples, weights):
    ys = [y for _, y in samples]
    mean = sum(ys) / len(ys)
    residual = sum((y - sum(w * v for w, v in zip(weights, x))) ** 2 for x, y in samples)
    return 1 - residual / sum((y - mean) ** 2 for y in ys)


# Feature vectors and targets per model.


def flex_features(position, stats, te_premium):
    features = [stat(stats, k) for k in RUSH + REC]
    if te_premium:
        # TE premium makes a TE's target worth more than anyone else's - its
        # own extra weight, fit on top of the shared target weight.
        features.append(stat(stats, "rec_tgt") if position == "TE" else 0)
    return features


def flex_points(position, stats, scoring, te):
    bonus = TE_BONUS[te] * stat(stats, "rec") if position == "TE" else 0
    return stat(stats, SCORINGS[scoring]) + bonus


def qb_features(stats):
    return [stat(stats, k) for k in PASS + RUSH]


def qb_points(stats, scoring, six_point):
    return stat(stats, SCORINGS[scoring]) + (2 * stat(stats, "pass_td") if six_point else 0)


def flex_samples(rows, scoring, te, seasons):
    return [
        (flex_features(p, s, te != "NONE"), flex_points(p, s, scoring, te))
        for season, _, p, s in rows
        if p != "QB" and season in seasons
    ]


def qb_samples(rows, scoring, six_point, seasons):
    return [
        (qb_features(s), qb_points(s, scoring, six_point))
        for season, _, p, s in rows
        if p == "QB" and season in seasons
    ]


def cut_points(values):
    """101 cut points: the 0th, 1st, ..., 100th percentile."""
    values = sorted(values)
    last = len(values) - 1
    return [round(values[round(last * q / 100)], 3) for q in range(101)]


def pooled(rows, positions, pool_size, xfp):
    """Each week's top `pool_size` player-weeks by expected points, pooled."""
    by_week = {}
    for season, week, p, s in rows:
        if p in positions:
            by_week.setdefault((season, week), []).append(xfp(p, s))
    out = []
    for values in by_week.values():
        out += sorted(values, reverse=True)[:pool_size]
    return out


def percentile(cuts, value):
    index = bisect.bisect_left(cuts, value)
    return min(index, 100)


def main():
    fetch_all()
    rows = load()
    all_seasons = set(BASELINE_SEASONS)
    train_seasons = all_seasons - {HOLDOUT_SEASON}
    report = []

    flex = {}
    for scoring in SCORINGS:
        for te in TE_BONUS:
            train = flex_samples(rows, scoring, te, train_seasons)
            test = flex_samples(rows, scoring, te, {HOLDOUT_SEASON})
            holdout_r2 = r_squared(test, least_squares(train))
            weights = least_squares(flex_samples(rows, scoring, te, all_seasons))
            by_season = [
                least_squares(flex_samples(rows, scoring, te, {season}))
                for season in BASELINE_SEASONS
            ]
            xfp = lambda p, s, w=weights, t=te: sum(
                a * b for a, b in zip(w, flex_features(p, s, t != "NONE"))
            )
            cuts = cut_points(pooled(rows, ("RB", "WR", "TE"), FLEX_POOL, xfp))
            flex[(scoring, te)] = (weights, cuts)
            report.append(
                f"FLEX {scoring:4} TE={te:4} holdout R2 {holdout_r2:.3f}  weights "
                + ", ".join(f"{w:.3f}" for w in weights)
                + "  per-season tgt/carry: "
                + ", ".join(f"{w[2]:.2f}/{w[0]:.2f}" for w in by_season)
            )

    qb = {}
    for scoring in SCORINGS:
        for six_point in (False, True):
            train = qb_samples(rows, scoring, six_point, train_seasons)
            test = qb_samples(rows, scoring, six_point, {HOLDOUT_SEASON})
            holdout_r2 = r_squared(test, least_squares(train))
            weights = least_squares(qb_samples(rows, scoring, six_point, all_seasons))
            xfp = lambda p, s, w=weights: sum(a * b for a, b in zip(w, qb_features(s)))
            cuts = cut_points(pooled(rows, ("QB",), QB_POOL, xfp))
            qb[(scoring, six_point)] = (weights, cuts)
            report.append(
                f"QB   {scoring:4} 6pt={str(six_point):5} holdout R2 {holdout_r2:.3f}  weights "
                + ", ".join(f"{w:.3f}" for w in weights)
            )

    # Calibration check on the holdout season (half PPR, no TE premium):
    # mean actual points per expected-points decile - should track xFP.
    weights, _ = flex[("HALF", "NONE")]
    test = flex_samples(rows, "HALF", "NONE", {HOLDOUT_SEASON})
    scored = sorted((sum(a * b for a, b in zip(weights, x)), y) for x, y in test)
    report.append("Holdout calibration (HALF, no TE premium) - decile: mean xFP vs mean actual")
    size = len(scored) // 10
    for d in range(10):
        chunk = scored[d * size : (d + 1) * size] if d < 9 else scored[9 * size :]
        report.append(
            f"  {d + 1:2}: {statistics.mean(x for x, _ in chunk):5.1f} vs "
            f"{statistics.mean(y for _, y in chunk):5.1f}"
        )

    print("\n".join(report))
    write_ts(flex, qb)


def ts_numbers(values):
    return "[" + ", ".join(f"{v:g}" for v in values) + "]"


def write_ts(flex, qb):
    lines = [
        "// GENERATED by infinileague/scripts/usage-calibration/calibrate.py - do not edit by hand.",
        "// Expected-points weights and percentile cut points for the usage score -",
        "// see infinileague/docs/usage-score.md. Baseline seasons: " + ", ".join(BASELINE_SEASONS) + ".",
        "",
        'export type UsageScoring = "STD" | "HALF" | "PPR";',
        'export type UsageTeScoring = "NONE" | "HALF" | "FULL";',
        "",
        "// RB/WR/TE: points per carry, red-zone carry (extra), target, red-zone",
        "// target (extra), and - TE premium only - a TE's extra per target.",
        "// `cuts` are the 0th..100th percentile of weekly expected points across",
        "// the flex comparison group.",
        "export interface FlexCalibration {",
        "  rushAtt: number;",
        "  rushRzAtt: number;",
        "  recTgt: number;",
        "  recRzTgt: number;",
        "  teTgt: number;",
        "  cuts: number[];",
        "}",
        "",
        "// QB: points per pass attempt, red-zone pass attempt (extra), carry,",
        "// red-zone carry (extra); `cuts` against other QBs.",
        "export interface QbCalibration {",
        "  passAtt: number;",
        "  passRzAtt: number;",
        "  rushAtt: number;",
        "  rushRzAtt: number;",
        "  cuts: number[];",
        "}",
        "",
        "export const FLEX_CALIBRATION: Record<UsageScoring, Record<UsageTeScoring, FlexCalibration>> = {",
    ]
    for scoring in SCORINGS:
        lines.append(f"  {scoring}: {{")
        for te in TE_BONUS:
            weights, cuts = flex[(scoring, te)]
            te_tgt = weights[4] if len(weights) > 4 else 0
            lines += [
                f"    {te}: {{",
                f"      rushAtt: {weights[0]:.4f},",
                f"      rushRzAtt: {weights[1]:.4f},",
                f"      recTgt: {weights[2]:.4f},",
                f"      recRzTgt: {weights[3]:.4f},",
                f"      teTgt: {te_tgt:.4f},",
                f"      cuts: {ts_numbers(cuts)},",
                "    },",
            ]
        lines.append("  },")
    lines += [
        "};",
        "",
        "// Keyed by scoring, then 6-point passing TDs.",
        "export const QB_CALIBRATION: Record<UsageScoring, { standard: QbCalibration; sixPointPassTds: QbCalibration }> = {",
    ]
    for scoring in SCORINGS:
        lines.append(f"  {scoring}: {{")
        for six_point, name in ((False, "standard"), (True, "sixPointPassTds")):
            weights, cuts = qb[(scoring, six_point)]
            lines += [
                f"    {name}: {{",
                f"      passAtt: {weights[0]:.4f},",
                f"      passRzAtt: {weights[1]:.4f},",
                f"      rushAtt: {weights[2]:.4f},",
                f"      rushRzAtt: {weights[3]:.4f},",
                f"      cuts: {ts_numbers(cuts)},",
                "    },",
            ]
        lines.append("  },")
    lines += ["};", ""]
    with open(OUT, "w") as file:
        file.write("\n".join(lines))


if __name__ == "__main__":
    main()
