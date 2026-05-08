import { Indicators } from "./indicators";
import { config } from "./config";
export class AnalysisEngine {
  constructor(
    private exchange: any,
    private ai: any,
  ) {}

  async getSpecificAnalysis(pair: string) {
    try {
      const candles = await this.exchange.getCandles(pair);
      if (!candles || candles.length < 20) return null;

      const currentPrice = candles[candles.length - 1].close;
      const rsi = Indicators.calculateRSI(candles);
      const emaValue = Indicators.calculateEMA(candles, config.emaPeriod);

      const trend =
        currentPrice > emaValue ? "Tendencia Alcista" : "Tendencia Bajista";
      let score;
      try {
        score = await this.ai.analyzeWithGroq(pair, {
          rsi,
          price: currentPrice,
          trend,
        });
      } catch (error: any) {
        if (
          error.message.includes("429") ||
          error.message.includes("rate_limit")
        ) {
          score = trend === "Tendencia Alcista" ? 55 : 45;
        }
      }
      return { pair, finalScore: score, price: currentPrice, trend, rsi };
    } catch (error) {
      return null;
    }
  }
}
