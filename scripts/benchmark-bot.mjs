import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Offline, reproducible full-game checks. No server, browser, or account access.
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { chooseBotDecision } = await server.ssrLoadModule('/src/engine/bot.ts');
  const { computePeriod, initialOpeningState, nextOpeningState } = await server.ssrLoadModule('/src/engine/computePeriod.ts');
  const { makeFirmStart, makeFirmDecision, makeMacroParams, DEFAULT_LEAGUE_CONFIG } = await server.ssrLoadModule('/src/engine/config.ts');
  const { checkDecisionBudget } = await server.ssrLoadModule('/src/engine/decisionBudget.ts');
  const rows = [];
  const run = (name, count, rivalPrice, useBot) => {
    const config = structuredClone(DEFAULT_LEAGUE_CONFIG);
    const firms = Array.from({ length: count }, (_, i) => ({ ...makeFirmStart(count), id: `f${i}`, name: `Firm ${i}` }));
    const league = { id: name, name, createdAt: '', config, firms,
      macroByPeriod: Array.from({ length: 9 }, (_, p) => makeMacroParams(p)),
      decisionsByPeriod: [Object.fromEntries(firms.map(f => [f.id, makeFirmDecision(f.id, count)]))],
      confirmedByPeriod: [], results: [] };
    let opening = initialOpeningState(league);
    const times = [];
    const turns = [];
    for (let p = 0; p < 9; p++) {
      const decisions = Object.fromEntries(firms.map(f => [f.id, {
        ...makeFirmDecision(f.id, count), price: p === 0 || f.id === 'f0' ? 30 : rivalPrice,
        production: Math.round(opening[f.id].machines * 0.8),
        capexGross: Math.round(opening[f.id].machines * config.machineCost / config.machineLifespanPeriods),
      }]));
      if (useBot && p > 0) {
        const start = performance.now();
        decisions.f0 = chooseBotDecision({ league, opening }, 'f0', () => 0.5);
        times.push(performance.now() - start);
      }
      const valid = !checkDecisionBudget(opening.f0, decisions.f0, league.macroByPeriod[p], config).overspend;
      const result = computePeriod({ periodIndex: p, config, macro: league.macroByPeriod[p], firms, opening, decisions,
        previousIndustry: league.results.at(-1)?.industry, previousNativeIndustryState: league.results.at(-1)?.nativeIndustryState });
      const own = result.firms[0];
      turns.push({ period: p, rif: own.rif.total, profit: Math.round(own.netProfit), production: own.produced,
        price: decisions.f0.price, rnd: decisions.f0.rnd, investment: decisions.f0.capexGross,
        inventory: own.inventoryEnd, loan: Math.round(own.loan), bankrupt: own.isBankrupt, valid });
      league.results.push(result);
      league.decisionsByPeriod[p] = decisions;
      league.decisionsByPeriod[p + 1] = {};
      opening = nextOpeningState(opening, result);
    }
    const last = league.results.at(-1).firms[0];
    rows.push({ scenario: name, policy: useBot ? 'bot' : 'fixed-30-maintenance-80pct', firms: count,
      finalRif: last.rif.total, retainedEarnings: Math.round(last.retainedEarnings),
      invalidTurns: turns.filter(t => !t.valid).length, bankruptTurns: turns.filter(t => t.bankrupt).length,
      maximumDecisionMs: Math.round(Math.max(0, ...times)), turns });
  };
  for (const [name, count, price] of [['steady-2', 2, 30], ['low-price-2', 2, 20], ['steady-8', 8, 30], ['low-price-8', 8, 20]]) {
    run(name, count, price, false);
    run(name, count, price, true);
  }
  const historical = [];
  if (process.argv[3]) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(process.argv[3], { readOnly: true });
    try {
      for (const room of db.prepare('SELECT name, snapshot FROM rooms').all()) {
        const source = JSON.parse(room.snapshot);
        if (source.league.firms.length <= 2 || source.league.results.length < 3) continue;
        for (const firm of source.league.firms) {
          const league = structuredClone(source.league);
          const recorded = league.results;
          league.results = [recorded[0]];
          league.decisionsByPeriod = [recorded[0].firms.reduce((d, f) => ({ ...d, [f.firmId]: f.decision }), {}), {}];
          let opening = nextOpeningState(initialOpeningState(league), recorded[0]);
          let validTurns = 0;
          for (let p = 1; p < recorded.length; p++) {
            const decision = chooseBotDecision({ league, opening }, firm.id, () => 0.5);
            if (!checkDecisionBudget(opening[firm.id], decision, league.macroByPeriod[p], league.config).overspend) validTurns++;
            const decisions = Object.fromEntries(recorded[p].firms.map(f => [f.firmId, f.firmId === firm.id ? decision : {
              ...f.decision, production: Math.min(f.decision.production, opening[f.firmId].machines),
            }]));
            const result = computePeriod({ periodIndex: p, config: league.config, macro: league.macroByPeriod[p],
              firms: league.firms, opening, decisions, previousIndustry: league.results.at(-1).industry,
              previousNativeIndustryState: league.results.at(-1).nativeIndustryState });
            league.results.push(result);
            league.decisionsByPeriod[p] = decisions;
            league.decisionsByPeriod[p + 1] = {};
            opening = nextOpeningState(opening, result);
          }
          const actual = recorded.at(-1).firms.find(f => f.firmId === firm.id);
          const bot = league.results.at(-1).firms.find(f => f.firmId === firm.id);
          historical.push({ game: room.name, firm: firm.name, playedTurns: recorded.length - 1,
            validTurns, actualRif: actual.rif.total, replayBotRif: bot.rif.total,
            actualRetainedEarnings: Math.round(actual.retainedEarnings), replayBotRetainedEarnings: Math.round(bot.retainedEarnings),
            botBankrupt: bot.isBankrupt });
        }
      }
    } finally { db.close(); }
  }
  const report = {
    note: 'Deterministic synthetic games; fixed baseline. Historical replay replaces one firm at a time while others repeat recorded decisions without reacting. Original results may use an earlier engine version. Incomplete games end at their last recorded turn; the bot still plans to the known game end. This is not evidence of guaranteed superiority against people.',
    rows, historical,
  };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  console.table(rows.map(({ turns, ...summary }) => summary));
  if (historical.length) console.table(historical);
} finally {
  await server.close();
}
