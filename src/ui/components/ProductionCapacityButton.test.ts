import { expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductionCapacityButton } from './ProductionCapacityButton';
import { createElement } from 'react';
import { OnlinePlayer } from '../screens/OnlinePlayer';
import { PlayerDecisions } from './PlayerDecisions';
import type { ProductionCapacityButtonProps } from './ProductionCapacityButton';
import type { FirmOpeningState } from '../../engine/types';

// Capture the real button handler while SSR supplies the real caller callback.
const renderedClick = vi.hoisted(() => ({ current: null as (() => void) | null }));
vi.mock('./ProductionCapacityButton', async importOriginal => {
  const actual = await importOriginal<typeof import('./ProductionCapacityButton')>();
  return { ...actual, ProductionCapacityButton: (props: ProductionCapacityButtonProps) => {
    const button = actual.ProductionCapacityButton(props);
    renderedClick.current = button.props.onClick;
    return button;
  } };
});

test('player waits for opening state before exposing decision controls', () => {
  const html = renderToStaticMarkup(createElement(OnlinePlayer, { accountRoomId: 'synthetic-room', onBack: () => {} }));
  expect(html).toContain('Загружаем вашу компанию');
  expect(html).not.toContain('id="player-production"');
  expect(html).not.toContain('80% мощности');
});

test.each([[525, 420], [526, 421], [3052.125, 2442], [0, 0], [0.8, 0], [1, 1]])('capacity %s selects integer production %s on click only', (capacity, expected) => {
  const select = vi.fn();
  const button = ProductionCapacityButton({ capacity, disabled: false, onSelect: select });
  expect(renderToStaticMarkup(button)).toContain('80% мощности');
  expect(select).not.toHaveBeenCalled();
  button.props.onClick();
  expect(select).toHaveBeenCalledExactlyOnceWith(expected);
});

test('actual 80% click rounds raw 2441.7 to 2442 through PlayerDecisions without caller flooring', () => {
  const onChange = vi.fn();
  const capacity = 3052.125;
  expect(capacity * 0.8).toBeCloseTo(2441.7, 10);
  renderedClick.current = null;
  renderToStaticMarkup(createElement(PlayerDecisions, {
    me: { gameId: 'synthetic-game', firmId: 'synthetic-firm', firmName: 'Фирма', phase: 'collecting', currentPeriodIndex: 1, submitted: false, openingState: { machines: capacity } as FirmOpeningState },
    form: { price: '30', production: '0', marketing: '0', rnd: '0', capexGross: '0' },
    loading: false, fieldErrors: {}, budget: null, capexCapacity: undefined, invalidDecision: false,
    onChange, onSave: () => {}, onSubmit: () => {},
  }));
  expect(onChange).not.toHaveBeenCalled();
  expect(renderedClick.current).not.toBeNull();
  renderedClick.current!();
  expect(onChange).toHaveBeenCalledExactlyOnceWith('production', '2442');
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
