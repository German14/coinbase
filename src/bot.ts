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

    this.riskManager.loadPosition();
  }
  async initialize(): Promise<void> {
    await this.initializeWatchlist();
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

    logger.info(
      `\n✨ Watchlist válida: ${this.validWatchlist.length}/${config.watchlist.length} monedas`,
    );
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
      // BTC context UNA sola vez
      const btcContext = await this.getBitcoinContext();
      const analyses = await this.getAllAnalyses(btcContext);
      if (analyses!.length === 0) return;

      const topTarget = analyses!.sort(
        (a, b) => b.finalScore - a.finalScore,
      )[0];
      logger.info(
        `🔝 Mejor oportunidad: ${topTarget.pair} (Score: ${topTarget.finalScore})`,
      );

      console.log(
        "📍 Estado actual - Holding:",
        this.currentHolding || "NINGUNO",
        "| USDC Disponible: TODO EL ANÁLISIS ABAJO",
      );

      if (this.currentHolding) {
        // 1. Primero validar que el par es legítimo
        const isValidHolding = this.validWatchlist.includes(
          this.currentHolding,
        );
        if (!isValidHolding) {
          logger.error(`\n🚨 PAR ILEGÍTIMO DETECTADO: ${this.currentHolding}`);
          logger.error(`   Vendiendo automáticamente para liberar capital...`);
          const symbol = this.currentHolding.split("-")[0];
          const balance = await this.exchange.getBalance(symbol);
          if (balance > 0) {
            try {
              const sellPrice = await this.exchange.getPrice(`${symbol}-USDC`);
              await this.exchange.marketSell(`${symbol}-USDC`, balance);
              this.tracker.recordSell(
                `${symbol}-USDC`,
                balance,
                sellPrice,
                0,
                "VENTA AUTOMÁTICA - Moneda no válida",
              );
              logger.success(`✅ Vendida ${symbol} automáticamente`);
            } catch (error: any) {
              logger.error(`❌ Error vendiendo ${symbol}: ${error.message}`);
            }
          }
          this.currentHolding = null;
          return;
        }
        // Verificar si la moneda actual está en el watchlist válido
        await this.managePosition(analyses, btcContext); // ← pasar los análisis ya hechos

        logger.warn(`\n🔄 MANEJO DE POSICIÓN ABIERTA`);
        logger.warn(`   Moneda actual: ${this.currentHolding}`);
        logger.warn(`   Precio de compra: $${this.buyPrice.toFixed(6)}`);
        logger.warn(`   Cantidad: ${this.buyAmount.toFixed(8)}`);
        await this.managePosition(analyses, btcContext);
      } else {
        logger.info(`\n💚 SIN POSICIÓN ABIERTA - Evaluando entrada`);
        logger.info(
          `   Mejor score encontrado: ${topTarget.pair} = ${topTarget.finalScore}`,
        );
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

    // 🧹 LIMPIAR POLVO CRIPTOGRÁFICO - Solo vender MICRO cantidades (< $0.50)
    const dustThreshold = 0.5; // Solo < $0.50 es considerado polvo irrelevante
    const minHolding = 1.5; // Posiciones mínimas (tracking de holdings activos)

    for (const balance of balances) {
      if (balance.currency === "USDC" || balance.availableBalance <= 0)
        continue;

      try {
        const price = await this.exchange.getPrice(`${balance.currency}-USDC`);
        const valueInUsd = balance.availableBalance * price;

        if (valueInUsd > 0 && valueInUsd < dustThreshold) {
          // SOLO vender si es polvo real (< $0.50)
          logger.warn(`\n🧹 POLVO REAL DETECTADO: ${balance.currency}`);
          logger.warn(`   Cantidad: ${balance.availableBalance.toFixed(8)}`);
          logger.warn(
            `   Valor: $${valueInUsd.toFixed(2)} (< $${dustThreshold})`,
          );
          logger.warn(`   Vendiendo para liberar USDC...`);

          await this.exchange.marketSell(
            `${balance.currency}-USDC`,
            balance.availableBalance,
          );
          this.tracker.recordSell(
            `${balance.currency}-USDC`,
            balance.availableBalance,
            price,
            0,
            "LIMPIEZA DE POLVO CRIPTOGRÁFICO",
          );
          logger.success(`✅ Polvo de ${balance.currency} convertido a USDC`);
        }
      } catch (error: any) {
        logger.warn(
          `⚠️  Error limpiando ${balance.currency}: ${error.message}`,
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Volver a obtener balances después de limpiar polvo
    const updatedBalances = await this.exchange.getBalances();
    const updatedUsdc = updatedBalances.find((b) => b.currency === "USDC");
    const updatedUsdcBalance = updatedUsdc ? updatedUsdc.availableBalance : 0;

    if (updatedUsdcBalance > usdcBalance) {
      logger.success(
        `\n💚 POLVO LIMPIADO: +$${(updatedUsdcBalance - usdcBalance).toFixed(2)} USDC liberado`,
      );
    }

    // 📊 DETECTAR POSICIONES ACTIVAS - Holdings > $1.50 (TODAS)
    const holdings = updatedBalances.filter(
      (b) => b.currency !== "USDC" && b.availableBalance > 0.1,
    );

    // Si hay múltiples posiciones, seleccionar la más grande en valor para gestión principal
    // pero no consolidar - permitir que el bot tenga varias posiciones al mismo tiempo
    if (holdings.length > 0) {
      const holdingsWithValue: Array<{
        currency: string;
        availableBalance: number;
        price: number;
        valueInUsd: number;
        pair: string;
      }> = [];
      for (const h of holdings) {
        try {
          const pair = `${h.currency}-USDC`;
          const price = await this.exchange.getPrice(pair);
          holdingsWithValue.push({
            currency: h.currency,
            availableBalance: h.availableBalance,
            price,
            valueInUsd: h.availableBalance * price,
            pair,
          });
        } catch (error: any) {
          logger.warn(
            `⚠️  No se pudo obtener precio para ${h.currency}: ${error.message}`,
          );
        }
      }

      if (holdingsWithValue.length === 0) {
        logger.warn(
          "⚠️  No se pudieron validar los precios de ninguna posición activa. No se actualizará currentHolding.",
        );
        this.currentHolding = null;
        return;
      }

      const mainHolding = holdingsWithValue.sort(
        (a, b) => b.valueInUsd - a.valueInUsd,
      )[0];
      const valueInUsd = mainHolding.valueInUsd;

      if (valueInUsd > minHolding) {
        if (this.currentHolding !== mainHolding.pair) {
          this.currentHolding = mainHolding.pair;

          // Recuperar precio de compra real desde el historial
          const openTrades = this.tracker.getOpenTrades();
          const openTrade = openTrades.find((t) => t.pair === mainHolding.pair);

          if (openTrade) {
            this.buyPrice = openTrade.buyTransaction.price;
            this.buyAmount = openTrade.buyTransaction.amount;
            // highestPrice = el mayor entre el precio de compra y el precio actual
            // (por si el precio subió mientras el bot estaba apagado)
            this.highestPrice = Math.max(
              openTrade.buyTransaction.price,
              mainHolding.price,
            );
            logger.success(
              `📋 Precio de compra recuperado del historial: $${this.buyPrice.toFixed(6)}`,
            );
          } else {
            // Sin registro → usar precio actual como fallback y avisar
            this.buyPrice = mainHolding.price;
            this.highestPrice = mainHolding.price;
            logger.warn(
              `⚠️  Sin historial de compra para ${mainHolding.pair}. ` +
                `Usando precio actual como referencia — stop loss puede no ser fiable.`,
            );
          }

          if (holdingsWithValue.length > 1) {
            logger.warn(
              `\n📊 MÚLTIPLES POSICIONES DETECTADAS: ${holdingsWithValue.length}`,
            );
            for (const h of holdingsWithValue) {
              logger.info(
                `   • ${h.pair}: ${h.availableBalance.toFixed(8)} @ $${h.price.toFixed(6)} = $${h.valueInUsd.toFixed(2)}`,
              );
            }
            logger.warn(
              `   Gestionando principalmente: ${this.currentHolding}`,
            );
          } else {
            logger.warn(
              `\n📦 POSICIÓN DETECTADA: ${this.currentHolding} (Valor: $${valueInUsd.toFixed(2)})`,
            );
          }
        }
      } else if (valueInUsd > 0 && valueInUsd < minHolding) {
        logger.info(
          `\n⚠️  Posición pequeña detectada: ${mainHolding.pair} = $${valueInUsd.toFixed(2)}`,
        );
      } else {
        this.currentHolding = null;
      }
    } else {
      this.currentHolding = null;
    }
  }

  async managePosition(allAnalyses: any[], btcContext: any): Promise<void> {
    if (!this.currentHolding) {
      logger.info("ℹ️ Sin posición abierta, saltando gestión.");
      return;
    }
    const pairParts = (this.currentHolding || "").split("-");

    if (pairParts.length < 2) return;
    try {
      const candles = await this.exchange.getCandles(this.currentHolding);
      // --- VALIDACIÓN ANTIFALLO ---
      if (!candles || candles.length === 0) {
        console.error(
          `No se obtuvieron velas para ${this.currentHolding}. Reintentando en el próximo ciclo...`,
        );
        return;
      }
      const currentPrice = candles[candles.length - 1].close;
      const profitPct = (currentPrice - this.buyPrice) / this.buyPrice;

      logger.info(
        `\n💰 PRECIO ACTUAL: $${currentPrice.toFixed(6)} | GANANCIA: ${(profitPct * 100).toFixed(2)}%`,
      );

      // Ordena correctamente por finalScore
      const bestOpportunity = allAnalyses.sort(
        (a, b) => b.finalScore - a.finalScore,
      )[0];

      logger.info(`\n📊 ANÁLISIS DE REBALANCEO:`);
      logger.info(
        `   Mejor moneda alternativa: ${bestOpportunity.pair} (Score: ${bestOpportunity.finalScore})`,
      );
      logger.info(`   Moneda actual: ${this.currentHolding} (analizando...)`);

      if (bestOpportunity && bestOpportunity.pair !== this.currentHolding) {
        const currentAnalysis = allAnalyses.find(
          (a) => a.pair === this.currentHolding,
        );

        const currentScore = currentAnalysis?.finalScore || 0;

        logger.info(`   ✓ Score moneda actual: ${currentScore}`);
        logger.info(
          `   ✓ Diferencia de score: ${(bestOpportunity.finalScore - currentScore).toFixed(2)} puntos`,
        );

        const scoreDelta = bestOpportunity.finalScore - currentScore;
        const totalFees = config.minProfitFees;
        const netProfitAfterFees = profitPct - totalFees / 100;
        const urgent = this.riskManager.needsUrgentRebalance(
          profitPct,
          currentScore,
          bestOpportunity.finalScore,
        );
        const rotationWorthIt = this.riskManager.isRotationWorthIt(
          currentPrice,
          bestOpportunity.finalScore,
          currentScore,
        );
        const shouldRotate = urgent || rotationWorthIt;

        logger.warn(
          `\n🚨 ¿ES REBALANCEO URGENTE? ${urgent ? "✅ SÍ" : "❌ NO"}`,
        );
        logger.info(`   Ganancia actual: ${(profitPct * 100).toFixed(2)}%`);
        logger.info(
          `   Ganancia neta después de fees (${totalFees}%): ${(netProfitAfterFees * 100).toFixed(2)}%`,
        );
        logger.info(`   Diferencia de score: ${scoreDelta.toFixed(2)} puntos`);
        logger.info(`   📊 CONDICIONES DE ROTACIÓN:`);
        logger.info(`   • Score actual: ${currentScore}`);
        logger.info(`   • Mejor alternativa: ${bestOpportunity.finalScore}`);
        logger.info(
          `   • Threshold de rotación: ${config.rotationThreshold} pts`,
        );
        logger.info(
          `   • Net profit after fees suficiente: ${netProfitAfterFees >= 0 ? "✅" : "❌"}`,
        );
        logger.info(
          `   • Rotación rentable según riesgo: ${rotationWorthIt ? "✅" : "❌"}`,
        );

        if (shouldRotate) {
          this.isRotating = true; // 🔒 bloquear nuevos ciclos
          try {
            console.info(
              `🚨 REBALANCEO: Rotando ${this.currentHolding} -> ${bestOpportunity.pair}`,
            );
            await this.executeSell();

            if (bestOpportunity.finalScore >= 80 && bestOpportunity.rsi < 70) {
              const usdcBalance = await this.exchange.getBalance("USDC");
              if (usdcBalance > 0) {
                await this.executeBuy(bestOpportunity.pair, usdcBalance);
              }
            }
          } finally {
            this.isRotating = false; // 🔓 liberar siempre, aunque falle
          }
          return;
        } else {
          logger.info(
            `\n⏸️  NO ES RENTABLE ROTAR - Manteniendo posición actual`,
          );
          logger.info(
            `   El cambio no compensa las comisiones y la diferencia de score`,
          );
        }
      } else {
        logger.info(
          `\n⏸️  No hay mejor alternativa - Moneda actual es la mejor`,
        );
      }
      // --- FIN REBALANCEO ---

      // Actualizar trailing stop ANTES de evaluar si vender
      this.riskManager.updateTrailingStop(currentPrice);

      const { sell, reason } = this.riskManager.shouldSell(currentPrice);
      if (sell) {
        logger.warn(
          `🛑 VENTA FORZADA - Razón: ${reason} | Precio: $${currentPrice.toFixed(2)}`,
        );
        const symbol = this.currentHolding.split("-")[0];
        const balance = await this.exchange.getBalance(symbol);
        if (balance > 0) {
          const sellPrice = await this.exchange.getPrice(`${symbol}-USDC`);
          await this.exchange.marketSell(`${symbol}-USDC`, balance);
          this.tracker.recordSell(
            `${symbol}-USDC`,
            balance,
            sellPrice,
            0,
            `VENTA AUTOMÁTICA: ${reason}`,
          );
          this.currentHolding = null;
        }
      } else {
        logger.info(`\n✅ Sin señales de venta - Posición segura`);
        logger.info(`   Esperando cambios en el mercado...`);
      }
    } catch (error: any) {
      console.error("Error en managePosition: " + error.message);
    }
  }
  private async evaluateNewEntry(topTarget: any) {
    const availableUSDC = await this.exchange.getBalance("USDC");
    const minBuyAmount = 1.5; // Mínimo para operar ($1.50)

    if (availableUSDC < minBuyAmount) {
      logger.warn(
        `\n💸 Capital insuficiente: $${availableUSDC.toFixed(2)} < $${minBuyAmount} mínimo`,
      );
      return;
    }

    if (topTarget.finalScore >= config.minSignalScore) {
      logger.success(
        `🚀 Comprando: ${topTarget.pair} (Score: ${topTarget.finalScore}) con $${availableUSDC.toFixed(2)}`,
      );
      await this.executeBuy(topTarget.pair, availableUSDC);
    } else {
      logger.info(
        `⏸️  Mejor oportunidad tiene score ${topTarget.finalScore}, mínimo requerido: ${config.minSignalScore}`,
      );
    }
  }

  private async getAllAnalyses(btcContext: any) {
    const results = [];
    logger.info(`\n🔍 ANALIZANDO ${this.validWatchlist.length} MONEDAS:`);
    for (const pair of this.validWatchlist) {
      try {
        const res = await this.getSpecificAnalysis(pair, btcContext); // ← pasar
        // Solo añadimos si el resultado es un objeto válido y tiene score
        if (res && typeof res === "object" && res.finalScore !== undefined) {
          results.push(res);
          logger.info(
            `   📍 ${pair}: SCORE = ${res.finalScore} | RSI = ${res.rsi.toFixed(2)} | Trend = ${res.trend}`,
          );
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

  private async getSpecificAnalysis(pair: string, btcContext: any) {
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

      // 3. Obtener velas
      const candles = await this.exchange.getCandles(pair);
      if (!candles || !Array.isArray(candles) || candles.length === 0) {
        logger.warn(`⚠️  ${pair}: Sin datos históricos disponibles`);
        return null;
      }

      // 4. Análisis de datos técnicos
      const currentPrice = candles[candles.length - 1].close;
      const rsi = Indicators.calculateRSI(candles);
      const emaValue = Indicators.calculateEMA(candles, config.emaPeriod || 20);
      const macd = Indicators.calculateMACD(candles);

      const trend =
        currentPrice > emaValue ? "Tendencia Alcista" : "Tendencia Bajista";

      // 5. Análisis de IA como base
      const score = await this.ai.analyzeWithGroq(
        pair,
        { rsi, price: currentPrice, trend, macd },
        btcContext,
      );

      // 6. Aplicar ajustes manuales (Scoring Invertido)
      let finalScore = score;

      // --- Lógica de RSI Invertida ---
      if (rsi > 72) {
        finalScore -= 20;
        logger.warn(
          `   ⚠️  ${pair}: RSI sobrecompra (${rsi.toFixed(1)}) → -20 pts`,
        );
      } else if (rsi < 30) {
        // SEGURIDAD: Solo premiar sobreventa si la tendencia no es puramente suicida
        // Si el precio está MUY por debajo de la EMA, es un cuchillo cayendo.
        const emaDist = ((currentPrice - emaValue) / emaValue) * 100;

        if (emaDist < -10) {
          finalScore -= 15; // Penalizamos si está en caída libre
          logger.warn(
            `   🚨  ${pair}: Cuchillo cayendo (${emaDist.toFixed(1)}% bajo EMA) → -15 pts`,
          );
        } else {
          finalScore += 25;
          logger.info(
            `   💎  ${pair}: RSI sobreventa (${rsi.toFixed(1)}) → +25 pts`,
          );
        }
      } else if (rsi >= 30 && rsi <= 45) {
        finalScore += 10;
      }

      // --- BTC Context ---
      const btcChange = parseFloat(btcContext.btcChange24h);
      if (btcChange < -4) {
        finalScore -= 20; // Más agresivo con el pánico de BTC
        logger.warn(`   🚨  ${pair}: Pánico en BTC → -20 pts`);
      }
      if (btcChange > 1.5) finalScore += 7;

      // Clampar entre 1 y 100
      finalScore = Math.min(100, Math.max(1, finalScore));

      // ⚠️ CORRECCIÓN AQUÍ: Devolver finalScore, no score
      return {
        pair,
        finalScore: finalScore, // Antes decía 'score', lo cual ignoraba tus ajustes
        price: currentPrice,
        trend,
        rsi,
        btcRef: btcContext.btcChange24h,
      };
    } catch (error: any) {
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
      btcTrend:
        currentPrice > Indicators.calculateEMA(btcCandles, 20)
          ? "ALCISTA"
          : "BAJISTA",
    };
  }
  private async executeBuy(pair: string, usdAmount: number) {
    try {
      // Calcular fees de manera más inteligente
      const estimatedFees = usdAmount * (config.minProfitFees / 100); // 2.2%
      const amountToUse = usdAmount - estimatedFees;

      logger.info(
        `💰 COMPRA: $${usdAmount.toFixed(2)} | Fees estimados: $${estimatedFees.toFixed(2)} | Usando: $${amountToUse.toFixed(2)}`,
      );

      const res: any = await this.exchange.marketBuy(pair, amountToUse);
      this.currentHolding = pair;
      this.buyPrice = Number(res.averagePrice || res.price || 0);
      this.buyAmount = Number(res.filledSize || 0);
      this.highestPrice = this.buyPrice;

      // Registrar posición en riesgo para valorar la rotación correctamente
      this.riskManager.openTrade(
        pair,
        this.buyPrice,
        this.buyAmount,
        amountToUse,
      );

      // Registrar en tracker con fees reales
      const actualFees = usdAmount - this.buyAmount * this.buyPrice;
      this.tracker.recordBuy(
        pair,
        this.buyAmount,
        this.buyPrice,
        actualFees,
        "Entrada en tendencia",
      );

      logger.success(
        `✅ Compra ejecutada: ${this.buyAmount.toFixed(8)} ${this.currentHolding} @ $${this.buyPrice.toFixed(6)}`,
      );
    } catch (e: any) {
      logger.error(`❌ Error en compra: ${e.message}`);
    }
  }

  private async executeSell() {
    if (!this.currentHolding) return;
    try {
      const pair = this.currentHolding;
      const symbol = pair.split("-")[0];
      const amount = await this.exchange.getBalance(symbol);
      // Truncar a 6 decimales para evitar errores de precisión en la API
      const safeAmount = Math.floor(amount * 1000000) / 1000000;

      if (safeAmount > 0) {
        const sellPrice = await this.exchange.getPrice(pair);

        // Calcular valor esperado vs fees
        const expectedValue = safeAmount * sellPrice;
        const estimatedFees = expectedValue * (config.minProfitFees / 100);

        logger.info(
          `💸 VENTA: ${safeAmount.toFixed(8)} ${symbol} | Precio: $${sellPrice.toFixed(6)}`,
        );
        logger.info(
          `   Valor esperado: $${expectedValue.toFixed(2)} | Fees estimados: $${estimatedFees.toFixed(2)}`,
        );

        await this.exchange.marketSell(pair, safeAmount);
        logger.success(`💰 Venta de ${symbol} completada.`);

        // Registrar en tracker con fees
        this.tracker.recordSell(
          pair,
          safeAmount,
          sellPrice,
          estimatedFees,
          "Salida de posición",
        );
        this.tracker.getSummary();
        this.riskManager.closeTrade();

        this.currentHolding = null;
      }
    } catch (e: any) {
      logger.error(`❌ Error en venta: ${e.message}`);
    }
  }
}
