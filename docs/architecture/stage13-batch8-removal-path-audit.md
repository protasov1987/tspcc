# Stage 13 Batch 8 Removal-Path Audit

Scope: cleanup proof after Stage 13 Batch 7. This document classifies the
remaining legacy / adapter paths without expanding the legacy role of any
domain. `receipts` remains a frozen out-of-scope carve-out.

## Classification

| Path | Classification | Proof | Removal path |
| --- | --- | --- | --- |
| GET `/api/data` | Allowed read compatibility | Server serves full or scoped snapshot reads through `buildScopedDataPayload(...)`; migrated UI writes use domain endpoints. | Remove after all remaining read hydration and fixtures are moved to domain reads or explicitly archived read models. |
| GET `/api/data?scope=cards-basic` | Allowed read compatibility | Used by cards/list compatibility reads and tests as scoped hydration, not as a write path. | Replace with cards/read-model endpoints when the final Stage 14 read contract is introduced. |
| GET `/api/data?scope=directories` | Allowed read compatibility | Directories writes use `/api/directories/*`; scoped snapshot read remains a hydration bridge. | Replace directory hydration with domain read endpoints and remove the scope from the snapshot endpoint. |
| GET `/api/data?scope=production` | Allowed read compatibility | Production commands use `/api/production/*`; scoped read carries production planning data and domain revision. | Replace production hydration with production slice endpoints after all production screens stop reading the legacy snapshot. |
| POST `/api/data` | Temporary compatibility with explicit guard | `preserveProtectedSlicesForLegacySnapshot(...)` preserves directories, security, messaging/profile, push/FCM, and production planning slices from server truth. `tests/e2e/28.stage13-removal-path-contract.spec.js` verifies protected slices cannot be overwritten. | Keep only until every remaining non-critical compatibility writer is removed. Then delete `LEGACY_SNAPSHOT_SAVE_PATH`, `saveData()`, server POST handling, and related `[DATA] legacy snapshot boundary` diagnostics in one focused cleanup batch. |
| `saveData()` | Temporary adapter with no in-scope UI callers | Static audit in `tests/e2e/28.stage13-removal-path-contract.spec.js` verifies client application code does not call `saveData()` outside its store definition. | Delete together with POST `/api/data` after compatibility writers are gone. New critical writes must use domain endpoints. |
| `preserveProtectedSlicesForLegacySnapshot(...)` | Keep guard with removal path | The guard is still required while POST `/api/data` exists. It prevents stale snapshot payloads from overwriting Stage 6-12 migrated slices. | Remove only after POST `/api/data` is removed or disabled. Removing the guard before that would reopen planning/security/chat overwrite risk. |
| `API_ENDPOINT` alias | Temporary adapter, currently unused by callers | Static audit verifies the alias is only defined in `js/app.00.state.js`; active reads/writes use explicit `LEGACY_SNAPSHOT_READ_PATH` / `LEGACY_SNAPSHOT_SAVE_PATH`. | Delete after a final static audit confirms no old code references the alias. |
| `navigateTo()` alias | Temporary navigation compatibility adapter | It forwards to the central navigation layer and does not create a parallel route/write model. | Convert remaining old callers to `navigateToPath(...)`, then remove the alias in a navigation-only cleanup. |
| `getCardDisplayTitle()` alias | Temporary formatting compatibility adapter | It forwards to `formatCardTitle(...)` and does not affect writes or routing. | Convert callers to `formatCardTitle(...)`, then remove the deprecated alias. |
| `js/app.73.receipts.js` leftovers | Out-of-scope receipts carve-out | Receipts is frozen by the migration plan and was not changed by this batch. Mentions of legacy barcode / fallback refresh inside receipts do not justify retaining legacy write paths for in-scope domains. | A future receipts-specific migration plan must handle this separately. Stage 13 must not expand receipts scope. |
| Live fallback refresh | Allowed Stage 12 safety fallback | Existing realtime tests cover fallback refresh for cards, directories/security, planning, and workspace. It is a safety refresh path, not correctness source. | Remove only when Stage 14 introduces measured final diagnostics/perf hardening and proves fallback is no longer required. |
| Production areas layout localStorage migration | Temporary adapter | `loadLegacyProductionAreasLayout()` reads old localStorage order and silently migrates to `/api/production/planning/areas-layout` when server layout is absent. | Delete legacy localStorage keys and loader after one release window where server layout is populated for active users. |
| `/api/messages/*` | Removed | Static audit verifies `server.js` has no active `/api/messages` routes. E2E verifies old dialog/send/mark-read paths return 404 and `/api/chat/*` remains the only message write path. | No adapter remains. Do not reintroduce without a separate compatibility decision. |

## Protected Snapshot Boundary

POST `/api/data` is not allowed to own critical in-scope slices. While the
compatibility endpoint exists, the following slices are preserved from current
server truth:

- directories: `ops`, `centers`, `areas`
- security: `users`, `accessLevels`
- messaging/profile/notifications: `messages`, `userActions`,
  `chatConversations`, `chatMessages`, `chatStates`, `webPushSubscriptions`,
  `fcmTokens`
- production planning: `productionSchedule`, `productionShiftTimes`,
  `productionShiftTasks`, `productionShifts`
- planning/security shared state: `meta.domainRevisions`

The guard is intentionally conservative. It remains until POST `/api/data` is
removed or disabled.

## Batch 8 Conclusion

No blocker was found that requires expanding legacy snapshot behavior. Remaining
paths are either read compatibility, frozen receipts carve-out, Stage 12 safety
fallback, or temporary adapters with explicit removal paths.
