# PagaDios

Vanilla HTML/CSS/JS SPA (no framework, no build step) to split shared family expenses. Target is a PWA on Firebase Firestore + Google auth, but it currently runs entirely on an in-memory mock store. UI copy is Spanish (Argentina).

## Run

- No install/build/lint/typecheck tooling. `npm test` runs Node's built-in runner (`node --test`) with zero dependencies, fully offline.
- In this WSL setup `node` is not on PATH; call the Windows binary directly from the repo root:
  `"/mnt/c/Program Files/nodejs/node.exe" --test` (or `--test --watch`).
- Serve the app over HTTP, e.g. `python3 -m http.server`, then open `index.html`. It will not work from `file://` because scripts are ES modules and Firebase SDK is imported from the gstatic CDN.

## Test / verify

- Tests live in `test/*.test.js`; shared helpers in `support/` (Node treats every file under `test/` as a test, so helpers must stay out of it).
- Tests import only pure modules from `src/` — never browser APIs or Firebase. `src/firestoreStore.js` and `firestore.js` import the CDN SDK, so they are NOT testable in Node.
- Sanity check a file without running it: `"/mnt/c/Program Files/nodejs/node.exe" --check <file>`.

## Layout

- `app.js` — browser entry: state, rendering, event wiring. Renders **only from `src/sessionCache.js`** (never queries the store while rendering). Mock login (pick a user) since there is no Firebase auth yet.
- `src/sessionCache.js` — reactive per-(user, session) cache. Opens one subscription per collection and exposes `state`, `onChange`, `open`, `loadMoreCompras`.
- `src/model.js` — all business logic (expenses, saldar, estafar, pagadios, balances, leaderboards, notifications). Pure and store-agnostic. Also has `balancesFromSaldos` / `leaderboardsFrom` for cache-driven rendering.
- `src/store.js` — in-memory store implementing the Firestore subset used: `get/set/update/add/delete`, `query(collection, { where, orderBy, limit, startAfter })`, `queryGroup`, `batch`, `newId`, optimistic `runTransaction`, and `subscribe`/`subscribeQuery`/`subscribeGroup`/`subscribeAny`. Exports `increment()` / `serverTimestamp()` write sentinels.
- `src/firestoreStore.js` — same interface against Firestore (gstatic CDN). Swap the store in `app.js` to go live.
- `src/money.js` — cent-based `splitAmount`/`round2`/`formatMoney`.
- `src/mockData.js` — demo users, session, join codes and seed expenses.
- `firestore.js` — Firebase init (`initializeFirestore` + `persistentLocalCache` + `persistentMultipleTabManager`). Placeholder config.
- `index.html` — markup plus inline globals `toggleSidebar()`/`switchView()`; loads `app.js` as `type="module"`. `styles.css` holds all styles.

## Traffic rules (do not regress)

- The UI must never read Firestore during render. All data comes from `sessionCache`; new subscriptions only happen in `sessionCache.open()`.
- `addExpense` must stay read-free: it uses `store.batch()` + `increment()` (no read-modify-write).
- Collections that grow unbounded must be queried with `limit`/`startAfter`: `compras` (page of 20, "Cargar más") and `notificaciones` (limit 20). Unread badge comes from `usuarios/{uid}.notif_no_leidas`, not from counting docs.
- List a user's sessions with `queryGroup('miembros', { where:[['uid','==',uid]] })`, never by scanning `sesiones`.

## Data model (Firestore-ready)

- `usuarios/{uid}` — profile + `notif_no_leidas` counter.
- `sesiones/{sesionId}` — session + aggregates `total_gastado` / `compras_count`.
- `sesiones/{sid}/miembros/{uid}` — membership with per-session `dinero_estafado` / `pagadios` and aggregates `total_gastado` / `compras_count`.
- `sesiones/{sid}/compras/{id}` — expense; `saldos/{idA_idB}` — pairwise balance; `pagos/{id}` — settlements; `solicitudes/{id}` — estafar/pagadios requests.
- `usuarios/{uid}/notificaciones/{id}` — in-app notifications.
- `codigos/{codigo} -> { sesionId }` — invite/join lookup.
- Aggregates and balances use `increment()` + `{ merge: true }`. `settle` / `resolveEstafa` / `forgivePagadios` still use `runTransaction` because they must validate the current debt (they read only the affected doc).

## Balance sign convention (do not break)

- Saldo id is `${sortedIds[0]}_${sortedIds[1]}` with ids sorted lexicographically, so A→B and B→A hit the same doc.
- `balance_neto_A_vs_B > 0` means `B` owes `A`; `< 0` means `A` owes `B`.
- Derive directions with `netOwedTo`, `owedBy`, `forgivenessEffect` in `src/model.js` instead of hand-rolling signs. `netOwedTo` rounds to 2 decimals because `increment()` accumulates float drift.
- Money is handled in cents (`src/money.js`) to avoid float drift; always test sum-exactness when splitting.

## Gotchas

- All tracked sources are CRLF on disk while git stores LF, so full-file diffs are normal. Avoid wholesale reformatting / line-ending conversion.
- Comments and user-facing strings are Spanish; match that style.
- `app.js` re-renders on every `sessionCache` change; render functions must not write to the store or they will loop.
- Firebase SDK is pinned to `10.8.0`; keep versions in sync.
