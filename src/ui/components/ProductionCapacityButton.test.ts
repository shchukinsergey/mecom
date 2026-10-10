import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductionCapacityButton } from './ProductionCapacityButton';
import { createElement } from 'react';
import { OnlinePlayer } from '../screens/OnlinePlayer';

test('player renders the shortcut beside production, disabled before opening state loads', () => {
  const html = renderToStaticMarkup(createElement(OnlinePlayer, { accountRoomId: 'synthetic-room', onBack: () => {} }));
  expect(html).toContain('80% мощности');
  expect(html).toMatch(/id="player-production"[\s\S]*?<button type="button" disabled="">80% мощности<\/button>/);
});

test.each([[525, 420], [526, 421], [0, 0], [0.8, 0], [1, 1]])('capacity %s selects integer production %s on click only', (capacity, expected) => {
  const select = vi.fn();
  const button = ProductionCapacityButton({ capacity, disabled: false, onSelect: select });
  expect(renderToStaticMarkup(button)).toContain('80% мощности');
  expect(select).not.toHaveBeenCalled();
  button.props.onClick();
  expect(select).toHaveBeenCalledExactlyOnceWith(expected);
});

test.each([undefined, null])('missing capacity %s disables selection', capacity => {
  const select = vi.fn();
  const button = ProductionCapacityButton({ capacity, disabled: false, onSelect: select });
  expect(button.props.disabled).toBe(true);
  button.props.onClick();
  expect(select).not.toHaveBeenCalled();
});

test('loading, submitted and noncollecting states disable selection', () => {
  const select = vi.fn();
  const button = ProductionCapacityButton({ capacity: 525, disabled: true, onSelect: select });
  expect(button.props.disabled).toBe(true);
  expect(button.props.type).toBe('button');
  button.props.onClick();
  expect(select).not.toHaveBeenCalled();
});
