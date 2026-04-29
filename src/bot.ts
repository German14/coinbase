import { CoinbaseClient } from "./coinbase";
import { SentimentAnalyzer } from "./sentiment";
import { Indicators } from "./indicators";
import { config } from "./config";
import { logger } from "./logger";

export class TradingBot {
  private exchange: CoinbaseClient;
  private ai: SentimentAnalyzer;
  private currentHolding: string | null = null;
  private buyPrice: number = 0;
  private highestPrice: number = 0;
  private isRotating: boolean = false;

  constructor() {
    this.exchange = new CoinbaseClient();
    this.ai = new SentimentAnalyzer();
  }

  async runCycle() {
    if (this.isRotating) {
      logger.warn(
        "⏳ Rotación en curso, saltando ciclo para evitar conflictos.",
      );
      return;
    }

    try {
      logger.info(
        `--- Iniciando Ciclo: Analizando ${config.watchlist.length} monedas ---`,
      );

      await this.syncWallet();

      const analyses = await this.getAllAnalyses();
      if (analyses!.length === 0) return;

      const topTarget = analyses!.sort((a, b) => b.finalScore - a.finalScore)[0];
      logger.info(
        `🔝 Mejor oportunidad: ${topTarget.pair} (Score: ${topTarget.finalScore})`,
      );

      if (this.currentHolding) {
        await this.managePosition(topTarget);
      } else {
        await this.evaluateNewEntry(topTarget);
      }
    } catch (error: any) {
      logger.error(`✖ Error en el ciclo: ${error.message}`);
    }
  }

  private async syncWallet() {
    const balances = await this.exchange.getBalances();
    const usdcAccount = balances.find((b) => b.currency === "USDC");
    const usdcBalance = usdcAccount ? usdcAccount.availableBalance : 0;
    logger.info(`💵 Saldo USDC detectado: $${usdcBalance}`);
    // Filtro de seguridad: ignoramos saldos menores a $1 para no detectar "basura"
    const holding = balances.find(
      (b) => b.currency !== "USDC" && b.availableBalance > 0.1,
    );

    if (holding) {
      const currentPrice = await this.exchange.getPrice(
        `${holding.currency}-USDC`,
      );
      const valueInUsd = holding.availableBalance * currentPrice;

      if (valueInUsd > 1.5) {
        // Si tenemos más de $1.50 de una moneda
        if (this.currentHolding !== holding.currency) {
          this.currentHolding = holding.currency;
          this.buyPrice = currentPrice;
          this.highestPrice = currentPrice;
          logger.info(
            `📦 Detectado en cartera: ${this.currentHolding} (Valor: $${valueInUsd.toFixed(2)})`,
          );
        }
      } else {
        this.currentHolding = null;
      }
    } else {
      this.currentHolding = null;
    }
  }

  private async managePosition(topTarget: any) {
    const pair = `${this.currentHolding}-USDC`;
    const currentPrice = await this.exchange.getPrice(pair);
    const pnl = ((currentPrice - this.buyPrice) / this.buyPrice) * 100;

    if (currentPrice > this.highestPrice) this.highestPrice = currentPrice;
    const dropFromMax =
      ((this.highestPrice - currentPrice) / this.highestPrice) * 100;

    logger.info(
      `📊 Status ${this.currentHolding}: PNL: ${pnl.toFixed(2)}% | Drop: ${dropFromMax.toFixed(2)}%`,
    );

    // 1. Trailing Stop Loss
    if (dropFromMax >= config.trailingStopPct && pnl > config.minProfitFees) {
      logger.warn(`📉 Trailing Stop activado en ${this.currentHolding}.`);
      await this.executeSell();
      return;
    }

    // 2. Rotación Inteligente
    if (topTarget.pair !== pair) {
      const currentAnalysis = await this.getSpecificAnalysis(pair);
      const scoreDiff =
        topTarget.finalScore - (currentAnalysis?.finalScore || 50);

      if (
        scoreDiff >= config.rotationThreshold &&
        topTarget.finalScore >= config.minSignalScore
      ) {
        logger.warn(
          `🔄 Ventaja detectada: ${topTarget.pair} (+${scoreDiff} pts sobre ${this.currentHolding})`,
        );
        this.isRotating = true;
        await this.executeSell();

        setTimeout(async () => {
          const balance = await this.exchange.getBalance("USDC");
          if (balance > 2) {
            await this.executeBuy(topTarget.pair, balance);
          }
          this.isRotating = false;
        }, 5000); // 5 segundos para asegurar balance en Coinbase
      }
    }
  }

  private async evaluateNewEntry(topTarget: any) {
    const availableUSDC = await this.exchange.getBalance("USDC");
    if (availableUSDC > 2 && topTarget.finalScore >= config.minSignalScore) {
      logger.success(
        `🚀 Comprando: ${topTarget.pair} (Score: ${topTarget.finalScore})`,
      );
      await this.executeBuy(topTarget.pair, availableUSDC);
    }
  }

  private async getAllAnalyses() {
  const results = [];
  for (const pair of config.watchlist) {
    try {
      const res = await this.getSpecificAnalysis(pair);
      // Solo añadimos si el resultado es un objeto válido y tiene score
      if (res && typeof res === 'object' && res.finalScore !== undefined) {
        results.push(res);
      }
    } catch (e) {
      // Ignoramos el error de una moneda individual para no romper el bucle
      continue;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return results;
}

private async getSpecificAnalysis(pair: string) {
  try {
    // 1. Filtro radical: Si es EUR o algo raro, ni lo intentamos
    if (!pair || pair.includes('EUR') || pair.includes('USD-USDC')) {
      return null;
    }

    const candles = await this.exchange.getCandles(pair);
console.log(`[${pair}] Velas recibidas: ${candles.length} | Primera: ${candles[0].close} | Última: ${candles[candles.length-1].close}`);
    // 2. PROTECCIÓN CRÍTICA: Aquí es donde fallaba.
    // Verificamos que candles NO sea null y que TENGA contenido antes de usar .length
    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      // logger.warn(`[${pair}] Sin datos de velas suficientes.`);
      return null;
    }

    // 3. Ahora sí es seguro acceder a los índices
    const currentPrice = candles[candles.length - 1].close;
    const rsi = Indicators.calculateRSI(candles);
    const emaValue = Indicators.calculateEMA(candles, config.emaPeriod || 20);

    const trend = currentPrice > emaValue ? "Tendencia Alcista" : "Tendencia Bajista";

    const score = await this.ai.analyzeWithGroq(pair, {
      rsi,
      price: currentPrice,
      trend
    });
    console.log('tendencia:', pair, trend)
    console.log('rsi:', rsi)
    console.log('emaValue:', emaValue)
    console.log('currentPrice:',currentPrice)
    console.log('trend:',trend)
    return { pair, finalScore: score };

  } catch (error: any) {
    // Si algo falla dentro (como un error 400 de Coinbase),
    // lo capturamos aquí para que el ciclo principal continúe
    // logger.error(`Error analizando ${pair}: ${error.message}`);
    return null;
  }
}

  private async executeBuy(pair: string, usdAmount: number) {
    try {
      const amountToUse = usdAmount * 0.98; // Reservar 2% para fees
      const res: any = await this.exchange.marketBuy(pair, amountToUse);
      this.currentHolding = pair.split("-")[0];
      this.buyPrice = Number(res.averagePrice || res.price || 0);
      this.highestPrice = this.buyPrice;
    } catch (e: any) {
      logger.error(`❌ Error en compra: ${e.message}`);
    }
  }

  private async executeSell() {
    if (!this.currentHolding) return;
    try {
      const pair = `${this.currentHolding}-USDC`;
      const amount = await this.exchange.getBalance(this.currentHolding);
      // Truncar a 6 decimales para evitar errores de precisión en la API
      const safeAmount = Math.floor(amount * 1000000) / 1000000;

      if (safeAmount > 0) {
        await this.exchange.marketSell(pair, safeAmount);
        logger.success(`💰 Venta de ${this.currentHolding} completada.`);
        this.currentHolding = null;
      }
    } catch (e: any) {
      logger.error(`❌ Error en venta: ${e.message}`);
    }
  }
}
