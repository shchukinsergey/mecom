/**
 * Типы игрового движка МЭКОМ.
 *
 * Движок не знает про UI и способ ввода решений: единственная точка входа —
 * computePeriod(league, decisions, macro, previousState) -> PeriodResults.
 */

// ---------------------------------------------------------------------------
// Флаги версий формул
// ---------------------------------------------------------------------------

/**
 * Источники восстанавливают движок по косвенным данным и в нескольких местах
 * противоречат друг другу. Каждое такое место — переключаемый флаг, а не
 * захардкоженный выбор.
 */
export interface FeatureFlags {
  /**
   * 'official'     — раздельные ставки на заём в пределах лимита и сверх (дефолт);
   * 'flatLoanRate' — плоская ставка на весь заём (упрощённый режим для новичков).
   */
  bankInterestFormula: 'official' | 'flatLoanRate';

  /**
   * Что делать с фирмой, попавшей под критерий банкротства.
   * 'externalManagement' — метка + запрет займа сверх абсолютного лимита (дефолт);
   * 'freeze'             — фирма исключается из расчёта, показатели замораживаются;
   * 'labelOnly'          — только метка в таблице, расчёт без ограничений.
   */
  bankruptcyMode: 'externalManagement' | 'freeze' | 'labelOnly';

  /**
   * 'none' — archived behavior: debt only grows to cover an end-period cash deficit.
   * 'sweep' — legacy: repay from opening cash above all period spending, excluding revenue.
   * 'preRevenue' — original MECOM (default for new games): finance production + marketing + R&D +
   *   gross capex - depreciation + firing cost before revenue. Repayment may cross
   *   zero into a deposit. Interest uses this first financed debt, not a late cash topup.
   */
  loanRepayment: 'none' | 'sweep' | 'preRevenue';
}

// ---------------------------------------------------------------------------
// Конфигурация лиги
// ---------------------------------------------------------------------------

/**
 * Все «магические числа» движка. В источниках прямо сказано, что часть из них —
 * параметры конкретной партии, а не универсальные константы, поэтому они живут
 * здесь, а не в формулах.
 */
export interface LeagueConfig {
  /** Native EXE default; legacy mode preserves archived custom curves. */
  demandModel: 'native' | 'legacy';
  nativeDemand: NativeDemandConfig;
  // --- Станки и амортизация (раздел 4 источника) ---
  machineCost: number; // стоимость одного станка, $ (дефолт 40)
  machineLifespanPeriods: number; // срок службы, периодов (дефолт 20)

  // --- Веса привлекательности при дележе заказов (мекомspec 2.1) ---
  priceWeight: number; // доля заказов, распределяемая по цене (дефолт 0.70)
  mktgWeight: number; // по маркетингу (дефолт 0.15)
  rndWeight: number; // по НИОКР (дефолт 0.15)
  mktgExponent: number; // native: степень (M/P)^n; legacy: M^n (дефолт 1.5)

  // --- Legacy-only curve/table/decay parameters (archived custom configurations) ---
  priceLambda: number; // λ — вычитаемая доля среднего f по лиге (дефолт 0.2076, не откалибровано)
  priceFTable: [number, number][]; // таблица [цена, f(цена)] для интерполяции
  /** Степенное продолжение ниже первой точки по двум нижним положительным точкам. */
  priceLowExtrapolation?: boolean;

  // --- Общий объём рынка по отрасли, D(P) — не зависит от N (мекомspec 2.2) ---
  demandCoeffLow: number; // коэффициент D(P) при P ≤ demandBreakpoint (дефолт 60850)
  demandExpLow: number; // показатель степени той же ветки (дефолт 0.85)
  demandCoeffHigh: number; // коэффициент D(P) при P > demandBreakpoint (дефолт 1668820)
  demandExpHigh: number; // показатель степени той же ветки (дефолт 1.75)
  demandBreakpoint: number; // точка стыка двух режимов, $ (дефолт 39.6)

  // --- Legacy-only множители объёма. Нативный спрос НЕ использует затухание;
  // эти поля сохраняются для явно выбранной архивной модели и импорта. ---
  demandRndPeriodNorm: number; // норма НИОКР/период на фирму, сверх которой считается избыток в затухающий запас (дефолт 420)
  demandRndDecayScale: number; // делитель в λ_i(t) = 1 − 1/(1 + НИОКР_i(t)/scale) — скорость забывания запаса (дефолт 25000)
  demandRndExcessSlope: number; // наклон линейного множителя избытка НИОКР (дефолт 0.0000224)
  demandMktgLnCoeffA: number; // свободный член логарифмического ядра множителя маркетинга (дефолт -2.4507)
  demandMktgLnCoeffB: number; // коэфф. при ln(ΣM + demandMktgLnOffset) (дефолт 0.3798)
  demandMktgLnOffset: number; // сдвиг ΣM под логарифмом, $ (дефолт 879)
  demandMktgLnNorm: number; // денормализатор — точка ΣM+offset, где множитель = 1 (дефолт 9279 = 8400 + 879)

  // --- Себестоимость (мекомspec, часть 3) ---
  costK1: number; // коэффициент при отношении мощностей (дефолт 15)
  costK2: number; // свободный член (дефолт 3)
  costOptimalCu: number; // CUopt — оптимальная загрузка, % (дефолт 80)
  costCuUp: number; // делитель выше CUopt (дефолт 10000/69)
  costCuDown: number; // делитель ниже CUopt (дефолт 10000/138)
  /** Explicit customization: preserve even old approximate standard values on load. */
  costDenominatorsCustom?: boolean;

  // --- Прочие расходы ---
  storageCostPerUnit: number; // хранение, $ за единицу за период (дефолт 1)
  firingPenaltyPerEmployee: number; // штраф за увольнение, $ за человека (дефолт 10)
  serviceFee: number; // надбавка за обслуживание кредита, годовых (дефолт 0.01)
  periodsPerYear: number; // периодов в году — делитель годовых ставок (дефолт 4)
  /**
   * Ставка по депозиту, годовых (дефолт 0.10). Применяется, когда заём при
   * `featureFlags.loanRepayment: 'sweep'` уходит в минус — это и есть
   * депозит: банк платит фирме, а не наоборот. Отдельная от ставок по займу
   * (bankRateBase/bankRateExtra) и не зависит от лимитов loanLimitBase/Abs.
   */
  depositRate: number;

  // --- Занятость: EXE или архивная линейная модель ---
  employmentModel: 'native' | 'legacy';
  staffingSizeDivisor: number; // G[1], положительный делитель выпуска (100)
  baseStaff: number; // постоянный персонал, чел. (дефолт 0)
  staffPerUnit: number; // человек на единицу выпуска (дефолт 1)

  // --- РИФ (мекомspec, часть 1) ---
  rifMarketingRndCarry: number; // P_перенос — база вводного периода, $ (дефолт 0, параметр сценария)
  rifEffPeak: number; // вершина Eff(CU) при CU=80 (дефолт 9.88)
  rifEffUpSlope: number; // наклон выше 80% (дефолт 0.136)
  rifEffDownSlope: number; // наклон между нижним изломом и 80% (дефолт 0.102)
  rifEffFarSlope: number; // наклон ниже нижнего излома (дефолт 0.20, не откалибровано)
  rifEffLowThreshold: number; // нижний излом Eff(CU), % (дефолт 30, диапазон 25–34)

  featureFlags: FeatureFlags;
}

/** EXE globals before K=ceil(N/8) scaling; custom settings are not corpus-tested. */
export interface NativeDemandConfig {
  demandScale: number;
  generalDemandSensitivity: number;
  marketingScale: number;
  marketingIntercept: number;
  marketingModifierSensitivity: number;
  marketingThreshold: number;
  marketingExcessSlope: number;
  rndScale: number;
  rndModifierSensitivity: number;
  initialLeagueRnd: number;
  priceExponent: number;
  firmMarketingThreshold: number;
  firmMarketingExcessSlope: number;
  firmRndThreshold: number;
  firmRndExcessSlope: number;
  priceCutoff: number;
}

/** Веса шести критериев РИФ — задаются per-период (мекомspec, часть 4). */
export interface RifWeights {
  retainedProfit: number; // w1, дефолт 50
  demandPotential: number; // w2, дефолт 10
  supplyPotential: number; // w3, дефолт 10
  efficiency80: number; // w4, дефолт 10
  marketShare: number; // w5, дефолт 10
  growth: number; // w6, дефолт 10
}

/** Стартовые условия одной фирмы. Все настраиваемые, ничего не захардкожено. */
export interface Firm {
  id: string;
  name: string;
  initialMachines: number;
  initialCash: number;
  initialLoan: number;
  initialCapital: number;
  initialInventory: number;
  initialInventoryUnitCost: number;
  initialAmortFundRemainder: number;
  initialEmployees: number;
  /** Предыгровой НИОКР (дефолт 0): вводный вклад записывается решением периода 0. */
  initialRnd: number;
}

export interface League {
  id: string;
  name: string;
  createdAt: string;
  config: LeagueConfig;
  firms: Firm[];
  /** Макропараметры по периодам; индекс массива = номер периода. */
  macroByPeriod: PeriodMacroParams[];
  /** Решения по периодам: periods[i][firmId]. */
  decisionsByPeriod: Record<string, FirmDecision>[];
  /**
   * Отметка ведущего «решение фирмы пересмотрено на этот период», по периодам
   * и firmId. Поля решений по умолчанию наследуются с прошлого периода (см.
   * ensurePeriodSlots) — эта отметка не влияет на расчёт, только помогает
   * ведущему не забыть, что он ещё не смотрел решение этой фирмы.
   */
  confirmedByPeriod: Record<string, boolean>[];
  /** Рассчитанные периоды. */
  results: PeriodResults[];
}

// ---------------------------------------------------------------------------
// Вход периода
// ---------------------------------------------------------------------------

/** Макропараметры периода — редактируются ведущим (раздел 10). */
export interface PeriodMacroParams {
  periodIndex: number;
  /** Native ОС/ВМ/ВН controls; nonzero trajectories are not corpus-tested. */
  demandOS?: number;
  demandVM?: number;
  demandVN?: number;
  taxRate: number; // доля, например 0.32
  bankRateBase: number; // годовая ставка по основной кредитной линии, доля
  bankRateExtra: number; // годовая ставка сверх лимита, доля
  loanLimitBase: number; // предел основной кредитной линии, $
  loanLimitAbs: number; // абсолютный предел займа (порог банкротства), $

  // Веса шести критериев РИФ (мекомspec, часть 4) — меняются между периодами,
  // поэтому живут здесь, а не в LeagueConfig. Сумма по умолчанию 100.
  rifWeightRetainedProfit: number; // w1, дефолт 50
  rifWeightDemandPotential: number; // w2, дефолт 10
  rifWeightSupplyPotential: number; // w3, дефолт 10
  rifWeightEfficiency: number; // w4, дефолт 10
  rifWeightMarketShare: number; // w5, дефолт 10
  rifWeightGrowth: number; // w6, дефолт 10

  scenarioNewsText: string;
}

/** Пять решений фирмы на период. */
export interface FirmDecision {
  firmId: string;
  price: number;
  production: number;
  marketing: number;
  capexGross: number; // «инвестиции-брутто», включают амортизацию
  rnd: number;
}

/**
 * Состояние фирмы на начало периода. Для периода 0 собирается из стартовых
 * условий, дальше переносится из результата предыдущего периода.
 */
export interface FirmOpeningState {
  firmId: string;
  machines: number; // «Полная мощность» текущего периода, шт
  period0Machines: number; // стартовая мощность — мощность_баз в себестоимости (часть 3)
  cash: number;
  loan: number;
  retainedEarnings: number;
  capital: number;
  inventory: number; // остаток на складе, шт
  inventoryUnitCost: number; // средневзвешенная себестоимость остатка, $
  /**
   * Остаток на складе на начало ПРЕДЫДУЩЕГО периода — то, что пролежало полный
   * период и потому облагается платой за хранение (раздел 5, задержка в 1 период).
   */
  inventoryAgedUnits: number;
  amortFundRemainder: number; // недоинвестированные центы, копятся между периодами
  employees: number;
  rndCumulative: number; // накопленный НИОКР за все периоды, включая нулевой и initialRnd — вечный, для дележа долей (мекомspec, Шаг 2)
  /** Legacy-only decay counter; native mode ignores and preserves it for compatibility. */
  rndDecayStock: number;
  retainedEarningsBase: number; // НакопПриб_база — фиксируется в периоде 0 (РИФ, критерий 1)
  productionPrevious: number; // произв_i,пред — производство фирмы в прошлом периоде (РИФ C3)
  /** Суммы всех завершённых периодов для РИФ; необязательны в старых снимках. */
  demandPotentialCumulative?: number;
  productionCumulative?: number;
  sharePrevious: number; // доля_i,пред — доля рынка (по сбыту) фирмы в прошлом периоде, % (РИФ C6)
  isBankrupt: boolean;
}

// ---------------------------------------------------------------------------
// Выход периода
// ---------------------------------------------------------------------------

export interface RifBreakdown {
  retainedProfitScore: number;
  demandPotential: number;
  supplyPotential: number;
  efficiency80: number;
  marketShareScore: number;
  growthScore: number;
  total: number;
}

export interface FirmPeriodResult {
  firmId: string;
  firmName: string;
  periodIndex: number;

  // Решения этого периода (дублируются в отчёт)
  decision: FirmDecision;

  // Спрос и продажи
  ordersReceived: number;
  produced: number;
  sold: number;
  unfulfilledOrders: number;
  inventoryEnd: number;
  /** Доля рынка в штуках проданного, % (мекомspec 1: доля_i = 100·сбыт_i/Σсбыт). */
  marketShareSold: number;

  // Себестоимость и мощность
  unitCost: number;
  inventoryUnitCostEnd: number; // средневзвешенная себестоимость остатка
  fullCapacity: number; // мощность текущего периода, шт
  capexAdditions: number; // доп. вложения, $
  newMachines: number;
  capacityNextPeriod: number; // шт
  capacityUtilization: number; // доля, production / fullCapacity
  employed: number;

  // P&L
  revenue: number;
  cogs: number;
  grossProfit: number;
  marketingExpense: number;
  rndExpense: number;
  depreciation: number;
  firingPenalty: number;
  storageCost: number;
  bankInterest: number;
  profitBeforeTax: number;
  tax: number;
  netProfit: number;

  // Баланс
  cash: number;
  inventoryValue: number;
  capexBookValue: number;
  totalAssets: number;
  loan: number;
  retainedEarnings: number;
  capital: number;
  totalLiabEquity: number;

  // Служебное
  newBorrowing: number;
  amortFundRemainder: number;
  rndCumulative: number;
  /** Накопленные с периода 0 маркетинг+НИОКР и производство — базы РИФ C2/C3. */
  demandPotentialCumulative?: number;
  productionCumulative?: number;
  /** Затухающий запас НИОКР на конец периода — переносится в следующий период
   * через nextOpeningState. См. FirmOpeningState.rndDecayStock. */
  rndDecayStock: number;
  isBankrupt: boolean;
  /** Заём, который фирма запросила, но не получила из-за внешнего управления. */
  unfundedShortfall: number;

  rif: RifBreakdown;
}

export interface IndustryPeriodResult {
  periodIndex: number;
  totalOrders: number;
  totalProduced: number;
  totalSold: number;
  totalInventory: number;
  totalCapacity: number; // шт
  industryRevenue: number;
  avgPrice: number;
  avgUnitCost: number;
  totalCapex: number; // капвложения по балансам, $
  industryUtilization: number; // доля
  totalEmployees: number;
  salesPerEmployee: number;

  // Макропараметры периода — публикуются всем (раздел 1)
  bankRateBase: number;
  loanAmountBase: number;
  bankRateExtra: number;
  loanAmountExtra: number;
  taxRate: number;

  /** Изменения к предыдущему периоду в долях; null, если предыдущего нет. */
  deltas: {
    totalOrders: number | null;
    totalProduced: number | null;
    totalSold: number | null;
    totalInventory: number | null; // в штуках, а не в процентах
    totalCapacity: number | null;
    industryRevenue: number | null;
    avgPrice: number | null;
    avgUnitCost: number | null;
    totalCapex: number | null;
    industryUtilization: number | null;
    bankRateBase: number | null;
    loanAmountBase: number | null;
  };
}

export interface PeriodResults {
  periodIndex: number;
  computedAt: string;
  firms: FirmPeriodResult[];
  industry: IndustryPeriodResult;
  macro: PeriodMacroParams;
}
