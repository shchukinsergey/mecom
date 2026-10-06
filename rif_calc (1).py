#!/usr/bin/env python3
"""
Полный расчёт РИФ (курса акций) МЭКОМ — реконструкция по отчётам.

RIF_i = C1 + C2 + C3 + C4 + C5 + C6, каждое слагаемое округляется отдельно.
Веса w1..w6 задаются сценарием и в базовом периоде дают в сумме 100.
"""


def rnd(x):
    """Округление как в игре (половина вверх)."""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def c_reterne(ret_ern, period, ret_ern_base, w=50):
    """Н.Приб — средняя накопленная прибыль за период к базовой."""
    return rnd(w * ret_ern / (period * ret_ern_base))


def c_dempot(mktg, rnd_spend, carry, others, w=10):
    """ПотСпр — накопленные маркетинг+НИОКР к среднему по лиге, потолок 2w."""
    x = mktg + rnd_spend + carry
    mean = sum(others) / len(others)
    return rnd(min(w * x / mean, 2 * w))


def c_suppot(prod, prod_prev, others, w=10):
    """ПотПр — накопленное производство к среднему по лиге."""
    x = prod + prod_prev
    mean = sum(others) / len(others)
    return rnd(w * x / mean)


def c_eff80(cu, w=10):
    """Эфф80% — отклонение загрузки мощности от 80%.

    Кусочно-линейная подгонка по 23 замерам (все совпадают точно).
    Параметры, вероятно, задаются сценарием, как CUup/CUdown в себестоимости.
    """
    A, s_down, s_up, T, s_far = 9.88, 0.102, 0.136, 30.0, 0.20
    if cu >= 80:
        v = A - s_up * (cu - 80)
    elif cu >= T:
        v = A - s_down * (80 - cu)
    else:
        v = A - s_down * (80 - T) - s_far * (T - cu)
    return rnd(v * w / 10)


def c_mktshr(share, n_firms, w=10):
    """Доля Р — доля рынка (по штукам) к равной доле."""
    return rnd(w * share / (100.0 / n_firms))


def c_growth(share, share_prev, w=10):
    """Рост — доля рынка к своей же доле прошлого периода."""
    return rnd(w * share / share_prev)


def rif(firm, league, weights=(50, 10, 10, 10, 10, 10)):
    w1, w2, w3, w4, w5, w6 = weights
    n = len(league["prod"])
    share = 100.0 * firm["sold"] / sum(league["sold"])
    pot = [m + r + league["carry"] for m, r in zip(league["mktg"], league["rnd"])]
    prods = [p + pp for p, pp in zip(league["prod"], league["prod_prev"])]
    cu = 100.0 * firm["prod"] / firm["capacity"]
    parts = [
        c_reterne(firm["ret_ern"], league["period"], league["ret_ern_base"], w1),
        c_dempot(firm["mktg"], firm["rnd"], league["carry"], pot, w2),
        c_suppot(firm["prod"], firm["prod_prev"], prods, w3),
        c_eff80(cu, w4),
        c_mktshr(share, n, w5),
        c_growth(share, firm["share_prev"], w6),
    ]
    return sum(parts), parts
