# TEST2 controlled heterogeneous-price analysis

Corpus: 46 records; strict pure-price controls: 34; primary mixture observations: 20; secondary one-changed observations: 7.

Strict control: period1, N8, production525 each, marketing1050 each, R&D420 each, cumulative840 each. Full grouping also checks capex and inferred R&D-before. Original labels are not used to define mixtures. Hidden macro/prior state remains unobserved.

## Primary leave-entire-family-out comparison

| Candidate | heldout MAE | heldout RMSE | max error | MAPE |
|---|---:|---:|---:|---:|
| existing arithmetic mean | 104.74 | 134.03 | 309.64 | 4.53% |
| variance | 115.61 | 136.48 | 284.83 | 4.77% |
| variance_mean_hinge | 42.29 | 55.18 | 140.82 | 1.74% |
| quadratic_hinge_moment | 102.59 | 129.36 | 294.08 | 4.29% |
| quadratic_hinge_moment_mean | 129.95 | 202.03 | 480.26 | 5.62% |
| variance_mean_quadratic | 127.40 | 192.66 | 529.83 | 5.36% |

## Conclusions and limitations
- Best exploratory candidate: D0(meanP) + V*(-0.292882 + 0.121469*max(meanP-40,0)); coefficients shown are the all-primary-fit summary, while reported LOFO errors use separately refitted training folds. Pure uniform predictions remain unchanged.
- Primary20 family-heldout MAE104.74 ->42.29; combined27 out-of-family MAE87.33 ->39.35. This is not merely a base-curve coefficient retune.
- IMPORTANT: direct narrow-family transfer is asymmetric: training20/60 predicts30/50 MAE43.60 versus baseline62.17; training30/50 predicts20/60 MAE256.15 versus baseline145.67. Therefore the correction is not established as universal; the broader training families matter.
- The singleton40/60 and broad-price heldouts retain errors140.82 and115.95 respectively. Variance alone and higher-order flexible dispersion features fail to improve the primary holdouts.
- A separable R&D multiplier is falsified by the p2 controlled price-only triple: implied multipliers2.807,3.758,4.554 at prices30,50,70. Fit joint exponent0.828 at30/50, hold70 predicts4575.51 versus4486 (+2.00%); reverse fit30/70 holds50 at6597.05 versus6671.
- Independent p1 mixed-R&D target5897: full existing formula3579.12; joint additive candidate5666.02 (-3.92%). The R&D amplitude for that state is anchored on its separate uniform30 control, not fitted on the heldout mixed target. No stock-to-amplitude law is claimed.
- Treat these as identified interaction directions plus a compact improved approximation, not an exact reconstruction or sufficient basis alone for engine replacement.

All candidates use D0(mean price) plus additive fitted features; no path identifier enters a predictor. V = mean((P-meanP)^2), H = mean(max(P-40,0)^2)-max(meanP-40,0)^2. The piecewise-quadratic moment is grounded in independent native uniform-price bend near40. Features: variance[V]; variance_mean_hinge[V,V*max(meanP-40,0)]; quadratic_hinge_moment[V,H]; quadratic_hinge_moment_mean[V,H,V*max(meanP-40,0)]; variance_mean_quadratic[V,V*(meanP-40),V*(meanP-40)^2]. Existing base coefficients are not refitted.

Candidate selection on LOFO is exploratory; each individual heldout prediction is out-of-family, but reporting the winning candidate is not a fresh untouched test. Broad and40/60 are singleton families; small fold counts increase uncertainty.

## Detailed family holdouts

### variance
Full-mixture coefficients: [0.12955872228858933]
- Hold out 20_60_composition: n=7, MAE=153.77, coefficients=[0.14175725628650884]
- Hold out 30_50_composition: n=7, MAE=68.38, coefficients=[0.15138697194297213]
- Hold out 40_60_half: n=1, MAE=217.60, coefficients=[0.11347514273647402]
- Hold out broad_multilevel: n=1, MAE=209.20, coefficients=[0.032190105315229395]
- Hold out fixed_mean30_spread: n=4, MAE=82.58, coefficients=[0.19843450029163445]
- Entire secondary one-changed-price family held out: MAE=54.68; not training inputs.

### variance_mean_hinge
Full-mixture coefficients: [-0.2928820471754203, 0.12146889057696433]
- Hold out 20_60_composition: n=7, MAE=29.11, coefficients=[-0.3457785749053921, 0.12368423594925465]
- Hold out 30_50_composition: n=7, MAE=43.44, coefficients=[-0.2645745180259689, 0.11744356061012058]
- Hold out 40_60_half: n=1, MAE=140.82, coefficients=[-0.28718642986617127, 0.11683815637783271]
- Hold out broad_multilevel: n=1, MAE=115.95, coefficients=[-0.2744055797941667, 0.13167319339544414]
- Hold out fixed_mean30_spread: n=4, MAE=20.29, coefficients=[-0.3227254026859183, 0.1253480136190856]
- Entire secondary one-changed-price family held out: MAE=30.93; not training inputs.

### quadratic_hinge_moment
Full-mixture coefficients: [-0.5344908483365384, 1.2258772601146444]
- Hold out 20_60_composition: n=7, MAE=115.89, coefficients=[-0.40434475245972556, 0.9348845596609618]
- Hold out 30_50_composition: n=7, MAE=58.85, coefficients=[-0.49435561172505, 1.189101805316311]
- Hold out 40_60_half: n=1, MAE=164.64, coefficients=[-0.5038486873266796, 1.1468439606643601]
- Hold out broad_multilevel: n=1, MAE=294.08, coefficients=[-0.7227044149156775, 1.8260064647723346]
- Hold out fixed_mean30_spread: n=4, MAE=92.45, coefficients=[-0.8780443337172111, 1.7156660178179393]
- Entire secondary one-changed-price family held out: MAE=79.74; not training inputs.

### quadratic_hinge_moment_mean
Full-mixture coefficients: [-0.1952904709616747, -0.2732725931189925, 0.13597197269119357]
- Hold out 20_60_composition: n=7, MAE=284.67, coefficients=[0.04818738442266879, -2.688463519513656, 0.42214570526492656]
- Hold out 30_50_composition: n=7, MAE=42.64, coefficients=[-0.17994804575347773, -0.23911379076873976, 0.13021233769269155]
- Hold out 40_60_half: n=1, MAE=144.45, coefficients=[-0.1748402877734263, -0.31417689602547233, 0.13339279170924478]
- Hold out broad_multilevel: n=1, MAE=125.08, coefficients=[-0.2906065120663567, 0.049440097661508337, 0.12985300320580856]
- Hold out fixed_mean30_spread: n=4, MAE=9.57, coefficients=[-0.19052483558816807, -0.28419003007458077, 0.13643871456615234]
- Entire secondary one-changed-price family held out: MAE=42.43; not training inputs.

### variance_mean_quadratic
Full-mixture coefficients: [-0.16991377671716235, 0.06082384649919957, 0.004907174700144394]
- Hold out 20_60_composition: n=7, MAE=277.30, coefficients=[-1.0062107668888196, 0.10757832708784028, 0.018619966996309887]
- Hold out 30_50_composition: n=7, MAE=45.50, coefficients=[-0.1339491496329953, 0.059366977857770696, 0.004548277390711257]
- Hold out 40_60_half: n=1, MAE=140.28, coefficients=[-0.16506457295891772, 0.058631458286722817, 0.004653598217176377]
- Hold out broad_multilevel: n=1, MAE=45.69, coefficients=[-0.14505129893686852, 0.06290595287795187, 0.004835058146037306]
- Hold out fixed_mean30_spread: n=4, MAE=25.59, coefficients=[-0.17973730408712163, 0.06424845203018738, 0.004692034465987401]
- Entire secondary one-changed-price family held out: MAE=26.20; not training inputs.

## Recommended explanatory candidate (not exact recovered mechanism)
{
  "formula": "D0(meanP) + V*(a+b*max(meanP-40,0)) + D0(meanP)*E*(meanP/30)^gamma",
  "a": -0.2928820471754203,
  "b": 0.12146889057696433,
  "gamma": 0.8282398016308068,
  "E_definition": "Q_native(uniform30,same_RD_state)/D0(30)-1; zero for no-excess baseline. Stock-to-E law delegated, not inferred here.",
  "limitations": "Price-R&D covariance not identifiable; mixture-R&D validation is one independent p1 family; higher degree terms worsened primary family holdouts."
}

## Direct training-family transfers
[
  {
    "train_family": "20_60_composition",
    "test_family": "30_50_composition",
    "coefficients": [
      -0.2525076276144303,
      0.12246411295962763
    ],
    "candidate": {
      "n": 7,
      "mae": 43.595104488596725,
      "rmse": 50.41535899070422,
      "max_abs": 81.78680739290212,
      "mape_pct": 1.6921626703478592
    },
    "baseline": {
      "n": 7,
      "mae": 62.16667532987871,
      "rmse": 69.46258157920332,
      "max_abs": 107.0375701543453,
      "mape_pct": 2.4600541513612115
    },
    "rows": [
      {
        "path": "прогнал\\TEST2_2_6.Z01",
        "family": "30_50_composition",
        "prices": [
          30.0,
          30.0,
          50.0,
          50.0,
          50.0,
          50.0,
          50.0,
          50.0
        ],
        "mean": 45.0,
        "variance": 75.0,
        "hinge40_jensen": 50.0,
        "actual": 2176.0,
        "prediction": 2161.4438880123853,
        "error": -14.556111987614713
      },
      {
        "path": "прогнал\\TEST2_3_5.Z01",
        "family": "30_50_composition",
        "prices": [
          30.0,
          30.0,
          30.0,
          50.0,
          50.0,
          50.0,
          50.0,
          50.0
        ],
        "mean": 42.5,
        "variance": 93.75,
        "hinge40_jensen": 56.25,
        "actual": 2345.0,
        "prediction": 2364.0349741082205,
        "error": 19.034974108220467
      },
      {
        "path": "прогнал\\TEST2_4_4.Z01",
        "family": "30_50_composition",
        "prices": [
          30.0,
          30.0,
          30.0,
          30.0,
          50.0,
          50.0,
          50.0,
          50.0
        ],
        "mean": 40.0,
        "variance": 100.0,
        "hinge40_jensen": 50.0,
        "actual": 2516.0,
        "prediction": 2597.786807392902,
        "error": 81.78680739290212
      },
      {
        "path": "прогнал\\TEST2_5_3.Z01",
        "family": "30_50_composition",
        "prices": [
          30.0,
          30.0,
          30.0,
          30.0,
          30.0,
          50.0,
          50.0,
          50.0
        ],
        "mean": 37.5,
        "variance": 93.75,
        "hinge40_jensen": 37.5,
        "actual": 2693.0,
        "prediction": 2771.019752676338,
        "error": 78.01975267633816
      },
      {
        "path": "прогнал\\TEST2_6_2.Z01",
        "family": "30_50_composition",
        "prices": [
          30.0,
          30.0,
          30.0,
          30.0,
          30.0,
          30.0,
          50.0,
          50.0
        ],
        "mean": 35.0,
        "variance": 75.0,
        "hinge40_jensen": 25.0,
        "actual": 2894.0,
        "prediction": 2944.5470065121744,
        "error": 50.54700651217445
      },
      {
        "path": "прогнал\\TEST2_all_50_one_30.Z01",
        "family": "30_50_composition",
        "prices": [
          30.0,
          50.0,
          50.0,
          50.0,
          50.0,
          50.0,
          50.0,
          50.0
        ],
        "mean": 47.5,
        "variance": 43.75,
        "hinge40_jensen": 31.25,
        "actual": 1999.0,
        "prediction": 1970.8969035359787,
        "error": -28.10309646402129
      },
      {
        "path": "прогнал\\TEST2_one_50.Z01",
        "family": "30_50_composition",
        "prices": [
          50.0,
          30.0,
          30.0,
          30.0,
          30.0,
          30.0,
          30.0,
          30.0
        ],
        "mean": 32.5,
        "variance": 43.75,
        "hinge40_jensen": 12.5,
        "actual": 3112.0,
        "prediction": 3145.117982278906,
        "error": 33.117982278905856
      }
    ]
  },
  {
    "train_family": "30_50_composition",
    "test_family": "20_60_composition",
    "coefficients": [
      -1.0249998617481675,
      0.3203651790977155
    ],
    "candidate": {
      "n": 7,
      "mae": 256.1488478412663,
      "rmse": 277.438264550465,
      "max_abs": 390.6512905166437,
      "mape_pct": 10.740825507266178
    },
    "baseline": {
      "n": 7,
      "mae": 145.6709790061814,
      "rmse": 172.8352088955211,
      "max_abs": 309.63731133173087,
      "mape_pct": 6.632750133586889
    },
    "rows": [
      {
        "path": "Новая папка\\TEST2_2_6.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          20.0,
          60.0,
          60.0,
          60.0,
          60.0,
          60.0,
          60.0
        ],
        "mean": 50.0,
        "variance": 300.0,
        "hinge40_jensen": 200.0,
        "actual": 2038.0,
        "prediction": 2428.6512905166437,
        "error": 390.6512905166437
      },
      {
        "path": "Новая папка\\TEST2_3_5.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          20.0,
          20.0,
          60.0,
          60.0,
          60.0,
          60.0,
          60.0
        ],
        "mean": 45.0,
        "variance": 375.0,
        "hinge40_jensen": 225.0,
        "actual": 2270.0,
        "prediction": 2350.767680376261,
        "error": 80.76768037626107
      },
      {
        "path": "Новая папка\\TEST2_4_4.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          20.0,
          20.0,
          20.0,
          60.0,
          60.0,
          60.0,
          60.0
        ],
        "mean": 40.0,
        "variance": 400.0,
        "hinge40_jensen": 200.0,
        "actual": 2536.0,
        "prediction": 2213.0376254550783,
        "error": -322.96237454492166
      },
      {
        "path": "Новая папка\\TEST2_5_3.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          20.0,
          20.0,
          20.0,
          20.0,
          60.0,
          60.0,
          60.0
        ],
        "mean": 35.0,
        "variance": 375.0,
        "hinge40_jensen": 150.0,
        "actual": 2866.0,
        "prediction": 2579.110130427694,
        "error": -286.889869572306
      },
      {
        "path": "Новая папка\\TEST2_6_2.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          20.0,
          20.0,
          20.0,
          20.0,
          20.0,
          60.0,
          60.0
        ],
        "mean": 30.0,
        "variance": 300.0,
        "hinge40_jensen": 100.0,
        "actual": 3298.0,
        "prediction": 3070.872407570857,
        "error": -227.12759242914308
      },
      {
        "path": "прогнал\\TEST2_1_7.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          60.0,
          60.0,
          60.0,
          60.0,
          60.0,
          60.0,
          60.0
        ],
        "mean": 55.0,
        "variance": 175.0,
        "hinge40_jensen": 125.0,
        "actual": 1812.0,
        "prediction": 2163.946307993843,
        "error": 351.9463079938432
      },
      {
        "path": "прогнал\\TEST2_7_1.Z01",
        "family": "20_60_composition",
        "prices": [
          20.0,
          20.0,
          20.0,
          20.0,
          20.0,
          20.0,
          20.0,
          60.0
        ],
        "mean": 25.0,
        "variance": 175.0,
        "hinge40_jensen": 50.0,
        "actual": 3898.0,
        "prediction": 3765.3031805442547,
        "error": -132.6968194557453
      }
    ]
  }
]

## Combined 27 heterogeneous observations
{
  "existing": {
    "n": 27,
    "mae": 87.32601471379618,
    "rmse": 117.18848013490243,
    "max_abs": 309.63731133173087,
    "mape_pct": 3.6844822829152752
  },
  "candidate_out_of_family": {
    "n": 27,
    "mae": 39.34500360585897,
    "rmse": 52.99515316968249,
    "max_abs": 140.82477486083712,
    "mape_pct": 1.5688628044046231
  }
}

The 20 primary rows are LOFO; seven secondary rows use a model trained on all20 primary mixtures. Thus none of27 target rows are used in their own prediction fit, but exploratory feature selection still uses LOFO. Native per-firm rounding explains at most a few orders, not the100+ residuals.

## Price x R&D controlled p2 tests
{
  "anchor_price30_amplitude": 1.806676994862828,
  "quality_power_fit30_50": 0.8282398016308068,
  "fit_prices": [
    30,
    50
  ],
  "heldout_price70": {
    "path": "прогнал\\TEST2_niokr2_70price.Z02",
    "price": 70.0,
    "actual": 4486.0,
    "anchored_separable": 2764.905935561455,
    "additive_quality_power": 4575.505886030604,
    "measured_multiplier": 4.5537726390673425,
    "full_current_engine": {
      "prediction": 3033.6040698556335,
      "rnd_stock_sum": 92831.89776001449,
      "rnd_multiplier": 3.0794345098243245,
      "marketing_multiplier": 1.0
    }
  },
  "reverse_fit30_70_power": 0.7984447295139738,
  "heldout_price50_reverse_prediction": 6597.047514613297,
  "rows": [
    {
      "path": "прогнал\\TEST2_niokr2.Z02",
      "price": 30.0,
      "actual": 9482.0,
      "anchored_separable": 9482.0,
      "additive_quality_power": 9482.0,
      "measured_multiplier": 2.806676994862828,
      "full_current_engine": {
        "prediction": 10403.476451190747,
        "rnd_stock_sum": 92831.89776001449,
        "rnd_multiplier": 3.0794345098243245,
        "marketing_multiplier": 1.0
      }
    },
    {
      "path": "прогнал\\TEST2_niokr2_50price.Z02",
      "price": 50.0,
      "actual": 6671.0,
      "anchored_separable": 4982.008030762827,
      "additive_quality_power": 6671.0,
      "measured_multiplier": 3.7581919011606,
      "full_current_engine": {
        "prediction": 5466.1678156174075,
        "rnd_stock_sum": 92831.89776001449,
        "rnd_multiplier": 3.0794345098243245,
        "marketing_multiplier": 1.0
      }
    },
    {
      "path": "прогнал\\TEST2_niokr2_70price.Z02",
      "price": 70.0,
      "actual": 4486.0,
      "anchored_separable": 2764.905935561455,
      "additive_quality_power": 4575.505886030604,
      "measured_multiplier": 4.5537726390673425,
      "full_current_engine": {
        "prediction": 3033.6040698556335,
        "rnd_stock_sum": 92831.89776001449,
        "rnd_multiplier": 3.0794345098243245,
        "marketing_multiplier": 1.0
      }
    }
  ],
  "interpretation": "Positive quality amplitude couples to price: D(P,E)=D0(P)[1+E(P/30)^gamma]. E is learned at price30, not inferred stock law. Three observations cannot uniquely identify structural law. Per-firm cumulative-before and all current nonprice inputs match across p2 price30/50/70."
}

## Independent p1 joint-price/R&D holdout
{
  "uniform_anchor_path": "прогнал\\TEST2_niokr.Z01",
  "heldout_path": "прогнал\\TEST2_niokr_dif_prices.Z01",
  "actual": 5897.0,
  "amplitude": 1.3540921894267108,
  "mean": 55.0,
  "base_separable_prediction": 3536.7002710800857,
  "quality_mean_price_prediction": 4863.219857750336,
  "mixture_plus_quality_prediction": 5666.024296276835,
  "note": "The p1 heterogeneous prices align positively with R&D; no permutation control exists, so mean-price coupling and covariance cannot be distinguished. Uniform and hetero p1 have identical nonprice decisions/history.",
  "full_current_engine": {
    "prediction": 3579.1182955893987,
    "rnd_stock_sum": 61711.0,
    "rnd_multiplier": 2.3823264,
    "marketing_multiplier": 1.0
  },
  "mixed_price_corrected_separable": 5426.575929452411
}

No exact native mechanism is established. Price-dependent R&D response is independently demonstrated; a positive price-R&D covariance coefficient is not identified by these tests. No mixed-price p2 observation exists in the corpus.

## Artifacts
JSON contains all grouping signatures, fold training membership, coefficients, predictions, and errors. Reproduce with this adjacent Python script. Repo and native originals are read-only.
