import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { OnlinePlayer } from '../screens/OnlinePlayer';

test('account cabinet waits for its own data without exposing room identifiers or empty charts', () => {
  const html = renderToStaticMarkup(createElement(OnlinePlayer, { accountRoomId: 'preview-room', onBack: () => {} }));
  expect(html).toContain('player-cabinet');
  expect(html).toContain('Загружаем вашу компанию');
  expect(html).not.toContain('preview-room');
  expect(html).not.toContain('competition-history');
  expect(html).not.toContain('Локальный макет');
});
