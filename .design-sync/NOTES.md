# design-sync notes for @infiniroot/shared

- `shared/previewProviders.ts` exports `previewConvexClient`, a real
  `ConvexReactClient` pointed at infinidraft's production deployment
  (`https://patient-vulture-800.convex.cloud`, same URL as
  `infinidraft/src/main.tsx`'s `VITE_CONVEX_URL`). It's wired in via
  `cfg.extraEntries` + `cfg.provider.props.client` (a `$ref`) so
  AuthPanel/AppHeader/ConnectSleeperLeague's Convex hooks resolve past
  "loading" during preview capture instead of rendering blank. The user
  explicitly chose this (real backend, read-only unauthenticated calls)
  over a dummy/unreachable URL (which would leave those three components
  as permanent floor cards). Confirmed with the user on 2026-09-06.
- Provider chain mirrors the real app's `main.tsx` exactly:
  `ConvexAuthProvider(client=previewConvexClient)` → `MantineProvider(theme,
  defaultColorScheme="dark", cssVariablesResolver)` — no
  `QueryClientProvider`, since none of shared/*.tsx use TanStack Query
  directly.
- `cssEntry` can't point outside the package directory (the build enforces
  a PKG_DIR bound), but Mantine's compiled CSS lives in the hoisted root
  `node_modules` (shared/ has no node_modules of its own - npm workspaces
  hoist everything to repo root). Fix: `buildCmd` copies
  `node_modules/@mantine/core/styles.css` to
  `shared/.design-sync-mantine-styles.css` (gitignored - it's a generated
  mirror, not authored source) before running tsup, and `cssEntry` points
  at that copy. Re-run `buildCmd` (not just `npm run build --workspace=
  shared`) whenever `@mantine/core` is upgraded, or this copy goes stale.
- `--node-modules` for the converter should point at the repo root
  (`./node_modules`), not `shared/node_modules` (which doesn't exist).
- `AppLogo`'s image import (`infini_logo.png`) must be inlined as a data URI
  in `shared/dist/index.js` (`tsup ... --loader .png=dataurl` in
  `shared/package.json`'s `build` script) rather than emitted as a
  separate hashed file - the converter's re-bundle of the pre-built dist
  entry doesn't copy sibling asset files, so a file-reference import left
  the logo broken (alt-text only) in every preview until this was fixed.
- `AppHeader`/`BottomNav`/`SignedOutHeader` use `@tanstack/react-router`'s
  `Link`/`useNavigate`, which throw "Cannot read properties of null
  (reading 'stores')" without a router context. Fixed two ways together:
  (1) `shared/previewProviders.tsx` exports `PreviewRouter`, a
  single-route `RouterProvider` wrapper used INSIDE the affected preview
  `.tsx` files (imported via a relative path, not through `cfg.provider` -
  `RouterProvider` owns rendering rather than accepting a plain `children`
  prop, so it can't sit in the provider chain the way
  MantineProvider/ConvexAuthProvider do). (2) `@tanstack/react-router` is
  also in `cfg.extraEntries` - without it, the preview file's own esbuild
  pass bundles a SEPARATE copy of the library from the one already inlined
  in `_ds_bundle.js`, so `SignedOutHeader`'s `Link` (reading context from
  bundle A) and `PreviewRouter`'s `RouterProvider` (providing context from
  bundle B) are different module instances with different React Context
  objects - classic dual-instance mismatch, same symptom as no router at
  all. Both pieces are required; either alone still crashes.
- `BottomNav` is `position: fixed`, not a portaled overlay (Modal/Popover
  render via a `Portal` to `document.body`, escaping the capture harness's
  transformed single-story wrapper entirely; a plain fixed element does
  not). The wrapper only gets real height from in-flow content, so without
  something explicit it collapses to 0 height and `bottom: 7px` resolves
  almost entirely above the visible frame. Fixed by wrapping every
  BottomNav story in a `<div style={{ height: 320 }}>` (matching
  `cfg.overrides.BottomNav.viewport`'s declared height) inside
  `.design-sync/previews/BottomNav.tsx` - `cardMode: "single"` +
  `viewport` alone (the guidance for portaled overlays) does NOT fix this
  for a plain fixed element; the explicit-height wrapper is the actual fix.
- `BottomNav`'s captured background reads as flat medium gray, not the
  dark "pops off the page" look from the real app - expected, not a bug.
  Its CSS is `color-mix(dark-5 50%, transparent)`, designed to be seen
  over the app's own dark page background; the capture harness's body is
  hardcoded white, so the same translucent math lands on gray instead.
  Confirmed correct by inspecting the raw per-story screenshots (icons,
  active-tab color, FAB notch gap, and overflow menu all render right).

## Known render warns

- `[RENDER_BLANK] components/general/BottomNav/BottomNav.html` from
  `package-validate.mjs`'s own default-mode render check (fixed 1200x800
  viewport) - benign. `BottomNav` is `hiddenFrom="sm"` by design (mobile-
  only, same as the real app); at validate's desktop-width viewport it
  correctly renders nothing. The actual grading screenshots
  (`package-capture.mjs`, which honors `cfg.overrides.BottomNav.viewport`)
  show all 3 stories rendering fully and were graded `good`.
- `[TOKENS_MISSING]` for `--app-shell-*` custom properties - non-blocking,
  expected. Mantine's shipped CSS defines these for its `AppShell`
  component, which nothing in `@infiniroot/shared` uses.

## Re-sync risks

- The preview Convex client hits a **live production backend** during
  capture. If that deployment URL ever changes (redeploy, new project),
  `shared/previewProviders.ts` needs updating or previews for
  AuthPanel/AppHeader/ConnectSleeperLeague will silently go blank again.
- These three components' previews reflect only the **signed-out** state
  (no real login flow is driven during capture) - that's the realistic
  state for a static design-system preview, but it means "signed in"
  variants of AppHeader/AuthPanel are necessarily mocked/composed rather
  than a real authenticated render.
