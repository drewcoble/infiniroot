#!/usr/bin/env python3
"""Backtests the matchup difficulty rating before any of it is built.

The rating: how many fantasy points a defense gives up to a position, per
stat category (pass / rush / rec), relative to what the players it faced
usually score - then a player's matchup is his own category split weighted
by those multipliers. This script answers whether that carries any real
signal, how hard the raw multipliers need to be shrunk and damped, which
refinements earn their keep, and what green/red would mean in points.

Method, for every week W of each season:
  - Each player's baseline for a game is his average in his OTHER games
    that season before W, excluding every game against that opponent
    (leave-one-out, so a defense can't grade itself).
  - A defense's multiplier for (position, category) is
    (points allowed + K) / (baseline points + K) over games before W -
    K is shrinkage, in fantasy points, pulling small samples toward 1.0.
  - Prediction for a week-W game: the player's average so far, adjusted by
    the opponent's multipliers. The damping is fit by least squares on the
    training seasons and scored on the held-out season, against the plain
    average with no matchup adjustment at all.

Data: Sleeper's public weekly stats and projections endpoints (stats
reused from ../usage-calibration/cache when present), cached under ./cache.

    python3 scripts/matchup-difficulty/backtest.py [--scoring PPR|HALF|STD]

Writes results.md next to this file. Pure Python, no numpy.
"""

import argparse
import concurrent.futures
import json
import math
import os
import statistics
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
USAGE_CACHE = os.path.join(HERE, "..", "usage-calibration", "cache")
OUT = os.path.join(HERE, "results.md")

SEASONS = ("2022", "2023", "2024", "2025")
WEEKS = range(1, 19)
POSITIONS = ("QB", "RB", "WR", "TE")
# Categories each position's matchup is split into. A QB's rare catch and
# a TE's rare carry are left out - too few to grade a defense on.
CATEGORIES = {"QB": ("pass", "rush"), "RB": ("rush", "rec"), "WR": ("rec", "rush"), "TE": ("rec",)}
# The opportunity behind each category's points - the volume half of the
# volume/efficiency split.
VOLUME = {"pass": "pass_att", "rush": "rush_att", "rec": "rec_tgt"}
REC_POINTS = {"STD": 0.0, "HALF": 0.5, "PPR": 1.0}
PROJ_KEY = {"STD": "pts_std", "HALF": "pts_half_ppr", "PPR": "pts_ppr"}

# A prediction needs this many games of the player's own history, and a
# baseline of at least this many points (deep backups are noise).
MIN_GAMES = 3
MIN_BASELINE = 5.0
# A defense sample needs this many of the player's other games behind it.
MIN_OTHER_GAMES = 2
EVAL_WEEKS = range(5, 19)
EARLY_WEEKS = range(3, 7)


# ---------------------------------------------------------------- data


def fetch_all():
    os.makedirs(CACHE, exist_ok=True)
    jobs = [
        (kind, s, w, p)
        for kind in ("stats", "projections")
        for s in SEASONS
        for w in WEEKS
        for p in POSITIONS
    ]

    def get(job):
        kind, season, week, position = job
        name = f"{season}_{week}_{position}.json"
        path = os.path.join(CACHE, f"{kind}_{name}")
        if os.path.exists(path):
            return
        if kind == "stats" and os.path.exists(os.path.join(USAGE_CACHE, name)):
            with open(os.path.join(USAGE_CACHE, name), "rb") as src, open(path, "wb") as dst:
                dst.write(src.read())
            return
        url = (
            f"https://api.sleeper.com/{kind}/nfl/{season}/{week}"
            f"?season_type=regular&position[]={position}"
        )
        request = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        with open(path, "wb") as file:
            file.write(data)

    with concurrent.futures.ThreadPoolExecutor(3) as pool:
        list(pool.map(get, jobs))


def category_points(stats, scoring):
    s = lambda key: stats.get(key, 0) or 0
    return {
        "pass": s("pass_yd") * 0.04 + s("pass_td") * 4 - s("pass_int"),
        "rush": s("rush_yd") * 0.1 + s("rush_td") * 6,
        "rec": s("rec") * REC_POINTS[scoring] + s("rec_yd") * 0.1 + s("rec_td") * 6,
    }


def load(scoring):
    """games[season] -> list of player-games; proj[(season, week, pid)] -> points."""
    games = defaultdict(list)
    proj = {}
    for season in SEASONS:
        for week in WEEKS:
            for position in POSITIONS:
                name = f"{season}_{week}_{position}.json"
                with open(os.path.join(CACHE, f"stats_{name}")) as file:
                    records = json.load(file)
                for record in records:
                    stats = record.get("stats") or {}
                    if (stats.get("gp") or 0) <= 0 or not record.get("opponent"):
                        continue
                    if (record.get("player") or {}).get("position") != position:
                        continue
                    points = category_points(stats, scoring)
                    categories = CATEGORIES[position]
                    snaps, team_snaps = stats.get("off_snp"), stats.get("tm_off_snp")
                    games[season].append(
                        {
                            "week": week,
                            "pos": position,
                            "pid": record["player_id"],
                            "opp": record["opponent"],
                            "pts": {c: points[c] for c in categories},
                            "vol": {c: stats.get(VOLUME[c], 0) or 0 for c in categories},
                            "snap": snaps / team_snaps if snaps and team_snaps else None,
                        }
                    )
                with open(os.path.join(CACHE, f"projections_{name}")) as file:
                    for record in json.load(file):
                        value = (record.get("stats") or {}).get(PROJ_KEY[scoring])
                        if value is not None:
                            proj[(season, week, record["player_id"])] = value
    return games, proj


# ---------------------------------------------------------------- defense table


DEFAULT = {"K": 40.0, "half_life": None, "snap_filter": False, "sos": False, "prior_games": 0.0}


def build_table(prior_games, cfg, through_week, adjust=None, prior_table=None):
    """(opp, pos, cat|'T') -> [allowed pts, baseline pts, allowed vol, baseline vol, games].

    `adjust` (opp, pos, cat) -> multiplier divides each of a player's other
    games by its own opponent's difficulty (strength of schedule) before
    averaging them into a baseline. `prior_table` is last season's final
    table, folded in as `prior_games` games' worth of evidence that fades
    out by week 6."""
    by_player = defaultdict(list)
    for game in prior_games:
        by_player[game["pid"]].append(game)

    table = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0])
    for history in by_player.values():
        position = history[0]["pos"]
        categories = CATEGORIES[position]

        def adjusted(game, cat):
            return game["pts"][cat] / adjust(game["opp"], position, cat) if adjust else game["pts"][cat]

        # Leave-one-out sums: everything, minus the games against this opponent.
        total_n = len(history)
        total_pts = {c: sum(adjusted(g, c) for g in history) for c in categories}
        total_vol = {c: sum(g["vol"][c] for g in history) for c in categories}
        by_opp = defaultdict(lambda: [0, defaultdict(float), defaultdict(float)])
        for g in history:
            entry = by_opp[g["opp"]]
            entry[0] += 1
            for c in categories:
                entry[1][c] += adjusted(g, c)
                entry[2][c] += g["vol"][c]
        shares = [g["snap"] for g in history if g["snap"] is not None]
        median_share = statistics.median(shares) if shares else None

        for g in history:
            n_vs, pts_vs, vol_vs = by_opp[g["opp"]]
            others = total_n - n_vs
            if others < MIN_OTHER_GAMES:
                continue
            # A game he left early says nothing about the defense.
            if cfg["snap_filter"] and median_share and g["snap"] is not None:
                if g["snap"] < 0.6 * median_share:
                    continue
            weight = 1.0
            if cfg["half_life"]:
                weight = 0.5 ** ((through_week - 1 - g["week"]) / cfg["half_life"])
            for c in categories:
                base_pts = (total_pts[c] - pts_vs[c]) / others
                base_vol = (total_vol[c] - vol_vs[c]) / others
                for key in ((g["opp"], position, c), (g["opp"], position, "T")):
                    row = table[key]
                    row[0] += weight * g["pts"][c]
                    row[1] += weight * base_pts
                    row[2] += weight * g["vol"][c]
                    row[3] += weight * base_vol
                    if key[2] != "T" or c == categories[0]:
                        row[4] += weight

    if prior_table and cfg["prior_games"] and through_week <= 6:
        fade = 1 - (through_week - 1) / 6
        for key, row in prior_table.items():
            if row[4] <= 0:
                continue
            scale = cfg["prior_games"] * fade / row[4]
            target = table[key]
            for i in range(5):
                target[i] += row[i] * scale
    return table


def multipliers(table, K):
    """(points multiplier, volume multiplier) lookups, shrunk toward 1.0."""

    def points(key):
        row = table.get(key)
        return (row[0] + K) / (row[1] + K) if row else 1.0

    def volume(key):
        row = table.get(key)
        if not row or row[1] <= 0:
            return 1.0
        k_vol = K * row[3] / row[1]  # the same pseudo-games, in attempts
        return (row[2] + k_vol) / (row[3] + k_vol)

    return points, volume


# ---------------------------------------------------------------- predictions


def predictions(games, proj, season, cfg, weeks, prior_table=None, min_games=MIN_GAMES):
    """One record per gradeable week-W game: actual, baseline, projection, and
    each variant's (undamped) adjustment features."""
    out = []
    season_games = games[season]
    for week in weeks:
        prior = [g for g in season_games if g["week"] < week]
        table = build_table(prior, cfg, week, prior_table=prior_table)
        mult, vol_mult = multipliers(table, cfg["K"])
        adjust = None
        if cfg["sos"]:
            # One pass of strength-of-schedule: rebuild baselines with each
            # other game divided by its own opponent's (shrunk) multiplier.
            adjust = lambda opp, pos, cat, m=mult: m((opp, pos, cat))
            table = build_table(prior, cfg, week, adjust=adjust, prior_table=prior_table)
            mult, vol_mult = multipliers(table, cfg["K"])

        history = defaultdict(list)
        for g in prior:
            history[g["pid"]].append(g)
        for g in season_games:
            if g["week"] != week or len(history[g["pid"]]) < min_games:
                continue
            past = history[g["pid"]]
            position = g["pos"]
            avg = {}
            for c in CATEGORIES[position]:
                values = [
                    p["pts"][c] / adjust(p["opp"], position, c) if adjust else p["pts"][c]
                    for p in past
                ]
                avg[c] = sum(values) / len(values)
            base = sum(avg.values())
            if base < MIN_BASELINE:
                continue
            key = lambda c: (g["opp"], position, c)
            m = {c: mult(key(c)) for c in avg}
            vm = {c: vol_mult(key(c)) for c in avg}
            out.append(
                {
                    "pos": position,
                    "week": week,
                    "actual": sum(g["pts"].values()),
                    "base": base,
                    "proj": proj.get((season, week, g["pid"])),
                    "total": [base * (mult(key("T")) - 1)],
                    "split": [sum(avg[c] * (m[c] - 1) for c in avg)],
                    "per_cat": [avg.get(c, 0) * (m.get(c, 1) - 1) for c in ("pass", "rush", "rec")],
                    "vol_eff": [
                        sum(avg[c] * (vm[c] - 1) for c in avg),
                        sum(avg[c] * (m[c] / vm[c] - 1) for c in avg),
                    ],
                }
            )
    return out


def solve(matrix, vector):
    n = len(vector)
    m = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for c in range(n):
        pivot = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[pivot] = m[pivot], m[c]
        if abs(m[c][c]) < 1e-12:
            return [0.0] * n
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit(rows, feature, target="base"):
    """No-intercept least squares of (actual - target) on the feature - the
    damping (one coefficient per feature column)."""
    xs = [r[feature] for r in rows]
    ys = [r["actual"] - r[target] for r in rows]
    # Columns that are all zero for this group (a RB's pass category) are
    # left out of the solve and get no weight.
    live = [i for i in range(len(xs[0])) if any(x[i] for x in xs)]
    a = [[sum(x[i] * x[j] for x in xs) for j in live] for i in live]
    b = [sum(x[i] * y for x, y in zip(xs, ys)) for i in live]
    weights = [0.0] * len(xs[0])
    for i, w in zip(live, solve(a, b)):
        weights[i] = w
    return weights


def mse_gain(rows, feature, weights, target="base"):
    """% of the target's squared error removed by the damped adjustment."""
    sse_base = sse_model = 0.0
    for r in rows:
        resid = r["actual"] - r[target]
        adj = sum(w * x for w, x in zip(weights, r[feature]))
        sse_base += resid**2
        sse_model += (resid - adj) ** 2
    return 100 * (1 - sse_model / sse_base) if sse_base else 0.0


def rmse(rows, target):
    return math.sqrt(sum((r["actual"] - r[target]) ** 2 for r in rows) / len(rows))


# ---------------------------------------------------------------- experiments


def run(games, proj, cfg, weeks=EVAL_WEEKS, seasons=SEASONS, prior_tables=None, min_games=MIN_GAMES):
    rows = {}
    for season in seasons:
        prior = prior_tables.get(season) if prior_tables else None
        rows[season] = predictions(games, proj, season, cfg, weeks, prior, min_games)
    return rows


def score(rows, feature, train, test, target="base"):
    """{pos: (weights, holdout % MSE gain, n)} - fit on `train`, scored on `test`."""
    result = {}
    for position in POSITIONS:
        keep = lambda r: r["pos"] == position and (target != "proj" or r["proj"] is not None)
        train_rows = [r for s in train for r in rows.get(s, []) if keep(r)]
        test_rows = [r for r in rows[test] if keep(r)]
        weights = fit(train_rows, feature, target)
        result[position] = (weights, mse_gain(test_rows, feature, weights, target), len(test_rows))
    return result


def cv_score(rows, feature, target="base"):
    """Leave-one-season-out: each season in `rows` held out in turn, fit on
    the rest. {pos: (mean gain, [gain per season])} - steadier than one
    holdout, and the spread shows how much of a gain is noise."""
    seasons = sorted(rows)
    per = [score(rows, feature, [s for s in seasons if s != t], t, target) for t in seasons]
    return {
        p: (statistics.mean(r[p][1] for r in per), [r[p][1] for r in per]) for p in POSITIONS
    }


def gain_row(label, result):
    """Mean gain, with the worst and best held-out season in brackets."""
    cells = " | ".join(
        f"{result[p][0]:+.2f}% [{min(result[p][1]):+.1f}, {max(result[p][1]):+.1f}]"
        for p in POSITIONS
    )
    return f"| {label} | {cells} |"


def final_tables(games, cfg):
    """Each season's full-season table - the next season's prior."""
    tables = {}
    for i, season in enumerate(SEASONS[1:], start=1):
        tables[season] = build_table(games[SEASONS[i - 1]], cfg, 19)
    return tables


def holdout_factors(rows, feature, position):
    """(damped factor, row) for every game of `position`, each season's factor
    from damping fit on the other seasons - so the bins are all out-of-sample."""
    seasons = sorted(rows)
    out = []
    for test in seasons:
        weights = score(rows, feature, [s for s in seasons if s != test], test)[position][0]
        for r in rows[test]:
            if r["pos"] == position:
                adj = sum(w * x for w, x in zip(weights, r[feature]))
                out.append((1 + adj / r["base"], r))
    return out


def factor_bins(scored, bins=5):
    """Quintiles of the factor - what each color band actually delivered vs.
    the player's average and Sleeper's projection."""
    scored = sorted(scored, key=lambda pair: pair[0])
    size = len(scored) // bins
    lines = []
    for b in range(bins):
        chunk = scored[b * size : (b + 1) * size if b < bins - 1 else len(scored)]
        factors = [f for f, _ in chunk]
        vs_base = [r["actual"] - r["base"] for _, r in chunk]
        vs_proj = [r["actual"] - r["proj"] for _, r in chunk if r["proj"] is not None]
        lines.append(
            f"| {b + 1} | {min(factors) - 1:+.1%} to {max(factors) - 1:+.1%} | "
            f"{statistics.mean(vs_base):+.2f} | "
            f"{statistics.mean(vs_proj) if vs_proj else float('nan'):+.2f} | {len(chunk)} |"
        )
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scoring", default="PPR", choices=("PPR", "HALF", "STD"))
    args = parser.parse_args()

    fetch_all()
    games, proj = load(args.scoring)
    report = [
        f"# Matchup difficulty backtest ({args.scoring})",
        "",
        "Generated by `backtest.py` - see its docstring for the method. Gain = % of squared "
        "error removed vs. the player's plain season-to-date average, weeks "
        f"{EVAL_WEEKS.start}-{EVAL_WEEKS.stop - 1}, positive = the matchup adjustment helps. "
        "Leave-one-season-out: each season held out in turn with the damping fit on the "
        "others; cells are the mean gain [worst, best season].",
        "",
    ]
    log = lambda line="": (report.append(line), print(line))

    # 1. Shrinkage, and total vs. split, at the default table.
    log("## 1. Shrinkage K and total vs. per-category split")
    log()
    log("| Variant | " + " | ".join(POSITIONS) + " |")
    log("|---|" + "---|" * len(POSITIONS))
    best = None
    for K in (20, 40, 80, 160, 320, 640):
        cfg = {**DEFAULT, "K": K}
        rows = run(games, proj, cfg)
        for feature in ("total", "split"):
            result = cv_score(rows, feature)
            log(gain_row(f"K={K:g}, {feature}", result))
            mean_gain = statistics.mean(result[p][0] for p in POSITIONS)
            if best is None or mean_gain > best[0]:
                best = (mean_gain, K, feature, rows)
    _, best_k, _, best_rows = best
    log()
    log(f"Best K: {best_k:g}.")
    log()

    # 2. Refinements, one at a time on top of the best K.
    base_cfg = {**DEFAULT, "K": best_k}
    base_rows = best_rows
    log("## 2. Refinements (one at a time, at the best K)")
    log()
    log("| Variant | " + " | ".join(POSITIONS) + " |")
    log("|---|" + "---|" * len(POSITIONS))
    log(gain_row("split (reference)", cv_score(base_rows, "split")))
    log(gain_row("total (one multiplier)", cv_score(base_rows, "total")))
    log(gain_row("split, damped per category", cv_score(base_rows, "per_cat")))
    log(gain_row("volume x efficiency, damped separately", cv_score(base_rows, "vol_eff")))
    variants = {
        "recency (6-week half-life)": {"half_life": 6},
        "drop games he left early (snap share)": {"snap_filter": True},
        "strength-of-schedule baselines": {"sos": True},
    }
    for label, change in variants.items():
        rows = run(games, proj, {**base_cfg, **change})
        log(gain_row(label + ", split", cv_score(rows, "split")))
    log()

    # Damping weights for the reference split, to read the scale off.
    damping = score(base_rows, "split", SEASONS[:-1], SEASONS[-1])
    log(f"Fitted damping (split, reference, fit on {SEASONS[0]}-{SEASONS[-2]}): " + ", ".join(
        f"{p} {damping[p][0][0]:.2f}" for p in POSITIONS
    ))
    log()

    # 3. Early season: last season's table as a prior.
    log(f"## 3. Early season (weeks {EARLY_WEEKS.start}-{EARLY_WEEKS.stop - 1}, 2+ games of history)")
    log()
    log("Last season's final table folded in as N games of evidence, fading out by week 6. "
        "2023-2025 only (2022 has no prior season here).")
    log()
    log("| Variant | " + " | ".join(POSITIONS) + " |")
    log("|---|" + "---|" * len(POSITIONS))
    seasons = SEASONS[1:]
    for prior_games in (0, 2, 4, 8):
        cfg = {**base_cfg, "prior_games": prior_games}
        tables = final_tables(games, cfg) if prior_games else None
        rows = run(games, proj, cfg, EARLY_WEEKS, seasons, tables, min_games=2)
        log(gain_row(f"prior = {prior_games} games", cv_score(rows, "split")))
    log()

    # 4. Against Sleeper's own projections.
    with_proj = [r for season in SEASONS for r in base_rows[season] if r["proj"] is not None]
    log("## 4. Against Sleeper's projections")
    log()
    log(f"All seasons, weeks {EVAL_WEEKS.start}-{EVAL_WEEKS.stop - 1}, players with a projection "
        f"(n={len(with_proj)}).")
    log()
    log("| | " + " | ".join(POSITIONS) + " |")
    log("|---|" + "---|" * len(POSITIONS))
    by_pos = {p: [r for r in with_proj if r["pos"] == p] for p in POSITIONS}
    log("| RMSE, season average | " + " | ".join(f"{rmse(by_pos[p], 'base'):.2f}" for p in POSITIONS) + " |")
    log("| RMSE, Sleeper projection | " + " | ".join(f"{rmse(by_pos[p], 'proj'):.2f}" for p in POSITIONS) + " |")
    log(gain_row("gain from adding matchup to the projection", cv_score(base_rows, "split", "proj")))
    # How much of the matchup a projection already prices in: slope of
    # (projection - average) on the matchup adjustment.
    slopes = []
    for p in POSITIONS:
        rows = [r for s in SEASONS for r in base_rows[s] if r["pos"] == p and r["proj"] is not None]
        sxx = sum(r["split"][0] ** 2 for r in rows)
        sxy = sum(r["split"][0] * (r["proj"] - r["base"]) for r in rows)
        slopes.append(f"{sxy / sxx:.2f}" if sxx else "n/a")
    log("| projection's own matchup lean (slope) | " + " | ".join(slopes) + " |")
    log()

    # 5. What the colors would mean.
    log("## 5. Factor quintiles (what red/green would mean)")
    log()
    log("Reference split, damped, every season out-of-sample. Factor = predicted % change vs. "
        "the player's average. Columns: mean points vs. his average, and vs. Sleeper's "
        "projection.")
    for p in POSITIONS:
        log()
        log(f"**{p}**")
        log()
        log("| Quintile | Factor | vs. average | vs. projection | n |")
        log("|---|---|---|---|---|")
        for line in factor_bins(holdout_factors(base_rows, "split", p)):
            log(line)

    with open(OUT, "w") as file:
        file.write("\n".join(report) + "\n")
    print(f"\nWrote {OUT}")


if __name__ == "__main__":
    main()
