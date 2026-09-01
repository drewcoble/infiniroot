import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { Moon, Sun } from "lucide-react";

// Binary light/dark toggle (no "auto"/system option - this is an internal
// tool, not worth the extra state for most users). Persistence is handled
// by Mantine's default localStorage color scheme manager - main.tsx only
// sets the fallback ("dark") for a browser that's never chosen before.
export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <ActionIcon
      variant="default"
      size={40}
      aria-label="Toggle light/dark mode"
      onClick={() => setColorScheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </ActionIcon>
  );
}
