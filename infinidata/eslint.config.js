import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Same rule set infinidraft's root eslint.config.js used to apply to
// convex/ before the split - just the TS-only subset (no react-hooks/
// react-refresh, no JSX here).
export default tseslint.config(
  {
    ignores: ["convex/_generated"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
  },
);
