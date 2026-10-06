import { describe, expect, it } from 'vitest';
import corpus from '../../../data/calibration/test2-original.json';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart, makeFirmDecision, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState } from '../computePeriod';
import type { League } from '../types';

function leagueFor(n: number): League {
  return {id:'intro',name:'intro',createdAt:'',config:DEFAULT_LEAGUE_CONFIG,firms:Array.from({length:n},(_,i)=>({...makeFirmStart(n),id:`f${i}`,name:`Фирма ${i+1}`})),macroByPeriod:[],decisionsByPeriod:[],confirmedByPeriod:[],results:[]};
}
describe('Native introductory R&D semantics', () => {
  it.each(corpus.records.filter(r=>r.periodIndex===0))('counts the introductory decision once for $firmCount firms', report => {
    const league = leagueFor(report.firmCount);
    const result = computePeriod({periodIndex:0,config:league.config,macro:makeMacroParams(0),firms:league.firms,opening:initialOpeningState(league),decisions:Object.fromEntries(league.firms.map(f=>[f.id,makeFirmDecision(f.id,report.firmCount)]))});
    expect(result.firms.map(f=>f.rndCumulative)).toEqual(report.fields.rndCumulative);
  });
  it('preserves explicitly configured pre-game R&D', () => {
    const league=leagueFor(8);
    league.firms[0].initialRnd=1234;
    const decision=makeFirmDecision('f0',8);
    const result=computePeriod({periodIndex:0,config:league.config,macro:makeMacroParams(0),firms:league.firms,opening:initialOpeningState(league),decisions:Object.fromEntries(league.firms.map(f=>[f.id,{...decision,firmId:f.id}]))});
    expect(result.firms[0].rndCumulative).toBe(1654);
  });
});
