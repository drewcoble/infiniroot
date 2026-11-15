import type { CSSProperties } from "react";

// Each pill is a small glass pane tinted by its theme color (--pill-tint,
// see .pill). The pane carries the color; text stays near-white with just a
// hint of it, since a full light shade over its own tint read too faintly.
// Rank badge on a team or player - glass gray, or saddlebrown when it's
// yours (your team, your players: the app's "yours" color, as on the My
// Team header's rank badge).
export function rankPillStyle(isMine: boolean): CSSProperties {
  return {
    color: isMine ? "color-mix(in srgb, #8b4513 15%, #fff)" : "#f8fafc",
    fontFamily: "var(--font-numeric)",
    "--pill-tint": isMine ? "#8b4513" : "var(--mantine-color-gray-5)",
  } as CSSProperties;
}

export function pillStyle(color: string) {
  return {
    color: `color-mix(in srgb, var(--mantine-color-${color}-1) 30%, #fff)`,
    "--pill-tint": `var(--mantine-color-${color}-4)`,
  } as CSSProperties;
}
