import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { TeamLogosContext } from "./teamLogos";
import classes from "./GlassMatchupCard.module.css";

// Up to two letters: the first letters of the first two words with any
// letter or digit in them ("Channel 4 News Team" -> "C4"), or the first two
// of a one-word name ("Longhorns" -> "LO").
function teamInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// A stable hue per name, so a team's initials badge keeps its color.
function nameHue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % 360;
}

// A fantasy team's logo/avatar from its provider (seasonTeams.logoUrl, see
// the Sleeper/ESPN/Yahoo syncs) in a rounded glass well, or the team's
// initials on a tint of its own when there's no logo or it fails to load
// (ESPN's custom logos are links to anywhere). Decorative - the team's name
// is always beside it.
export function TeamLogo({
  name,
  logoUrl,
  size,
  className,
}: {
  name: string;
  logoUrl: string | undefined;
  size: number;
  className?: string | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = logoUrl !== undefined && logoUrl !== failedUrl;
  const style = {
    width: size,
    height: size,
    // The headshot well's 12px at 40px, scaled.
    borderRadius: Math.round(size * 0.3),
    fontSize: Math.round(size * 0.38),
    "--logo-hue": nameHue(name),
  } as CSSProperties;

  return (
    <span
      className={[classes.teamLogo, !showImage && classes.teamLogoInitials, className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      aria-hidden
    >
      {showImage ? (
        <img
          src={logoUrl}
          alt=""
          className={classes.teamLogoImg}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(logoUrl)}
        />
      ) : (
        teamInitials(name)
      )}
    </span>
  );
}

// Provides the league's team logos to TeamLogo users below (see
// teamLogos.ts's useTeamLogoUrl).
export function TeamLogosProvider({
  teams,
  children,
}: {
  teams: ReadonlyArray<{ teamId: string; logoUrl?: string | undefined }> | undefined;
  children: ReactNode;
}) {
  const logos = useMemo(() => {
    const byTeamId = new Map<string, string>();
    for (const team of teams ?? []) {
      if (team.logoUrl) byTeamId.set(team.teamId, team.logoUrl);
    }
    return byTeamId;
  }, [teams]);
  return <TeamLogosContext.Provider value={logos}>{children}</TeamLogosContext.Provider>;
}
