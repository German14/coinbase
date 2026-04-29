import { config } from './config';
import { logger } from './logger';

export interface Position {
  productId: string;
  entryPrice: number;
  size: number;
  entryValue: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice: number; // Para el Trailing Stop
}

export class RiskManager {
  private openPosition: Position | null = null;

  openTrade(productId: string, entryPrice: number, size: number, entryValue: number): Position {
    // El Take Profit debe ser el % que quieres + lo que necesitas para cubrir fees
    const targetPct = (config.takeProfitPercent + config.minProfitFees) / 100;

    this.openPosition = {
      productId,
      entryPrice,
      size,
      entryValue,
      highestPrice: entryPrice,
      stopLoss: entryPrice * (1 - config.stopLossPercent / 100),
      takeProfit: entryPrice * (1 + targetPct)
    };

    logger.success(`✅ Posición en ${productId} abierta a $${entryPrice}`);
    return this.openPosition;
  }

  // Lógica de Trailing Stop: Si el precio sube, el Stop Loss sube con él
  updateTrailingStop(currentPrice: number): void {
    if (!this.openPosition) return;

    if (currentPrice > this.openPosition.highestPrice) {
      this.openPosition.highestPrice = currentPrice;
      const newStopLoss = currentPrice * (1 - config.trailingStopPct / 100);

      // Solo subimos el stop, nunca lo bajamos
      if (newStopLoss > this.openPosition.stopLoss) {
        this.openPosition.stopLoss = newStopLoss;
        logger.info(`📈 Trailing Stop sube a: $${newStopLoss.toFixed(4)}`);
      }
    }
  }

  shouldSell(currentPrice: number): { sell: boolean; reason: string } {
    if (!this.openPosition) return { sell: false, reason: "" };

    if (currentPrice >= this.openPosition.takeProfit) return { sell: true, reason: "TAKE_PROFIT" };
    if (currentPrice <= this.openPosition.stopLoss) return { sell: true, reason: "STOP_LOSS / TRAILING" };

    return { sell: false, reason: "" };
  }

  getOpenPosition() { return this.openPosition; }
  closeTrade() { this.openPosition = null; }
}