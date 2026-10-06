/**
 * Масштабирование стартовых условий и дефолтов периода 0 по числу фирм N
 * (раздел 4.1 источника: отраслевые итоги вводного сценария не зависят от N,
 * доля на фирму — итог/N).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FIRM_START, makeFirmDecision, makeFirmStart } from '../config';

describe('makeFirmStart', () => {
  it('для N=8 задаёт старт до периода 0 (525 станков, $21 000, $9 030, initialRnd 0)', () => {
    expect(makeFirmStart(8)).toEqual(DEFAULT_FIRM_START);
    expect(makeFirmStart(8)).toEqual(
      expect.objectContaining({
        initialMachines: 525,
        initialCash: 9030,
        initialLoan: 9030,
        initialCapital: 21000,
        initialRnd: 0,
      }),
    );
  });

  it('для N=2 и N=5 воспроизводит остальные замеры таблицы источника', () => {
    expect(makeFirmStart(2)).toEqual(
      expect.objectContaining({ initialMachines: 2100, initialCash: 36120, initialLoan: 36120, initialRnd: 0 }),
    );
    expect(makeFirmStart(5)).toEqual(
      expect.objectContaining({ initialMachines: 840, initialCash: 14448, initialLoan: 14448, initialRnd: 0 }),
    );
  });

  it('стартовый баланс сходится по построению при любом N от 2 до 12', () => {
    for (let n = 2; n <= 12; n++) {
      const firm = makeFirmStart(n);
      const assets = firm.initialCash + firm.initialInventory * firm.initialInventoryUnitCost + firm.initialMachines * 40;
      const liabilities = firm.initialLoan + firm.initialCapital;
      expect(assets).toBe(liabilities);
    }
  });

  it('наличные всегда равны займу, капитал — стоимости станков', () => {
    const firm = makeFirmStart(6);
    expect(firm.initialCash).toBe(firm.initialLoan);
    expect(firm.initialCapital).toBe(firm.initialMachines * 40);
  });
});

describe('makeFirmDecision', () => {
  it('цена не зависит от N — это параметр сценария, а не отраслевой итог', () => {
    expect(makeFirmDecision('f1', 2).price).toBe(30);
    expect(makeFirmDecision('f1', 8).price).toBe(30);
  });

  it('маркетинг, инвестиции и НИОКР масштабируются как итог/N', () => {
    const d8 = makeFirmDecision('f1', 8);
    expect(d8.marketing).toBe(1050);
    expect(d8.capexGross).toBe(1050);
    expect(d8.rnd).toBe(420);

    const d2 = makeFirmDecision('f1', 2);
    expect(d2.marketing).toBe(4200);
    expect(d2.capexGross).toBe(4200);
    expect(d2.rnd).toBe(1680);
  });

  it('производство по умолчанию — 80% загрузки мощности периода 0', () => {
    expect(makeFirmDecision('f1', 8).production).toBe(420); // 80% от 525 станков
    expect(makeFirmDecision('f1', 2).production).toBe(1680); // 80% от 2100 станков
  });
});
