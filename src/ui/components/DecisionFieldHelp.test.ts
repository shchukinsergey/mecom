import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DecisionFieldHelp } from './DecisionFieldHelp';

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

  it('does not claim that marketing or R&D guarantees demand or sales', () => {
    const html = ['marketing', 'rnd'].map(field => renderToStaticMarkup(
      createElement(DecisionFieldHelp, { field: field as 'marketing' | 'rnd', id: 'field-help' }),
    )).join(' ');
    expect(html).not.toMatch(/гарантирует\s+(?:спрос|продажи)/i);
  });
});
