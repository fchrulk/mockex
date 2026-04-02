"""Server-side technical indicator calculations for signal engine."""


def calc_sma(closes: list[float], period: int) -> list[float | None]:
    """Simple Moving Average."""
    result = []
    for i in range(len(closes)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(closes[i - period + 1:i + 1]) / period)
    return result


def calc_ema(closes: list[float], period: int) -> list[float | None]:
    """Exponential Moving Average."""
    result: list[float | None] = [None] * len(closes)
    if len(closes) < period:
        return result
    ema = sum(closes[:period]) / period
    result[period - 1] = ema
    k = 2 / (period + 1)
    for i in range(period, len(closes)):
        ema = closes[i] * k + ema * (1 - k)
        result[i] = ema
    return result


def calc_rsi(closes: list[float], period: int = 14) -> list[float | None]:
    """Relative Strength Index."""
    result: list[float | None] = [None] * len(closes)
    if len(closes) < period + 1:
        return result

    gain_sum = 0.0
    loss_sum = 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gain_sum += diff
        else:
            loss_sum -= diff

    avg_gain = gain_sum / period
    avg_loss = loss_sum / period
    result[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    for i in range(period + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gain = diff if diff > 0 else 0
        loss = -diff if diff < 0 else 0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        result[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    return result


def calc_macd(
    closes: list[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """MACD: returns (macd_line, signal_line, histogram)."""
    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)

    macd_line: list[float | None] = []
    for ef, es in zip(ema_fast, ema_slow):
        if ef is not None and es is not None:
            macd_line.append(ef - es)
        else:
            macd_line.append(None)

    # EMA of macd_line values
    macd_vals = [v for v in macd_line if v is not None]
    signal_line: list[float | None] = [None] * len(macd_line)
    if len(macd_vals) >= signal:
        ema = sum(macd_vals[:signal]) / signal
        k = 2 / (signal + 1)
        first_valid = next(i for i, v in enumerate(macd_line) if v is not None)
        idx = first_valid + signal - 1
        if idx < len(signal_line):
            signal_line[idx] = ema
        for j in range(first_valid + signal, len(macd_line)):
            if macd_line[j] is not None:
                ema = macd_line[j] * k + ema * (1 - k)
                signal_line[j] = ema

    histogram: list[float | None] = []
    for m, s in zip(macd_line, signal_line):
        if m is not None and s is not None:
            histogram.append(m - s)
        else:
            histogram.append(None)

    return macd_line, signal_line, histogram


def calc_bollinger(
    closes: list[float],
    period: int = 20,
    stddev: float = 2.0,
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    """Bollinger Bands: returns (upper, middle, lower)."""
    import math
    middle = calc_sma(closes, period)
    upper: list[float | None] = []
    lower: list[float | None] = []

    for i in range(len(closes)):
        if middle[i] is None:
            upper.append(None)
            lower.append(None)
            continue
        variance = sum((closes[j] - middle[i]) ** 2 for j in range(i - period + 1, i + 1)) / period
        sd = math.sqrt(variance)
        upper.append(middle[i] + stddev * sd)
        lower.append(middle[i] - stddev * sd)

    return upper, middle, lower
