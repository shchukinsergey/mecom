import { useCurrentSnapshot, useLeagueStore } from '../../state/leagueStore';
import { NumberField } from '../components/NumberField';
import type { LeagueConfig, NativeDemandConfig } from '../../engine/types';

/** Подписи и подсказки к переключателям версий формул. */
const FLAG_FIELDS: {
  key: keyof LeagueConfig['featureFlags'];
  label: string;
  options: { value: string; label: string }[];
  hint: string;
}[] = [
  {
    key: 'bankInterestFormula',
    label: 'Банковский процент',
    options: [
      { value: 'official', label: 'По траншам (официальная)' },
      { value: 'flatLoanRate', label: 'Плоская ставка' },
    ],
    hint: 'Официальная разделяет заём в пределах лимита и сверх него. Плоская — упрощение для новичков.',
  },
  {
    key: 'bankruptcyMode',
    label: 'Банкротство фирмы',
    options: [
      { value: 'externalManagement', label: 'Внешнее управление' },
      { value: 'freeze', label: 'Заморозка' },
      { value: 'labelOnly', label: 'Только метка' },
    ],
    hint: 'Внешнее управление: фирма играет дальше, но займ выше абсолютного лимита не выдаётся.',
  },
  {
    key: 'loanRepayment',
    label: 'Гашение займа',
    options: [
      { value: 'none', label: 'Не гасится (архивный режим)' },
      { value: 'sweep', label: 'Гасится из остатка входящих средств' },
      { value: 'preRevenue', label: 'Финансирование до выручки (MECOM)' },
    ],
    hint: 'MECOM: расходы финансируются до выручки; процент относится к первоначально рассчитанному долгу. Sweep гасит долг из избытка входящих средств. Режим уже сохранённой лиги не меняется автоматически.',
  },
];

type NumericConfigKey = { [K in keyof LeagueConfig]-?: LeagueConfig[K] extends number ? K : never }[keyof LeagueConfig];
const LEGACY_DEMAND_KEYS = new Set<NumericConfigKey>([
  'priceLambda', 'demandCoeffLow', 'demandExpLow', 'demandCoeffHigh', 'demandExpHigh',
  'demandBreakpoint', 'demandRndPeriodNorm', 'demandRndDecayScale', 'demandRndExcessSlope',
  'demandMktgLnCoeffA', 'demandMktgLnCoeffB', 'demandMktgLnOffset', 'demandMktgLnNorm',
]);
const NATIVE_DEMAND_FIELDS: { key: keyof NativeDemandConfig; label: string; step?: number }[] = [
  { key: 'demandScale', label: 'Масштаб спроса' },
  { key: 'generalDemandSensitivity', label: 'Чувствительность спроса к ОС', step: 0.005 },
  { key: 'marketingScale', label: 'Масштаб маркетингового спроса', step: 0.001 },
  { key: 'marketingIntercept', label: 'Базовый коэффициент маркетинга', step: 0.001 },
  { key: 'marketingModifierSensitivity', label: 'Чувствительность маркетинга к ВМ', step: 0.0005 },
  { key: 'marketingThreshold', label: 'Порог маркетинга лиги (до ×K)' },
  { key: 'marketingExcessSlope', label: 'Наклон маркетинга сверх порога', step: 0.01 },
  { key: 'rndScale', label: 'Масштаб спроса НИОКР', step: 0.1 },
  { key: 'rndModifierSensitivity', label: 'Чувствительность НИОКР к ВН', step: 0.01 },
  { key: 'initialLeagueRnd', label: 'База НИОКР лиги (до ×K)' },
  { key: 'priceExponent', label: 'Степень цены при дележе', step: 0.1 },
  { key: 'firmMarketingThreshold', label: 'Порог маркетинга фирмы (до ×K)' },
  { key: 'firmMarketingExcessSlope', label: 'Наклон маркетинга фирмы сверх порога', step: 0.01 },
  { key: 'firmRndThreshold', label: 'Порог НИОКР фирмы (до ×K)' },
  { key: 'firmRndExcessSlope', label: 'Наклон НИОКР фирмы сверх порога', step: 0.01 },
  { key: 'priceCutoff', label: 'Порог цены для ограничения заказов, $' },
];

const CONFIG_FIELDS: { key: NumericConfigKey; label: string; step?: number }[] = [
  { key: 'machineCost', label: 'Стоимость станка, $' },
  { key: 'machineLifespanPeriods', label: 'Срок службы станка, периодов' },

  { key: 'priceWeight', label: 'Вес цены при дележе заказов', step: 0.05 },
  { key: 'mktgWeight', label: 'Вес маркетинга при дележе заказов', step: 0.05 },
  { key: 'rndWeight', label: 'Вес НИОКР при дележе заказов', step: 0.05 },
  { key: 'mktgExponent', label: 'Степень маркетинговой привлекательности (M/P)^n', step: 0.5 },
  { key: 'priceLambda', label: 'λ ценового индекса', step: 0.0001 },

  { key: 'demandCoeffLow', label: 'D(P): коэфф. ниже перелома (итог по отрасли)' },
  { key: 'demandExpLow', label: 'D(P): степень ниже перелома', step: 0.01 },
  { key: 'demandCoeffHigh', label: 'D(P): коэфф. выше перелома (итог по отрасли)' },
  { key: 'demandExpHigh', label: 'D(P): степень выше перелома', step: 0.01 },
  { key: 'demandBreakpoint', label: 'D(P): точка перелома, $', step: 0.1 },

  { key: 'demandRndPeriodNorm', label: 'D: норма НИОКР/период на фирму (затух. запас)', step: 10 },
  { key: 'demandRndDecayScale', label: 'D: масштаб забывания запаса НИОКР (λ)', step: 1000 },
  { key: 'demandRndExcessSlope', label: 'D: наклон множителя избытка НИОКР', step: 0.000001 },
  { key: 'demandMktgLnCoeffA', label: 'D: множитель маркетинга — своб. член', step: 0.0001 },
  { key: 'demandMktgLnCoeffB', label: 'D: множитель маркетинга — коэфф. при ln', step: 0.0001 },
  { key: 'demandMktgLnOffset', label: 'D: множитель маркетинга — сдвиг под ln, $', step: 1 },
  { key: 'demandMktgLnNorm', label: 'D: множитель маркетинга — нормировка', step: 1 },

  { key: 'costK1', label: 'Себестоимость: k1', step: 0.5 },
  { key: 'costK2', label: 'Себестоимость: k2', step: 0.5 },
  { key: 'costOptimalCu', label: 'Себестоимость: CUopt, %', step: 1 },
  { key: 'costCuUp', label: 'Себестоимость: делитель выше CUopt', step: 1 },
  { key: 'costCuDown', label: 'Себестоимость: делитель ниже CUopt', step: 0.5 },

  { key: 'rifMarketingRndCarry', label: 'РИФ: P_перенос ($, база вводного периода)', step: 10 },
  { key: 'rifEffPeak', label: 'РИФ: вершина Eff(80%)', step: 0.01 },
  { key: 'rifEffUpSlope', label: 'РИФ: наклон Eff выше 80%', step: 0.001 },
  { key: 'rifEffDownSlope', label: 'РИФ: наклон Eff между изломом и 80%', step: 0.001 },
  { key: 'rifEffFarSlope', label: 'РИФ: наклон Eff ниже излома', step: 0.01 },
  { key: 'rifEffLowThreshold', label: 'РИФ: нижний излом Eff, %', step: 1 },

  { key: 'storageCostPerUnit', label: 'Хранение, $ за ед.', step: 0.5 },
  { key: 'firingPenaltyPerEmployee', label: 'Штраф за увольнение, $', step: 1 },
  { key: 'serviceFee', label: 'Надбавка за обслуживание, годовых', step: 0.005 },
  { key: 'depositRate', label: 'Ставка по депозиту (займ < 0), годовых', step: 0.01 },
  { key: 'periodsPerYear', label: 'Периодов в году' },
  { key: 'staffingSizeDivisor', label: 'Занятость: делитель размера выпуска' },
  { key: 'baseStaff', label: 'Занятость: постоянный штат' },
  { key: 'staffPerUnit', label: 'Занятость: человек на ед. выпуска', step: 0.1 },
];

export function LeagueSetup() {
  const snapshot = useCurrentSnapshot();
  const renameLeague = useLeagueStore((s) => s.renameLeague);
  const updateFirm = useLeagueStore((s) => s.updateFirm);
  const addFirm = useLeagueStore((s) => s.addFirm);
  const removeFirm = useLeagueStore((s) => s.removeFirm);
  const updateLeagueConfig = useLeagueStore((s) => s.updateLeagueConfig);
  const updateFeatureFlags = useLeagueStore((s) => s.updateFeatureFlags);
  const setScreen = useLeagueStore((s) => s.setScreen);

  if (!snapshot) return <p className="hint">Лига не выбрана.</p>;

  const { league } = snapshot;
  const started = league.results.length > 0;

  return (
    <div>
      <div className="panel">
        <h2>Лига</h2>
        <div className="field" style={{ maxWidth: 420 }}>
          <label>Название</label>
          <input value={league.name} onChange={(e) => renameLeague(e.target.value)} />
        </div>
        {started && (
          <p className="hint" style={{ marginBottom: 0 }}>
            Партия уже идёт (рассчитано периодов: {league.results.length}). Состав фирм и их
            стартовые условия закрыты для правки — иначе разъедутся уже посчитанные периоды.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Фирмы и стартовые условия</h2>
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th className="num">Станки</th>
              <th className="num">Наличные</th>
              <th className="num">Займы</th>
              <th className="num">Капитал</th>
              <th className="num">Склад</th>
              <th className="num">Себест. склада</th>
              <th className="num">Накопл. НИОКР</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {league.firms.map((firm) => (
              <tr key={firm.id}>
                <td style={{ minWidth: 160 }}>
                  <input
                    value={firm.name}
                    onChange={(e) => updateFirm(firm.id, { name: e.target.value })}
                  />
                </td>
                <td className="num" style={{ width: 110 }}>
                  <NumberField
                    value={firm.initialMachines}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialMachines: v })}
                  />
                </td>
                <td className="num" style={{ width: 120 }}>
                  <NumberField
                    value={firm.initialCash}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialCash: v })}
                  />
                </td>
                <td className="num" style={{ width: 120 }}>
                  <NumberField
                    value={firm.initialLoan}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialLoan: v })}
                  />
                </td>
                <td className="num" style={{ width: 120 }}>
                  <NumberField
                    value={firm.initialCapital}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialCapital: v })}
                  />
                </td>
                <td className="num" style={{ width: 100 }}>
                  <NumberField
                    value={firm.initialInventory}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialInventory: v })}
                  />
                </td>
                <td className="num" style={{ width: 110 }}>
                  <NumberField
                    value={firm.initialInventoryUnitCost}
                    step={0.01}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialInventoryUnitCost: v })}
                  />
                </td>
                <td className="num" style={{ width: 110 }}>
                  <NumberField
                    value={firm.initialRnd}
                    disabled={started}
                    onChange={(v) => updateFirm(firm.id, { initialRnd: v })}
                  />
                </td>
                <td>
                  <button
                    className="danger"
                    disabled={started || league.firms.length <= 2}
                    onClick={() => removeFirm(firm.id)}
                  >
                    Убрать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={started} onClick={() => addFirm(`Фирма ${league.firms.length + 1}`)}>
            Добавить фирму
          </button>
          <span className="hint">
            Баланс на старте должен сходиться: наличные + склад + станки × стоимость = займы + капитал.
          </span>
        </div>
        <BalanceCheck league={league} />
      </div>

      <div className="panel">
        <h2>Версии формул</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {FLAG_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <select
                value={league.config.featureFlags[f.key]}
                onChange={(e) => updateFeatureFlags({ [f.key]: e.target.value } as never)}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="hint">{f.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Константы движка</h2>
        <div className="field">
          <label>Модель занятости</label>
          <select value={league.config.employmentModel}
            onChange={e => updateLeagueConfig({ employmentModel: e.target.value as LeagueConfig['employmentModel'] })}>
            <option value="native">EXE: загрузка текущей мощности (по умолчанию)</option>
            <option value="legacy">Архивная линейная модель</option>
          </select>
        </div>
        <p className="hint">EXE: ceil(выпуск × (100 + ceil(выпуск / делитель)) / текущая мощность).
          Делитель и текущая мощность должны быть положительными. Новые станки влияют со следующего периода.
          Сохранённые результаты и входящий штат не пересчитываются: для исправления старой истории нужна новая лига или повтор всей партии с начала.</p>
        <div className="field">
          <label>Модель спроса</label>
          <select value={league.config.demandModel}
            onChange={(e) => updateLeagueConfig({ demandModel: e.target.value as LeagueConfig['demandModel'] })}>
            <option value="native">Формула EXE (по умолчанию)</option>
            <option value="legacy">Архивная калибровка (для пользовательских настроек)</option>
          </select>
        </div>
        <p className="hint">
          Часть этих чисел в источниках — настройки конкретной партии, а не универсальные
          константы. Меняйте, если калибруете движок под свою лигу.
        </p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {CONFIG_FIELDS.filter(f => (league.config.demandModel === 'legacy' || !LEGACY_DEMAND_KEYS.has(f.key)) &&
            (f.key === 'staffingSizeDivisor' ? league.config.employmentModel === 'native' :
              f.key === 'baseStaff' || f.key === 'staffPerUnit' ? league.config.employmentModel === 'legacy' : true)).map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <NumberField
                value={league.config[f.key]}
                step={f.step}
                onChange={(v) => updateLeagueConfig({ [f.key]: v } as Partial<LeagueConfig>)}
              />
            </div>
          ))}
        </div>
      </div>

      {league.config.demandModel === 'native' && <div className="panel">
        <h3>Спрос EXE</h3>
        <p className="hint">K = ceil(число фирм / 8). НИОКР не затухает: накопленная сумма делится на период + 1.
          Изменённые коэффициенты, K &gt; 1 и ненулевые ОС/ВМ/ВН не проверены на корпусе оригинала.
          Уже сохранённые результаты не пересчитываются.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {NATIVE_DEMAND_FIELDS.map(f => <div className="field" key={f.key}>
            <label>{f.label}</label>
            <NumberField value={league.config.nativeDemand[f.key]} step={f.step}
              onChange={v => updateLeagueConfig({ nativeDemand: { ...league.config.nativeDemand, [f.key]: v } })} />
          </div>)}
        </div>
      </div>}

      <button className="primary" onClick={() => setScreen('period')}>
        К вводу решений
      </button>
    </div>
  );
}

/** Предупреждение, если стартовый баланс фирмы не сходится. */
function BalanceCheck({ league }: { league: ReturnType<typeof useCurrentSnapshot> extends null ? never : NonNullable<ReturnType<typeof useCurrentSnapshot>>['league'] }) {
  const broken = league.firms.filter((f) => {
    const assets =
      f.initialCash +
      f.initialInventory * f.initialInventoryUnitCost +
      f.initialMachines * league.config.machineCost;
    const liabilities = f.initialLoan + f.initialCapital;
    return Math.abs(assets - liabilities) > 1;
  });

  if (broken.length === 0) return null;

  return (
    <div className="error" style={{ marginTop: 12, marginBottom: 0 }}>
      Стартовый баланс не сходится у фирм: {broken.map((f) => f.name).join(', ')}. Расчёт
      периода остановится с ошибкой — поправьте наличные, займы или капитал.
    </div>
  );
}
