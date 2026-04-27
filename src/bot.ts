import { CoinbaseClient } from './coinbase';
import { config } from './config';
import { logger } from './logger';

interface Analysis {
  pair: string;
  finalScore: number;
  currentPrice: number;
}

export class TradingBot {
  private exchange: CoinbaseClient;
  private currentHolding: string | null = null;
  private highestPrice: number = 0;
  private buyPrice: number = 0;

  // --- CONFIGURACIÓN DE ESTRATEGIA ---
  private readonly ROTATION_THRESHOLD = 25;   // Diferencia de puntos para rotar
  private readonly TRAILING_STOP_PCT = 3.5;    // % de caída desde el máximo para vender
  private readonly MIN_PROFIT_TO_EXIT = 2.2;   // Profit mínimo para permitir trailing (comisiones)

  // Lista de pares a vigilar
  private readonly WATCHLIST = [
    'BTC-USDC', 'ETH-USDC', 'SOL-USDC', 'ALEO-USDC',
    'RAVE-USDC', 'SUI-USDC', 'PEPE-USDC', 'ADA-USDC'
  ];

  constructor() {
    this.exchange = new CoinbaseClient();
  }
async getPortfolioValueInUSDC(): Promise<number> {
  const balances = await this.exchange.getBalances();
  let totalValue = 0;

  for (const account of balances) {
    if (account.availableBalance <= 0) continue;

    if (account.currency === 'USDC' || account.currency === 'USD') {
      // El USDC ya es dólar, se suma directo
      totalValue += account.availableBalance;
    } else {
      try {
        // Para monedas como BTC, SOL, PEPE, buscamos su precio actual
        const price = await this.exchange.getPrice(`${account.currency}-USDC`);
        totalValue += account.availableBalance * price;
      } catch (e) {
        // Si no existe el par con USDC, ignoramos o logeamos
        // logger.debug(`No se pudo valorar la moneda: ${account.currency}`);
      }
    }
  }
  return totalValue;
}
  /**
   * Ejecuta un ciclo completo de análisis y trading
   */
  async runCycle() {
    try {
      // 1. Obtener análisis de mercado
      const analyses = await this.getAllAnalyses();
      if (analyses.length === 0) {
        logger.warn("⚠️ No se pudieron obtener análisis de mercado.");
        return;
      }

      // 2. Buscar la mejor oportunidad actual
      const topTarget = [...analyses].sort((a, b) => b.finalScore - a.finalScore)[0];

      // 3. Obtener balance de USDC disponible
      const usdcBalance = await this.exchange.getBalance('USDC');

      // 4. LÓGICA DE DECISIÓN
      if (this.currentHolding) {
        await this.managePosition(topTarget, analyses);
      } else {
        await this.manageEntry(topTarget, usdcBalance);
      }

    } catch (error: any) {
      logger.error(`❌ Error en runCycle: ${error.message}`);
    }
  }

  /**
   * Lógica para entrar al mercado cuando estamos en USDC
   */
  private async manageEntry(target: Analysis, balance: number) {
    // Solo entramos si el score es alto (> 45) y tenemos al menos 2 USDC
    if (target.finalScore > 45 && balance > 2) {
      logger.info(`🎯 Oportunidad detectada: ${target.pair} (Score: ${target.finalScore})`);
      await this.executeBuy(target.pair, balance);
    } else {
      logger.info(`💤 Esperando señal fuerte. Mejor actual: ${target.pair} (${target.finalScore})`);
    }
  }

  /**
   * Gestiona la posición abierta (Trailing Stop y Rotaciones)
   */
  private async managePosition(topTarget: Analysis, analyses: Analysis[]) {
    const productId = `${this.currentHolding}-USDC`;
    const currentPrice = await this.exchange.getPrice(productId);
    const currentAnalysis = analyses.find(a => a.pair === productId);

    if (!currentAnalysis) return;

    // A. ACTUALIZAR TRAILING STOP
    if (currentPrice > this.highestPrice) {
      this.highestPrice = currentPrice;
      logger.info(`📈 Nuevo máximo para ${this.currentHolding}: $${currentPrice}`);
    }

    const dropFromMax = ((this.highestPrice - currentPrice) / this.highestPrice) * 100;
const currentPnL = ((currentPrice - this.buyPrice) / this.buyPrice) * 100;
    // B. EJECUTAR TRAILING STOP
    if (dropFromMax >= config.trailingStopPct && currentPnL > config.minProfitFees) {
      if (currentPnL > this.MIN_PROFIT_TO_EXIT) {
        logger.success(`🚨 TRAILING STOP: Vendiendo ${this.currentHolding} con ${currentPnL.toFixed(2)}% de profit.`);
        await this.executeSell();
        return;
      }
    }

    // C. LÓGICA DE ROTACIÓN (+25 PUNTOS)
    if (topTarget.finalScore > (currentAnalysis.finalScore + config.rotationThreshold)) {
      // Solo rotamos si la moneda actual ya dio algo de profit para no quemar la cuenta en comisiones
        if (currentPnL > this.MIN_PROFIT_TO_EXIT) {
            logger.success(`🔄 ROTACIÓN: ${this.currentHolding} (${currentAnalysis.finalScore}) -> ${topTarget.pair} (${topTarget.finalScore})`);
            await this.executeSell();

            // Pausa para actualización de balances en Coinbase
            await new Promise(r => setTimeout(r, 2000));
            const newBalance = await this.exchange.getBalance('USDC');
            await this.executeBuy(topTarget.pair, newBalance);
        }
    } else {
      logger.info(`✅ Holding ${this.currentHolding} | PnL: ${currentPnL.toFixed(2)}% | Score: ${currentAnalysis.finalScore}`);
    }
  }

  private async getAllAnalyses(): Promise<Analysis[]> {
  // 1. Creamos un array de promesas
  const analysisPromises = this.WATCHLIST.map(async (pair) => {
    try {
      const price = await this.exchange.getPrice(pair);

      // Esperamos a que la promesa del Score se resuelva
      const score = await this.calculateRealScore(pair);

      return {
        pair,
        finalScore: score,
        currentPrice: price
      };
    } catch (e) {
      logger.error(`Error analizando ${pair}: ${e}`);
      return null; // Si falla una, devolvemos null
    }
  });

  // 2. Ejecutamos todas las promesas en paralelo y filtramos los errores
  const results = await Promise.all(analysisPromises);

  // Limpiamos los nulls de las monedas que fallaron
  return results.filter((r): r is Analysis => r !== null);
}

  private async calculateRealScore(pair: string): Promise<number> {
  try {
    const prices = await this.exchange.getCandles(pair); // Obtenemos las últimas 60 velas
    if (prices.length < 14) return 20; // Si no hay datos suficientes, score bajo

    const currentPrice = prices[prices.length - 1];
    const previousPrice = prices[prices.length - 2];

    // 1. Cálculo de Momentum (¿Sube o baja respecto al anterior?)
    let score = 30; // Base neutral
    if (currentPrice > previousPrice) score += 10;

    // 2. Media Móvil Simple (SMA) de las últimas 10 velas
    const sma10 = prices.slice(-10).reduce((a:any, b:any) => a + b, 0) / 10;
    if (currentPrice > sma10) score += 15; // Tendencia alcista

    // 3. RSI Simplificado (Fuerza relativa)
    // Si el precio actual es mayor que el de hace 14 velas, hay fuerza
    if (currentPrice > prices[prices.length - 14]) score += 10;

    // Normalizar para que no pase de 100
    return Math.min(score, 100);
  } catch (e) {
    return 20; // En caso de error, devolvemos score mínimo
  }
}

  private async executeBuy(pair: string, amount: number) {
    try {
      const safeAmount = amount * 0.97; // Usar 97% para asegurar que quepan las comisiones
      const res = await this.exchange.marketBuy(pair, safeAmount);

      this.currentHolding = pair.split('-')[0];
      this.buyPrice = res.averagePrice;
      this.highestPrice = res.averagePrice;
      logger.success(`✔ COMPRADO: ${this.currentHolding} a $${this.buyPrice}`);
    } catch (e: any) {
      logger.error(`✖ Error en Compra: ${e.message}`);
    }
  }

  private async executeSell() {
    try {
      const pair = `${this.currentHolding}-USDC`;
      const balance = await this.exchange.getBalance(this.currentHolding!);

      if (balance > 0) {
        await this.exchange.marketSell(pair, balance);
        logger.success(`📤 VENDIDO: ${this.currentHolding} - Volviendo a USDC`);
        this.currentHolding = null;
        this.highestPrice = 0;
        this.buyPrice = 0;
      }
    } catch (e: any) {
      logger.error(`✖ Error en Venta: ${e.message}`);
    }
  }
}