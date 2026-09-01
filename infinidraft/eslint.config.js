import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "src/routeTree.gen.ts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // eslint-plugin-react-hooks@7's own "recommended" configs bundle in a
      // large set of newer React-Compiler-oriented rules (not just the
      // classic pair) and are in the pre-flat-config plugin-array format,
      // which errors under this project's flat config - so just the two
      // stable, universally-recommended rules are set explicitly instead.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // TanStack Router's file-based routing requires every route file to
    // export both `Route` and its component from the same file - exactly
    // the pattern this rule warns about elsewhere. Not a real fast-refresh
    // problem here, just the convention this framework mandates.
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
);
