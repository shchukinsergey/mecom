import { expect, it } from 'vitest';
import { initialOpeningState, nextOpeningState, computePeriod } from '../../engine/computePeriod';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart, makeMacroParams } from '../../engine/config';
import type { League } from '../../engine/types';
import { parseLeagueFile, serializeLeague, loadAll } from '../persistence';

it('restores full RIF history from old JSON and localStorage without recalculating saved results', () => {
  const league: League={id:'migration',name:'migration',createdAt:'',config:DEFAULT_LEAGUE_CONFIG,firms:[{...makeFirmStart(8),id:'a',name:'A'}],macroByPeriod:[],decisionsByPeriod:[],confirmedByPeriod:[],results:[]};
  let opening=initialOpeningState(league);
  for(let p=0;p<3;p++) {
    const result=computePeriod({periodIndex:p,config:league.config,macro:makeMacroParams(p),firms:league.firms,opening,decisions:{a:{firmId:'a',price:30,production:400+p*10,marketing:1000+p*100,capexGross:1050,rnd:420}}});
    league.results.push(result);
    opening=nextOpeningState(opening,result);
  }
  const file=JSON.parse(serializeLeague({league,opening}));
  for(const period of file.snapshot.league.results) for(const firm of period.firms) {
    delete firm.demandPotentialCumulative;delete firm.productionCumulative;
  }
  delete file.snapshot.opening.a.demandPotentialCumulative;delete file.snapshot.opening.a.productionCumulative;
  const restored=parseLeagueFile(JSON.stringify(file));
  expect(restored.opening.a.demandPotentialCumulative).toBe(4560);
  expect(restored.opening.a.productionCumulative).toBe(1230);
  expect(restored.league.results).toEqual(file.snapshot.league.results);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>JSON.stringify({schemaVersion:file.schemaVersion,leagues:{migration:file.snapshot}})}});
  try {
    expect(loadAll().leagues.migration.opening.a.demandPotentialCumulative).toBe(4560);
    expect(loadAll().leagues.migration.opening.a.productionCumulative).toBe(1230);
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
