import classes from "./GlassMatchupCard.module.css";

// A score in the scoreboard font (Doto, see index.css's --font-scoreboard),
// with the decimal point drawn as one round dot - Doto's own period is a
// small cluster of dots that reads as a "+" at this weight. Screen readers
// get the plain number as visually hidden text.
export function ScoreboardNumber({ value }: { value: string }) {
  const [whole, fraction] = value.split(".");
  if (fraction === undefined) return <>{value}</>;
  return (
    <>
      <span className={classes.srOnly}>{value}</span>
      <span aria-hidden>
        {whole}
        <span className={classes.scoreboardDot} />
        {fraction}
      </span>
    </>
  );
}
