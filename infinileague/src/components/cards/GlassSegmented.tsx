import { useRef, type KeyboardEvent } from "react";
import classes from "./GlassMatchupCard.module.css";

// Full-width glass segmented control - a recessed glass track with the
// selected option raised as its own glass pane. Exposed as a radio group:
// arrow keys move the selection, only the selected option is in the tab
// order.
export function GlassSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  // Shorter segments - for a secondary control under a full-size one.
  compact?: boolean;
}) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const nextIndex = (index + step + options.length) % options.length;
    onChange(options[nextIndex]!.value);
    buttonsRef.current[nextIndex]?.focus();
  };

  return (
    <div
      className={`${classes.segmented} ${compact ? classes.segmentedCompact : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`${classes.segment} ${selected ? classes.segmentSelected : ""}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
