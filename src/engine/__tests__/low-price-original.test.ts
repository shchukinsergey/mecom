import { describe, expect, it } from 'vitest';
import corpus from '../../../data/calibration/test2-original.json';
import heldOut from '../../../data/calibration/hermes1-original.json';
import { DEFAULT_LEAGUE_CONFIG } from '../config';
import { computeDemand } from '../demand';
import evidence from './fixtures/native-demand.json';

function allocation(fields: {price: number[]; production: number[]; inventoryOpening: number[]; marketing: number[]; rnd: number[]; rndCumulative: number[]}, periodIndex: number) {
  const inputs=fields.price.map((price,i)=>({firmId:`f${i}`,price, production:fields.production[i], openingInventory:fields.inventoryOpening[i], marketing:fields.marketing[i],rnd:fields.rnd[i],rndCumulativeBefore:fields.rndCumulative[i]-fields.rnd[i],rndDecayStockBefore:0}));
  const demand=computeDemand(inputs,DEFAULT_LEAGUE_CONFIG, { periodIndex });
  return inputs.map(f=>demand.ordersByFirm[f.firmId]);
}
describe('Independent original low-price calibration', () => {
  it.each(corpus.records.filter(r=>r.path==='TEST2_10_50.Z01'||r.path==='TEST2_15_45.Z01'))('reproduces isolated native allocation: $path', r=> {
    // Report totals already include cutoff/rounding: they are not latent volume.
    const predicted=allocation(r.fields,r.periodIndex);
    expect(predicted).toEqual(r.fields.ordersReceived);
  });
  it('improves held-out price 7 without fitting its native orders',()=> {
    const f=heldOut.periods[4].fields;
    const saved=evidence.saves.find(s => s.name === 'HERMES1.S04')!;
    const predicted=allocation({price:f['decision.price'], production:saved.firms.map(x=>x.production), inventoryOpening:saved.firms.map(x=>x.openingInventory), marketing:f.marketingExpense,rnd:f.rndExpense,rndCumulative:f.rndCumulative},4);
    const l1=predicted.reduce((s,x,i)=>s+Math.abs(x-f.ordersReceived[i]),0);
    expect(l1).toBe(0);
    expect(predicted).toEqual(f.ordersReceived);
  });
});
