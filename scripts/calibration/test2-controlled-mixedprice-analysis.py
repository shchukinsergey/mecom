import json, math, pathlib, statistics, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'data/calibration/research'
source=ROOT/'data/calibration/test2-original.json'
records=json.loads(source.read_text(encoding='utf-8'))['records']
def base(p): return 60850/p**.85 if p<=39.6 else 1668820/p**1.75
def stats(r):
 p=r['fields']['price']; m=statistics.mean(p); v=statistics.mean([(x-m)**2 for x in p]); h=statistics.mean([max(x-40,0)**2 for x in p])-max(m-40,0)**2
 return m,v,h
keys=['production','marketing','capexGross','rnd']
def controlled(r):
 f=r['fields']; return r['periodIndex']==1 and r['firmCount']==8 and all(f[k]==[v]*8 for k,v in [('production',525),('marketing',1050),('capexGross',1050),('rnd',420),('inventoryOpening',0),('fullCapacity',525)]) and f['rndCumulative']==[840]*8
pure=[r for r in records if controlled(r)]
def family(r):
 p=sorted(set(r['fields']['price'])); m,v,h=stats(r)
 if len(p)==1:return 'uniform'
 if p==[20,60]:return '20_60_composition'
 if p==[30,50]:return '30_50_composition'
 if m==30 and len(p)==2 and r['fields']['price'].count(p[0])==4:return 'fixed_mean30_spread'
 if p==[40,60]:return '40_60_half'
 if len(p)>2:return 'broad_multilevel'
 return 'one_changed'
# Group full observed decision/history inputs (not folder labels); never group outcomes.
groups={}
for r in records:
 f=r['fields']; sig=json.dumps({'periodIndex':r['periodIndex'],'firmCount':r['firmCount'],**{k:f[k] for k in keys},'rndBefore':[a-b for a,b in zip(f['rndCumulative'],f['rnd'])]},sort_keys=True)
 groups.setdefault(sig,[]).append(r['path'])
# stdlib least squares using scaled Gram matrix and tiny numerical regularizer.
def fit(X,y):
 n=len(X[0]); sc=[max(abs(x[j]) for x in X) or 1 for j in range(n)]; z=[[x[j]/sc[j] for j in range(n)] for x in X]
 a=[[sum(x[i]*x[j] for x in z)+(1e-9 if i==j else 0) for j in range(n)]+[sum(x[i]*t for x,t in zip(z,y))] for i in range(n)]
 for i in range(n):
  k=max(range(i,n),key=lambda k:abs(a[k][i]));a[i],a[k]=a[k],a[i]; pivot=a[i][i]
  if abs(pivot)<1e-15: raise ValueError('rank deficient')
  a[i]=[t/pivot for t in a[i]]
  for k in range(n):
   if k!=i:
    q=a[k][i]; a[k]=[u-q*v for u,v in zip(a[k],a[i])]
 return [a[i][-1]/sc[i] for i in range(n)]
def feat(r,model):
 m,v,h=stats(r)
 return {'variance':[v], 'variance_mean_hinge':[v,v*max(m-40,0)], 'quadratic_hinge_moment':[v,h], 'quadratic_hinge_moment_mean':[v,h,v*max(m-40,0)], 'variance_mean_quadratic':[v,v*(m-40),v*(m-40)**2]}[model]
def predict(r,model,c):return base(stats(r)[0])+sum(a*b for a,b in zip(c,feat(r,model)))
def metrics(rows):
 e=[r['prediction']-r['actual'] for r in rows]
 return {'n':len(e),'mae':statistics.mean(map(abs,e)),'rmse':math.sqrt(statistics.mean([x*x for x in e])),'max_abs':max(map(abs,e)),'mape_pct':statistics.mean([abs(x)/r['actual']*100 for x,r in zip(e,rows)])}
def row(r,p):return {'path':r['path'],'family':family(r),'prices':r['fields']['price'],'mean':stats(r)[0],'variance':stats(r)[1],'hinge40_jensen':stats(r)[2],'actual':r['industry']['totalOrders'],'prediction':p,'error':p-r['industry']['totalOrders']}
mixtures=[r for r in pure if family(r) not in ['uniform','one_changed']]
secondary=[r for r in pure if family(r)=='one_changed']
models=['variance','variance_mean_hinge','quadratic_hinge_moment','quadratic_hinge_moment_mean','variance_mean_quadratic']
result={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'record_count':len(records),'controlled_pure_count':len(pure),'primary_mixture_count':len(mixtures),'secondary_one_changed_count':len(secondary),'grouping_keys':['periodIndex','firmCount']+keys+['rndCumulative-rnd'],'observed_input_groups':[{'signature':json.loads(k),'paths':v} for k,v in groups.items()],'warning':'Observed input grouping cannot certify hidden macro settings or complete prior state; labels ignored. No native runs. Existing base held fixed; additive corrections only. Selection among these candidates uses same LOFO and is exploratory, not untouched final test.','base_primary':metrics([row(r,base(stats(r)[0])) for r in mixtures]),'base_rows':[row(r,base(stats(r)[0])) for r in pure],'models':{}}
for model in models:
 folds=[];allrows=[]
 for fam in sorted(set(map(family,mixtures))):
  train=[r for r in mixtures if family(r)!=fam]; test=[r for r in mixtures if family(r)==fam]
  c=fit([feat(r,model) for r in train],[r['industry']['totalOrders']-base(stats(r)[0]) for r in train]);rows=[row(r,predict(r,model,c)) for r in test];allrows+=rows
  folds.append({'heldout_family':fam,'training_paths':[r['path'] for r in train],'coefficients':c,'metrics':metrics(rows),'rows':rows})
 c=fit([feat(r,model) for r in mixtures],[r['industry']['totalOrders']-base(stats(r)[0]) for r in mixtures])
 srows=[row(r,predict(r,model,c)) for r in secondary]
 result['models'][model]={'lofo':metrics(allrows),'folds':folds,'all_mixture_fit_coefficients':c,'secondary_entire_one_changed_family_holdout':metrics(srows),'secondary_rows':srows}
# p2 controlled pair matches all nonprice current inputs and reconstructed cumulative-before.
p2=[r for r in records if r['periodIndex']==2 and 'niokr2' in r['path']]
p2.sort(key=lambda r:stats(r)[0]);p30,p50,p70=p2
amp=p30['industry']['totalOrders']/base(30)-1
power=math.log((p50['industry']['totalOrders']/base(50)-1)/amp)/math.log(50/30)
# Reverse price holdout too, no refitting at heldout price.
reverse_power=math.log((p70['industry']['totalOrders']/base(70)-1)/amp)/math.log(70/30)
inter=[]
for r in p2:
 p=stats(r)[0];inter.append({'path':r['path'],'price':p,'actual':r['industry']['totalOrders'],'anchored_separable':base(p)*(1+amp),'additive_quality_power':base(p)*(1+amp*(p/30)**power),'measured_multiplier':r['industry']['totalOrders']/base(p)})
result['p2_interaction']={'anchor_price30_amplitude':amp,'quality_power_fit30_50':power,'fit_prices':[30,50],'heldout_price70':inter[-1],'reverse_fit30_70_power':reverse_power,'heldout_price50_reverse_prediction':base(50)*(1+amp*(50/30)**reverse_power),'rows':inter,'interpretation':'Positive quality amplitude couples to price: D(P,E)=D0(P)[1+E(P/30)^gamma]. E is learned at price30, not inferred stock law. Three observations cannot uniquely identify structural law. Per-firm cumulative-before and all current nonprice inputs match across p2 price30/50/70.'}
# Independent p1 heterogeneous high-R&D extrapolation, amplitude anchored only on p1 uniform30.
r30=next(r for r in records if r['path'].endswith('TEST2_niokr.Z01')); rh=next(r for r in records if r['path'].endswith('TEST2_niokr_dif_prices.Z01'))
a1=r30['industry']['totalOrders']/base(30)-1
best='variance_mean_hinge'
c=result['models'][best]['all_mixture_fit_coefficients'];m=stats(rh)[0]
result['p1_joint_independent_holdout']={'uniform_anchor_path':r30['path'],'heldout_path':rh['path'],'actual':rh['industry']['totalOrders'],'amplitude':a1,'mean':m,'base_separable_prediction':base(m)*(1+a1),'quality_mean_price_prediction':base(m)*(1+a1*(m/30)**power),'mixture_plus_quality_prediction':predict(rh,best,c)+base(m)*a1*(m/30)**power,'note':'The p1 heterogeneous prices align positively with R&D; no permutation control exists, so mean-price coupling and covariance cannot be distinguished. Uniform and hetero p1 have identical nonprice decisions/history.'}
# Full current engine formula using controlled known R&D histories, separate from fair native30 anchoring.
def current_volume(r,previous_stock):
 f=r['fields']; stock=sum((x/(25000+x))*old+x-420 for x,old in zip(f['rnd'],previous_stock)); mult=max(.1,1+.0000224*stock)
 mkt=(-2.4507+.3798*math.log(sum(f['marketing'])+879))/(-2.4507+.3798*math.log(9279))
 return {'prediction':base(stats(r)[0])*mult*mkt,'rnd_stock_sum':stock,'rnd_multiplier':mult,'marketing_multiplier':mkt}
p1stocks=[x-420 for x in r30['fields']['rnd']]
for rr,z in zip(p2,result['p2_interaction']['rows']):z['full_current_engine']=current_volume(rr,p1stocks)
result['p1_joint_independent_holdout']['full_current_engine']=current_volume(rh,[0]*8)
result['p1_joint_independent_holdout']['mixed_price_corrected_separable']=predict(rh,best,c)*(1+a1)
result['primary_family_baseline_metrics']={fam:metrics([row(r,base(stats(r)[0])) for r in mixtures if family(r)==fam]) for fam in sorted(set(map(family,mixtures)))}
result['secondary_base']=metrics([row(r,base(stats(r)[0])) for r in secondary])
result['practical_candidate']={'formula':'D0(meanP) + V*(a+b*max(meanP-40,0)) + D0(meanP)*E*(meanP/30)^gamma','a':c[0],'b':c[1],'gamma':power,'E_definition':'Q_native(uniform30,same_RD_state)/D0(30)-1; zero for no-excess baseline. Stock-to-E law delegated, not inferred here.','limitations':'Price-R&D covariance not identifiable; mixture-R&D validation is one independent p1 family; higher degree terms worsened primary family holdouts.'}
controlled_path=ROOT/'data/calibration/test2-controlled-series.json'
if controlled_path.exists():
 parent=json.loads(controlled_path.read_text(encoding='utf-8'))
 result['parent_grouping_verification']={'verifiedHashes':parent['verifiedHashes'],'controlNote':parent['controlNote'],'family_summary':[{'varied':g['varied'],'count':g['count']} for g in parent['families']]}
result['single_family_transfer']=[]
for trainfam,testfam in [('20_60_composition','30_50_composition'),('30_50_composition','20_60_composition')]:
 tr=[r for r in mixtures if family(r)==trainfam]; te=[r for r in mixtures if family(r)==testfam]
 cc=fit([feat(r,best) for r in tr],[r['industry']['totalOrders']-base(stats(r)[0]) for r in tr]); rr=[row(r,predict(r,best,cc)) for r in te]
 result['single_family_transfer'].append({'train_family':trainfam,'test_family':testfam,'coefficients':cc,'candidate':metrics(rr),'baseline':metrics([row(r,base(stats(r)[0])) for r in te]),'rows':rr})
result['combined_out_of_family_27']=metrics([r for f in result['models'][best]['folds'] for r in f['rows']]+result['models'][best]['secondary_rows'])
result['baseline_27']=metrics([row(r,base(stats(r)[0])) for r in mixtures+secondary])
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'test2-controlled-mixedprice-analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# TEST2 controlled heterogeneous-price analysis','',f"Corpus: {len(records)} records; strict pure-price controls: {len(pure)}; primary mixture observations: {len(mixtures)}; secondary one-changed observations: {len(secondary)}.",'','Strict control: period1, N8, production525 each, marketing1050 each, R&D420 each, cumulative840 each. Full grouping also checks capex and inferred R&D-before. Original labels are not used to define mixtures. Hidden macro/prior state remains unobserved.','', '## Primary leave-entire-family-out comparison','', '| Candidate | heldout MAE | heldout RMSE | max error | MAPE |','|---|---:|---:|---:|---:|']
for name,z in [('existing arithmetic mean',result['base_primary'])]+[(k,v['lofo']) for k,v in result['models'].items()]:lines.append(f"| {name} | {z['mae']:.2f} | {z['rmse']:.2f} | {z['max_abs']:.2f} | {z['mape_pct']:.2f}% |")
lines += ['','## Conclusions and limitations','- Best exploratory candidate: D0(meanP) + V*(-0.292882 + 0.121469*max(meanP-40,0)); coefficients shown are the all-primary-fit summary, while reported LOFO errors use separately refitted training folds. Pure uniform predictions remain unchanged.','- Primary20 family-heldout MAE104.74 ->42.29; combined27 out-of-family MAE87.33 ->39.35. This is not merely a base-curve coefficient retune.','- IMPORTANT: direct narrow-family transfer is asymmetric: training20/60 predicts30/50 MAE43.60 versus baseline62.17; training30/50 predicts20/60 MAE256.15 versus baseline145.67. Therefore the correction is not established as universal; the broader training families matter.','- The singleton40/60 and broad-price heldouts retain errors140.82 and115.95 respectively. Variance alone and higher-order flexible dispersion features fail to improve the primary holdouts.','- A separable R&D multiplier is falsified by the p2 controlled price-only triple: implied multipliers2.807,3.758,4.554 at prices30,50,70. Fit joint exponent0.828 at30/50, hold70 predicts4575.51 versus4486 (+2.00%); reverse fit30/70 holds50 at6597.05 versus6671.','- Independent p1 mixed-R&D target5897: full existing formula3579.12; joint additive candidate5666.02 (-3.92%). The R&D amplitude for that state is anchored on its separate uniform30 control, not fitted on the heldout mixed target. No stock-to-amplitude law is claimed.','- Treat these as identified interaction directions plus a compact improved approximation, not an exact reconstruction or sufficient basis alone for engine replacement.']
lines += ['','All candidates use D0(mean price) plus additive fitted features; no path identifier enters a predictor. V = mean((P-meanP)^2), H = mean(max(P-40,0)^2)-max(meanP-40,0)^2. The piecewise-quadratic moment is grounded in independent native uniform-price bend near40. Features: variance[V]; variance_mean_hinge[V,V*max(meanP-40,0)]; quadratic_hinge_moment[V,H]; quadratic_hinge_moment_mean[V,H,V*max(meanP-40,0)]; variance_mean_quadratic[V,V*(meanP-40),V*(meanP-40)^2]. Existing base coefficients are not refitted.','', 'Candidate selection on LOFO is exploratory; each individual heldout prediction is out-of-family, but reporting the winning candidate is not a fresh untouched test. Broad and40/60 are singleton families; small fold counts increase uncertainty.','', '## Detailed family holdouts']
for name,d in result['models'].items():
 lines+=['',f'### {name}',f"Full-mixture coefficients: {d['all_mixture_fit_coefficients']}"]
 for fold in d['folds']:lines.append(f"- Hold out {fold['heldout_family']}: n={fold['metrics']['n']}, MAE={fold['metrics']['mae']:.2f}, coefficients={fold['coefficients']}")
 lines.append(f"- Entire secondary one-changed-price family held out: MAE={d['secondary_entire_one_changed_family_holdout']['mae']:.2f}; not training inputs.")
lines+=['','## Recommended explanatory candidate (not exact recovered mechanism)',json.dumps(result['practical_candidate'],ensure_ascii=False,indent=2),'','## Direct training-family transfers',json.dumps(result['single_family_transfer'],ensure_ascii=False,indent=2),'','## Combined 27 heterogeneous observations',json.dumps({'existing':result['baseline_27'],'candidate_out_of_family':result['combined_out_of_family_27']},indent=2),'','The 20 primary rows are LOFO; seven secondary rows use a model trained on all20 primary mixtures. Thus none of27 target rows are used in their own prediction fit, but exploratory feature selection still uses LOFO. Native per-firm rounding explains at most a few orders, not the100+ residuals.','', '## Price x R&D controlled p2 tests',json.dumps(result['p2_interaction'],ensure_ascii=False,indent=2),'','## Independent p1 joint-price/R&D holdout',json.dumps(result['p1_joint_independent_holdout'],ensure_ascii=False,indent=2),'','No exact native mechanism is established. Price-dependent R&D response is independently demonstrated; a positive price-R&D covariance coefficient is not identified by these tests. No mixed-price p2 observation exists in the corpus.','', '## Artifacts','JSON contains all grouping signatures, fold training membership, coefficients, predictions, and errors. Reproduce with this adjacent Python script. Repo and native originals are read-only.']
(OUT/'test2-controlled-mixedprice-analysis.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'counts':{k:result[k] for k in ['record_count','controlled_pure_count','primary_mixture_count','secondary_one_changed_count']},'base':result['base_primary'],'models':{k:{'lofo':v['lofo'],'secondary':v['secondary_entire_one_changed_family_holdout']} for k,v in result['models'].items()},'p2':result['p2_interaction'],'p1':result['p1_joint_independent_holdout']},ensure_ascii=False,indent=2))
