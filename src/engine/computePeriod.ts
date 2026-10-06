/**
 * Оркестратор расчёта периода — единственная публичная точка входа движка.
 *
 * Порядок фаз задан ТЗ 6.1. Инвестиции (фаза 5) считаются раньше себестоимости
 * (фаза 3) чисто по порядку вычислений: оба блока зависят только от решений и
 * входящего состояния, а не друг от друга, так что перестановка ни на что не
 * влияет.
 */

import { computeCapex } from './capex';
import { type CashFlowInput, type CashFlowResult, computeCashFlow, computePreRevenueFinancing, isBankrupt } from './cashflow';
import { computeUnitCost } from './cost';
import { computeDemand, type DemandFirmInput } from './demand';
import { assertBalanceIdentity, computeBalance } from './balance';
import { computeEmployees, computeIndustry } from './industry';
import { computeBankInterest, computePnl, type PnlInput, type PnlResult } from './pnl';
import { computeRif, computeRifLeagueAverages } from './rif';
import type {
  FirmDecision,
  FirmOpeningState,
  FirmPeriodResult,
  IndustryPeriodResult,
  League,
  LeagueConfig,
  PeriodMacroParams,
  PeriodResults,
  RifWeights,
} from './types';

/**
 * Официальный процент должен облагать и заём, взятый в ЭТОМ ЖЕ периоде (см.
 * `computeBankInterest` в pnl.ts) — а это цикл: процент → кэш → новый заём →
 * процент. Разрешаем его пересчётом P&L и кэш-флоу до схождения. Сходится
 * быстро: доля нового займа, обратно влияющая на процент, ограничена
 * ставкой/4 и дополнительно гасится налогом (выше процент → ниже
 * налогооблагаемая прибыль). 20 итераций — щедрый запас, а не откалиброванное
 * число.
 */
const BANK_INTEREST_MAX_ITERATIONS = 20;
const BANK_INTEREST_TOLERANCE = 0.005; // $, меньше цента

function interestForLoan(loan: number, macro: PeriodMacroParams, config: LeagueConfig): number {
  return computeBankInterest(
    {
      openingLoan: loan,
      loanLimitBase: macro.loanLimitBase,
      bankRateBase: macro.bankRateBase,
      bankRateExtra: macro.bankRateExtra,
    },
    config,
  );
}

/** Фазы 6–7 (P&L и кэш-флоу) вместе — самосогласованный процент по займу. */
export function resolvePnlAndCashFlow(
  pnlBase: Omit<PnlInput, 'bankInterest'>,
  cfBase: Omit<CashFlowInput, 'bankInterest' | 'tax' | 'revenue' | 'firingPenalty' | 'storageCost'>,
  openingLoan: number,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): { pnl: PnlResult; cf: CashFlowResult } {
  if (config.featureFlags.loanRepayment === 'preRevenue') {
    // Firing cost belongs to the initial budget; storage is sale-dependent and late.
    const costs = computePnl({ ...pnlBase, bankInterest: 0 }, macro, config);
    const fundingBase = { ...cfBase, depreciation: pnlBase.depreciation, firingPenalty: costs.firingPenalty };
    const financing = computePreRevenueFinancing(fundingBase, macro, config);
    const bankInterest = interestForLoan(financing.financedLoan, macro, config);
    const pnl = computePnl({ ...pnlBase, bankInterest }, macro, config);
    const cf = computeCashFlow({
      ...fundingBase,
      revenue: pnl.revenue,
      storageCost: pnl.storageCost,
      bankInterest: pnl.bankInterest,
      tax: pnl.tax,
    }, macro, config);
    return { pnl, cf };
  }

  let bankInterest = interestForLoan(openingLoan, macro, config);
  let pnl = computePnl({ ...pnlBase, bankInterest }, macro, config);
  let cf = computeCashFlow(
    {
      ...cfBase,
      revenue: pnl.revenue,
      firingPenalty: pnl.firingPenalty,
      storageCost: pnl.storageCost,
      bankInterest: pnl.bankInterest,
      tax: pnl.tax,
    },
    macro,
    config,
  );

  for (let i = 0; i < BANK_INTEREST_MAX_ITERATIONS; i++) {
    const nextInterest = interestForLoan(cf.loan, macro, config);
    if (Math.abs(nextInterest - pnl.bankInterest) < BANK_INTEREST_TOLERANCE) break;

    pnl = computePnl({ ...pnlBase, bankInterest: nextInterest }, macro, config);
    cf = computeCashFlow(
      {
        ...cfBase,
        revenue: pnl.revenue,
        firingPenalty: pnl.firingPenalty,
        storageCost: pnl.storageCost,
        bankInterest: pnl.bankInterest,
        tax: pnl.tax,
      },
      macro,
      config,
    );
  }

  return { pnl, cf };
}

export interface ComputePeriodInput {
  periodIndex: number;
  config: LeagueConfig;
  macro: PeriodMacroParams;
  firms: { id: string; name: string }[];
  opening: Record<string, FirmOpeningState>;
  decisions: Record<string, FirmDecision>;
  previousIndustry?: IndustryPeriodResult;
}

/** Стартовое состояние фирм для периода 0 — из настроек лиги. */
export function initialOpeningState(league: League): Record<string, FirmOpeningState> {
  const out: Record<string, FirmOpeningState> = {};
  for (const f of league.firms) {
    out[f.id] = {
      firmId: f.id,
      machines: f.initialMachines,
      period0Machines: f.initialMachines,
      cash: f.initialCash,
      loan: f.initialLoan,
      retainedEarnings: 0,
      capital: f.initialCapital,
      inventory: f.initialInventory,
      inventoryUnitCost: f.initialInventoryUnitCost,
      inventoryAgedUnits: 0,
      amortFundRemainder: f.initialAmortFundRemainder,
      employees: f.initialEmployees,
      rndCumulative: f.initialRnd,
      // Затухающий запас (мекомspec «Шаг 3») стартует пустым: до начала игры
      // ни один период ещё не мог дать избыток/недобор над нормой.
      rndDecayStock: 0,
      retainedEarningsBase: 0,
      productionPrevious: 0,
      demandPotentialCumulative: 0,
      productionCumulative: 0,
      sharePrevious: 0,
      isBankrupt: false,
    };
  }
  return out;
}

/** Состояние на начало следующего периода из результата текущего. */
export function nextOpeningState(
  previousOpening: Record<string, FirmOpeningState>,
  results: PeriodResults,
): Record<string, FirmOpeningState> {
  const out: Record<string, FirmOpeningState> = {};
  for (const r of results.firms) {
    const prev = previousOpening[r.firmId];
    out[r.firmId] = {
      firmId: r.firmId,
      machines: r.capacityNextPeriod,
      period0Machines: prev.period0Machines,
      cash: r.cash,
      loan: r.loan,
      retainedEarnings: r.retainedEarnings,
      capital: r.capital,
      inventory: r.inventoryEnd,
      inventoryUnitCost: r.inventoryUnitCostEnd,
      // Плата за хранение с задержкой в 1 период: в следующем периоде облагается
      // то, что лежит на складе СЕЙЧАС, а не то, что произведут тогда.
      inventoryAgedUnits: r.inventoryEnd,
      amortFundRemainder: r.amortFundRemainder,
      employees: r.employed,
      rndCumulative: r.rndCumulative,
      rndDecayStock: r.rndDecayStock,
      // База критерия РИФ «накопленная прибыль» (НакопПриб_база) фиксируется на периоде 0.
      retainedEarningsBase:
        results.periodIndex === 0 ? r.retainedEarnings : prev.retainedEarningsBase,
      productionPrevious: r.produced,
      demandPotentialCumulative:
        r.demandPotentialCumulative ?? (prev.demandPotentialCumulative ?? 0) + r.marketingExpense + r.rndExpense,
      productionCumulative:
        r.productionCumulative ?? (prev.productionCumulative ?? 0) + r.produced,
      sharePrevious: r.marketShareSold,
      isBankrupt: r.isBankrupt,
    };
  }
  return out;
}

export function computePeriod(input: ComputePeriodInput): PeriodResults {
  const { config, macro, periodIndex } = input;

  // Фирмы под заморозкой выбывают из расчёта спроса и P&L целиком.
  const frozen = new Set<string>();
  if (config.featureFlags.bankruptcyMode === 'freeze') {
    for (const f of input.firms) {
      if (input.opening[f.id]?.isBankrupt) frozen.add(f.id);
    }
  }
  const active = input.firms.filter((f) => !frozen.has(f.id));

  // ── Фаза 1: решения ───────────────────────────────────────────────────────
  const decisionOf = (firmId: string): FirmDecision =>
    input.decisions[firmId] ?? {
      firmId,
      price: 0,
      production: 0,
      marketing: 0,
      capexGross: 0,
      rnd: 0,
    };

  // ── Фаза 2: спрос и распределение заказов ────────────────────────────────
  const demandInputs: DemandFirmInput[] = active.map((f) => {
    const d = decisionOf(f.id);
    return {
      firmId: f.id,
      price: d.price,
      production: d.production,
      openingInventory: input.opening[f.id]?.inventory ?? 0,
      marketing: d.marketing,
      rnd: d.rnd,
      rndCumulativeBefore: input.opening[f.id]?.rndCumulative ?? 0,
      rndDecayStockBefore: input.opening[f.id]?.rndDecayStock ?? 0,
    };
  });
  const demand = computeDemand(demandInputs, config, { ...macro, periodIndex });

  // ── Фазы 3–8 по каждой фирме ─────────────────────────────────────────────
  const firmResults: FirmPeriodResult[] = [];

  for (const f of input.firms) {
    const opening = input.opening[f.id];
    const d = decisionOf(f.id);

    if (frozen.has(f.id)) {
      firmResults.push(frozenResult(f, opening, d, periodIndex, config));
      continue;
    }

    // Инвестиции и мощность
    const capex = computeCapex(
      {
        machines: opening.machines,
        capexGross: d.capexGross,
        amortFundRemainder: opening.amortFundRemainder,
      },
      config,
    );

    // Себестоимость единицы
    const unitCost = computeUnitCost(
      {
        capacityBase: opening.period0Machines,
        capacityCurrent: opening.machines,
        production: d.production,
      },
      config,
    );

    // Продажи
    const produced = Math.max(0, d.production);
    const orders = demand.ordersByFirm[f.id] ?? 0;
    const available = produced + opening.inventory;
    const sold = Math.min(orders, available);
    const unfulfilledOrders = orders - sold;
    const inventoryEnd = available - sold;

    const employed = computeEmployees(produced, opening.machines, config);

    // P&L + кэш-флоу и заём — вместе, чтобы процент по займу мог учитывать и
    // заём, взятый в этом же периоде (см. resolvePnlAndCashFlow выше).
    const { pnl, cf } = resolvePnlAndCashFlow(
      {
        price: d.price,
        sold,
        produced,
        unitCost,
        inventoryOpening: opening.inventory,
        inventoryOpeningUnitCost: opening.inventoryUnitCost,
        inventoryAgedUnits: opening.inventoryAgedUnits,
        marketing: d.marketing,
        rnd: d.rnd,
        depreciation: capex.depreciation,
        employeesPrevious: opening.employees,
        employeesCurrent: employed,
      },
      {
        openingCash: opening.cash,
        openingLoan: opening.loan,
        produced,
        unitCost,
        marketing: d.marketing,
        rnd: d.rnd,
        capexGross: d.capexGross,
        isBankrupt: opening.isBankrupt,
      },
      opening.loan,
      macro,
      config,
    );

    // Баланс
    const balance = computeBalance({
      cash: cf.cash,
      inventoryUnits: inventoryEnd,
      inventoryUnitCost: pnl.inventoryUnitCostEnd,
      capexBookValue: capex.capexBookValue,
      loan: cf.loan,
      retainedEarningsOpening: opening.retainedEarnings,
      netProfit: pnl.netProfit,
      capital: opening.capital,
    });
    assertBalanceIdentity(balance);

    firmResults.push({
      firmId: f.id,
      firmName: f.name,
      periodIndex,
      decision: d,

      ordersReceived: orders,
      produced,
      sold,
      unfulfilledOrders,
      inventoryEnd,
      marketShareSold: 0, // заполняется в фазе 9, когда известен Σсбыт по лиге

      unitCost,
      inventoryUnitCostEnd: pnl.inventoryUnitCostEnd,
      fullCapacity: opening.machines,
      capexAdditions: capex.capexAdditions,
      newMachines: capex.newMachines,
      capacityNextPeriod: capex.capacityNext,
      // Использование мощности — от ТЕКУЩЕЙ, а не от мощности следующего
      // периода: на реальном отчёте 698/873 = 80.0%, а не 698/1203 = 58%.
      capacityUtilization: opening.machines > 0 ? produced / opening.machines : 0,
      employed,

      revenue: pnl.revenue,
      cogs: pnl.cogs,
      grossProfit: pnl.grossProfit,
      marketingExpense: pnl.marketingExpense,
      rndExpense: pnl.rndExpense,
      depreciation: pnl.depreciation,
      firingPenalty: pnl.firingPenalty,
      storageCost: pnl.storageCost,
      bankInterest: pnl.bankInterest,
      profitBeforeTax: pnl.profitBeforeTax,
      tax: pnl.tax,
      netProfit: pnl.netProfit,

      cash: balance.cash,
      inventoryValue: balance.inventoryValue,
      capexBookValue: balance.capexBookValue,
      totalAssets: balance.totalAssets,
      loan: balance.loan,
      retainedEarnings: balance.retainedEarnings,
      capital: balance.capital,
      totalLiabEquity: balance.totalLiabEquity,

      newBorrowing: cf.newBorrowing,
      amortFundRemainder: capex.amortFundRemainder,
      rndCumulative: config.demandModel === 'legacy'
        ? opening.rndCumulative + Math.max(0, d.rnd)
        : Math.fround(opening.rndCumulative + Math.max(0, d.rnd)),
      demandPotentialCumulative:
        (opening.demandPotentialCumulative ?? 0) + pnl.marketingExpense + pnl.rndExpense,
      productionCumulative: (opening.productionCumulative ?? opening.productionPrevious) + produced,
      rndDecayStock: demand.breakdown.rndDecayStockByFirm[f.id] ?? 0,
      isBankrupt:
        opening.isBankrupt || isBankrupt(balance.cash, balance.loan, macro),
      unfundedShortfall: cf.unfundedShortfall,

      rif: emptyRif(),
    });
  }

  // ── Фаза 9: отраслевые агрегаты и РИФ ────────────────────────────────────
  const industry = computeIndustry(firmResults, macro, input.previousIndustry);

  const rifAverages = computeRifLeagueAverages(
    firmResults.map((r) => ({
      marketing: r.demandPotentialCumulative ?? r.marketingExpense + r.rndExpense,
      rnd: 0,
      production: r.productionCumulative ?? r.produced,
      productionPrevious: 0,
    })),
    config.rifMarketingRndCarry,
  );

  const rifWeights: RifWeights = {
    retainedProfit: macro.rifWeightRetainedProfit,
    demandPotential: macro.rifWeightDemandPotential,
    supplyPotential: macro.rifWeightSupplyPotential,
    efficiency80: macro.rifWeightEfficiency,
    marketShare: macro.rifWeightMarketShare,
    growth: macro.rifWeightGrowth,
  };

  for (const r of firmResults) {
    const opening = input.opening[r.firmId];
    r.marketShareSold = industry.totalSold > 0 ? (100 * r.sold) / industry.totalSold : 0;

    r.rif = computeRif(
      {
        retainedEarnings: r.retainedEarnings,
        // В периоде 0 базой служит накопленная прибыль этого же периода: разница
        // нулевая, критерий даёт ровно свой вес w1. С периода 1 база зафиксирована
        // и переносится через nextOpeningState.
        retainedEarningsBase:
          periodIndex === 0 ? r.retainedEarnings : (opening?.retainedEarningsBase ?? 0),
        period: periodIndex + 1,
        marketing: r.demandPotentialCumulative ?? r.marketingExpense + r.rndExpense,
        rnd: 0,
        avgMarketingRndPlusCarry: rifAverages.avgMarketingRndPlusCarry,
        production: r.productionCumulative ?? r.produced,
        productionPrevious: 0,
        avgProductionPlusPrevious: rifAverages.avgProductionPlusPrevious,
        utilizationPercent: r.capacityUtilization * 100,
        sold: r.sold,
        industrySold: industry.totalSold,
        sharePrevious: opening?.sharePrevious ?? 0,
        firmCount: firmResults.length,
        isFirstPeriod: periodIndex === 0,
        weights: rifWeights,
      },
      config,
    );
  }

  return {
    periodIndex,
    computedAt: new Date().toISOString(),
    firms: firmResults,
    industry,
    macro,
  };
}

function emptyRif() {
  return {
    retainedProfitScore: 0,
    demandPotential: 0,
    supplyPotential: 0,
    efficiency80: 0,
    marketShareScore: 0,
    growthScore: 0,
    total: 0,
  };
}

/** Замороженная фирма: показатели держатся на уровне банкротства, движения нет. */
function frozenResult(
  firm: { id: string; name: string },
  opening: FirmOpeningState,
  decision: FirmDecision,
  periodIndex: number,
  config: LeagueConfig,
): FirmPeriodResult {
  const capexBookValue = opening.machines * config.machineCost + opening.amortFundRemainder;
  const inventoryValue = opening.inventory * opening.inventoryUnitCost;
  const zeroed = {
    ordersReceived: 0,
    produced: 0,
    sold: 0,
    unfulfilledOrders: 0,
    marketShareSold: 0,
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    marketingExpense: 0,
    rndExpense: 0,
    depreciation: 0,
    firingPenalty: 0,
    storageCost: 0,
    bankInterest: 0,
    profitBeforeTax: 0,
    tax: 0,
    netProfit: 0,
    capexAdditions: 0,
    newMachines: 0,
    newBorrowing: 0,
    unfundedShortfall: 0,
  };

  return {
    firmId: firm.id,
    firmName: firm.name,
    periodIndex,
    decision,
    ...zeroed,
    inventoryEnd: opening.inventory,
    unitCost: opening.inventoryUnitCost,
    inventoryUnitCostEnd: opening.inventoryUnitCost,
    fullCapacity: opening.machines,
    capacityNextPeriod: opening.machines,
    capacityUtilization: 0,
    employed: 0,
    cash: opening.cash,
    inventoryValue,
    capexBookValue,
    totalAssets: opening.cash + inventoryValue + capexBookValue,
    loan: opening.loan,
    retainedEarnings: opening.retainedEarnings,
    capital: opening.capital,
    totalLiabEquity: opening.loan + opening.retainedEarnings + opening.capital,
    amortFundRemainder: opening.amortFundRemainder,
    rndCumulative: opening.rndCumulative,
    demandPotentialCumulative: opening.demandPotentialCumulative ?? 0,
    productionCumulative: opening.productionCumulative ?? opening.productionPrevious,
    rndDecayStock: opening.rndDecayStock,
    isBankrupt: true,
    rif: emptyRif(),
  };
}
