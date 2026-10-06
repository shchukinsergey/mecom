# TEST2 controlled R&D and marketing analysis

Original SHA-256: **46/46 match**. Original/repository are read-only. Stdlib only; scipy/numpy unavailable. Script: `C:\Users\serge.DESKTOP-FQG7BEU\Downloads\mecom\data\calibration\research\test2-controlled-rnd-analysis.py`.

## State linkage (numeric, not filenames)
- прогнал\TEST2_marketing.Z01: predecessor(s) ['прогнал\\TEST2.Z00']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).
- прогнал\TEST2_marketing2.Z02: predecessor(s) ['прогнал\\TEST2_marketing.Z01']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).
- прогнал\TEST2_niokr.Z01: predecessor(s) ['прогнал\\TEST2.Z00']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).
- прогнал\TEST2_niokr2.Z02: predecessor(s) ['прогнал\\TEST2_niokr.Z01']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).
- прогнал\TEST2_niokr2_50price.Z02: predecessor(s) ['прогнал\\TEST2_niokr.Z01']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).
- прогнал\TEST2_niokr2_70price.Z02: predecessor(s) ['прогнал\\TEST2_niokr.Z01']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).
- прогнал\TEST2_niokr_dif_prices.Z01: predecessor(s) ['прогнал\\TEST2.Z00']; matching Rcum, opening inventory, capacity, and retained earnings minus profit (tolerance 1).

Strict unchanged-decision/state/header groups: price-only groups contain34 baseline reports,2 p1 R&D reports and3 p2 R&D reports. No multi-report exact R&D-only or marketing-only group survives including production decisions: the named baseline-near marketing reports change production too. Their logarithmic volume checks are therefore conditional sensitivity checks, not isolated marketing-volume identification.

## Exact native controlled vectors
### прогнал\TEST2_marketing.Z01 (period 1; D=5763)
P=[30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0]; production=[525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[420.0, 420.0, 420.0, 420.0, 420.0, 420.0, 420.0, 420.0]; Rcum=[840.0, 840.0, 840.0, 840.0, 840.0, 840.0, 840.0, 840.0]; M=[0.0, 300.0, 1051.0, 2000.0, 4000.0, 8000.0, 16000.0, 32000.0]
Orders=[612.0, 613.0, 616.0, 621.0, 637.0, 682.0, 810.0, 1172.0]
### прогнал\TEST2_marketing2.Z02 (period 2; D=5763)
P=[30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0]; production=[524.0, 524.0, 524.0, 524.0, 524.0, 524.0, 524.0, 524.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[420.0, 420.0, 420.0, 420.0, 420.0, 420.0, 420.0, 420.0]; Rcum=[1260.0, 1260.0, 1260.0, 1260.0, 1260.0, 1260.0, 1260.0, 1260.0]; M=[0.0, 300.0, 1051.0, 2000.0, 4000.0, 8000.0, 16000.0, 32000.0]
Orders=[612.0, 613.0, 616.0, 621.0, 637.0, 682.0, 810.0, 1172.0]
### прогнал\TEST2_niokr.Z01 (period 1; D=7953)
P=[30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0]; production=[525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[0.0, 150.0, 421.0, 1000.0, 2500.0, 6000.0, 15000.0, 40000.0]; Rcum=[420.0, 570.0, 841.0, 1420.0, 2920.0, 6420.0, 15420.0, 40420.0]; M=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
Orders=[852.0, 855.0, 860.0, 870.0, 896.0, 957.0, 1114.0, 1549.0]
### прогнал\TEST2_niokr2.Z02 (period 2; D=9482)
P=[30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0, 30.0]; production=[525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[1.0, 151.0, 420.0, 1001.0, 2501.0, 6001.0, 15001.0, 40001.0]; Rcum=[421.0, 721.0, 1261.0, 2421.0, 5421.0, 12421.0, 30421.0, 80421.0]; M=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
Orders=[1012.0, 1015.0, 1021.0, 1033.0, 1065.0, 1140.0, 1332.0, 1864.0]
### прогнал\TEST2_niokr2_50price.Z02 (period 2; D=6671)
P=[50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0]; production=[525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[1.0, 151.0, 420.0, 1001.0, 2501.0, 6001.0, 15001.0, 40001.0]; Rcum=[421.0, 721.0, 1261.0, 2421.0, 5421.0, 12421.0, 30421.0, 80421.0]; M=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
Orders=[712.0, 714.0, 718.0, 727.0, 749.0, 802.0, 937.0, 1312.0]
### прогнал\TEST2_niokr2_70price.Z02 (period 2; D=4486)
P=[70.0, 70.0, 70.0, 70.0, 70.0, 70.0, 70.0, 70.0]; production=[525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[1.0, 151.0, 420.0, 1001.0, 2501.0, 6001.0, 15001.0, 40001.0]; Rcum=[421.0, 721.0, 1261.0, 2421.0, 5421.0, 12421.0, 30421.0, 80421.0]; M=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
Orders=[479.0, 480.0, 483.0, 489.0, 504.0, 539.0, 630.0, 882.0]
### прогнал\TEST2_niokr_dif_prices.Z01 (period 1; D=5897)
P=[20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]; production=[525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0, 525.0]; capex=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
R=[0.0, 150.0, 421.0, 1000.0, 2500.0, 6000.0, 15000.0, 40000.0]; Rcum=[420.0, 570.0, 841.0, 1420.0, 2920.0, 6420.0, 15420.0, 40420.0]; M=[1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0, 1050.0]
Orders=[3334.0, 1085.0, 512.0, 242.0, 148.0, 125.0, 158.0, 293.0]

## Price x R&D: fixed p2 state / R&D / marketing
Native base D30=3360, D50=1776, D70=984. Native p2 R&D D=9482,6671,4486.
Additive expansions = [6122.0, 4895.0, 3502.0]; multiplicative factors = [2.8220238095238095, 3.7561936936936937, 4.558943089430894]. Neither constant-additive nor constant-multiplicative expansion holds.

| Family | Parameters | Train RMSE | Leave-one-price-out RMSE | Held 70 error (train30,50) |
|---|---|---:|---:|---:|
| additive_constant | {'coefficients': [4839.666666666667]} | 1070.326 | 1605.489 | 2006.500 |
| multiplicative_constant | {'coefficients': [3.122329359295387]} | 1194.958 | 2483.887 | -1508.392 |
| additive_affine_price | {'coefficients': [8114.666666666666, -65.5]} | 39.127 | 143.760 | 166.000 |
| additive_affine_sqrt_baseline | {'coefficients': [590.8254140131166, 96.94877289256277]} | 155.428 | 603.136 | 557.533 |
| additive_affine_baseline | {'coefficients': [2685.7813852813842, 1.0558261183261188]} | 240.559 | 1050.104 | 779.500 |
| squared_sqrt_addition | {'coefficient': 38.56998118690595} | 267.952 | 374.754 | 530.857 |
| additive_power_price | {'C': 55820.4586809728, 'exponent': -0.6411664343829939} | 246.550 | 1273.134 | 722.427 |
| effective_price_subtractive | {'parameters': [21.35863114275064]} | 2394.135 | 2143290.098 | -2633.181 |
| effective_price_proportional | {'parameters': [0.29754451543712634]} | 308.270 | 500.997 | 161.102 |
| effective_price_affine | {'parameters': [-0.6752687489811784, 0.3098088993618595]} | 402.589 | 2701.494 | 708.415 |

Squared-sqrt addition is D=(sqrt(Dbase)+c)^2, fit directly in output units. Affine-sqrt expansion is D=Dbase+a+b*sqrt(Dbase). Two-parameter fits have only one test observation per split; low errors do not identify a law. Effective-price affine model fits inverse-price space, not output space. **Its inferred effective prices mostly lie below observed price20: extrapolation is unvalidated.**
Implied effective prices: [9.173203035753817, 13.706766611353377, 21.565559010228203].
P1 expansion 4593; mixed P1 mean-price55 surrogate: additive prediction 6089 vs native 5897 (error 192); multiplicative prediction 3540.979. Price dispersion in the absent baseline mixed vector is a confounder; do not claim exact additive identification.
A nonseparable D(P,R) relative to the observed baseline is established if baseline-period stationarity holds. That does not establish a primitive interaction: an additive price-dependent expansion or a transformed/shifted price law can account for it. A fixed price multiplier is contradicted much more strongly than constant-additive expansion.

## Period linkage / memory
Current total R&D changes 65071 -> 65077 (+6), but D30 rises 1529. At unchanged price/marketing this establishes R&D/history or period dependence, not a current-R&D-only smooth law. Expansion ratio = 1.332897888.
No no-current-spend follow-up or third R&D period exists in the corpus: per-firm decay, lifetime vs decaying stock and exact carryover cannot be identified. A single aggregate effective carryover coefficient is model-dependent, not a measured lambda. The corpus has no pure baseline p2 for ruling out a general period effect independently.

## Equal-price share allocation (independent of total-volume law)
The native rule tested is D*(0.70/N + 0.15*M_i^1.5/sum(M^1.5) + 0.15*Rcum_i/sum(Rcum)).
- прогнал\TEST2_marketing.Z01: max cumulative-counter error 0.351396; rounded vector equals native: True; fixed15% current-only alternative max error 0.351396; feasible unrounded D interval [5761.774751404421, 5764.705882352941].
- прогнал\TEST2_marketing2.Z02: max cumulative-counter error 0.351396; rounded vector equals native: True; fixed15% current-only alternative max error 0.351396; feasible unrounded D interval [5761.774751404421, 5764.705882352941].
- прогнал\TEST2_niokr.Z01: max cumulative-counter error 0.643607; rounded vector equals native: False; fixed15% current-only alternative max error 29.328314; feasible unrounded D interval [7951.452179151694, 7952.262985918767].
- прогнал\TEST2_niokr2.Z02: max cumulative-counter error 0.453638; rounded vector equals native: True; fixed15% current-only alternative max error 17.710273; feasible unrounded D interval [9481.66985138712, 9483.469586212479].
- прогнал\TEST2_niokr2_50price.Z02: max cumulative-counter error 0.446313; rounded vector equals native: True; fixed15% current-only alternative max error 11.865137; feasible unrounded D interval [6670.726930714759, 6671.672497853934].
- прогнал\TEST2_niokr2_70price.Z02: max cumulative-counter error 0.271446; rounded vector equals native: True; fixed15% current-only alternative max error 8.250188; feasible unrounded D interval [4483.603346873854, 4488.134817704006].
Marketing exponent fitted from firm orders: 1.502062616; training RMSE 0.186653; leave-one-firm-out RMSE 0.335963. The exponent result establishes distribution/share shape, NOT aggregate logarithmic marketing law.
R&D allocation is affine in cumulative R&D; fitted slopes/held-firm errors are in JSON. Current and cumulative vectors here are nearly affine-collinear, so a freely fitted slope alone cannot identify the lifetime counter. However the native header independently fixes the R&D weight at15%: cumulative normalization yields sub-unit errors, whereas fixed15% current-only normalization misses 8.25 to29.33 orders. For p1, a latent pre-rounding market total between7951.452 and7952.263 makes every firm round correctly, while summed displayed firm orders are7953. This is compatible with ordinary per-firm rounding rather than a share-law failure.

## Marketing aggregate and period memory
- прогнал\TEST2_1.Z01: sumM=8401, D=3360.
- прогнал\TEST2_big.Z01: sumM=8400, D=3360.
- прогнал\TEST2_marketing.Z01: sumM=63351, D=5763.
- прогнал\TEST2_small.Z01: sumM=7770, D=3253.
p1 and p2 marketing repeat the exact complete order vector despite changed production (525 to524), retained earnings/loans and cumulative R&D. Therefore no detectable marketing memory for this repeated-vector trajectory, and demand is not capacity/production-limited. This does NOT prove no memory under a change or stoppage of marketing.
Near-baseline controls and one large marketing sum are too few independent points to identify log offset/saturation or prove sum-only dependence. Offsets 0/1000/8400/50000 fitted on endpoint sums, evaluated on remaining sums in JSON; same-sum different marketing-distribution tests are absent except the negligible +/-1 control. No new runs are proposed.

## Reproduction
Run: `python "C:\Users\serge.DESKTOP-FQG7BEU\Downloads\mecom\data\calibration\research\test2-controlled-rnd-analysis.py"`
Every fit, held-out prediction/residual, full numerical state grouping and exact hash audit is saved in the JSON. Baseline interpolation is intentionally a fixed observed table, not a re-fit of the parent agent’s pure-price work.

## Quality-adjusted prices before applying price curve
Each p1 model is fitted ONLY to uniform30 R&D, then evaluated on the exact mixed-price p1 sibling. Each p2 model is fitted ONLY to price30, then evaluated on price50 and70 siblings. The models use mean(P_i/Q_i); league scalar instead sets common Q. Current positive excess=max(R_i-420,0); signed excess=R_i-420 with Q floor0.01; sqrt uses sqrt(positive excess); cumulative power uses (Rcum_i/[420*(period+1)])^k.

| Curve | Quality model | p1 train error | Held mixed p1 error | Held p2 price50 error | Held p2 price70 error |
|---|---|---:|---:|---:|---:|
| observed_native_loglog | league_scalar | 0.000 | -1219.124 | -608.396 | 29.607 |
| observed_native_loglog | firm_positive_linear_excess | 0.000 | 2014.357 | -1600.788 | -709.556 |
| observed_native_loglog | firm_signed_linear_excess | -2958.900 | -1824.071 | -3467.964 | -2305.920 |
| observed_native_loglog | firm_sqrt_positive_excess | 0.000 | 1687.147 | -1665.290 | -757.599 |
| observed_native_loglog | firm_cumulative_power | -3264.841 | -1912.988 | -3835.414 | -2805.317 |
| fixed_engine_kinked | league_scalar | 0.000 | -1146.101 | -528.736 | 128.447 |
| fixed_engine_kinked | firm_positive_linear_excess | 0.000 | 2091.600 | -1633.918 | -701.834 |
| fixed_engine_kinked | firm_signed_linear_excess | -2989.342 | -1824.735 | -3454.584 | -2309.305 |
| fixed_engine_kinked | firm_sqrt_positive_excess | 0.000 | 1791.084 | -1696.139 | -748.578 |
| fixed_engine_kinked | firm_cumulative_power | -3284.812 | -1911.071 | -3832.868 | -2803.629 |
Quality models are hypotheses, not identified rules. Fits are constrained to nonnegative k. The fixed-engine curve is the unchanged 60850/P^0.85 below39.6, 1668820/P^1.75 above39.6; no pure-price re-fit. Both curves need extrapolation below native baseline price20. Per-period fitted k does not provide a history update law.
Normalization audit: {'N': 8, 'perFirmCurrentBaseline': 420, 'leagueCurrentBaseline': 3360, 'p1CurrentExcess': 61711.0, 'p2CurrentExcess': 61717.0, 'p1CumulativeExcessVsPeriodBaseline': 61711.0, 'p2CumulativeExcessVsPeriodBaseline': 123428.0, 'zeroCurrentContributionForFirm1P1': -420, 'caveat': 'No controlled zero-R&D league or cross-N R&D trajectory: sum vs average normalization and effect of a full zero-R&D market cannot be identified.'}
