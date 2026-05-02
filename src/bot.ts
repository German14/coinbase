import { CoinbaseClient } from "./coinbase";
import { SentimentAnalyzer } from "./sentiment";
import { Indicators } from "./indicators";
import { config } from "./config";
import { logger } from "./logger";
import { RiskManager } from "./risk";
import { TransactionTracker } from "./transactionTracker";

export class TradingBot {
  private exchange: CoinbaseClient;
  private ai: SentimentAnalyzer;
  private currentHolding: string | null = null;
  private buyPrice: number = 0;
  private buyAmount: number = 0;
  private highestPrice: number = 0;
  private isRotating: boolean = false;
  private riskManager: RiskManager = new RiskManager();
  private tracker: TransactionTracker = new TransactionTracker();
  private validWatchlist: string[] = [];

  constructor() {
    this.exchange = new CoinbaseClient();
    this.ai = new SentimentAnalyzer();
    this.initializeWatchlist();
  }

  private async initializeWatchlist() {
    logger.info(`\n🔍 VALIDANDO WATCHLIST INICIAL...`);
    this.validWatchlist = [];

    for (const pair of config.watchlist) {
      try {
        const price = await this.exchange.getPrice(pair);
        if (price && price > 0) {
          this.validWatchlist.push(pair);
          logger.success(`   ✅ ${pair}: $${price.toFixed(2)}`);
        } else {
          logger.warn(`   ❌ ${pair}: Precio inválido`);
        }
      } catch (error) {
        logger.warn(`   ❌ ${pair}: NO DISPONIBLE en Coinbase`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    logger.info(`\n✨ Watchlist válida: ${this.validWatchlist.length}/${config.watchlist.length} monedas`);
    if (this.validWatchlist.length === 0) {
      logger.error(`❌ ERROR: Ninguna moneda del watchlist está disponible`);
      process.exit(1);
    }
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

      console.log('📍 Estado actual - Holding:', this.currentHolding || 'NINGUNO', '| USDC Disponible: TODO EL ANÁLISIS ABAJO');

      if (this.currentHolding) {
        // Verificar si la moneda actual está en el watchlist válido
        const isValidHolding = this.validWatchlist.includes(`${this.currentHolding}-USDC`);

        if (!isValidHolding) {
          logger.error(`\n🚨 MONEDA ILEGÍTIMA DETECTADA: ${this.currentHolding}`);
          logger.error(`   Esta moneda no está en el watchlist válido o no existe en Coinbase`);
          logger.error(`   Vendiendo automáticamente para liberar capital...`);

          const symbol = this.currentHolding;
          const balance = await this.exchange.getBalance(symbol);

          if (balance > 0) {
            try {
              const sellPrice = await this.exchange.getPrice(`${symbol}-USDC`);
              await this.exchange.marketSell(`${symbol}-USDC`, balance);
              this.tracker.recordSell(`${symbol}-USDC`, balance, sellPrice, 0, 'VENTA AUTOMÁTICA - Moneda no válida');
              logger.success(`✅ Vendida ${symbol} automáticamente`);
            } catch (error: any) {
              logger.error(`❌ Error vendiendo ${symbol}: ${error.message}`);
            }
          }

          this.currentHolding = null;
          return; // Salir del ciclo para que en el próximo pueda comprar algo válido
        }

        logger.warn(`\n🔄 MANEJO DE POSICIÓN ABIERTA`);
        logger.warn(`   Moneda actual: ${this.currentHolding}`);
        logger.warn(`   Precio de compra: $${this.buyPrice.toFixed(6)}`);
        logger.warn(`   Cantidad: ${this.buyAmount.toFixed(8)}`);
        await this.managePosition();
      } else {
        logger.info(`\n💚 SIN POSICIÓN ABIERTA - Evaluando entrada`);
        logger.info(`   Mejor score encontrado: ${topTarget.pair} = ${topTarget.finalScore}`);
        logger.info(`   Score mínimo requerido: ${config.minSignalScore}`);
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

async managePosition(): Promise<void> {
    if (!this.currentHolding) return;

    try {
      const candles = await this.exchange.getCandles(this.currentHolding);
      // --- VALIDACIÓN ANTIFALLO ---
        if (!candles || candles.length === 0) {
            console.error(`No se obtuvieron velas para ${this.currentHolding}. Reintentando en el próximo ciclo...`);
            return;
        }
        const currentPrice = candles[candles.length - 1].close;
        const profitPct = (currentPrice - this.buyPrice) / this.buyPrice;

        logger.info(`\n💰 PRECIO ACTUAL: $${currentPrice.toFixed(6)} | GANANCIA: ${(profitPct*100).toFixed(2)}%`);

        // --- REBALANCEO URGENTE ---
        const allAnalyses = await this.getAllAnalyses();

        // Ordena correctamente por finalScore
        const bestOpportunity = allAnalyses.sort((a, b) => b.finalScore - a.finalScore)[0];

        logger.info(`\n📊 ANÁLISIS DE REBALANCEO:`);
        logger.info(`   Mejor moneda alternativa: ${bestOpportunity.pair} (Score: ${bestOpportunity.finalScore})`);
        logger.info(`   Moneda actual: ${this.currentHolding} (analizando...)`);

        if (bestOpportunity && bestOpportunity.pair !== this.currentHolding) {
            const currentAnalysis = await this.getSpecificAnalysis(this.currentHolding);
            const currentScore = currentAnalysis?.finalScore || 0;

            logger.info(`   ✓ Score moneda actual: ${currentScore}`);
            logger.info(`   ✓ Diferencia de score: ${(bestOpportunity.finalScore - currentScore).toFixed(2)} puntos`);

            const urgent = this.riskManager.needsUrgentRebalance(
                profitPct,
                currentScore,
                bestOpportunity.finalScore
            );

            logger.warn(`\n🚨 ¿ES REBALANCEO URGENTE? ${urgent ? '✅ SÍ' : '❌ NO'}`);
            logger.info(`   Ganancia actual: ${(profitPct*100).toFixed(2)}%`);
            const totalFees = config.minProfitFees;
            const netProfitAfterFees = profitPct - (totalFees / 100);
            logger.info(`   Ganancia neta después de fees (${totalFees}%): ${(netProfitAfterFees*100).toFixed(2)}%`);
            logger.info(`   📊 CONDICIONES DE ROTACIÓN:`);
            logger.info(`   • En pérdida neta: ${netProfitAfterFees < 0 ? '✅' : '❌'} (rota con +10pts diferencia)`);
            logger.info(`   • En ganancia: ${profitPct > 0 ? '✅' : '❌'} (rota solo con +40pts o actual<40/mejor>80)`);
            logger.info(`   • Break-even: diferencia ${(bestOpportunity.finalScore - currentScore).toFixed(1)}pts ${((bestOpportunity.finalScore - currentScore) > 25) ? '✅ (>25pts)' : '❌ (≤25pts)'}`);

            if (urgent) {
                console.info(`🚨 REBALANCEO: Rotando ${this.currentHolding} -> ${bestOpportunity.pair}`);

                // Vender la posición actual usando executeSell
                await this.executeSell();

                // 2. COMPRAR: La nueva oportunidad
                if (bestOpportunity.finalScore >= 80 && bestOpportunity.rsi < 70) {
                    const usdcBalance = await this.exchange.getBalance('USDC');
                    if (usdcBalance > 0) {
                        logger.info(`\n💰 EJECUTANDO RECOMPRA: ${bestOpportunity.pair} con $${usdcBalance.toFixed(2)} USDC`);
                        await this.executeBuy(bestOpportunity.pair, usdcBalance);
                        return;
                    }
                }
            } else {
                logger.info(`\n⏸️  NO ES URGENTE ROTAR - Manteniendo posición actual`);
                logger.info(`   La moneda actual está relativamente bien`);
            }
        } else {
            logger.info(`\n⏸️  No hay mejor alternativa - Moneda actual es la mejor`);
        }
        // --- FIN REBALANCEO ---

        // Lógica de salida normal usando tus métodos de venta
        const currentAnalysis = await this.getSpecificAnalysis(this.currentHolding);
        const { sell, reason } = this.riskManager.shouldSell(currentPrice);
        if (sell) {
            logger.warn(`🛑 VENTA FORZADA - Razón: ${reason} | Precio: $${currentPrice.toFixed(2)}`);
            const symbol = this.currentHolding.split('-')[0];
            const balance = await this.exchange.getBalance(symbol);
            if (balance > 0) {
                const sellPrice = await this.exchange.getPrice(`${symbol}-USDC`);
                await this.exchange.marketSell(`${symbol}-USDC`, balance);
                this.tracker.recordSell(`${symbol}-USDC`, balance, sellPrice, 0, `VENTA AUTOMÁTICA: ${reason}`);
                this.currentHolding = null;
            }
        } else {
            logger.info(`\n✅ Sin señales de venta - Posición segura`);
            logger.info(`   Esperando cambios en el mercado...`);
        }

    } catch (error:any) {
       console.error("Error en managePosition: " + error.message);
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
    logger.info(`\n🔍 ANALIZANDO ${this.validWatchlist.length} MONEDAS:`);
    for (const pair of this.validWatchlist) {
      try {
        const res = await this.getSpecificAnalysis(pair);
        // Solo añadimos si el resultado es un objeto válido y tiene score
        if (res && typeof res === "object" && res.finalScore !== undefined) {
          results.push(res);
          logger.info(`   📍 ${pair}: SCORE = ${res.finalScore} | RSI = ${res.rsi.toFixed(2)} | Trend = ${res.trend}`);
        } else {
          logger.warn(`   ❌ ${pair}: Sin datos`);
        }
      } catch (e) {
        // Ignoramos el error de una moneda individual para no romper el bucle
        logger.warn(`   ⚠️  ${pair}: Error al analizar`);
        continue;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return results;
  }

  private async getSpecificAnalysis(pair: string) {
    try {
      // 1. Validación básica del par
      if (!pair || pair.includes("EUR") || pair.includes("USD-USDC")) {
        return null;
      }

      // 2. Verificar que el par existe en Coinbase
      try {
        const price = await this.exchange.getPrice(pair);
        if (!price || price <= 0) {
          logger.warn(`⚠️  ${pair}: Precio inválido ($${price})`);
          return null;
        }
      } catch (error: any) {
        logger.warn(`⚠️  ${pair}: NO EXISTE en Coinbase o está deshabilitado`);
        return null;
      }

      const btcContext = await this.getBitcoinContext();

      // 3. Obtener velas
      const candles = await this.exchange.getCandles(pair);
      if (!candles || !Array.isArray(candles) || candles.length === 0) {
        logger.warn(`⚠️  ${pair}: Sin datos históricos disponibles`);
        return null;
      }

      // 4. Análisis de datos
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

      return {
        pair,
        finalScore: score,
        price: currentPrice,
        trend,
        rsi,
        btcRef: btcContext.btcChange24h
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
      // Calcular fees de manera más inteligente
      const estimatedFees = usdAmount * (config.minProfitFees / 100); // 2.2%
      const amountToUse = usdAmount - estimatedFees;

      logger.info(`💰 COMPRA: $${usdAmount.toFixed(2)} | Fees estimados: $${estimatedFees.toFixed(2)} | Usando: $${amountToUse.toFixed(2)}`);

      const res: any = await this.exchange.marketBuy(pair, amountToUse);
      this.currentHolding = pair.split("-")[0];
      this.buyPrice = Number(res.averagePrice || res.price || 0);
      this.buyAmount = Number(res.filledSize || 0);
      this.highestPrice = this.buyPrice;

      // Registrar en tracker con fees reales
      const actualFees = usdAmount - (this.buyAmount * this.buyPrice);
      this.tracker.recordBuy(pair, this.buyAmount, this.buyPrice, actualFees, 'Entrada en tendencia');

      logger.success(`✅ Compra ejecutada: ${this.buyAmount.toFixed(8)} ${this.currentHolding} @ $${this.buyPrice.toFixed(6)}`);
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
        const sellPrice = await this.exchange.getPrice(pair);

        // Calcular valor esperado vs fees
        const expectedValue = safeAmount * sellPrice;
        const estimatedFees = expectedValue * (config.minProfitFees / 100);

        logger.info(`💸 VENTA: ${safeAmount.toFixed(8)} ${this.currentHolding} | Precio: $${sellPrice.toFixed(6)}`);
        logger.info(`   Valor esperado: $${expectedValue.toFixed(2)} | Fees estimados: $${estimatedFees.toFixed(2)}`);

        await this.exchange.marketSell(pair, safeAmount);
        logger.success(`💰 Venta de ${this.currentHolding} completada.`);

        // Registrar en tracker con fees
        this.tracker.recordSell(pair, safeAmount, sellPrice, estimatedFees, 'Salida de posición');
        this.tracker.getSummary();

        this.currentHolding = null;
      }
    } catch (e: any) {
      logger.error(`❌ Error en venta: ${e.message}`);
    }
  }
}
