import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OnlineFirm } from '../../online/api';
import { OnlineFirmRoster } from './OnlineFirmRoster';

const firms: OnlineFirm[] = [
  { firmId: 'mine', firmName: 'Север', submitted: true, currentRif: 72.4 },
  { firmId: 'other', firmName: 'Юг', submitted: false, currentRif: null },
];

describe('OnlineFirmRoster', () => {
  it('shows firms, latest public RIF and decision status in a labeled table', () => {
    const html = renderToStaticMarkup(createElement(OnlineFirmRoster, { firms, ownFirmId: 'mine' }));

    expect(html).toContain('<table');
    expect(html).toContain('Фирмы в игре');
    expect(html).toContain('РИФ за последний рассчитанный период');
    expect(html).toContain('72,4');
    expect(html).toContain('Пока не рассчитан');
    expect(html).toContain('Ваша фирма');
    expect(html).toContain('Отправлено');
    expect(html).toContain('Ожидает решения');
  });

  it('renders a zero RIF as a score instead of treating it as missing', () => {
    const html = renderToStaticMarkup(createElement(OnlineFirmRoster, {
      firms: [{ ...firms[0], currentRif: 0 }], ownFirmId: 'mine',
    }));
    expect(html).toContain('0,0');
    expect(html).not.toContain('Пока не рассчитан');
  });

  it('shows a safe fallback when the API has not sent a RIF value', () => {
    const html = renderToStaticMarkup(createElement(OnlineFirmRoster, {
      firms: [{ ...firms[0], currentRif: undefined as unknown as number }], ownFirmId: 'mine',
    }));
    expect(html).toContain('Нет данных');
    expect(html).not.toContain('не число');
  });
});
