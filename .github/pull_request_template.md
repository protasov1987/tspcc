# PR Checklist

## Routing / Bootstrap (required if touched)

- [ ] F5 works on /dashboard
- [ ] F5 works on /cards
- [ ] F5 works on /cards/<id>
- [ ] F5 works on /profile/<id> or /user/<id>
- [ ] Direct open by URL works (no redirect to dashboard)
- [ ] Back / Forward works
- [ ] initNavigation / setupNavigation is idempotent
- [ ] popstate triggers handleRoute(fullPath)
- [ ] spa-boot.md updated if boot order was changed

## Notes
(optional)
