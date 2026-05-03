export class Indicators {

  static calculateEMA(candles: any[], period: number): number {
    if (candles.length === 0) return 0;
    const actualPeriod = candles.length < period ? candles.length : period;
    const k = 2 / (actualPeriod + 1);
    let ema = candles.slice(0, actualPeriod)
      .reduce((acc, val) => acc + val.close, 0) / actualPeriod;
    for (let i = actualPeriod; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
    }
    return ema;
  }

  // ✅ RSI con suavizado de Wilder (el estándar real)
  static calculateRSI(candles: any[], period: number = 14): number {
    if (candles.length <= period + 1) return 50;

    // Fase 1: media simple de los primeros `period` movimientos (seed)
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Fase 2: suavizado de Wilder sobre el resto de velas
    for (let i = period + 1; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // ✅ MACD — ahora existe
  static calculateMACD(candles: any[]): {
    macd: number;
    signal: number;
    histogram: number
  } {
    if (candles.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const ema12 = this.calculateEMA(candles, 12);
    const ema26 = this.calculateEMA(candles, 26);
    const macd  = ema12 - ema26;

    // Línea de señal: EMA de 9 periodos sobre los valores MACD históricos
    const macdValues = [];
    for (let i = 26; i <= candles.length; i++) {
      const slice = candles.slice(0, i);
      const e12 = this.calculateEMA(slice, 12);
      const e26 = this.calculateEMA(slice, 26);
      macdValues.push({ close: e12 - e26 });
    }
    const signal    = this.calculateEMA(macdValues, 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }
}