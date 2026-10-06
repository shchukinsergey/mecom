#!/usr/bin/env python3
"""
Распределение заказов МЭКОМ — восстановленная модель.

доля_i = w_m·m̂_i + w_p·p̂_i + w_n·n̂_i        (w = 0.15 / 0.70 / 0.15, из сценария)

  m̂_i = M_i^1.5 / Σ M^1.5                    маркетинг, без накопления
  n̂_i = N_накопл,i / Σ N_накопл               НИОКР, накапливается за все периоды
  p̂_i = x_i / Σ x,   x_i = f(P_i) − λ·f̄      цена; λ = 0.2076, f̄ — среднее f по лиге

Ключевая особенность: у ценового индекса вычитается доля среднего по лиге.
Из-за этого x может быть отрицательным — дорогая фирма не просто мало получает,
а уменьшает общую привлекательность рынка.

Проверено на 23 партиях: расхождение нигде не превышает 5 заказов.
"""

import math

import numpy as np

LAMBDA = 0.2076

# Множители масштаба лиги (мекомspec 2.3) — сверху на объём рынка от цены.
RND_EXCESS_BASE = 840
RND_EXCESS_SLOPE = 0.0000224

MKTG_LN_A = -2.4507
MKTG_LN_B = 0.3798
MKTG_LN_OFFSET = 879
MKTG_LN_NORM = 9279

# f(P) — ядро ценовой привлекательности, восстановлено из данных.
# В диапазоне 20..40 хорошо описывается как (30/P)^2.7, выше — круче,
# около P≈74 проходит через ноль.
F_TABLE = {
    20: 2.9643, 25: 1.6103, 30: 1.0000, 35: 0.6707, 40: 0.4843,
    45: 0.3094, 50: 0.2007, 55: 0.1360, 60: 0.1022, 70: 0.0369,
    100: -0.0326,
}


def f_price(P):
    """Интерполяция ядра между измеренными точками."""
    xs = np.array(sorted(F_TABLE))
    ys = np.array([F_TABLE[x] for x in xs])
    return np.interp(P, xs, ys)


def shares(prices, marketing, rnd_acc, weights=(0.15, 0.70, 0.15)):
    """Доли рынка (в штуках) по фирмам."""
    w_m, w_p, w_n = weights
    P = np.asarray(prices, float)
    M = np.asarray(marketing, float)
    N = np.asarray(rnd_acc, float)

    mm = M ** 1.5
    m_hat = mm / mm.sum() if mm.sum() > 0 else np.full(len(P), 1 / len(P))
    n_hat = N / N.sum()

    f = f_price(P)
    x = f - LAMBDA * f.mean()
    p_hat = x / x.sum()

    return w_m * m_hat + w_p * p_hat + w_n * n_hat


def market_size_uniform(P):
    """Размер рынка, когда у всех фирм одна цена: заказов НА ФИРМУ (не итог по
    отрасли!) — историческая калибровка «×N», валидная в основном при N≈8, где
    и была снята (см. известный баг с зависимостью от N в demand.ts). Для
    итога по отрасли и для новых множителей НИОКР/маркетинга используйте
    industry_demand().

    Два степенных режима с переломом около 40 (в TS-версии откалибровано как
    39.6 — небольшое расхождение точки перелома между реализациями, отдельный
    TODO синхронизации, не связанный с множителями ниже).
    Максимальное отклонение от факта на 8 замерах — 0.56%.
    """
    return 7607 / P ** 0.85 if P <= 40 else 208361 / P ** 1.75


def industry_demand(P):
    """Итог по отрасли (НЕ «на фирму»!) — N-инвариантный аналог industryDemand()
    из demand.ts. Коэффициенты 60850/1668820, точка перелома 39.6 (мекомspec 2.2)."""
    return 60850 / P ** 0.85 if P <= 39.6 else 1668820 / P ** 1.75


def rnd_expansion_multiplier(rnd_accum):
    """Множитель расширения категории от избытка накопленного НИОКР ЛИГИ
    (сумма, не среднее) над базой 840/фирму (мекомspec 2.3)."""
    excess_sum = float((np.asarray(rnd_accum, float) - RND_EXCESS_BASE).sum())
    return 1 + RND_EXCESS_SLOPE * excess_sum


def marketing_expansion_multiplier(marketing):
    """Множитель расширения категории от ΣM за ТЕКУЩИЙ период по лиге
    (не накапливается; важна только сумма, не распределение). Мекомspec 2.3."""
    sigma_m = float(np.clip(np.asarray(marketing, float), 0, None).sum())

    def core(x):
        return MKTG_LN_A + MKTG_LN_B * math.log(x)

    return core(sigma_m + MKTG_LN_OFFSET) / core(MKTG_LN_NORM)


def total_demand_uniform(P, rnd_accum, marketing):
    """Полный объём рынка для ОДНОРОДНОЙ по цене лиги:
    D = D_цена(P̄) · множитель_НИОКР · множитель_маркетинга (мекомspec 2.3).
    Для неоднородной лиги D_цена(P̄) по-прежнему приближение (мекомspec 2.2)."""
    return (industry_demand(P)
            * rnd_expansion_multiplier(rnd_accum)
            * marketing_expansion_multiplier(marketing))


def orders(total_demand, prices, marketing, rnd_acc):
    """Заказы по фирмам. Для однородной по цене лиги total_demand теперь можно
    получить через total_demand_uniform(P, rnd_accum, marketing) (мекомspec 2.3);
    для неоднородной лиги D_цена(P̄) по-прежнему не выведена вне диапазона
    P̄≤40 (мекомspec 2.2)."""
    return total_demand * shares(prices, marketing, rnd_acc)
