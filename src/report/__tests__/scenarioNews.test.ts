import { readFileSync } from 'node:fs';
import { SCENARIOS } from '../../engine/scenarios';
import { expect, test } from 'vitest';
import { scenarioParagraphs } from '../scenarioNews';

test('removes DOS headings, joins wrapped words and preserves paragraphs', () => {
  expect(scenarioParagraphs('~~~ Сценарий 2 период ~~~\nНовые тракто-\nры на рынке.\nУсловия меняются.\n\nВторая новость.')).toEqual(['Новые тракторы на рынке. Условия меняются.', 'Вторая новость.']);
  expect(scenarioParagraphs('  ')).toEqual([]);
});
test('long blocks are split without dropping sentences or decimal values', () => {
  const text = 'Ставка 12.5 процента. ' + 'На рынке произошли существенные изменения спроса и предложения. '.repeat(12);
  const result = scenarioParagraphs(text);
  expect(result.length).toBeGreaterThan(1);
  expect(result.join(' ')).toBe(text.trim());
});

test('all 25 manually edited news texts have semantic paragraphs and retain every numeric value', () => {
  let count = 0;
  const numbers = (text: string) => text.replace(/^.*~{3,}.*(?:\n|$)/gm, '')
    .replace(/(\d)[ ,](?=\d{3}(?:\D|$))/g, '$1').match(/\d+/g) ?? [];
  for (const scenario of SCENARIOS) for (const period of scenario.data.periods) {
    const blocks = scenarioParagraphs(period.news);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.join(' ')).not.toContain('~~~');
    expect(numbers(blocks.join(' ')).sort()).toEqual(numbers(period.news).sort());
    count++;
  }
  expect(count).toBe(25);
});
test('legacy versions use the same authored presentation and user edits are preserved', () => {
  for (const name of ['tractors', 'ipad', 'emobile']) {
    const current = JSON.parse(readFileSync(`src/engine/scenarios/${name}-v3.json`, 'utf8'));
    for (const suffix of ['', '-v2']) {
      const legacy = JSON.parse(readFileSync(`src/engine/scenarios/${name}${suffix}.json`, 'utf8'));
      legacy.periods.forEach((period: { news: string }, index: number) => {
        if (!period.news.includes('БЫЛ ПОСЛЕДНИМ')) expect(scenarioParagraphs(period.news)).toEqual(scenarioParagraphs(current.periods[index].news));
      });
    }
  }
  const source = SCENARIOS[1].data.periods[0].news;
  expect(scenarioParagraphs(source + '\nОсобые условия ведущего.').join(' ')).toContain('Особые условия ведущего.');
  expect(scenarioParagraphs('Сюжет.\n\nУсловия периода\n• Цена: 10–200 $.')).toEqual(['Сюжет.', 'Условия периода\n• Цена: 10–200 $.']);
});
