// A weekly chart's height while its data loads - the title row, the 96px
// plot with its week labels, and the legend, as measured in the popover.
// Holding it keeps the popover from growing when the data lands.
const CHART_HEIGHT = 139;

export function ChartLoading() {
  return <div style={{ height: CHART_HEIGHT }} aria-busy />;
}
