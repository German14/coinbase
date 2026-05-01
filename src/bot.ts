import { CoinbaseClient } from "./coinbase";
import { SentimentAnalyzer } from "./sentiment";
import { Indicators } from "./indicators";
import { config } from "./config";
import { logger } from "./logger";
import { RiskManager } from "./risk";

export class TradingBot {
  private exchange: CoinbaseClient;
  private ai: SentimentAnalyzer;
  private currentHolding: string | null = null;
  private buyPrice: number = 0;
  private highestPrice: number = 0;
  private isRotating: boolean = false;
  private riskManager: RiskManager = new RiskManager();

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

      const topTarget = analyses!.sort(
        (a, b) => b.finalScore - a.finalScore,
      )[0];
      logger.info(
        `🔝 Mejor oportunidad: ${topTarget.pair} (Score: ${topTarget.finalScore})`,
      );

      console.log('holding',this.currentHolding)
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
    // 1. Validar que tenemos una posición cargada en el RiskManager
    const position = this.riskManager.getOpenPosition();
    if (!position) return;

    const currentPair = position.productId; // Ya incluye el '-USDC'
    const currentAnalysis = await this.getSpecificAnalysis(currentPair);

    if (!currentAnalysis) return;

    // 2. Cálculo de PnL real
    const { pnlPercent } = this.riskManager.getPnL(currentAnalysis.price);

    // 3. Verificación de Stop Loss / Take Profit (Salidas de emergencia)
    // Usamos los valores guardados en la posición, no en 'this'
    if (
      currentAnalysis.price <= position.stopLoss ||
      currentAnalysis.price >= position.takeProfit
    ) {
      logger.warn(`⚠️ Salida forzada para ${currentPair} (SL/TP alcanzado)`);
      await this.executeSell();
      return;
    }

    // 4. LÓGICA DE ROTACIÓN PROTEGIDA
    if (topTarget.pair !== currentPair) {
      const advantage = topTarget.finalScore - currentAnalysis.finalScore;
// LOG DE DIAGNÓSTICO INICIAL
logger.info(`⚖️ Comparando: ${currentPair} (${currentAnalysis.finalScore}) vs ${topTarget.pair} (${topTarget.finalScore})`);
logger.info(`   • Ventaja calculada: ${advantage} puntos`);
      logger.info(`   • Umbral requerido (rotationThreshold): ${config.rotationThreshold} puntos`);

      // Filtro 1: ¿Ya cubrimos las comisiones? (Tu 2.2% de config)
      const hasCoveredFees = pnlPercent > config.minProfitFees;

      // Filtro 2: ¿La nueva oportunidad es una "Super Señal" que solventa la pérdida?
      const isPowerfulSignal =
        topTarget.finalScore >= 85 && advantage > config.rotationThreshold + 15;

      // Filtro 3: Validación Técnica (EMA y RSI)
      const isTechnicalValid =
        topTarget.trend === "Tendencia Alcista" && topTarget.rsi < 65;

      if (
        (hasCoveredFees || isPowerfulSignal) &&
        isTechnicalValid &&
        advantage >= config.rotationThreshold
      ) {
        logger.warn(
          `🔄 Rotación validada: De ${currentPair} a ${topTarget.pair}`,
        );
        logger.info(
          `📊 PnL Actual: ${pnlPercent.toFixed(2)}% | Ventaja IA: +${advantage} puntos`,
        );

        this.isRotating = true; // Bloqueamos el ciclo
        await this.executeSell();
        this.isRotating = false;
      } else {
        // Si no cumple, imprimimos por qué se queda quieto (útil para debug)
        if (advantage >= config.rotationThreshold) {
          logger.info(
            `🚫 Rotación denegada por costos: PnL (${pnlPercent.toFixed(2)}%) < Fees (${config.minProfitFees}%)`,
          );
        }
      }
      logger.info(`📊 Estado de ${currentPair}:`);
      logger.info(`   • Precio Actual: $${currentAnalysis.price}`);
      logger.info(`   • PnL Bruto: ${pnlPercent.toFixed(2)}%`);
      logger.info(`   • Umbral de Fees: ${config.minProfitFees}%`);
      logger.info(
        `   • RSI: ${currentAnalysis.rsi} | Score IA: ${currentAnalysis.finalScore}`,
      );
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
        if (res && typeof res === "object" && res.finalScore !== undefined) {
          results.push(res);
        }
      } catch (e) {
        // Ignoramos el error de una moneda individual para no romper el bucle
        continue;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  }

  private async getSpecificAnalysis(pair: string) {
    try {
      // 1. Filtro radical: Si es EUR o algo raro, ni lo intentamos
      if (!pair || pair.includes("EUR") || pair.includes("USD-USDC")) {
        return null;
      }
      const btcContext = await this.getBitcoinContext();


      const candles = await this.exchange.getCandles(pair);
      console.log(
        `[${pair}] Velas recibidas: ${candles.length} | Primera: ${candles[0].close} | Última: ${candles[candles.length - 1].close}`,
      );
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

      const trend =
        currentPrice > emaValue ? "Tendencia Alcista" : "Tendencia Bajista";

      const score = await this.ai.analyzeWithGroq(pair, {
        rsi,
        price: currentPrice,
        trend,
      },btcContext);

      console.log("tendencia:", pair, trend);
      console.log("rsi:", rsi);
      console.log("emaValue:", emaValue);
      console.log("currentPrice:", currentPrice);
      console.log("trend:", trend);
      console.log("score:", score);
      return {
        pair,
        finalScore: score,
        price: currentPrice, // 👈 CRUCIAL: Necesario para el PnL
        trend, // 👈 CRUCIAL: Necesario para validar la rotación
        rsi,
        btcRef: btcContext.btcChange24h // Opcional: guardarlo para los logs
      };
    } catch (error: any) {
      // Si algo falla dentro (como un error 400 de Coinbase),
      // lo capturamos aquí para que el ciclo principal continúe
      // logger.error(`Error analizando ${pair}: ${error.message}`);
      return null;
    }
  }
async getBitcoinContext() {
  const btcCandles = await this.exchange.getCandles("BTC-USDC");
  const currentPrice = btcCandles[btcCandles.length - 1].close;
  const openPrice = btcCandles[0].close; // Precio de hace X periodos

  // Calculamos la variación porcentual simple
  const btcChange24h = ((currentPrice - openPrice) / openPrice) * 100;

  return {
    btcPrice: currentPrice,
    btcChange24h: btcChange24h.toFixed(2),
    btcTrend: currentPrice > Indicators.calculateEMA(btcCandles, 20) ? "ALCISTA" : "BAJISTA"
  };
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
