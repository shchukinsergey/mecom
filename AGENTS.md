# Repository guide

## Project
МЭКОМ is a Russian-language, browser-only facilitator tool for an economic business simulation. The facilitator configures leagues, enters each firm's five decisions and period macro parameters, runs the simulation, and exports private firm reports plus public industry reports. There is no server, login, or remote API.

## Stack and commands
- React 18 + TypeScript (strict), Vite 8, Zustand 5; Vitest 4. `html-to-image` renders report images; `jszip` builds bulk ZIP exports.
- `npm run dev` serves at `127.0.0.1:5173`; `npm test`; `npm run typecheck`; `npm run build` (static output in `dist/`); `npm run smoke` requires the dev server and system Chrome.
- At inspection: 123 tests across 8 files passed; typecheck and production build passed. `npm run smoke` was not run.

## Structure and data flow
- `index.html` → `src/main.tsx` → `src/ui/App.tsx` → four screens in `src/ui/screens/`.
- `src/engine/`: pure calculation modules and shared types/config. `computePeriod.ts` is the public orchestration boundary: demand → capacity/capex and costs → sales → P&L/cash flow/balance → RIF and industry aggregates. Keep UI/state concerns out of this layer; assert balance identity during calculations.
- `src/state/leagueStore.ts`: Zustand actions create/update/compute leagues and persist snapshots. `persistence.ts`: localStorage (`mecom.leagues.v1`), config defaults, versioned JSON import/export. Opening firm state advances from each result.
- Reports flow through `src/report/` (text renderers); UI supports clipboard/PNG, bulk ZIP (`src/ui/exportAllReports.ts`) and optional direct folder output (`src/state/reportsFolder.ts`).
- Normal storage is browser localStorage; optional report-folder handles live in IndexedDB (`mecom-reports-dirs`) and use File System Access API (Chrome/Edge). No external service/API calls.
- `data/calibration/` holds calibration CSVs. `mecom-spec.md` is the primary source for calibrated demand/RIF/cost behavior; `DOCS.md` documents formulas, model, and caveats. `scripts/` contains browser smoke automation and a separate DOSBox/PowerShell automation path.

## Conventions
- Preserve strict TypeScript and existing module boundaries; prefer focused pure-function changes in `engine` and corresponding Vitest regression tests.
- Add/adjust tests under the relevant `src/**/__tests__/` folder. Verify with `npm test`, `npm run typecheck`, and `npm run build` for code changes.
- Treat game formulas and defaults as scenario-sensitive. Keep configurable values in `LeagueConfig`/period macro types, not unexplained literals. Preserve the distinction between `rndCumulative` (market-share allocation) and decaying `rndDecayStock` (market volume).
- Maintain firm-report privacy: a private firm renderer must not receive competitors' private figures. Master report is facilitator-only.
- Keep persistence schema/config-default compatibility in mind when changing `LeagueConfig` or stored data. Test JSON import/export and migration/default behavior.
- Reports are fixed-width monospaced text; test alignment/wrapping when editing templates.

## Known limitations / debt
- Some model assumptions remain uncalibrated or inferred: employment formula, low-utilization RIF break, portions of price-attractiveness interpolation, and market-demand behavior for heterogeneous high prices. See `DOCS.md` limitations and `mecom-spec.md` markers before changing these.
- `README.md` is a concise overview; detailed formulas live in `DOCS.md` and `mecom-spec.md`. Documentation contains historical counts/claims that may drift; use current tests/source as truth.
- Browser File System Access behavior is Chrome/Edge-specific; fallback is ZIP export.
- Repository directory currently has no `.git` metadata, so git status/history cannot be used here. Keep changes narrowly scoped.

## Useful references
- `README.md`: quick start and high-level overview.
- `DOCS.md`: architecture, formulas, persistence, tests, limitations.
- `mecom-spec.md`: calibrated model specification.
- `src/engine/computePeriod.ts`, `src/state/leagueStore.ts`: calculation/state orchestration.