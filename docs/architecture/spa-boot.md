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
4. Initialize navigation idempotently.
5. Call `handleRoute(currentFullPath, { replace: true, soft: true })`.
6. Render the target page only inside the route handler.
7. Start SSE / live updates only after the route is resolved.

Forbidden:

- Do not parallelize these steps.
- Do not render before step 5.

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
- Missing `popstate` handling.
- Duplicated `window.popstate` listeners across multiple bootstrap files.
- Re-initializing navigation without guard flags.

---

## Debugging

- Allowed log prefixes: `[ROUTE] ...`, `[BOOT] ...`
- Logs must make it clear at which bootstrap step execution stopped.

---

## Asset Loading Update

- `index.html` must use normal versioned asset tags for first paint:
  - `<link rel="stylesheet" href="/style.css?v=<app-version>">`
  - `<script src="/js/...?... " defer></script>`
- Asset version must be synchronized from `app-version.json`.
- Runtime bootstrap must not block first paint by sequentially fetching
  `app-version.json` and then dynamically injecting the full CSS/JS set.
- `scripts/bump-app-version.js` updates versioned asset URLs in `index.html`
  during each required application version bump.
