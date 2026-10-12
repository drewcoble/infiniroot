import { createLucideIcon } from "lucide-react";

// Several tickets - Lucide's Ticket (the Matchup tab's icon) drawn the way
// Lucide turns Tag into Tags: a smaller copy of the ticket shifted up and
// right, and just the left and bottom edges of a second one peeking out
// behind it, offset down and left. Lucide's own Tickets icon looks too
// unlike Ticket to read as "the Matchup ticket, for every league", so this
// is the Matchups button's icon instead. The back ticket's edge is a plain
// line, no notch: its notch would bulge into the front ticket's left edge
// (they'd overlap at the header's 2.5 stroke), and Tags' back tag is the
// same bare outline. Same 24x24 grid and stroke
// conventions as every Lucide icon, so it takes the usual size/strokeWidth
// props.
export const TicketStack = createLucideIcon("ticket-stack", [
  [
    "path",
    {
      d: "M6 6.5a2.5 2.5 0 0 1 0 5V13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5a2.5 2.5 0 0 1 0-5V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2Z",
      key: "front",
    },
  ],
  ["path", { d: "M15 3v2", key: "perf-top" }],
  ["path", { d: "M15 8v2", key: "perf-middle" }],
  ["path", { d: "M15 13v2", key: "perf-bottom" }],
  [
    "path",
    {
      d: "M2 9v8a2 2 0 0 0 2 2h12a2 2 0 0 0 1.414-.586",
      key: "back",
    },
  ],
]);
