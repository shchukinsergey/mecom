import { useEffect, useState } from 'react';
import {
  currentPeriodIndex,
  useCurrentSnapshot,
  useLeagueStore,
} from '../../state/leagueStore';
import { downloadLeagueFile } from '../../state/persistence';
import {
  checkPermission,
  connectReportsFolder,
  disconnectReportsFolder,
  getStoredFolder,
  isFileSystemAccessSupported,
  requestPermission,
  saveAllReports,
  saveReportsForPeriod,
  type FolderPermission,
} from '../../state/reportsFolder';
import { NumberField } from '../components/NumberField';
import { ReportView } from '../components/ReportView';
import { renderFirmExport, renderIndustryReport, renderMasterReport } from '../../report';
import { money, num, percent } from '../../report/format';
import { estimateFunds, fundsLevel, type FundsPreview } from '../fundsPreview';
import { downloadAllFirmReports } from '../exportAllReports';
import type { FirmDecision, PeriodMacroParams } from '../../engine/types';


type FolderUiState = 'checking' | 'unsupported' | 'disconnected' | FolderPermission;

const MACRO_FIELDS: {
  key: keyof PeriodMacroParams;
  label: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}[] = [
  { key: 'taxRate', label: 'Ставка налога', step: 0.01, min: 0, max: 0.99 },
  { key: 'bankRateBase', label: 'Банк. ставка (осн.)', step: 0.01, min: 0, max: 0.99 },
  { key: 'bankRateExtra', label: 'Банк. ставка (экстр.)', step: 0.05, min: 0 },
  { key: 'loanLimitBase', label: 'Предел осн. линии, $', step: 1000, min: 0 },
  { key: 'loanLimitAbs', label: 'Абсолютный предел займа, $', step: 1000, min: 0 },
  { key: 'rifWeightRetainedProfit', label: 'РИФ: вес w1 (Н.Приб)', step: 1, min: 0, max: 100 },
  { key: 'rifWeightDemandPotential', label: 'РИФ: вес w2 (ПотСпр)', step: 1, min: 0, max: 100 },
  { key: 'rifWeightSupplyPotential', label: 'РИФ: вес w3 (ПотПр)', step: 1, min: 0, max: 100 },
  { key: 'rifWeightEfficiency', label: 'РИФ: вес w4 (Эфф80%)', step: 1, min: 0, max: 100 },
  { key: 'rifWeightMarketShare', label: 'РИФ: вес w5 (Доля Р)', step: 1, min: 0, max: 100 },
  { key: 'rifWeightGrowth', label: 'РИФ: вес w6 (Рост)', step: 1, min: 0, max: 100 },
];

/** Значение прошлого периода мелким текстом под полем ввода. */
function PrevValue({ value, format }: { value: number | undefined; format: (v: number) => string }) {
  if (value === undefined) return null;
  return <div className="prev-value">пред: {format(value)}</div>;
}

/** Разбивка бюджета нативного диалога ввода — не прогноз расчёта периода. */
function fundsTitle(p: FundsPreview): string {
  return [
    `Наличные: ${money(p.cash)}`,
    `Доступный кредит (до абс. предела): ${money(p.availableCredit)}`,
    `Суммарные средства: ${money(p.totalFunds)}`,
    `Стоимость пр-ва: ${money(-p.costOfProduction)}`,
    `Маркетинг: ${money(-p.marketing)}`,
    `Инвестиции (брутто, справочно): ${money(p.investment)}`,
    `Амортизация (возврат в бюджет): ${money(p.depreciation)}`,
    `Инвестиции (нетто): ${money(-p.netInvestment)}`,
    `НИОКР: ${money(-p.rnd)}`,
    '',
    `Остаток наличных: ${money(p.cashRemaining)}`,
    `Остаток кредита: ${money(p.creditRemaining)}`,
    `Остаток бюджета ввода: ${money(p.remaining)}`,
    'Бюджет ввода не гарантирует итоговую ликвидность. Увольнения, хранение, проценты и налоги учитываются при расчёте периода отдельно.',
  ].join('\n');
}

export function PeriodScreen() {
  const snapshot = useCurrentSnapshot();
  const updateMacro = useLeagueStore((s) => s.updateMacro);
  const updateDecision = useLeagueStore((s) => s.updateDecision);
  const setConfirmed = useLeagueStore((s) => s.setConfirmed);
  const compute = useLeagueStore((s) => s.computeCurrentPeriod);
  const recompute = useLeagueStore((s) => s.recomputeLastPeriod);
  const computeError = useLeagueStore((s) => s.computeError);

  const [tab, setTab] = useState<string>('industry');
  const [includeIndustry, setIncludeIndustry] = useState(true);
  const [reportsZipBusy, setReportsZipBusy] = useState(false);
  const [reportsZipStatus, setReportsZipStatus] = useState<string | null>(null);

  const [folderState, setFolderState] = useState<FolderUiState>('checking');
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderStatus, setFolderStatus] = useState<string | null>(null);

  const leagueId = snapshot?.league.id ?? null;

  // Хендл на папку не хранится в zustand/localStorage (не сериализуется в JSON) —
  // подгружаем привязку этой лиги из IndexedDB при каждом открытии периода.
  useEffect(() => {
    let cancelled = false;
    setFolderHandle(null);
    if (!leagueId) {
      setFolderState('checking');
      return;
    }
    if (!isFileSystemAccessSupported()) {
      setFolderState('unsupported');
      return;
    }
    setFolderState('checking');
    (async () => {
      const stored = await getStoredFolder(leagueId);
      if (cancelled) return;
      if (!stored) {
        setFolderState('disconnected');
        return;
      }
      const permission = await checkPermission(stored);
      if (cancelled) return;
      setFolderHandle(stored);
      setFolderState(permission);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (!snapshot) return <p className="hint">Лига не выбрана.</p>;

  const { league, opening } = snapshot;
  const index = currentPeriodIndex(league);
  const macro = league.macroByPeriod[index];
  const decisions = league.decisionsByPeriod[index];
  const lastResult = league.results[league.results.length - 1];

  if (!macro || !decisions) return <p className="hint">Готовлю период…</p>;

  const prevDecisions: Record<string, FirmDecision> | null =
    index > 0 ? league.decisionsByPeriod[index - 1] : null;
  const confirmed: Record<string, boolean> = league.confirmedByPeriod[index] ?? {};
  const confirmedCount = league.firms.filter((f) => confirmed[f.id]).length;

  const previews: Record<string, FundsPreview> = {};
  for (const firm of league.firms) {
    previews[firm.id] = estimateFunds(opening[firm.id], decisions[firm.id], macro, league.config);
  }
  const shortfallFirms = league.firms.filter((f) => previews[f.id].remaining < 0);

  const handleDownloadAllReports = async () => {
    setReportsZipBusy(true);
    setReportsZipStatus('Готовлю изображения…');
    try {
      await downloadAllFirmReports(league, includeIndustry, (done, total) => {
        setReportsZipStatus(`Готовлю изображения… ${done}/${total}`);
      });
      setReportsZipStatus('Архив со всеми отчётами скачан');
    } catch (error) {
      setReportsZipStatus(
        error instanceof Error ? error.message : 'Не удалось собрать архив отчётов',
      );
    } finally {
      setReportsZipBusy(false);
      setTimeout(() => setReportsZipStatus(null), 4000);
    }
  };

  /** Должен вызываться напрямую из клика — showDirectoryPicker требует жеста пользователя. */
  const handleConnectFolder = async () => {
    setFolderBusy(true);
    setFolderStatus('Открываю диалог выбора папки…');
    try {
      const handle = await connectReportsFolder(league.id, league.name);
      setFolderHandle(handle);
      setFolderState('granted');
      if (league.results.length > 0) {
        setFolderStatus('Сохраняю уже посчитанные периоды…');
        await saveAllReports(handle, league, includeIndustry, (done, total) => {
          setFolderStatus(`Сохраняю отчёты… ${done}/${total}`);
        });
      }
      setFolderStatus('Папка подключена — отчёты будут сохраняться туда автоматически');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setFolderStatus(null);
      } else {
        setFolderStatus(error instanceof Error ? error.message : 'Не удалось подключить папку');
      }
    } finally {
      setFolderBusy(false);
      setTimeout(() => setFolderStatus(null), 5000);
    }
  };

  const handleReconnectPermission = async () => {
    if (!folderHandle) return;
    setFolderBusy(true);
    try {
      const granted = await requestPermission(folderHandle);
      setFolderState(granted ? 'granted' : 'prompt-needed');
      setFolderStatus(granted ? 'Доступ к папке восстановлен' : 'Доступ не предоставлен');
    } catch (error) {
      setFolderStatus(error instanceof Error ? error.message : 'Не удалось получить доступ к папке');
    } finally {
      setFolderBusy(false);
      setTimeout(() => setFolderStatus(null), 4000);
    }
  };

  const handleDisconnectFolder = async () => {
    await disconnectReportsFolder(league.id);
    setFolderHandle(null);
    setFolderState('disconnected');
  };

  const handleComputePeriod = async () => {
    const periodsBefore = league.results.length;
    compute();
    if (folderState !== 'granted' || !folderHandle) return;

    const updatedLeague = useLeagueStore.getState().leagues[league.id]?.league;
    const newResult = updatedLeague?.results[updatedLeague.results.length - 1];
    if (!updatedLeague || !newResult || updatedLeague.results.length <= periodsBefore) return;

    try {
      setFolderStatus(`Сохраняю отчёты периода ${newResult.periodIndex} в папку…`);
      await saveReportsForPeriod(folderHandle, updatedLeague, newResult, includeIndustry);
      setFolderStatus(`Отчёты периода ${newResult.periodIndex} сохранены в папку`);
    } catch (error) {
      setFolderStatus(
        `Не удалось сохранить отчёты в папку: ${error instanceof Error ? error.message : 'ошибка'}`,
      );
    } finally {
      setTimeout(() => setFolderStatus(null), 4000);
    }
  };

  return (
    <div>
      {computeError && (
        <div className="error">
          Расчёт не выполнен: {computeError}
        </div>
      )}

      <div className="panel">
        <h2>
          Период {index} — решения фирм
          {league.firms.length > 0 && (
            <span className="hint" style={{ textTransform: 'none', letterSpacing: 0, marginLeft: 10 }}>
              обновлено {confirmedCount} из {league.firms.length}
            </span>
          )}
        </h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }} title="Ведущий пересмотрел решение фирмы на этот период">
                ✓
              </th>
              <th>Фирма</th>
              <th className="num">Цена, $</th>
              <th className="num">Производство</th>
              <th className="num">Маркетинг, $</th>
              <th className="num">Инвестиции, $</th>
              <th className="num">НИОКР, $</th>
              <th className="num">Мощность</th>
              <th className="num">Аморт-я, $</th>
              <th className="num">Остаток бюджета ввода</th>
            </tr>
          </thead>
          <tbody>
            {league.firms.map((firm) => {
              const d = decisions[firm.id];
              const state = opening[firm.id];
              const prev = prevDecisions?.[firm.id];
              const isConfirmed = confirmed[firm.id] ?? false;
              const preview = previews[firm.id];
              const depreciation = preview.depreciation;
              const level = fundsLevel(preview);
              return (
                <tr key={firm.id} className={state.isBankrupt ? 'bankrupt' : undefined}>
                  <td className="num">
                    <input
                      type="checkbox"
                      checked={isConfirmed}
                      onChange={(e) => setConfirmed(firm.id, e.target.checked)}
                      title={
                        isConfirmed
                          ? 'Решение пересмотрено на этот период'
                          : 'Отметьте, когда проверите и введёте решение фирмы на этот период'
                      }
                      style={{ width: 16, height: 16 }}
                    />
                  </td>
                  <td style={!isConfirmed ? { borderLeft: '2px solid var(--warn)' } : undefined}>
                    {firm.name}
                    {state.isBankrupt && <span className="badge warn" style={{ marginLeft: 8 }}>банкрот</span>}
                  </td>
                  {/* Порядок полей — как рекомендуют игроки-практики (раздел 3.0). */}
                  <td className="num" style={{ width: 110 }}>
                    <NumberField
                      value={d.price}
                      step={0.5}
                      onChange={(v) => updateDecision(firm.id, { price: v })}
                    />
                    <PrevValue value={prev?.price} format={(v) => money(v, 2)} />
                  </td>
                  <td className="num" style={{ width: 120 }}>
                    <NumberField
                      value={d.production}
                      onChange={(v) => updateDecision(firm.id, { production: v })}
                      title={`80% загрузки = ${Math.round(state.machines * 0.8)} шт`}
                    />
                    <PrevValue value={prev?.production} format={(v) => num(v)} />
                  </td>
                  <td className="num" style={{ width: 130 }}>
                    <NumberField
                      value={d.marketing}
                      onChange={(v) => updateDecision(firm.id, { marketing: v })}
                    />
                    <PrevValue value={prev?.marketing} format={(v) => money(v)} />
                  </td>
                  <td className="num" style={{ width: 130 }}>
                    <NumberField
                      value={d.capexGross}
                      onChange={(v) => updateDecision(firm.id, { capexGross: v })}
                      title={`Амортизация за период: ${money(depreciation)}`}
                    />
                    <PrevValue value={prev?.capexGross} format={(v) => money(v)} />
                  </td>
                  <td className="num" style={{ width: 120 }}>
                    <NumberField
                      value={d.rnd}
                      onChange={(v) => updateDecision(firm.id, { rnd: v })}
                    />
                    <PrevValue value={prev?.rnd} format={(v) => money(v)} />
                  </td>
                  <td className="num">{num(state.machines)}</td>
                  <td className="num">{money(depreciation)}</td>
                  <td className={`num funds-${level}`} title={fundsTitle(preview)} style={{ width: 140 }}>
                    {money(preview.remaining)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 10 }}>
          Поля по умолчанию заполнены решением фирмы за прошлый период — поправьте, что
          изменилось. Галочка слева отмечается сама при правке любого поля; жёлтая полоса
          у названия фирмы — решение ещё не пересмотрено в этом периоде. Подсказки при
          наведении: 80% загрузки — оптимум себестоимости, амортизация — минимум инвестиций,
          чтобы мощность не упала. «Остаток бюджета ввода» — как в нативном диалоге:
          производство, маркетинг, нетто-инвестиции и НИОКР; наведите для разбивки.
          Он не гарантирует итоговую ликвидность: выручка, увольнения, хранение, проценты
          и налоги учитываются отдельно при расчёте периода.
        </p>
        {shortfallFirms.length > 0 && (
          <div className="error" style={{ marginTop: 10 }}>
            Отрицательный бюджет ввода у:{' '}
            {shortfallFirms
              .map((f) => `${f.name} (не хватает ${money(-previews[f.id].remaining)})`)
              .join(', ')}
            . Уменьшите производство, инвестиции, маркетинг или НИОКР — иначе расчёт периода
            заблокирован.
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Макропараметры периода {index}</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
          {MACRO_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <NumberField
                value={macro[f.key] as number}
                step={f.step}
                min={f.min}
                max={f.max}
                onChange={(v) => updateMacro({ [f.key]: v } as Partial<PeriodMacroParams>)}
              />
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Новостной текст периода (виден всем фирмам)</label>
          <textarea
            rows={3}
            value={macro.scenarioNewsText}
            placeholder="Что происходит в экономике в этом периоде…"
            onChange={(e) => updateMacro({ scenarioNewsText: e.target.value })}
          />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 20 }}>
        <button
          className="primary"
          onClick={handleComputePeriod}
          disabled={shortfallFirms.length > 0}
          title={
            shortfallFirms.length > 0
              ? 'Сначала устраните отрицательный бюджет ввода, отмеченный красным'
              : 'Бюджет ввода не гарантирует итоговую ликвидность; прочие расходы учитываются в расчёте периода'
          }
        >
          Рассчитать период {index}
        </button>
        <button onClick={() => downloadLeagueFile(snapshot)}>Экспорт лиги в файл</button>
        <button
          onClick={handleDownloadAllReports}
          disabled={reportsZipBusy || league.results.length === 0}
          title={
            league.results.length === 0
              ? 'Сначала рассчитайте хотя бы один период'
              : 'Архив: папка периода → PNG-отчёт каждой фирмы, за все посчитанные периоды'
          }
        >
          {reportsZipBusy ? 'Готовлю архив…' : 'Скачать все отчёты фирм'}
        </button>
        {reportsZipStatus && <span className="hint">{reportsZipStatus}</span>}

        {folderState === 'disconnected' && (
          <button
            onClick={handleConnectFolder}
            disabled={folderBusy}
            title="Один раз выберите папку на диске — дальше отчёты каждого периода будут сохраняться туда сами, без скачивания архива. Работает в Chrome и Edge."
          >
            {folderBusy ? 'Подключаю…' : 'Подключить папку для отчётов'}
          </button>
        )}
        {(folderState === 'prompt-needed' || folderState === 'denied') && (
          <button
            onClick={handleReconnectPermission}
            disabled={folderBusy}
            title="Браузер сбрасывает доступ к папке после перезагрузки страницы — подтвердите его ещё раз."
          >
            {folderBusy ? 'Переподключаю…' : 'Переподключить папку отчётов'}
          </button>
        )}
        {folderState === 'granted' && (
          <span className="hint" title="Отчёты каждого посчитанного периода сохраняются сюда автоматически">
            папка отчётов подключена
            <button
              style={{ marginLeft: 8, padding: '2px 8px' }}
              onClick={handleDisconnectFolder}
              title="Отвязать эту лигу от папки на диске — сами файлы не удаляются"
            >
              отключить
            </button>
          </span>
        )}
        {folderStatus && <span className="hint">{folderStatus}</span>}

        {league.results.length > 0 && (
          <button
            className="danger"
            onClick={() => {
              if (
                confirm(
                  `Откатить период ${league.results.length - 1}? Его результаты будут удалены, ` +
                    'решения останутся — можно поправить и посчитать заново.',
                )
              ) {
                recompute();
              }
            }}
          >
            Откатить период {league.results.length - 1}
          </button>
        )}
      </div>

      {lastResult && (
        <div className="panel">
          <h2>Отчёты за период {lastResult.periodIndex}</h2>

          <div className="tabs">
            <button
              className={tab === 'industry' ? 'active' : ''}
              onClick={() => setTab('industry')}
            >
              Отраслевой отчёт
            </button>
            <button
              className={tab === 'master' ? 'active' : ''}
              onClick={() => setTab('master')}
              title="Полная сводка по всем фирмам: решения, склад, мощность, P&L и РИФ — только для ведущего"
            >
              Сводный отчёт
            </button>
            {lastResult.firms.map((f) => (
              <button
                key={f.firmId}
                className={tab === f.firmId ? 'active' : ''}
                onClick={() => setTab(f.firmId)}
              >
                {f.firmName}
                {f.isBankrupt ? ' ⚠' : ''}
              </button>
            ))}
          </div>

          {tab === 'industry' ? (
            <ReportView
              text={renderIndustryReport(lastResult, league.name)}
              fileName={`mecom-${league.name}-p${lastResult.periodIndex}-отрасль`}
            />
          ) : tab === 'master' ? (
            <ReportView
              text={renderMasterReport(lastResult, league.name)}
              fileName={`mecom-${league.name}-p${lastResult.periodIndex}-сводный`}
            />
          ) : (
            (() => {
              const firm = lastResult.firms.find((f) => f.firmId === tab);
              if (!firm) return <p className="hint">Выберите вкладку.</p>;
              return (
                <ReportView
                  text={renderFirmExport(
                    firm,
                    lastResult,
                    league.config,
                    league.name,
                    includeIndustry,
                  )}
                  fileName={`mecom-${league.name}-p${lastResult.periodIndex}-${firm.firmName}`}
                  extra={
                    <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', width: 'auto' }}>
                      <input
                        type="checkbox"
                        checked={includeIndustry}
                        style={{ width: 'auto' }}
                        onChange={(e) => setIncludeIndustry(e.target.checked)}
                      />
                      с отраслевым блоком
                    </label>
                  }
                />
              );
            })()
          )}

          <table style={{ marginTop: 20 }}>
            <thead>
              <tr>
                <th>Фирма</th>
                <th className="num">Заказы</th>
                <th className="num">Продано</th>
                <th className="num">Выручка</th>
                <th className="num">Чист. прибыль</th>
                <th className="num">Наличные</th>
                <th className="num">Займы</th>
                <th className="num">Загрузка</th>
                <th className="num">РИФ</th>
              </tr>
            </thead>
            <tbody>
              {lastResult.firms.map((f) => (
                <tr key={f.firmId} className={f.isBankrupt ? 'bankrupt' : undefined}>
                  <td>{f.firmName}</td>
                  <td className="num">{num(f.ordersReceived)}</td>
                  <td className="num">{num(f.sold)}</td>
                  <td className="num">{money(f.revenue)}</td>
                  <td className="num">{money(f.netProfit)}</td>
                  <td className="num">{money(f.cash)}</td>
                  <td className="num">{money(f.loan)}</td>
                  <td className="num">{percent(f.capacityUtilization)}</td>
                  <td className="num">{num(f.rif.total, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
