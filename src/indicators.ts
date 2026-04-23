import { Candle } from './coinbase';
import { config } from './config';

export interface TechnicalSignal {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  ema: number;
  currentPrice: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;        // -100 a +100
  confidence: number;  // 0-100
  reasons: string[];
}

// EMA (Exponential Moving Average)
function ema(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Primer valor = SMA
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);

  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    result.push(prev);
  }

  return result;
}

// RSI (Relative Strength Index)
function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  // Primer promedio
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilders smoothing
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// MACD
function macd(prices: number[], fast: number, slow: number, signal: number): {
  macd: number; signal: number; histogram: number
} {
  const emaFast = ema(prices, fast);
  const emaSlow = ema(prices, slow);

  if (emaFast.length === 0 || emaSlow.length === 0) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Alinear arrays por longitud
  const diff = emaFast.length - emaSlow.length;
  const alignedFast = diff > 0 ? emaFast.slice(diff) : emaFast;
  const alignedSlow = diff < 0 ? emaSlow.slice(-diff) : emaSlow;

  const macdLine = alignedFast.map((v, i) => v - alignedSlow[i]);
  const signalLine = ema(macdLine, signal);

  if (signalLine.length === 0) return { macd: 0, signal: 0, histogram: 0 };

  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];

  return {
    macd: lastMacd,
    signal: lastSignal,
    histogram: lastMacd - lastSignal,
  };
}

export function analyzeTechnicals(candles: Candle[]): TechnicalSignal {
  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  const rsiValue = rsi(closes, config.rsiPeriod);
  const macdResult = macd(closes, config.macdFast, config.macdSlow, config.macdSignal);
  const emaValues = ema(closes, config.emaPeriod);
  const emaValue = emaValues[emaValues.length - 1] || currentPrice;

  const reasons: string[] = [];
  let score = 0;

  // --- RSI ---
  if (rsiValue < config.rsiOversold) {
    const strength = Math.min((config.rsiOversold - rsiValue) / config.rsiOversold, 1);
    score += 40 * strength;
    reasons.push(`RSI sobrevendido (${rsiValue.toFixed(1)}) → señal BUY`);
  } else if (rsiValue > config.rsiOverbought) {
    const strength = Math.min((rsiValue - config.rsiOverbought) / (100 - config.rsiOverbought), 1);
    score -= 40 * strength;
    reasons.push(`RSI sobrecomprado (${rsiValue.toFixed(1)}) → señal SELL`);
  } else {
    reasons.push(`RSI neutro (${rsiValue.toFixed(1)})`);
  }

  // --- MACD ---
  if (macdResult.histogram > 0 && macdResult.macd > macdResult.signal) {
    const strength = Math.min(Math.abs(macdResult.histogram) / 100, 1);
    score += 30 + strength * 10;
    reasons.push(`MACD cruce alcista (hist: ${macdResult.histogram.toFixed(2)})`);
  } else if (macdResult.histogram < 0 && macdResult.macd < macdResult.signal) {
    const strength = Math.min(Math.abs(macdResult.histogram) / 100, 1);
    score -= 30 + strength * 10;
    reasons.push(`MACD cruce bajista (hist: ${macdResult.histogram.toFixed(2)})`);
  }

  // --- EMA ---
  if (currentPrice > emaValue * 1.001) {
    score += 15;
    reasons.push(`Precio por encima de EMA${config.emaPeriod} → tendencia alcista`);
  } else if (currentPrice < emaValue * 0.999) {
    score -= 15;
    reasons.push(`Precio por debajo de EMA${config.emaPeriod} → tendencia bajista`);
  }

  // Clamp score -100 a +100
  score = Math.max(-100, Math.min(100, score));

  const signal: 'BUY' | 'SELL' | 'HOLD' =
    score >= config.minSignalScore ? 'BUY' :
    score <= -config.minSignalScore ? 'SELL' : 'HOLD';

  const confidence = Math.min(Math.abs(score), 100);

  return {
    rsi: rsiValue,
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    ema: emaValue,
    currentPrice,
    signal,
    score,
    confidence,
    reasons,
  };
}
