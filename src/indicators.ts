export class Indicators {
  /**
   * Calcula la Media Móvil Exponencial (EMA)
   */
  static calculateEMA(candles: any[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;

    const k = 2 / (period + 1);
    // Empezamos con el promedio simple de los primeros periodos como base
    let ema = candles.slice(0, period).reduce((acc, val) => acc + val.close, 0) / period;

    // Aplicamos la fórmula al resto de las velas
    for (let i = period; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
    }
    return ema;
  }

  /**
   * Calcula el RSI (Relative Strength Index)
   */
  static calculateRSI(candles: any[], period: number = 14): number {
    if (candles.length <= period) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses -= Math.abs(diff);
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }
}