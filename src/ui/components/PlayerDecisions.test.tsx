import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerMe } from '../../online/api';
import type { FirmOpeningState, PeriodMacroParams } from '../../engine/types';
import type { DecisionBudget } from '../../engine/decisionBudget';
import { PlayerDecisionHelp } from './PlayerDecisionHelp';
import { decisionFields, type DecisionForm } from '../../online/playerDecisionForm';
import { PlayerDecisions, type PlayerDecisionsProps } from './PlayerDecisions';

const me: PlayerMe = { gameId: 'private-game', firmId: 'private-firm', firmName: 'Фирма', phase: 'collecting', currentPeriodIndex: 1, submitted: false };
const form: DecisionForm = { price: '30', production: '400', marketing: '100', capexGross: '1000', rnd: '100' };
const props: PlayerDecisionsProps = { me, form, loading: false, fieldErrors: {}, budget: null, capexCapacity: undefined, invalidDecision: false, onChange: () => {}, onSave: () => {}, onSubmit: () => {} };
const render = (overrides: Partial<PlayerDecisionsProps> = {}) => renderToStaticMarkup(createElement(PlayerDecisions, { ...props, ...overrides }));
const action = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];

const nativeBudget: DecisionBudget = { type: 'entry-budget-check', openingCash: 200, availableCredit: 1000, resourcesAvailable: 1200, costOfProduction: 1400, marketing: 0, rnd: 0, depreciation: 100, netInvestment: -100, totalSpending: 1300, remainingBudget: -100, overspend: true };
const liveMe: PlayerMe = { ...me, openingState: { machines: 500, loan: 100, cash: 200.99 } as FirmOpeningState, periodMacro: { loanLimitBase: 600 } as PeriodMacroParams };

describe('PlayerDecisions', () => {
  it('names decision spending and shows available resources separately from new credit needs', () => {
    const html = render({ me: liveMe, budget: { ...nativeBudget, totalSpending: 1200, remainingBudget: 0, overspend: false } });
    expect(html).toContain('Расходы по решению');
    expect(html).toContain('Всего доступно с кредитами');
    const resources = html.match(/<dl class="pc-budget-resources[^\"]*">([\s\S]*?)<\/dl>/)?.[1];
    expect(resources).toContain('Свои деньги на начало периода');
    expect(resources).toContain('200 $');
    expect(resources).toContain('Доступный обычный кредит');
    expect(resources).toContain('Доступный экспресс-кредит');
    expect(resources?.match(/500 \$/g)).toHaveLength(2);
    expect(html).toContain('потенциальные новые заимствования');
    expect(html).toContain('Потребность в новом экспресс-кредите');
    expect(html).toContain('Текущий долг');
    expect(html).not.toContain('Всего расходов');
    expect(html).not.toContain('Текущие ресурсы');
  });

  it('keeps fractional resources and borrowing needs visible to two decimal places', () => {
    const html = render({ me: { ...liveMe, openingState: { ...liveMe.openingState!, loan: 100.25 } }, budget: nativeBudget });
    expect(html).toContain('499,75 $');
    expect(html).toContain('500,25 $');
    expect(html).toContain('100,25 $');
  });

  it('reconciles displayed cents instead of independently rounding both credit segments up', () => {
    const html = render({ me: { ...liveMe, openingState: { ...liveMe.openingState!, loan: 100.255 } }, budget: nativeBudget });
    const resources = html.match(/<dl class="pc-budget-resources[^\"]*">([\s\S]*?)<\/dl>/)?.[1];
    expect(resources).toContain('499,75 $');
    expect(resources).toContain('500,25 $');
    expect(resources).not.toContain('500,26 $');
    const needs = html.match(/<div class="pc-legend pc-funding-legend">([\s\S]*?)<h4>/)?.[1];
    expect(needs).toContain('499,75 $');
    expect(needs).toContain('500,25 $');
  });

  it('explains fractional credit residuals without suppressing native express usage', () => {
    const html = render({ me: { ...liveMe, openingState: { ...liveMe.openingState!, loan: 20.25 }, periodMacro: { loanLimitBase: 80, loanLimitAbs: 80 } as PeriodMacroParams }, budget: { ...nativeBudget, openingCash: 100, availableCredit: 60, resourcesAvailable: 160, totalSpending: 160, remainingBudget: 0, overspend: false } });
    expect(html).toContain('data-funding-status="extra"');
    expect(html).toContain('0,25 $');
    expect(html).toContain('Доступный кредит округляется');
    expect(html).toContain('не прогноз итогового долга');
  });

  it('identifies negative opening cash as a budget liability rather than extra decision spending', () => {
    const html = render({ me: liveMe, budget: { ...nativeBudget, openingCash: -100, resourcesAvailable: 900, totalSpending: 300, remainingBudget: 600, overspend: false } });
    expect(html).toContain('Дефицит денег на начало периода');
    expect(html).toContain('не дополнительные расходы по решению');
  });
  it('does not apply a nonnegative-spending reconciliation formula to a signed investment release', () => {
    const html = render({ me: liveMe, budget: { ...nativeBudget, openingCash: -100, resourcesAvailable: 900, costOfProduction: 0, netInvestment: -200, totalSpending: -200, remainingBudget: 1100, overspend: false } });
    expect(html).toContain('Дефицит денег на начало периода');
    expect(html).toContain('не дополнительные расходы по решению');
    expect(html).not.toContain('Расходы по решению = свои использованные средства');
  });

  it.each([
    { loading: true }, { invalidDecision: true }, { me: { ...me, submitted: true } },
    ...(['lobby', 'complete', 'closed'] as const).map(phase => ({ me: { ...me, phase } })),
  ])('disables save and submit for existing lock condition %j', overrides => {
    const html = render(overrides);
    expect(action(html, 'Сохранить черновик')).toContain('disabled');
    expect(action(html, 'Отправить решение')).toContain('disabled');
  });

  it('keeps inputs editable for a validation error but locks submitted inputs', () => {
    const invalid = render({ invalidDecision: true, fieldErrors: { price: 'Заполните поле.' } });
    expect(invalid.match(/<input[^>]*id="player-price"[^>]*>/)?.[0]).not.toContain('disabled');
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('aria-describedby="player-price-help player-price-error"');
    expect(render({ me: { ...me, submitted: true } }).match(/<input[^>]*id="player-price"[^>]*>/)?.[0]).toContain('disabled');
  });

  it('keeps help definitions hidden, connected and controlled by question buttons', () => {
    const html = render();
    for (const [key, label] of decisionFields) {
      expect(html).toContain(`aria-label="Подсказка: ${label}" aria-expanded="false" aria-controls="player-${key}-help-popover"`);
      expect(html).toContain(`id="player-${key}-help"`);
      expect(html).toContain(`aria-describedby="player-${key}-help"`);
    }
    expect(html).toContain('Маркетинг — это реклама');
    expect(html).toContain('Эффект на качество накапливается');
    expect(html).toContain('min-width:44px;min-height:44px');
    expect(html.match(/role="dialog"[^>]*hidden=""/g)).toHaveLength(5);
    const open = renderToStaticMarkup(createElement(PlayerDecisionHelp, { field: 'price', label: 'Цена', id: 'help', open: true, onToggle: () => {}, onClose: () => {} }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('Закрыть подсказку');
    expect(open).not.toMatch(/popover=|commandfor=|invoketarget=/i);
  });

  it('shows unclamped overloaded capacity but clamps progress width and ARIA', () => {
    const html = render({ me: liveMe, form: { ...form, production: '600' } });
    expect(html).toContain('120 %');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('width:100%');
    expect(html).toContain('Выше лимита');
    expect(html).toContain('Превышение на 100 шт.');
    expect(html).not.toContain('<h3>Производственная мощность');
  });

  it('renders native overspend even when overspend disables submission', () => {
    const html = render({ me: liveMe, budget: nativeBudget, invalidDecision: true, fieldErrors: { production: 'Недостаточно средств.' }, capexCapacity: 510 });
    expect(html).toContain('data-funding-status="shortage"');
    expect(html).toContain('Не хватает средств');
    expect(html).toContain('-100 $');
    expect(html).toContain('это не поступление денег');
    expect(html).toContain('510 шт.');
    expect(html).toContain('Будущая выручка не включена');
    expect(html).not.toContain('200,99');
    expect(html).not.toMatch(/pc-expense-investment[^>]*style="width:[1-9]/);
  });

  it.each(['', '   ', 'abc', '-1'])('does not compute a budget for invalid or missing price %j', price => {
    const html = render({ me: liveMe, budget: nativeBudget, form: { ...form, price } });
    expect(html).toContain('Не удалось рассчитать');
    expect(html).not.toContain('data-funding-status=');
  });

  it('starts the mobile budget collapsed with a stable controls target', () => {
    const html = render();
    expect(html).toMatch(/<details[^>]*class="pc-budget/);
    expect(html).not.toMatch(/<details[^>]*\sopen=/);
    expect(html).toMatch(/<summary[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    expect(html).toMatch(/class="pc-budget-body" hidden=""/);
    expect(html).toContain('--pc-budget-height:88px');
  });

  it('renders five native fields in order with units and enabled real actions', () => {
    const html = render();
    const ids = [...html.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(match => match[1]);
    expect(ids).toEqual(decisionFields.map(([key]) => `player-${key}`));
    for (const [, label] of decisionFields) expect(html).toContain(label);
    expect(html).toContain('$ за штуку');
    expect(html).toContain('шт.');
    expect(action(html, 'Сохранить черновик')).not.toContain('disabled');
    expect(action(html, 'Отправить решение')).not.toContain('disabled');
    expect(html).toContain('80% мощности');
    expect(html).not.toMatch(/private-game|private-firm|UUID|API|прототип|readonly|концепт|debug/i);
  });
});
