export class Indicators {
  /**
   * Calcula la Media Móvil Exponencial (EMA)
   */
 static calculateEMA(candles: any[], period: number): number {
    if (candles.length === 0) return 0;

    // Si hay menos velas que el periodo pedido, ajustamos el periodo a lo que hay
    const actualPeriod = candles.length < period ? candles.length : period;

    const k = 2 / (actualPeriod + 1);
    let ema = candles.slice(0, actualPeriod).reduce((acc, val) => acc + val.close, 0) / actualPeriod;

    for (let i = actualPeriod; i < candles.length; i++) {
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
      else losses += Math.abs(diff);
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }
}