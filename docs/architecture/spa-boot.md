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
  `fullPath` must be read from the current
  `window.location.pathname + window.location.search`; stale `event.state.route`
  must not override the URL.
  Feature-level `popstate` listeners must not compete with the central router.
3. Restore the session with `await restoreSession()` / `checkAuth()`.
4. Initialize navigation idempotently before the first loading route pass.
  This step may be implemented via `setupNavigation()` plus the route-facing
  navigation helpers it depends on (for example dropdown wiring).
  Removed legacy UI layers must not keep bootstrap-only setup hooks.
5. Call `handleRoute(currentFullPath, { replace: true, loading: true })`
  to mount the correct page shell for the URL.
  If `handleRoute` performs an internal SPA redirect (for example `/` to a
  permission-based home route), the bootstrap pipeline must continue with the
  updated canonical route, not the stale pre-redirect path.
6. Load only route-critical data required for the current route.
7. Render the target page inside the route handler after route-critical data is ready.
8. Start full background hydration only after the route is already visible.
9. Start SSE / live updates only after the route is resolved.

Allowed optimization:

- Security-only data may be deferred out of the mandatory bootstrap path.
- Deferred security loading is allowed only for routes that actually need it
  (for example `/users`, `/accessLevels`, `/profile/<id>`).
- Full `/api/data` hydration may also be deferred out of the critical F5 path,
  but only if route-critical data is loaded first for the exact URL route.
- Background hydration must be idempotent and single-flight.
- This deferral MUST NOT bypass session restore, permission checks,
  or protected-route guards.

Forbidden:

- Do not parallelize these steps.
- Do not render protected route content before step 6.
- Do not use a forced redirect as a substitute for route-critical loading.
- Do not run multiple competing full hydration requests.

---

## Routing Rules (MUST)

- URL is the route source of truth.
- `/` is an auth entry route, not a business page route.
- If the user is authenticated and opens `/`, `handleRoute` must redirect
  inside the SPA router to the user's home route resolved from permissions
  (for example `permissions.landingTab`), using replace semantics.
- If the user opens a concrete deep link such as `/cards`, `/workspace/<id>`,
  `/profile/<id>`, that URL remains authoritative after login as long as
  access is allowed. Home-route redirect applies only to `/`.
- Explicit logout in the current tab must reset the SPA route to auth-entry `/`
  with replace semantics before the next login, so a new user does not inherit
  the previous user's protected business route.
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
