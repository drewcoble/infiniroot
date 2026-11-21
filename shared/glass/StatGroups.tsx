import classes from "./GlassMatchupCard.module.css";

export interface StatItem {
  label: string;
  value: string;
}

// A long-press card's numbers, grouped by what they describe rather than
// laid out as one flat grid of tiles:
// - a row: a few related numbers side by side in one glass panel, under a
//   small caps label ("Trade value", "This week", "Roster")
// - a table: the same measures across time frames - rows are the measures
//   (PPG, VOR, position rank), columns the frames ("Season", "ROS") - so
//   a player's season-to-date and rest-of-season reads sit next to each
//   other instead of in separate tiles.
export type StatGroup =
  | { label: string; items: StatItem[] }
  | { label?: string; columns: string[]; rows: Array<{ label: string; values: string[] }> };

// Up to three numbers per line; four go two by two rather than three and
// a straggler.
function rowColumns(count: number): number {
  return count === 4 ? 2 : Math.min(count, 3);
}

// "—" (no value) reads quieter than a real number.
function Value({ value }: { value: string }) {
  return <span className={value === "—" ? classes.statEmpty : undefined}>{value}</span>;
}

export function StatGroups({ groups }: { groups: StatGroup[] }) {
  return (
    <div className={classes.statGroups}>
      {groups.map((group, index) =>
        "items" in group ? (
          <section key={group.label} aria-label={group.label}>
            <div className={classes.statGroupLabel}>{group.label}</div>
            <div
              className={`${classes.statPanel} ${classes.statRow}`}
              style={{
                gridTemplateColumns: `repeat(${rowColumns(group.items.length)}, minmax(0, 1fr))`,
              }}
            >
              {group.items.map((item, itemIndex) => (
                <div
                  key={item.label}
                  className={[
                    classes.statRowItem,
                    itemIndex % rowColumns(group.items.length) !== 0 && classes.statRowItemLeft,
                    itemIndex >= rowColumns(group.items.length) && classes.statRowItemTop,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className={classes.statValue}>
                    <Value value={item.value} />
                  </div>
                  <div className={classes.statLabel}>{item.label}</div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section key={group.label ?? `table-${index}`} aria-label={group.label}>
            {group.label && <div className={classes.statGroupLabel}>{group.label}</div>}
            <table className={`${classes.statPanel} ${classes.statTable}`}>
              <thead>
                <tr>
                  <th aria-hidden />
                  {group.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.values.map((value, column) => (
                      <td key={group.columns[column] ?? column}>
                        <Value value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ),
      )}
    </div>
  );
}
