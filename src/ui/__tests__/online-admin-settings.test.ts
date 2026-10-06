import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('localStorage', undefined);
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:8788', pathname: '/' });
});
import { OnlineAdmin } from '../screens/OnlineAdmin';

describe('online game creation settings', () => {
  it('exposes expandable custom financial settings with original MECOM defaults', () => {
    const html = renderToStaticMarkup(createElement(OnlineAdmin, {
      initialAdminToken: 'test-admin-token', initialPublicOrigin: 'http://127.0.0.1:8788',
      initialGameId: '', onBack: () => {},
    }));

    expect(html).toContain('<details class="online-settings">');
    expect(html).toContain('Дополнительные финансовые настройки');
    expect(html).toContain('value="preRevenue" selected=""');
    expect(html).toContain('value="official" selected=""');
    expect(html).toContain('Базовая ставка банка, % годовых');
    expect(html).toContain('value="10"');
    expect(html).toContain('value="40"');
    expect(html).toContain('Лимит основной кредитной линии, $');
    expect(html).toContain('value="50000"');
  });
});
