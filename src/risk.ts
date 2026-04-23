import { config } from './config';
import { logger } from './logger';

export interface Position {
  productId: string;
  side: 'BUY';
  entryPrice: number;
  size: number;        // en base currency (BTC, ETH...)
  entryValue: number;  // en USD
  entryTime: Date;
  stopLoss: number;
  takeProfit: number;
  orderId: string;
}

export class RiskManager {
  private openPosition: Position | null = null;

  openTrade(
    productId: string,
    entryPrice: number,
    size: number,
    entryValue: number,
    orderId: string,
  ): Position {
    const stopLoss = entryPrice * (1 - config.stopLossPercent / 100);
    const takeProfit = entryPrice * (1 + config.takeProfitPercent / 100);

    this.openPosition = {
      productId,
      side: 'BUY',
      entryPrice,
      size,
      entryValue,
      entryTime: new Date(),
      stopLoss,
      takeProfit,
      orderId,
    };

    logger.success(`Posición abierta: ${size.toFixed(6)} ${productId.split('-')[0]} @ $${entryPrice.toFixed(2)}`);
    logger.info(`  Stop Loss: $${stopLoss.toFixed(2)} (-${config.stopLossPercent}%)`);
    logger.info(`  Take Profit: $${takeProfit.toFixed(2)} (+${config.takeProfitPercent}%)`);

    return this.openPosition;
  }

  closeTrade(): void {
    this.openPosition = null;
  }

  getOpenPosition(): Position | null {
    return this.openPosition;
  }

  hasOpenPosition(): boolean {
    return this.openPosition !== null;
  }

  shouldStopLoss(currentPrice: number): boolean {
    if (!this.openPosition) return false;
    return currentPrice <= this.openPosition.stopLoss;
  }

  shouldTakeProfit(currentPrice: number): boolean {
    if (!this.openPosition) return false;
    return currentPrice >= this.openPosition.takeProfit;
  }

  getPnL(currentPrice: number): { pnl: number; pnlPercent: number } {
    if (!this.openPosition) return { pnl: 0, pnlPercent: 0 };
    const currentValue = this.openPosition.size * currentPrice;
    const pnl = currentValue - this.openPosition.entryValue;
    const pnlPercent = (pnl / this.openPosition.entryValue) * 100;
    return { pnl, pnlPercent };
  }

  logPositionStatus(currentPrice: number): void {
    if (!this.openPosition) return;
    const { pnl, pnlPercent } = this.getPnL(currentPrice);
    const pnlStr = pnl >= 0
      ? `+$${pnl.toFixed(2)} (+${pnlPercent.toFixed(2)}%)`
      : `-$${Math.abs(pnl).toFixed(2)} (${pnlPercent.toFixed(2)}%)`;

    logger.info(`Posición abierta | Entrada: $${this.openPosition.entryPrice.toFixed(2)} | Actual: $${currentPrice.toFixed(2)} | PnL: ${pnlStr}`);
  }
}

// Historial de trades
export interface TradeRecord {
  id: number;
  productId: string;
  buyPrice: number;
  sellPrice: number | null;
  size: number;
  buyValue: number;
  sellValue: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  openTime: Date;
  closeTime: Date | null;
  closeReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL' | null;
}

export class TradeHistory {
  private trades: TradeRecord[] = [];
  private nextId = 1;

  openRecord(productId: string, buyPrice: number, size: number, buyValue: number): number {
    const id = this.nextId++;
    this.trades.push({
      id,
      productId,
      buyPrice,
      sellPrice: null,
      size,
      buyValue,
      sellValue: null,
      pnl: null,
      pnlPercent: null,
      openTime: new Date(),
      closeTime: null,
      closeReason: null,
    });
    return id;
  }

  closeRecord(id: number, sellPrice: number, sellValue: number, reason: TradeRecord['closeReason']): void {
    const trade = this.trades.find((t) => t.id === id);
    if (!trade) return;
    trade.sellPrice = sellPrice;
    trade.sellValue = sellValue;
    trade.pnl = sellValue - trade.buyValue;
    trade.pnlPercent = (trade.pnl / trade.buyValue) * 100;
    trade.closeTime = new Date();
    trade.closeReason = reason;
  }

  printSummary(): void {
    const closed = this.trades.filter((t) => t.pnl !== null);
    if (closed.length === 0) {
      logger.info('Sin trades cerrados en esta sesión.');
      return;
    }

    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
    const losses = closed.filter((t) => (t.pnl || 0) <= 0).length;

    logger.banner('📊 RESUMEN DE SESIÓN');
    logger.info(`Trades cerrados: ${closed.length} (${wins} ganadores, ${losses} perdedores)`);
    logger.info(`PnL total: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);

    for (const t of closed) {
      const pnlStr = (t.pnl || 0) >= 0 ? `+$${t.pnl?.toFixed(2)}` : `-$${Math.abs(t.pnl || 0).toFixed(2)}`;
      logger.info(`  #${t.id} | ${t.closeReason} | ${pnlStr} | ${t.pnlPercent?.toFixed(2)}%`);
    }
  }

  getAll(): TradeRecord[] {
    return this.trades;
  }
}
