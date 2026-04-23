import { CoinbaseClient } from "./coinbase";
import { analyzeTechnicals } from "./indicators";
import { analyzeSentiment, combineSignals } from "./sentiment";
import { RiskManager, TradeHistory } from "./risk";
import { config, validateConfig } from "./config";
import { logger } from "./logger";
import fs from "fs"; // Necesario para leer el historial de ganancias
interface PairAnalysis {
  pair: string;
  baseCurrency: string; // SOL, OP, BTC...
  currentPrice: number;
  finalScore: number;
  confidence: number;
  signal: "BUY" | "SELL" | "HOLD";
  technicalScore: number;
  sentimentScore: number;
}

export class TradingBot {
  private coinbase: CoinbaseClient;
  private riskManager: RiskManager;
  private tradeHistory: TradeHistory;
  private running = false;
  private interval: ReturnType<typeof setTimeout> | null = null;
  private currentTradeId: number | null = null;
  private iterationCount = 0;

  // Moneda que tenemos actualmente en cartera (distinta de USD/USDC)
  private currentHolding: string | null = null;
  private currentHoldingSize = 0;
  private currentHoldingEntryPrice = 0;

  constructor() {
    this.coinbase = new CoinbaseClient();
    this.riskManager = new RiskManager();
    this.tradeHistory = new TradeHistory();
  }
  private savePnLToHistory(profit: number, wasWin: boolean): void {
    const path = "./pnl_history.json";
    let stats = { totalPnL: 0, wins: 0, losses: 0 };

    if (require("fs").existsSync(path)) {
      try {
        stats = JSON.parse(require("fs").readFileSync(path, "utf-8"));
      } catch (e) {
        /* archivo corrupto, usamos el default */
      }
    }

    stats.totalPnL += profit;
    if (wasWin) stats.wins++;
    else stats.losses++;

    require("fs").writeFileSync(path, JSON.stringify(stats, null, 2));
  }
  async start(): Promise<void> {
    validateConfig();

    logger.banner("🤖 COINBASE MULTI-ASSET TRADING BOT");
    logger.info(`Pares vigilados: ${config.tradingPairs.join(" | ")}`);
    logger.info(`Capital por operación: $${config.tradeAmountUSD}`);
    logger.info(
      `Stop Loss: ${config.stopLossPercent}% | Take Profit: ${config.takeProfitPercent}%`,
    );
    logger.divider();

    // Detectar si ya tenemos alguna moneda en cartera
    await this.detectCurrentHolding();

    this.running = true;
    await this.runCycle();

    this.interval = setInterval(async () => {
      if (this.running) await this.runCycle();
    }, config.checkIntervalMs);

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    this.tradeHistory.printSummary();
    logger.info("Bot detenido.");
  }

  // Detecta si ya tenemos crypto en cartera al arrancar
  private async detectCurrentHolding(): Promise<void> {
    try {
      const balances = await this.coinbase.getBalances();
      const btcBal = balances.find((b) => b.currency === "BTC");
      if (btcBal && btcBal.availableBalance > 0.0001) {
        // Filtro por cantidad mínima de BTC
        const price = await this.coinbase.getPrice("BTC-USDC");
        const usdValue = btcBal.availableBalance * price;

        this.currentHolding = "BTC";
        this.currentHoldingSize = btcBal.availableBalance;
        this.currentHoldingEntryPrice = price; // Toma el precio actual como entrada
        logger.success(
          `Holding de BTC vinculado: ${btcBal.availableBalance} BTC ≈ $${usdValue.toFixed(2)}`,
        );
      }
      for (const pair of config.tradingPairs) {
        const base = pair.split("-")[0];
        const bal = balances.find((b) => b.currency === base);
        if (bal && bal.availableBalance > 0) {
          const price = await this.coinbase.getPrice(pair);
          const usdValue = bal.availableBalance * price;
          if (usdValue >= 1) {
            // más de $1 en esa moneda
            this.currentHolding = base;
            this.currentHoldingSize = bal.availableBalance;
            this.currentHoldingEntryPrice = price; // usamos precio actual como referencia
            logger.success(
              `Holding detectado al arrancar: ${bal.availableBalance.toFixed(6)} ${base} ≈ $${usdValue.toFixed(2)}`,
            );
          }
        }
      }
      if (!this.currentHolding) {
        logger.info("Sin holdings activos. Esperando señal de entrada.");
      }
    } catch (err) {
      logger.warn(
        "Error detectando BTC:",
        err instanceof Error ? err.message : "",
      );

      logger.warn(
        "No se pudo detectar holding inicial:",
        err instanceof Error ? err.message : "",
      );
    }
  }
  // En bot.ts
  private savePnL(profit: number, isWin: boolean) {
    let data = { totalPnL: 0, wins: 0, losses: 0 };

    if (fs.existsSync("./pnl_history.json")) {
      data = JSON.parse(fs.readFileSync("./pnl_history.json", "utf-8"));
    }

    data.totalPnL += profit;
    if (isWin) data.wins++;
    else data.losses++;

    fs.writeFileSync("./pnl_history.json", JSON.stringify(data, null, 2));
  }
  private async runCycle(): Promise<void> {
    this.iterationCount++;
    logger.banner(
      `⏱ CICLO #${this.iterationCount} — ${new Date().toLocaleTimeString("es-ES")}`,
    );

    try {
      // 1. Analizar todos los pares
      const analyses: PairAnalysis[] = [];

      for (const pair of config.tradingPairs) {
        logger.info(`Analizando ${pair}...`);
        try {
          const analysis = await this.analyzePair(pair);
          analyses.push(analysis);
          logger.signal(
            `${pair.padEnd(10)} score: ${analysis.finalScore.toFixed(1).padStart(7)} | ` +
              `confianza: ${analysis.confidence.toFixed(0).padStart(3)}% | señal: ${analysis.signal}`,
          );
        } catch (err) {
          logger.warn(
            `Error analizando ${pair}:`,
            err instanceof Error ? err.message : "",
          );
        }
      }

      if (analyses.length === 0) {
        logger.warn("No se pudo analizar ningún par.");
        return;
      }

      logger.divider();

      // 2. Si tenemos holding, comprobar stop loss / take profit
      if (this.currentHolding) {
        const holdingPair = `${this.currentHolding}-USDC`;
        const holdingAnalysis = analyses.find((a) => a.pair === holdingPair);
        const currentPrice =
          holdingAnalysis?.currentPrice ||
          (await this.coinbase.getPrice(holdingPair));

        this.logHoldingStatus(currentPrice);

        // Comprobar stop loss / take profit
        const pnlPct =
          ((currentPrice - this.currentHoldingEntryPrice) /
            this.currentHoldingEntryPrice) *
          100;

        if (pnlPct <= -config.stopLossPercent) {
          logger.warn(
            `🛑 STOP LOSS alcanzado en ${this.currentHolding} (${pnlPct.toFixed(2)}%)`,
          );
          await this.sellCurrentHolding(currentPrice, "STOP_LOSS");
          // Rotar inmediatamente al mejor par disponible
          await this.enterBestOpportunity(analyses);
          return;
        }

        if (pnlPct >= config.takeProfitPercent) {
          logger.success(
            `🎯 TAKE PROFIT alcanzado en ${this.currentHolding} (${pnlPct.toFixed(2)}%)`,
          );
          await this.sellCurrentHolding(currentPrice, "TAKE_PROFIT");
          // Rotar inmediatamente al mejor par disponible
          await this.enterBestOpportunity(analyses);
          return;
        }
        // 3. ¿Hay una moneda mejor? Rotar si su score supera al actual por margen suficiente
        const currentAnalysis = analyses.find(
          (a) => a.baseCurrency === this.currentHolding,
        );
        const bestAlternative = analyses
          .filter((a) => a.baseCurrency !== this.currentHolding)
          .sort((a, b) => b.finalScore - a.finalScore)[0];

        const ROTATION_MARGIN = 5; // el alternativo debe superar al actual en 20 puntos
        if (
          bestAlternative &&
          bestAlternative.finalScore >
            (currentAnalysis?.finalScore || 0) + ROTATION_MARGIN &&
          bestAlternative.finalScore >= config.minSignalScore
        ) {
          logger.trade(
            `🔄 ROTACIÓN: ${this.currentHolding} (${currentAnalysis?.finalScore.toFixed(1)}) → ` +
              `${bestAlternative.baseCurrency} (${bestAlternative.finalScore.toFixed(1)})`,
          );
          await this.rotate(bestAlternative, currentPrice);
        } else {
          logger.info(
            `Manteniendo ${this.currentHolding}. Sin alternativa mejor.`,
          );
        }
        return;
      }

      // 4. Sin holding — buscar el mejor par para entrar
      await this.enterBestOpportunity(analyses);
      const best = analyses
        .filter((a) => a.signal === "BUY")
        .sort((a, b) => b.finalScore - a.finalScore)[0];
      if (best) {
        logger.success(
          `Mejor oportunidad: ${best.pair} (score: ${best.finalScore.toFixed(1)})`,
        );
        await this.buy(best);
      } else {
        logger.info("Sin señales claras de entrada. Esperando...");
      }
    } catch (err) {
      logger.error(
        "Error en ciclo:",
        err instanceof Error ? err.message : String(err),
      );
    }

    logger.divider();
  }

  private async analyzePair(pair: string): Promise<PairAnalysis> {
    const baseCurrency = pair.split("-")[0];
    const candles = await this.coinbase.getCandles(pair, "FIVE_MINUTE", 100);

    if (candles.length < 30) throw new Error("Datos insuficientes");

    const technical = analyzeTechnicals(candles);
    const sentiment = await analyzeSentiment(pair, candles, technical.score);
    if (Math.abs(sentiment.score) < 35) {
      return {
        pair,
        baseCurrency,
        currentPrice: technical.currentPrice,
        sentimentScore: 0,
        finalScore: sentiment.score,
        signal: "HOLD",
        technicalScore: technical.score,
        confidence: technical.confidence,
      };
    }

    const combined = combineSignals(
      technical.score,
      technical.confidence,
      sentiment.score,
      sentiment.confidence,
    );

    return {
      pair,
      baseCurrency,
      currentPrice: technical.currentPrice,
      finalScore: combined.finalScore,
      confidence: combined.confidence,
      signal: combined.signal,
      technicalScore: technical.score,
      sentimentScore: sentiment.score,
    };
  }

  private async buy(analysis: PairAnalysis): Promise<void> {
    try {
      const usdBalance = await this.coinbase.getBalance("USDC");
      const amount = Math.min(config.tradeAmountUSD, usdBalance) * 0.98;
      if (amount < 1) {
        logger.warn(`Saldo USDC insuficiente: $${usdBalance.toFixed(2)}`);
        return;
      }

      const order = await this.coinbase.marketBuy(analysis.pair, amount);
      this.currentHolding = analysis.baseCurrency;
      this.currentHoldingSize = order.filledSize;
      this.currentHoldingEntryPrice =
        order.averagePrice || analysis.currentPrice;

      this.currentTradeId = this.tradeHistory.openRecord(
        analysis.pair,
        this.currentHoldingEntryPrice,
        this.currentHoldingSize,
        order.filledValue || amount,
      );

      logger.success(
        `✅ BUY ${analysis.baseCurrency} | ${this.currentHoldingSize.toFixed(6)} @ $${this.currentHoldingEntryPrice.toFixed(4)}`,
      );
      logger.info(
        `  Stop Loss: $${(this.currentHoldingEntryPrice * (1 - config.stopLossPercent / 100)).toFixed(4)}`,
      );
      logger.info(
        `  Take Profit: $${(this.currentHoldingEntryPrice * (1 + config.takeProfitPercent / 100)).toFixed(4)}`,
      );
    } catch (err) {
      logger.error("Error en BUY:", err instanceof Error ? err.message : "");
    }
  }

  private async sellCurrentHolding(
    currentPrice: number,
    reason: string,
  ): Promise<void> {
    if (!this.currentHolding) return;

    try {
      const balances = await this.coinbase.getBalances();
      const coinBalance = balances.find(
        (b) => b.currency === this.currentHolding,
      );

      if (!coinBalance || coinBalance.availableBalance <= 0) {
        this.currentHolding = null;
        return;
      }

      // --- EL FIX DE LOS DECIMALES ---
      // Truncamos a 4 decimales (seguro para la mayoría de activos en Coinbase)
      // Usamos Math.floor para no intentar vender más de lo que tenemos
      const amountToSell = Math.floor(coinBalance.availableBalance * 100) / 100;

      if (amountToSell <= 0) {
        logger.warn(
          "El balance tras redondear es demasiado pequeño para vender.",
        );
        return;
      }

      logger.info(
        `📤 Vendiendo ${amountToSell} de ${this.currentHolding} (${reason})`,
      );

      const pair = `${this.currentHolding}-USDC`;
      await this.coinbase.marketSell(pair, amountToSell);
      const pnl =
        amountToSell - this.currentHoldingSize * this.currentHoldingEntryPrice;
      const pnlPct =
        (pnl / (this.currentHoldingSize * this.currentHoldingEntryPrice)) * 100;
      this.savePnLToHistory(pnl, pnl >= 0);
      this.currentHolding = null;
      this.currentHoldingSize = 0;
    } catch (err: any) {
      logger.error("Error en SELL:", err.message);
    }
  }

  // Vender holding actual y comprar el alternativo
  private async rotate(
    target: PairAnalysis,
    currentPrice: number,
  ): Promise<void> {
    await this.sellCurrentHolding(currentPrice, "SIGNAL");
    // Pequeña pausa para que el USD quede disponible
    await new Promise((r) => setTimeout(r, 2000));
    await this.buy(target);
  }

  private logHoldingStatus(currentPrice: number): void {
    if (!this.currentHolding) return;
    const pnl =
      (currentPrice - this.currentHoldingEntryPrice) * this.currentHoldingSize;
    const pnlPct =
      ((currentPrice - this.currentHoldingEntryPrice) /
        this.currentHoldingEntryPrice) *
      100;
    const pnlStr =
      pnl >= 0
        ? `+$${pnl.toFixed(2)} (+${pnlPct.toFixed(2)}%)`
        : `-$${Math.abs(pnl).toFixed(2)} (${pnlPct.toFixed(2)}%)`;
    logger.info(
      `Holding: ${this.currentHolding} @ $${currentPrice.toFixed(4)} | PnL: ${pnlStr}`,
    );
  }
  private async enterBestOpportunity(analyses: PairAnalysis[]): Promise<void> {
    await new Promise((r) => setTimeout(r, 2000)); // esperar que USD quede disponible

    const best = analyses
      .filter(
        (a) => a.signal === "BUY" && a.baseCurrency !== this.currentHolding,
      )
      .sort((a, b) => b.finalScore - a.finalScore)[0];

    if (best) {
      logger.trade(
        `↪ Entrando inmediatamente en ${best.pair} (score: ${best.finalScore.toFixed(1)})`,
      );
      await this.buy(best);
    } else {
      logger.info(
        "Sin oportunidades claras tras venta. Esperando siguiente ciclo en USD.",
      );
    }
  }
}
