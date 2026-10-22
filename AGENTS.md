# Repository guide

## Project
МЭКОМ is a Russian-language economic business simulation with two supported modes: an online multiplayer application (Node.js server, SQLite, accounts, rooms, player cabinets and timed periods) and a local browser-only facilitator tool. Online players enter and submit their own decisions; local facilitators enter decisions for all firms. Both use the shared calculation engine.

## Inspect before planning
- This guide was refreshed against source on 2026-10-22. Verify current code before declaring a feature absent or proposing new infrastructure; documentation can lag implementation.
- Start with `package.json`, `server/index.ts`, `server/roomsHttp.ts`, `server/roomDatabase.ts`, and the relevant UI/API modules for online features.
- Telegram group notifications already exist. Read `docs/TELEGRAM.md` and `server/telegram*.ts` before planning Telegram changes. Optional personal Telegram linking, bot-based login, personal notifications and group mentions are implemented; preserve login/password compatibility.
- `docs/multiplayer-api.md` describes the opt-in legacy token-based server, not the default account/SQLite server.

## Stack and commands
- React 18 + TypeScript (strict), Vite 8, Zustand 5; Vitest 4. `html-to-image` renders report images; `jszip` builds bulk ZIP exports.
- `npm run dev` serves at `127.0.0.1:5173`; `npm test`; `npm run typecheck`; `npm run build` (client in `dist/`, server in `dist-server/`, checks both client and server types); `npm run smoke` requires the dev server and system Chrome.
- Node.js 24+ is required for the server (`node:sqlite`). `npm run server` starts the built server on port 8787 by default; Vite proxies `/api` to it. `npm run test:server`, `npm run smoke:rooms`, and `npm run smoke:telegram` cover online functionality. See scripts/docs for smoke prerequisites. Use current test output rather than historical test counts.

## Structure and data flow
- `index.html` → `src/main.tsx` → `src/ui/App.tsx` → local and online screens in `src/ui/screens/`. `OnlineRooms.tsx` provides the account-based rooms UI; `src/online/roomsApi.ts` is its API client.
- `src/engine/`: pure calculation modules and shared types/config. `computePeriod.ts` is the public orchestration boundary: demand → capacity/capex and costs → sales → P&L/cash flow/balance → RIF and industry aggregates. Keep UI/state concerns out of this layer; assert balance identity during calculations.
- `src/state/leagueStore.ts`: Zustand actions create/update/compute leagues and persist snapshots. `persistence.ts`: localStorage (`mecom.leagues.v1`), config defaults, versioned JSON import/export. Opening firm state advances from each result.
- Reports flow through `src/report/` (text renderers); UI supports clipboard/PNG, bulk ZIP (`src/ui/exportAllReports.ts`) and optional direct folder output (`src/state/reportsFolder.ts`).
- Local storage is browser localStorage; optional report-folder handles live in IndexedDB (`mecom-reports-dirs`) and use File System Access API (Chrome/Edge).
- `server/index.ts` starts the default account server: `accounts.ts` handles login/password and cookie sessions; `roomsHttp.ts` handles access, rooms, decisions and period timers; `roomDatabase.ts` stores accounts/sessions/rooms/members in SQLite. A member links `userId` to `firmId` and `submitted`; currently one firm per account per room. `backupSupport.ts` manages database backups.
- `MECOM_MODE=legacy` explicitly selects the older loopback server (`http.ts`, `repository.ts`, JSON storage). Do not confuse it with default online mode or local browser mode.
- Telegram: `telegram.ts` handles webhook commands and delivery; `telegramStore.ts` persists chat managers, room subscriptions and notification jobs; `telegramMessages.ts` renders public rankings and reminders. `src/ui/TelegramSettings.tsx` configures group subscriptions. The existing bot sends period starts, previous-period RIF rankings, game completion and one-hour reminders listing firms that have not submitted. Delivery sweeps every 30 seconds with retries; transitions enqueue within the room transaction. Telegram API calls are server-side.
- Personal Telegram identity lives in `telegram_identities`, separate from chat managers. `telegram_auth` holds five-minute one-time codes plus separate browser secrets; `/login code` in a private bot chat confirms identity. `TelegramAuth.tsx` polls completion. New Telegram-only accounts have no usable password and cannot unlink their only login. `telegram_personal_jobs` queues notifications for member accounts. Mentions use Telegram IDs and escaped display names.
- Deployment: `DEPLOY-AMVERA.md`, `Dockerfile`, `amvera.yml`; one server instance and persistent SQLite storage. Telegram configuration and delivery details: `docs/TELEGRAM.md`.
- `data/calibration/` holds calibration CSVs. `mecom-spec.md` is the primary source for calibrated demand/RIF/cost behavior; `DOCS.md` documents formulas, model, and caveats. `scripts/` contains browser smoke automation and a separate DOSBox/PowerShell automation path.

## Conventions
- Preserve strict TypeScript and existing module boundaries; prefer focused pure-function changes in `engine` and corresponding Vitest regression tests.
- Add/adjust tests under the relevant `src/**/__tests__/` folder or alongside server modules (`server/*.test.ts`). Verify with `npm test`, `npm run typecheck`, and `npm run build` for code changes.
- Treat game formulas and defaults as scenario-sensitive. Keep configurable values in `LeagueConfig`/period macro types, not unexplained literals. Preserve the distinction between `rndCumulative` (market-share allocation) and decaying `rndDecayStock` (market volume).
- Maintain firm-report privacy: a private firm renderer must not receive competitors' private figures. Master report is facilitator-only.
- Keep persistence schema/config-default compatibility in mind when changing `LeagueConfig` or stored data. Test JSON import/export and migration/default behavior.
- Reports are fixed-width monospaced text; test alignment/wrapping when editing templates.

## Known limitations / debt
- Some model assumptions remain uncalibrated or inferred: employment formula, low-utilization RIF break, portions of price-attractiveness interpolation, and market-demand behavior for heterogeneous high prices. See `DOCS.md` limitations and `mecom-spec.md` markers before changing these.
- `README.md` is a concise overview; detailed formulas live in `DOCS.md` and `mecom-spec.md`. Documentation contains historical counts/claims that may drift; use current tests/source as truth.
- Browser File System Access behavior is Chrome/Edge-specific; fallback is ZIP export.
- Check actual repository metadata before relying on git status/history; `.git` is present at this refresh. Keep changes narrowly scoped.

## Useful references
- `README.md`: quick start and high-level overview.
- `DOCS.md`: architecture, formulas, persistence, tests, limitations.
- `mecom-spec.md`: calibrated model specification.
- `src/engine/computePeriod.ts`, `src/state/leagueStore.ts`: calculation/state orchestration.