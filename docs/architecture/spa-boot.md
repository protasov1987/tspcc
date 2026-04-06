# SPA Bootstrap (F5-safe)

This document describes the mandatory SPA bootstrap order that preserves
correct behavior for F5, direct URLs, and browser history.

---

## Definitions

- `fullPath = window.location.pathname + window.location.search`
- `handleRoute(fullPath, options)`
- `restoreSession() / checkAuth()`
- `initNavigation() / setupNavigation()`

---

## Required Boot Order (MUST)

The step order below is mandatory and must not be rearranged arbitrarily:

1. Hide page content and show only loader / overlay.
2. Attach exactly one `window.popstate` handler.
   It must call `handleRoute(fullPath, { fromHistory: true })`.
3. Restore the session with `await restoreSession()` / `checkAuth()`.
4. Keep the main app hidden while bootstrap resolves the route and loads data.
5. Call `handleRoute(currentFullPath, { replace: true, soft: true })`.
6. Load the data required by the current route.
7. Reveal the main app only after route + data bootstrap is complete.
8. Initialize navigation idempotently.
9. Start SSE / live updates only after the route is resolved and the app is visible.

Forbidden:

- Do not parallelize these steps.
- Do not reveal `#app-root` before step 7.
- Do not start SSE before step 9.

---

## Routing Rules (MUST)

- URL is the route source of truth.
- Unknown route goes to `404` / fallback only after the session decision.
- Unauthorized access goes to login / unauthorized route with preserved
  `returnUrl`.
- Every new deep-link route must be registered:
  - in the client router
  - in the server-side SPA fallback for F5 and direct URLs
- This also applies to production routes such as:
  - `/production/shifts/<DDMMYYYYsN>`
  - `/production/defects/<id>`
  - `/production/delayed/<id>`

---

## Common Failure Modes (DO NOT DO THIS)

- Unconditional `navigate('/dashboard')` on boot.
- Rendering dashboard before URL handling.
- Calling `showMainApp()` before `bootstrapApp()` has finished.
- Missing `popstate` handling.
- Duplicated `window.popstate` listeners across multiple bootstrap files.
- Re-initializing navigation without guard flags.

---

## Debugging

- Allowed log prefixes: `[ROUTE] ...`, `[BOOT] ...`
- Logs must make it clear at which bootstrap step execution stopped.

---

## Asset Loading Update

- Local `npm start` builds fresh `dist/` and serves hashed assets from `/assets/*`.
- Source-mode fallback is explicit and should be used only for debugging, not as
  the default local startup path.
- Production HTML is served from `dist/index.html` when a build exists.
- Production CSS and JS are served from hashed files under `/assets/`.
- `dist/index.html` must load only the CSS bundle and the `core` JS bundle.
- Route-specific code must be delivered as lazy route chunks.
- Route chunk loading must happen before the route-specific render step.
- The chunk loader must not bypass session-first bootstrap.
- `index.html` must stay fresh, while `/assets/*` can use immutable caching.
- Runtime bootstrap must not block first paint by sequentially fetching
  `app-version.json` and then dynamically injecting the full CSS/JS set.
- `scripts/build-frontend.js` is responsible for generating `dist/` and
  replacing source asset blocks with hashed bundle references.
- `scripts/bump-app-version.js` still keeps the source `index.html` fallback
  synchronized for non-built local startup.
