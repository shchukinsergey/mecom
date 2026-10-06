import json, math, hashlib, pathlib, importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'data/calibration/research'
OUT.mkdir(parents=True, exist_ok=True)
corpus=ROOT/'data/calibration/test2-original.json'
d=json.loads(corpus.read_text(encoding='utf-8')); records=d['records']; source=pathlib.Path(d['source'])
def mean(x): return sum(x)/len(x)
def metrics(actual,pred):
    e=[p-a for a,p in zip(actual,pred)]
    return {'predictions':pred,'errors':e,'mae':mean(list(map(abs,e))),'rmse':math.sqrt(mean([v*v for v in e])),'maxAbs':max(map(abs,e))}
def ls(xs,ys):
    n=len(xs[0]); a=[[sum(x[i]*x[j] for x in xs) for j in range(n)]+[sum(x[i]*y for x,y in zip(xs,ys))] for i in range(n)]
    for i in range(n):
        k=max(range(i,n),key=lambda k:abs(a[k][i])); a[i],a[k]=a[k],a[i]
        pivot=a[i][i]
        if abs(pivot)<1e-15: raise ValueError('singular')
        a[i]=[v/pivot for v in a[i]]
        for j in range(n):
            if j!=i:
                t=a[j][i]; a[j]=[v-t*w for v,w in zip(a[j],a[i])]
    return [row[-1] for row in a]
def golden(f,lo,hi):
    g=(math.sqrt(5)-1)/2; c=hi-g*(hi-lo); e=lo+g*(hi-lo); fc=f(c); fe=f(e)
    for _ in range(110):
        if fc<fe: hi,e,fe=e,c,fc; c=hi-g*(hi-lo); fc=f(c)
        else: lo,c,fc=c,e,fe; e=lo+g*(hi-lo); fe=f(e)
    return (lo+hi)/2
hashes=[]; native_headers={}
for r in records:
    p=source/r['path']; raw=p.read_bytes(); h=hashlib.sha256(raw).hexdigest()
    header=next((line.strip() for line in raw.decode('cp866').splitlines() if line.strip().startswith('___') and '%' in line),None)
    native_headers[r['path']]=header
    hashes.append({'path':r['path'],'expected':r['sha256'],'actual':h,'match':h==r['sha256'],'size':len(raw),'nativeModifierWeightHeader':header})
assert len(hashes)==46 and all(x['match'] for x in hashes)
# Infer all transitions from numeric state, never filename.
links=[]
for r in records:
    f=r['fields']; candidates=[]; near=[]
    if r['periodIndex']:
        expected={'rndCumulative':[a-b for a,b in zip(f['rndCumulative'],f['rnd'])], 'inventoryEnd':f['inventoryOpening'],'capacityNextPeriod':f['fullCapacity'],'retainedEarnings':[a-b for a,b in zip(f['retainedEarnings'],f['netProfit'])]}
        for p in records:
            if p['periodIndex']!=r['periodIndex']-1 or p['firmCount']!=r['firmCount']: continue
            err={k:max(abs(a-b) for a,b in zip(v,p['fields'][k])) for k,v in expected.items()}
            if all(err[k]==0 for k in ('rndCumulative','inventoryEnd','capacityNextPeriod')) and err['retainedEarnings']<=1:
                candidates.append({'path':p['path'],'maxErrors':err})
            near.append({'path':p['path'],'maxErrors':err})
        links.append({'path':r['path'],'opening':expected,'candidates':candidates,'bestByRnd':sorted(near,key=lambda x:(x['maxErrors']['rndCumulative'],x['maxErrors']['retainedEarnings']))[:3]})
by={r['path'].split('\\')[-1]:r for r in records if r['firmCount']==8}
selected=[r for r in records if any(t in r['path'] for t in ('niokr','marketing'))]
linkby={x['path']:x for x in links}
# Group one-parameter controls by decisions outside tested parameter and full numeric inferred opening.
groups={}
for variable in ('price','rnd','marketing'):
    g={}
    for r in records:
        if r['firmCount']!=8 or not r['periodIndex']: continue
        fields=r['fields']; opening=linkby[r['path']]['opening']
        key=json.dumps({'period':r['periodIndex'],'nativeModifierWeightHeader':native_headers[r['path']],'opening':opening,'decisions':{k:fields[k] for k in ('price','production','marketing','capexGross','rnd') if k!=variable}},sort_keys=True)
        g.setdefault(key,[]).append(r['path'])
    groups[variable]=[{'signature':json.loads(k),'paths':v} for k,v in g.items() if len(v)>1]
base={30:3360.,50:1776.,70:984.}; ps=[30.,50.,70.]; y=[9482.,6671.,4486.]; b=[base[p] for p in ps]
# Hold out each PRICE at fixed p2 history/current R&D. Each uses exactly the same model family.
features={
 'additive_constant':lambda p,b:[1.],
 'multiplicative_constant':lambda p,b:[b],
 'additive_affine_price':lambda p,b:[1.,p],
 'additive_affine_sqrt_baseline':lambda p,b:[1.,math.sqrt(b)],
 'additive_affine_baseline':lambda p,b:[1.,b],
}
fits={}
for name,fn in features.items():
    x=[fn(p,bb) for p,bb in zip(ps,b)]; target=y if name=='multiplicative_constant' else [a-bb for a,bb in zip(y,b)]
    c=ls(x,target); pred=[sum(a*bb for a,bb in zip(c,xx))+(0 if name=='multiplicative_constant' else bb) for xx,bb in zip(x,b)]
    held=[]
    for i in range(3):
        ids=[j for j in range(3) if j!=i]; ci=ls([x[j] for j in ids],[target[j] for j in ids]); pred_i=sum(a*bb for a,bb in zip(ci,x[i]))+(0 if name=='multiplicative_constant' else b[i]); held.append({'heldPrice':ps[i],'trainPrices':[ps[j] for j in ids],'coefficients':ci,'predicted':pred_i,'actual':y[i],'error':pred_i-y[i]})
    fits[name]={'coefficients':c,'training':metrics(y,pred),'leaveOnePriceOut':held,'heldMetrics':metrics(y,[v['predicted'] for v in held])}
# General square-root transform: D=(sqrt(Dbase)+c)^2. fit directly in output units.
def squarefit(ids):
    c=golden(lambda c:sum(((math.sqrt(b[i])+c)**2-y[i])**2 for i in ids),0,100)
    return c
c=squarefit(range(3)); held=[]
for i in range(3):
    ci=squarefit([j for j in range(3) if j!=i]); pred=(math.sqrt(b[i])+ci)**2; held.append({'heldPrice':ps[i],'coefficient':ci,'predicted':pred,'error':pred-y[i]})
fits['squared_sqrt_addition']={'coefficient':c,'perPriceImpliedShift':[math.sqrt(yy)-math.sqrt(bb) for yy,bb in zip(y,b)],'training':metrics(y,[(math.sqrt(bb)+c)**2 for bb in b]),'leaveOnePriceOut':held,'heldMetrics':metrics(y,[v['predicted'] for v in held])}
# Expansion C/P^q, two-parameter family. Independent power-law fit to expansion, not base price law.
z=[yy-bb for yy,bb in zip(y,b)]; cc=ls([[1,math.log(p)] for p in ps],[math.log(v) for v in z]); held=[]
for i in range(3):
    ids=[j for j in range(3) if j!=i]; a,q=ls([[1,math.log(ps[j])] for j in ids],[math.log(z[j]) for j in ids]); pred=b[i]+math.exp(a)*ps[i]**q; held.append({'heldPrice':ps[i],'C':math.exp(a),'exponent':q,'predicted':pred,'error':pred-y[i]})
fits['additive_power_price']={'C':math.exp(cc[0]),'exponent':cc[1],'training':metrics(y,[bb+math.exp(cc[0])*p**cc[1] for p,bb in zip(ps,b)]),'leaveOnePriceOut':held,'heldMetrics':metrics(y,[v['predicted'] for v in held])}
# Fixed native base table; log-log interpolation only, with explicitly unvalidated endpoint extrapolation.
table={30:3360.}
for r in records:
    f=r['fields']
    if r['periodIndex']==1 and r['firmCount']==8 and len(set(f['price']))==1 and f['rnd']==[420.]*8 and f['marketing']==[1050.]*8:
        table[f['price'][0]]=r['industry']['totalOrders']
knots=sorted(table)
def pricebase(p):
    p=max(0.01,p)
    j=next((j for j in range(1,len(knots)) if p<=knots[j]),len(knots)-1)
    x0,x1=knots[j-1],knots[j]; t=math.log(p/x0)/math.log(x1/x0)
    return math.exp(math.log(table[x0])+t*math.log(table[x1]/table[x0]))
def invbase(v): return math.exp(golden(lambda lp:(pricebase(math.exp(lp))-v)**2,math.log(.01),math.log(500)))
effective=[invbase(v) for v in y]
for kind in ('subtractive','proportional','affine'):
    def pred_param(p,c): return pricebase(p-c[0]) if kind=='subtractive' else pricebase(p*c[0]) if kind=='proportional' else pricebase(c[0]+c[1]*p)
    def fitparam(ids):
        if kind=='subtractive': return [golden(lambda a:sum((pricebase(ps[i]-a)-y[i])**2 for i in ids),0,29.99)]
        if kind=='proportional': return [golden(lambda a:sum((pricebase(ps[i]*a)-y[i])**2 for i in ids),.01,1)]
        # Inverse-space affine fit is stated explicitly; not output-space optimal.
        return ls([[1,ps[i]] for i in ids],[effective[i] for i in ids])
    c=fitparam(range(3)); held=[]
    for i in range(3):
        ci=fitparam([j for j in range(3) if j!=i]); pred=pred_param(ps[i],ci); held.append({'heldPrice':ps[i],'parameters':ci,'predicted':pred,'error':pred-y[i]})
    fits['effective_price_'+kind]={'parameters':c,'training':metrics(y,[pred_param(p,c) for p in ps]),'leaveOnePriceOut':held,'heldMetrics':metrics(y,[v['predicted'] for v in held]),'caveat':'Most inferred effective prices are below lowest observed native baseline price 20; log-log extrapolation is assumed, NOT established.'}
# Equal-price allocations isolate native weights independently of volume model.
allocations=[]
for r in selected:
    f=r['fields']; yy=f['ordersReceived']; total=r['industry']['totalOrders']
    if len(set(f['price']))!=1: continue
    rnd=f['rndCumulative']; sr=sum(rnd); m=f['marketing']; sm=sum(v**1.5 for v in m)
    pred=[total*(.70/8+.15*(v**1.5/sm if sm else 1/8)+.15*rr/sr) for v,rr in zip(m,rnd)]
    shares=[v/total for v in pred]
    lower=max((v-.5)/s for v,s in zip(yy,shares)); upper=min((v+.5)/s for v,s in zip(yy,shares))
    rc=f['rnd']; src=sum(rc)
    current_pred=[total*(.70/8+.15*(v**1.5/sm if sm else 1/8)+.15*(rr/src if src else 1/8)) for v,rr in zip(m,rc)]
    allocations.append({'path':r['path'],'formula':'D*(0.70/N+0.15*M_i^1.5/sum(M^1.5)+0.15*Rcum_i/sum(Rcum))','native':yy,'evaluation':metrics(yy,pred),'rounded':[math.floor(v+.5) for v in pred],'rawTotalRoundingInterval':[lower,upper],'canExactRoundWithUnreportedRawTotal':lower<upper,'currentOnlyRndAlternative':metrics(yy,current_pred)})
# Marketing exponent genuinely held firm-out; fit intercept/slope on other seven at each exponent.
mrec=next(r for r in selected if r['periodIndex']==1 and len(set(r['fields']['marketing']))>1)
m=mrec['fields']['marketing']; my=mrec['fields']['ordersReceived']
def mfit(ids):
    def calc(q):
        xx=[[1,(m[i]/32000)**q] for i in ids]; cc=ls(xx,[my[i] for i in ids]); pred=[cc[0]+cc[1]*(m[i]/32000)**q for i in ids]
        return sum((v-my[i])**2 for i,v in zip(ids,pred)),cc
    q=golden(lambda q:calc(q)[0],.2,3); _,cc=calc(q); return q,cc
q,mc=mfit(range(8)); mheld=[]
for i in range(8):
    qi,ci=mfit([j for j in range(8) if j!=i]); v=ci[0]+ci[1]*(m[i]/32000)**qi; mheld.append({'heldFirm':i+1,'exponent':qi,'predicted':v,'error':v-my[i]})
marketing={'sumM':sum(m),'exponentFit':q,'interceptAndScaledSlope':mc,'train':metrics(my,[mc[0]+mc[1]*(v/32000)**q for v in m]),'heldFirms':mheld,'heldMetrics':metrics(my,[v['predicted'] for v in mheld])}
# Baseline-near marketing controls: everything else same, state match same.
mcontrols=[]
for r in records:
    f=r['fields']
    if r['periodIndex']==1 and r['firmCount']==8 and f['price']==[30.]*8 and f['rnd']==[420.]*8:
        mcontrols.append({'path':r['path'],'sumM':sum(f['marketing']),'marketing':f['marketing'],'production':f['production'],'capexGross':f['capexGross'],'D':r['industry']['totalOrders'],'opening':linkby[r['path']]['opening'],'caveat':'Not an exact isolated marketing-volume pair: production vectors differ between these reports.'})
# For volume log model, fit on endpoints, test near-baseline controls; cannot identify saturation.
ms=[v['sumM'] for v in mcontrols]; ds=[v['D'] for v in mcontrols]
def mlog(offset):
    ids=[ms.index(min(ms)),ms.index(max(ms))]; c=ls([[1,math.log(ms[i]+offset)] for i in ids],[ds[i] for i in ids]); pred=[c[0]+c[1]*math.log(v+offset) for v in ms]; return c,metrics(ds,pred)
marketing['volumeControls']=mcontrols; marketing['logVolumeSensitivity']={str(o):{'coefficients':mlog(o)[0],'errors':mlog(o)[1]} for o in (0,1000,8400,50000)}
# Equal-price R&D affine allocation and weight, including cumulative vs current counter.
rndregs=[]
for r in selected:
    f=r['fields']
    if len(set(f['price']))!=1 or len(set(f['rnd']))==1: continue
    out={'path':r['path']}
    for k in ('rnd','rndCumulative'):
        x=f[k]; yy=f['ordersReceived']; c=ls([[1,v] for v in x],yy); pred=[c[0]+c[1]*v for v in x]
        held=[]
        for i in range(len(x)):
            ids=[j for j in range(len(x)) if j!=i]; ci=ls([[1,x[j]] for j in ids],[yy[j] for j in ids]); held.append(ci[0]+ci[1]*x[i])
        out[k]={'intercept':c[0],'slope':c[1],'impliedShareWeight':c[1]*sum(x)/r['industry']['totalOrders'],'training':metrics(yy,pred),'heldFirms':metrics(yy,held)}
    rndregs.append(out)
p1=by['TEST2_niokr.Z01']; p2=by['TEST2_niokr2.Z02']; mixed=by['TEST2_niokr_dif_prices.Z01']
e1=p1['industry']['totalOrders']-3360
mixedD=mixed['industry']['totalOrders']; mixbase=table[55]
comparison={'p1Expansion':e1,'p2ExpansionByPrice':z,'p2MultiplierByPrice':[yy/bb for yy,bb in zip(y,b)],'p2PriceDrops':[y[0]-y[1],y[1]-y[2]],'baselinePriceDrops':[b[0]-b[1],b[1]-b[2]],'mixedP1':{'meanPrice':mean(mixed['fields']['price']),'nativeD':mixedD,'baselineUniform55':mixbase,'additiveFromP1':mixbase+e1,'additiveError':mixbase+e1-mixedD,'multiplicativeFromP1':mixbase*p1['industry']['totalOrders']/3360,'multiplicativeError':mixbase*p1['industry']['totalOrders']/3360-mixedD,'caveat':'Mixed-price baseline at same actual price vector is absent; uniform55 is a surrogate, so 192-unit residual is not a clean interaction estimate.'},'periodCarryover':{'currentRndTotals':[sum(p1['fields']['rnd']),sum(p2['fields']['rnd'])],'nativeDemandIncrease':y[0]-p1['industry']['totalOrders'],'expansionRatio':z[0]/e1,'identifiedDecay':'Only one aggregate carryover observation; cannot identify per-firm lambda(R), decay stock vs nonlinear cumulative response.'}}
# Price/quality BEFORE kinked price curve: calibrated p1 uniform, hold out exact p1 mixed pair.
# Also calibrate p2 uniform30 and hold out siblings50/70, avoiding engine multiplier.
quality_checks=[]
def enginebase(p):
    p=max(.01,p)
    return 60850/p**.85 if p<=39.6 else 1668820/p**1.75
for curve_name,curve in [('observed_native_loglog',pricebase),('fixed_engine_kinked',enginebase)]:
    for model in ('league_scalar','firm_positive_linear_excess','firm_signed_linear_excess','firm_sqrt_positive_excess','firm_cumulative_power'):
        def qvalues(r,k):
            f=r['fields']; n=r['firmCount']; norm=420.; cum_norm=420.*(r['periodIndex']+1)
            if model=='league_scalar': return [1+k*sum(v-norm for v in f['rnd'])]*n
            if model=='firm_positive_linear_excess': return [1+k*max(0,v-norm) for v in f['rnd']]
            if model=='firm_signed_linear_excess': return [max(.01,1+k*(v-norm)) for v in f['rnd']]
            if model=='firm_sqrt_positive_excess': return [1+k*math.sqrt(max(0,v-norm)) for v in f['rnd']]
            return [(max(1,v)/cum_norm)**k for v in f['rndCumulative']]
        def qpred(r,k):
            qv=qvalues(r,k)
            pe=mean([p/q for p,q in zip(r['fields']['price'],qv)])
            return curve(pe),pe,qv
        hi=4 if model=='firm_cumulative_power' else 2 if model=='firm_sqrt_positive_excess' else 10
        def fitquality(r):
            # Signed/cumulative models can be nonmonotonic: scan globally before local refinement.
            target=r['industry']['totalOrders']
            grid=([hi*i/500 for i in range(501)] if model=='firm_cumulative_power' else [0]+[10**(-10+i*(math.log10(hi)+10)/600) for i in range(601)])
            objective=lambda k:(qpred(r,k)[0]-target)**2
            j=min(range(len(grid)),key=lambda j:objective(grid[j]))
            lo=grid[max(0,j-1)]; upper=grid[min(len(grid)-1,j+1)]
            opt=golden(objective,lo,upper)
            return min((grid[j],opt),key=objective)
        k=fitquality(p1)
        train,pe,qv=qpred(p1,k); held,hpe,hq=qpred(mixed,k)
        k2=fitquality(p2)
        p2held=[]
        for name in ('TEST2_niokr2_50price.Z02','TEST2_niokr2_70price.Z02'):
            rr=by[name]; v,ep,qv2=qpred(rr,k2); p2held.append({'path':rr['path'],'prediction':v,'effectiveMeanPrice':ep,'error':v-rr['industry']['totalOrders']})
        quality_checks.append({'curve':curve_name,'model':model,'p1FitK':k,'p1TrainingError':train-p1['industry']['totalOrders'],'p1EffectiveMeanPrice':pe,'p1QualityVector':qv,'heldP1MixedPrediction':held,'heldP1MixedEffectiveMeanPrice':hpe,'heldP1MixedError':held-mixedD,'p2FitK':k2,'p2HeldPriceSiblings':p2held,'caveat':'Separate period calibration does not identify quality dynamics; baseline period norm used explicitly. Extrapolation below observed20 is required.'})
# Aggregate excess normalizations: corpus has one eight-firm R&D vector, not N identification.
comparison['rndNormalization']={'N':8,'perFirmCurrentBaseline':420,'leagueCurrentBaseline':3360,'p1CurrentExcess':sum(p1['fields']['rnd'])-3360,'p2CurrentExcess':sum(p2['fields']['rnd'])-3360,'p1CumulativeExcessVsPeriodBaseline':sum(p1['fields']['rndCumulative'])-8*840,'p2CumulativeExcessVsPeriodBaseline':sum(p2['fields']['rndCumulative'])-8*1260,'zeroCurrentContributionForFirm1P1':-420,'caveat':'No controlled zero-R&D league or cross-N R&D trajectory: sum vs average normalization and effect of a full zero-R&D market cannot be identified.'}
# Marketing log-shape inference beyond fixed positive offsets: fit endpoints and hold controls.
# Do not turn four near-redundant totals into a saturation claim.
result={'priceQualityBeforeCurveChecks':quality_checks,'corpus':str(corpus),'corpusSha256':hashlib.sha256(corpus.read_bytes()).hexdigest(),'verifiedOriginalCount':len(hashes),'hashes':hashes,'dependencies':{'stdlibOnly':True,'scipyInstalled':importlib.util.find_spec('scipy') is not None,'numpyInstalled':importlib.util.find_spec('numpy') is not None},'nativeControlledReports':[{'path':r['path'],'periodIndex':r['periodIndex'],'industry':r['industry'],'fields':r['fields']} for r in selected],'stateLinks':links,'actualDecisionStateGroups':groups,'baselineFixedNativeTable':table,'p2EffectivePriceUnderAssumedInterpolation':effective,'priceRndModelFits':fits,'equalPriceAllocationTests':allocations,'rndAllocationRegressions':rndregs,'marketing':marketing,'comparison':comparison}
(OUT/'test2-controlled-rnd-analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# TEST2 controlled R&D and marketing analysis','',f'Original SHA-256: **{len(hashes)}/46 match**. Original/repository are read-only. Stdlib only; scipy/numpy unavailable. Script: `{OUT / pathlib.Path(__file__).name}`.','', '## State linkage (numeric, not filenames)']
for r in selected:
    l=linkby[r['path']]; lines.append(f"- {r['path']}: predecessor(s) {[v['path'] for v in l['candidates']]}; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).")
lines+=['','Strict unchanged-decision/state/header groups: price-only groups contain34 baseline reports,2 p1 R&D reports and3 p2 R&D reports. No multi-report exact R&D-only or marketing-only group survives including production decisions: the named baseline-near marketing reports change production too. Their logarithmic volume checks are therefore conditional sensitivity checks, not isolated marketing-volume identification.','','## Exact native controlled vectors']
for r in selected:
    f=r['fields']; lines.extend([f"### {r['path']} (period {r['periodIndex']}; D={r['industry']['totalOrders']:g})",f"P={f['price']}; production={f['production']}; capex={f['capexGross']}",f"R={f['rnd']}; Rcum={f['rndCumulative']}; M={f['marketing']}",f"Orders={f['ordersReceived']}"])
lines+=['','## Price x R&D: fixed p2 state / R&D / marketing','Native base D30=3360, D50=1776, D70=984. Native p2 R&D D=9482,6671,4486.',f'Additive expansions = {z}; multiplicative factors = {comparison["p2MultiplierByPrice"]}. Neither constant-additive nor constant-multiplicative expansion holds.', '', '| Family | Parameters | Train RMSE | Leave-one-price-out RMSE | Held 70 error (train30,50) |','|---|---|---:|---:|---:|']
for name,fit in fits.items():
    pars={k:v for k,v in fit.items() if k in ('coefficients','coefficient','C','exponent','parameters')}
    lines.append(f'| {name} | {pars} | {fit["training"]["rmse"]:.3f} | {fit["heldMetrics"]["rmse"]:.3f} | {fit["leaveOnePriceOut"][2]["error"]:.3f} |')
lines+=['','Squared-sqrt addition is D=(sqrt(Dbase)+c)^2, fit directly in output units. Affine-sqrt expansion is D=Dbase+a+b*sqrt(Dbase). Two-parameter fits have only one test observation per split; low errors do not identify a law. Effective-price affine model fits inverse-price space, not output space. **Its inferred effective prices mostly lie below observed price20: extrapolation is unvalidated.**',f'Implied effective prices: {effective}.',f'P1 expansion {e1:g}; mixed P1 mean-price55 surrogate: additive prediction {mixbase+e1:g} vs native {mixedD:g} (error {mixbase+e1-mixedD:g}); multiplicative prediction {comparison["mixedP1"]["multiplicativeFromP1"]:.3f}. Price dispersion in the absent baseline mixed vector is a confounder; do not claim exact additive identification.', 'A nonseparable D(P,R) relative to the observed baseline is established if baseline-period stationarity holds. That does not establish a primitive interaction: an additive price-dependent expansion or a transformed/shifted price law can account for it. A fixed price multiplier is contradicted much more strongly than constant-additive expansion.','','## Period linkage / memory',f'Current total R&D changes {sum(p1["fields"]["rnd"]):g} -> {sum(p2["fields"]["rnd"]):g} (+6), but D30 rises {y[0]-p1["industry"]["totalOrders"]:g}. At unchanged price/marketing this establishes R&D/history or period dependence, not a current-R&D-only smooth law. Expansion ratio = {z[0]/e1:.9f}.', 'No no-current-spend follow-up or third R&D period exists in the corpus: per-firm decay, lifetime vs decaying stock and exact carryover cannot be identified. A single aggregate effective carryover coefficient is model-dependent, not a measured lambda. The corpus has no pure baseline p2 for ruling out a general period effect independently.','','## Equal-price share allocation (independent of total-volume law)','The native rule tested is D*(0.70/N + 0.15*M_i^1.5/sum(M^1.5) + 0.15*Rcum_i/sum(Rcum)).']
for a in allocations: lines.append(f'- {a["path"]}: max cumulative-counter error {a["evaluation"]["maxAbs"]:.6f}; rounded vector equals native: {a["rounded"]==a["native"]}; fixed15% current-only alternative max error {a["currentOnlyRndAlternative"]["maxAbs"]:.6f}; feasible unrounded D interval {a["rawTotalRoundingInterval"]}.')
lines.extend([f'Marketing exponent fitted from firm orders: {q:.9f}; training RMSE {marketing["train"]["rmse"]:.6f}; leave-one-firm-out RMSE {marketing["heldMetrics"]["rmse"]:.6f}. The exponent result establishes distribution/share shape, NOT aggregate logarithmic marketing law.', 'R&D allocation is affine in cumulative R&D; fitted slopes/held-firm errors are in JSON. Current and cumulative vectors here are nearly affine-collinear, so a freely fitted slope alone cannot identify the lifetime counter. However the native header independently fixes the R&D weight at15%: cumulative normalization yields sub-unit errors, whereas fixed15% current-only normalization misses 8.25 to29.33 orders. For p1, a latent pre-rounding market total between7951.452 and7952.263 makes every firm round correctly, while summed displayed firm orders are7953. This is compatible with ordinary per-firm rounding rather than a share-law failure.','','## Marketing aggregate and period memory'])
for v in mcontrols: lines.append(f'- {v["path"]}: sumM={v["sumM"]:g}, D={v["D"]:g}.')
lines.extend(['p1 and p2 marketing repeat the exact complete order vector despite changed production (525 to524), retained earnings/loans and cumulative R&D. Therefore no detectable marketing memory for this repeated-vector trajectory, and demand is not capacity/production-limited. This does NOT prove no memory under a change or stoppage of marketing.', 'Near-baseline controls and one large marketing sum are too few independent points to identify log offset/saturation or prove sum-only dependence. Offsets 0/1000/8400/50000 fitted on endpoint sums, evaluated on remaining sums in JSON; same-sum different marketing-distribution tests are absent except the negligible +/-1 control. No new runs are proposed.','','## Reproduction',f'Run: `python "{OUT / pathlib.Path(__file__).name}"`','Every fit, held-out prediction/residual, full numerical state grouping and exact hash audit is saved in the JSON. Baseline interpolation is intentionally a fixed observed table, not a re-fit of the parent agent’s pure-price work.'])
lines+=['','## Quality-adjusted prices before applying price curve','Each p1 model is fitted ONLY to uniform30 R&D, then evaluated on the exact mixed-price p1 sibling. Each p2 model is fitted ONLY to price30, then evaluated on price50 and70 siblings. The models use mean(P_i/Q_i); league scalar instead sets common Q. Current positive excess=max(R_i-420,0); signed excess=R_i-420 with Q floor0.01; sqrt uses sqrt(positive excess); cumulative power uses (Rcum_i/[420*(period+1)])^k.','', '| Curve | Quality model | p1 train error | Held mixed p1 error | Held p2 price50 error | Held p2 price70 error |','|---|---|---:|---:|---:|---:|']
for v in quality_checks:
    lines.append(f'| {v["curve"]} | {v["model"]} | {v["p1TrainingError"]:.3f} | {v["heldP1MixedError"]:.3f} | {v["p2HeldPriceSiblings"][0]["error"]:.3f} | {v["p2HeldPriceSiblings"][1]["error"]:.3f} |')
lines+=['Quality models are hypotheses, not identified rules. Fits are constrained to nonnegative k. The fixed-engine curve is the unchanged 60850/P^0.85 below39.6, 1668820/P^1.75 above39.6; no pure-price re-fit. Both curves need extrapolation below native baseline price20. Per-period fitted k does not provide a history update law.',f'Normalization audit: {comparison["rndNormalization"]}']
(OUT/'test2-controlled-rnd-analysis.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'hashesVerified':len(hashes),'output':str(OUT),'fits':{k:{'trainRMSE':v['training']['rmse'],'heldRMSE':v['heldMetrics']['rmse'],'held70error':v['leaveOnePriceOut'][2]['error']} for k,v in fits.items()},'comparison':comparison,'marketingExponent':q,'marketingHeldRMSE':marketing['heldMetrics']['rmse'],'allocationMaxErrors':[(a['path'],a['evaluation']['maxAbs'],a['rounded']==a['native']) for a in allocations]},ensure_ascii=False,indent=2))
