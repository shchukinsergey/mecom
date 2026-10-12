import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionFieldHelp, type DecisionHelpField } from './DecisionFieldHelp';

function helpText(field: DecisionHelpField): string {
  return renderToStaticMarkup(createElement(DecisionFieldHelp, { field, id: 'field-help' }))
    .replace(/<[^>]+>/g, '');
}

describe('DecisionFieldHelp', () => {
  it('shows one concise inline tip for each original field, without a Подробнее disclosure', () => {
    const fields = [
      ['price', 'Никто не хочет продавать в убыток'],
      ['production', 'текущего периода'],
      ['marketing', 'реклама'],
      ['capexGross', 'В первую очередь инвестиции покрывают амортизацию'],
      ['rnd', 'научные разработки'],
    ] as const;
    for (const [field, phrase] of fields) {
      const html = renderToStaticMarkup(createElement(DecisionFieldHelp, { field, id: 'field-help' }));
      expect(html).toContain(phrase);
      expect(html).toContain('decision-field-note');
      expect(html).not.toContain('<details');
      expect(html).not.toContain('Подробнее');
    }
  });

  it.each([
    ['price', [/ценами конкурентов/, /спрос/, /маржу/, /количеством заказов/]],
    ['production', [/мощности текущего периода/, /запасы/, /заказы/, /80%/, /не гарантия максимальной прибыли/]],
    ['marketing', [/реклама/, /расходы вычитаются из прибыли/, /только в текущем периоде/, /конкурентов/, /бюджет с ценой/]],
    ['capexGross', [/покрывают амортизацию/, /со следующего периода/, /недостаточно/, /мощность может снизиться/]],
    ['rnd', [/научные разработки/, /Эффект на качество накапливается/, /будущих периодах/, /привлекательнее/, /не гарантированные продажи/]],
  ] as const)('explains %s trade-offs without changing MECOM timing', (field, concepts) => {
    const text = helpText(field);
    for (const concept of concepts) expect(text).toMatch(concept);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(text.match(/[.!?](?:\s|$)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text.match(/[.!?](?:\s|$)/g)?.length).toBeLessThanOrEqual(3);
    expect(text).not.toMatch(/\$|5%|20%|25%|EchoPen|MESE/);
  });

  it('does not claim that marketing or R&D guarantees demand or sales', () => {
    const html = ['marketing', 'rnd'].map(field => renderToStaticMarkup(
      createElement(DecisionFieldHelp, { field: field as 'marketing' | 'rnd', id: 'field-help' }),
    )).join(' ');
    expect(html).not.toMatch(/гарантирует\s+(?:спрос|продажи)/i);
  });
});
