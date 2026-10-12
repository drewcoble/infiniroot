import { createLucideIcon } from "lucide-react";

// Several tickets, for the Matchups button. Same layout as Lucide's own
// Tickets icon (a front ticket along the bottom, x 2-22 / y 8-21, with the
// top-right corner of a second one peeking out above it, tilted ~24° on a
// 5:11 slope, its strokes ending on the front ticket's top edge) - but
// both tickets drawn in the shape of Lucide's Ticket (the Matchup tab's
// icon: notched sides, perforation column 11 units in) rather than Tickets'
// plain rectangles, which read as a different object. The back ticket is
// Ticket at its own 20x14, so the top of its right notch just shows before
// it tucks behind; its perforation would land inside the tilted edge's
// stroke, so it's left out. Same 24x24 grid and stroke conventions as every
// Lucide icon, so it takes the usual size/strokeWidth props.
export const TicketStack = createLucideIcon("ticket-stack", [
  [
    "path",
    {
      d: "M3.565 8 14.172 3.179a2 2 0 0 1 2.649.993l.827 1.821A3 3 0 0 0 15.979 8",
      key: "back",
    },
  ],
  [
    "path",
    {
      d: "M2 11.5a3 3 0 0 1 0 6V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-1.5a3 3 0 0 1 0-6V10a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
      key: "front",
    },
  ],
  ["path", { d: "M13 8v2", key: "perf-top" }],
  ["path", { d: "M13 13.5v2", key: "perf-middle" }],
  ["path", { d: "M13 19v2", key: "perf-bottom" }],
]);
