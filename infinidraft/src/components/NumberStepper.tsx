import { useState, type KeyboardEvent } from "react";
import { ActionIcon, Group, NumberInput, Text } from "@mantine/core";
import { STEPPER_BUTTON_SIZE } from "../constants/general";
import { useHoldRepeat } from "../hooks/useHoldRepeat";

interface StepperButtonProps {
  label?: string | undefined;
  onClick: () => void;
}

// Fixed at STEPPER_BUTTON_SIZE regardless of the stepper's own `size` prop
// (which still governs the input/text next to these) - a stepper used in a
// dense table row still needs a full-size tap target on mobile, same as
// the Budget tab's own +/- buttons.
function DecrementButton({
  label,
  disabled,
  onClick,
}: StepperButtonProps & { disabled: boolean }) {
  const holdHandlers = useHoldRepeat(onClick);
  return (
    <ActionIcon
      size={STEPPER_BUTTON_SIZE}
      variant="default"
      onClick={onClick}
      disabled={disabled}
      aria-label={label ? `Decrease ${label}` : "Decrease"}
      {...holdHandlers}
    >
      −
    </ActionIcon>
  );
}

function IncrementButton({
  label,
  disabled,
  onClick,
}: StepperButtonProps & { disabled: boolean }) {
  const holdHandlers = useHoldRepeat(onClick);
  return (
    <ActionIcon
      size={STEPPER_BUTTON_SIZE}
      variant="default"
      onClick={onClick}
      disabled={disabled}
      aria-label={label ? `Increase ${label}` : "Increase"}
      {...holdHandlers}
    >
      +
    </ActionIcon>
  );
}

interface CountStepperProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  // Used for the +/- buttons' aria-labels, e.g. "QB" -> "Increase QB".
  label?: string | undefined;
  // Text shown in place of a number when value is undefined, e.g. "Unlimited".
  placeholder?: string | undefined;
  // When true, decrementing below `min` clears the value to `undefined`
  // (shown as `placeholder`) instead of clamping at `min` - for fields where
  // blank means "no limit" rather than zero.
  nullable?: boolean;
  disabled?: boolean;
}

// A non-editable "− value +" control for small, low-range counts (roster
// slots, keeper years, etc.) where typing an arbitrary number isn't useful.
export function CountStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  label,
  placeholder,
  nullable = false,
  disabled = false,
}: CountStepperProps) {
  const handleDecrement = () => {
    if (value === undefined) return;
    const next = value - step;
    if (nullable && next < min) {
      onChange(undefined);
      return;
    }
    onChange(Math.max(min, next));
  };

  const handleIncrement = () => {
    if (value === undefined) {
      onChange(min);
      return;
    }
    const next = value + step;
    onChange(max === undefined ? next : Math.min(max, next));
  };

  return (
    <Group gap={4} align="center" wrap="nowrap">
      <DecrementButton
        label={label}
        disabled={disabled || value === undefined}
        onClick={handleDecrement}
      />
      <Text
        miw={28}
        ta="center"
        fw={600}
        {...(value === undefined ? { c: "dimmed" as const } : {})}
      >
        {value === undefined ? (placeholder ?? "—") : value}
      </Text>
      <IncrementButton
        label={label}
        disabled={
          disabled || (value !== undefined && max !== undefined && value >= max)
        }
        onClick={handleIncrement}
      />
    </Group>
  );
}

interface EditableNumberStepperProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  width?: number;
  size?: "xs" | "sm" | "md";
  // Used for the +/- buttons' aria-labels, e.g. "Bid" -> "Increase Bid".
  label?: string | undefined;
  // Placeholder shown in the input when value is undefined, e.g. "None".
  placeholder?: string | undefined;
  // When true, clearing the input calls onChange(undefined) instead of
  // coercing to 0 - for optional fields like an unset minimum cost.
  nullable?: boolean;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

// A "− [typeable input] +" control for values that can range higher (dollar
// amounts, bids, etc.) - the buttons handle quick increments, but the field
// stays a real NumberInput so an exact value can be typed in directly.
export function EditableNumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  width = 90,
  size = "sm",
  label,
  placeholder,
  nullable = false,
  disabled = false,
  onKeyDown,
}: EditableNumberStepperProps) {
  // Tracks "the field is mid-edit and currently empty" separately from the
  // committed `value` prop. Without this, clearing the field to retype a
  // number from scratch (e.g. erasing a default "1" to type "46") used to
  // coerce straight to 0 (or undefined) on that very keystroke and get fed
  // back in as the controlled value - so the next digit typed landed after
  // that stray "0" instead of into an empty box (typing "46" produced
  // "460"). Coercing only happens on blur now, so the box stays visually
  // blank for as long as the user is actively retyping it.
  const [isEditingBlank, setIsEditingBlank] = useState(false);

  const handleDecrement = () => {
    setIsEditingBlank(false);
    if (value === undefined) return;
    const next = value - step;
    if (nullable && min !== undefined && next < min) {
      onChange(undefined);
      return;
    }
    onChange(min !== undefined ? Math.max(min, next) : next);
  };

  const handleIncrement = () => {
    setIsEditingBlank(false);
    if (value === undefined) {
      onChange(min ?? 0);
      return;
    }
    const next = value + step;
    onChange(max !== undefined ? Math.min(max, next) : next);
  };

  return (
    <Group gap={4} align="center" wrap="nowrap">
      <DecrementButton
        label={label}
        disabled={disabled || value === undefined}
        onClick={handleDecrement}
      />
      <NumberInput
        hideControls
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        step={step}
        value={isEditingBlank ? "" : (value ?? "")}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(val) => {
          if (val === "") {
            setIsEditingBlank(true);
            return;
          }
          setIsEditingBlank(false);
          onChange(Number(val));
        }}
        onBlur={() => {
          if (isEditingBlank) {
            setIsEditingBlank(false);
            onChange(nullable ? undefined : 0);
          }
        }}
        {...(prefix !== undefined ? { prefix } : {})}
        w={width}
        size={size}
        styles={{ input: { textAlign: "center", fontWeight: 600 } }}
      />
      <IncrementButton
        label={label}
        disabled={
          disabled || (value !== undefined && max !== undefined && value >= max)
        }
        onClick={handleIncrement}
      />
    </Group>
  );
}
