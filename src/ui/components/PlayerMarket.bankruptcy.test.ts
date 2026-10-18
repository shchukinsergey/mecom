import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { GameStatus, PlayerMe } from '../../online/api';
import type { PublicHistoryPeriod } from '../../online/roomTypes';
import { PlayerMarket, playerPublicRank } from './PlayerMarket';

it('keeps excluded firms visible but unranked, after active firms with negative RIF', () => {
  const metric = { netProfit: 0, revenue: 0, marketShareSold: 0, retainedEarnings: 0 };
  const period: PublicHistoryPeriod = { periodIndex: 2, firms: [
    { ...metric, firmId: 'out', firmName: 'Out', rif: 0, excluded: true },
    { ...metric, firmId: 'active', firmName: 'Active', rif: -10 },
  ] };
  expect(playerPublicRank(period, 'out')).toBeNull();
  expect(playerPublicRank(period, 'active')).toBe(1);
  const me: PlayerMe = { gameId: 'g', firmId: 'out', firmName: 'Out',
    phase: 'collecting', currentPeriodIndex: 3, submitted: false };
  const status: GameStatus = { gameId: 'g', phase: 'collecting', currentPeriodIndex: 3,
    firms: [{ firmId: 'out', firmName: 'Out', submitted: false, nativeBankrupt: true },
      { firmId: 'active', firmName: 'Active', submitted: true }], history: [period] };
  const html = renderToStaticMarkup(createElement(PlayerMarket, { me, status }));
  expect(html).toContain('Исключена');
  expect(html.indexOf('>Active<')).toBeLessThan(html.indexOf('>Out<'));
});
