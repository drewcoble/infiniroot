import { type PropsWithChildren, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  type TextProps as RNTextProps,
  View,
  type ViewProps,
} from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { burlywood, darkSurfaces, saddlebrown } from '@shared-core/colors';
import { useConvexReconnect } from '@/lib/convexConnection';

// Dark-mode-only for now - infinifaab (web) defaults to dark too (see its
// main.tsx's defaultColorScheme="dark") and a light/dark switcher is out
// of scope for this first vertical slice. These are rough approximations
// of shared/theme.ts's Mantine mapping (which shade Mantine actually
// picks depends on primaryShade/variant/component-specific resolvers this
// doesn't attempt to replicate) - close enough to read as "the same app,"
// not a pixel-exact port.
export const colors = {
  body: darkSurfaces[7],
  surface: darkSurfaces[6],
  border: darkSurfaces[4],
  text: darkSurfaces[0],
  textDimmed: darkSurfaces[2],
  primary: burlywood[3],
  accent: saddlebrown[7],
  danger: '#c1666b',
  // Apple's own system green/yellow - a traffic-light trio with `danger`
  // above for bid-outcome status (dollarsign.ring on the Bids tab, and
  // wherever else adopts the same convention later), deliberately using
  // recognizable iOS system colors here rather than matching the rest of
  // the muted brand palette, since a status signal needs to read
  // unambiguously at a glance.
  success: '#34c759',
  warning: '#ffcc00',
};

export function Screen({ children, style, ...rest }: PropsWithChildren<ViewProps>) {
  return (
    <View style={[styles.screen, style]} {...rest}>
      {children}
    </View>
  );
}

interface StackProps extends ViewProps {
  gap?: number;
}

export function Stack({ children, style, gap = 8, ...rest }: PropsWithChildren<StackProps>) {
  return (
    <View style={[{ gap }, style]} {...rest}>
      {children}
    </View>
  );
}

interface AppTextProps extends RNTextProps {
  variant?: 'body' | 'title' | 'dimmed';
}

export function AppText({ style, variant = 'body', ...rest }: AppTextProps) {
  return (
    <RNText
      style={[
        styles.textBase,
        variant === 'title' && styles.textTitle,
        variant === 'dimmed' && styles.textDimmed,
        style,
      ]}
      {...rest}
    />
  );
}

export function Card({ children, style, ...rest }: PropsWithChildren<ViewProps>) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

// A Card rendered as real iOS 26 Liquid Glass (UIGlassEffect) instead of a
// flat surface color - "clear" style (not "regular") so the dark screen
// behind it stays visible through the card instead of the tint reading as
// a solid painted block, with a translucent (not opaque) tintColor for the
// same reason - a fully opaque tint over "clear" glass still washes out
// the see-through effect. Reserved for player-facing cards (Players/My
// Bids' row cards) rather than replacing Card everywhere - applying it to
// every card in the app would make it wallpaper instead of a highlight.
// Degrades to an opaque View with no visual effect on non-iOS/pre-26
// (expo-glass-effect's own runtime availability check), so no platform
// gating needed here.
export function GlassCard({ children, style, ...rest }: PropsWithChildren<ViewProps>) {
  return (
    <GlassView
      glassEffectStyle="clear"
      tintColor="rgba(31, 77, 58, 0.4)"
      style={[styles.glassCard, style]}
      {...rest}
    >
      {children}
    </GlassView>
  );
}

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ title, onPress, loading, disabled }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <RNText style={styles.buttonText}>{title}</RNText>
      )}
    </Pressable>
  );
}

// Convex's connectionState() can report a perfectly healthy connection
// while a query is permanently stuck pending (observed after switching
// between NativeTabs a few times - see convexConnection.ts for the full
// story), with no client-side signal available to detect or auto-recover
// from it. Since every data-fetching screen in this app renders this same
// Loading component while its query is pending, a stuck-forever spinner
// eventually surfaces a manual "tap to reconnect" affordance here instead
// of needing a per-screen timeout - one place handles every case.
const STUCK_LOADING_TIMEOUT_MS = 8000;

export function Loading() {
  const reconnect = useConvexReconnect();
  const [showReconnect, setShowReconnect] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShowReconnect(true), STUCK_LOADING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} size="large" />
      {showReconnect && (
        <Pressable onPress={reconnect} style={styles.reconnectButton}>
          <AppText variant="dimmed" style={styles.reconnectText}>
            Taking longer than expected. Tap to reconnect.
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

interface ChipProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

// Pressable pill used for small single/multi-choice pickers (BidModal's
// team picker, the Settings tab's weekday/AM-PM/tiebreak pickers) - RN has
// no native equivalent of Mantine's SegmentedControl/Select for this scale
// of option set, so this is the one reusable stand-in.
export function Chip({ label, active, disabled, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
    >
      <RNText style={[styles.chipText, active && styles.chipTextActive]}>{label}</RNText>
    </Pressable>
  );
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

// Plain clamped-integer TextInput - the stand-in everywhere Mantine's
// NumberInput/EditableNumberStepper appears on web (auction settings,
// bid-cycle duration pickers). Clamps on every keystroke rather than
// buffering free text, so a value below `min` (e.g. clearing the field to
// retype) briefly snaps to `min` instead of showing empty - acceptable for
// the short numeric fields this is used for, not worth a fuller buffered
// implementation for.
export function NumberField({ value, onChange, min, max, disabled }: NumberFieldProps) {
  return (
    <TextInput
      value={String(value)}
      onChangeText={(text) => {
        const parsed = Number(text.replace(/[^0-9]/g, ''));
        if (!Number.isFinite(parsed)) return;
        let next = parsed;
        if (min !== undefined) next = Math.max(min, next);
        if (max !== undefined) next = Math.min(max, next);
        onChange(next);
      }}
      keyboardType="number-pad"
      editable={!disabled}
      style={[styles.numberInput, disabled && styles.numberInputDisabled]}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.body,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  glassCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    padding: 12,
  },
  textBase: {
    color: colors.text,
    fontSize: 16,
  },
  textTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  textDimmed: {
    color: colors.textDimmed,
    fontSize: 14,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.body,
    gap: 16,
  },
  reconnectButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  reconnectText: {
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.accent,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
  },
  chipTextActive: {
    fontWeight: '600',
  },
  numberInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 16,
    minWidth: 60,
    textAlign: 'center',
  },
  numberInputDisabled: {
    opacity: 0.5,
  },
});
