import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  pair: string;
  amount: number;
  price: number;
  totalValue: number;
  fee: number;
  timestamp: string;
  profit?: number;
  profitPercent?: number;
  reason?: string;
}

export interface TradePair {
  pair: string;
  buyTransaction: Transaction;
  sellTransaction?: Transaction;
  profitUSD?: number;
  profitPercent?: number;
  duration?: string;
}

export class TransactionTracker {
  private transactionsFilePath = path.join(__dirname, '../history.json');
  private transactions: Transaction[] = [];
  private openTrades: Map<string, TradePair> = new Map();

  constructor() {
    this.loadTransactions();
    this.rebuildOpenTrades();
  }

  private loadTransactions() {
    try {
      if (fs.existsSync(this.transactionsFilePath)) {
        const data = fs.readFileSync(this.transactionsFilePath, 'utf8');
        this.transactions = JSON.parse(data);
      }
    } catch (error) {
      logger.warn('No se pudo cargar historial, iniciando nuevo');
      this.transactions = [];
    }
  }

  private saveTransactions() {
    try {
      const dir = path.dirname(this.transactionsFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.transactionsFilePath, JSON.stringify(this.transactions, null, 2));
    } catch (error) {
      logger.error(`Error guardando transacciones: ${error}`);
    }
  }

  private rebuildOpenTrades() {
    this.openTrades.clear();

    for (const tx of this.transactions) {
      if (tx.type === 'BUY') {
        this.openTrades.set(tx.pair, {
          pair: tx.pair,
          buyTransaction: tx
        });
      } else if (tx.type === 'SELL') {
        const trade = this.openTrades.get(tx.pair);
        if (trade) {
          trade.sellTransaction = tx;

          const buyTx = trade.buyTransaction;
          const profitUSD = (tx.totalValue - tx.fee) - (buyTx.totalValue + buyTx.fee);
          const profitPercent = (profitUSD / (buyTx.totalValue + buyTx.fee)) * 100;
          const buyDate = new Date(buyTx.timestamp);
          const sellDate = new Date(tx.timestamp);
          const durationMs = sellDate.getTime() - buyDate.getTime();
          const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
          const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

          trade.profitUSD = profitUSD;
          trade.profitPercent = profitPercent;
          trade.duration = `${durationHours}h ${durationMins}m`;

          this.openTrades.delete(tx.pair);
        }
      }
    }
  }

  recordBuy(pair: string, amount: number, price: number, fee: number = 0, reason: string = 'Manual'): void {
    const totalValue = amount * price;
    const transaction: Transaction = {
      id: `buy-${Date.now()}-${Math.random()}`,
      type: 'BUY',
      pair,
      amount,
      price,
      totalValue,
      fee,
      timestamp: new Date().toISOString(),
      reason
    };

    this.transactions.push(transaction);
    this.saveTransactions();

    logger.success(`\n💰 ========== COMPRA REGISTRADA ==========`);
    logger.info(`   Moneda: ${pair}`);
    logger.info(`   Cantidad: ${amount.toFixed(8)}`);
    logger.info(`   Precio: $${price.toFixed(6)}`);
    logger.info(`   Valor Total: $${totalValue.toFixed(2)}`);
    logger.info(`   Comisiones: $${fee.toFixed(2)}`);
    logger.info(`   Total Invertido: $${(totalValue + fee).toFixed(2)}`);
    logger.info(`   Razón: ${reason}`);
    logger.info(`=========================================\n`);
  }

  recordSell(pair: string, amount: number, price: number, fee: number = 0, reason: string = 'Manual'): void {
    const totalValue = amount * price;
    const transaction: Transaction = {
      id: `sell-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      type: 'SELL',
      pair,
      amount,
      price,
      totalValue,
      fee,
      timestamp: new Date().toISOString(),
      reason
    };

    this.transactions.push(transaction);
    this.saveTransactions();
    this.rebuildOpenTrades();

    // Buscar la compra correspondiente
    const buyTx = this.transactions
      .filter(t => t.type === 'BUY' && t.pair === pair)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    let profitUSD = 0;
    let profitPercent = 0;

    if (buyTx) {
      const costBasis = buyTx.totalValue + buyTx.fee;
      const proceeds = totalValue - fee;
      profitUSD = proceeds - costBasis;
      profitPercent = (profitUSD / costBasis) * 100;
    }

    logger.success(`\n💵 ========== VENTA REGISTRADA ==========`);
    logger.info(`   Moneda: ${pair}`);
    logger.info(`   Cantidad: ${amount.toFixed(8)}`);
    logger.info(`   Precio: $${price.toFixed(6)}`);
    logger.info(`   Valor Total: $${totalValue.toFixed(2)}`);
    logger.info(`   Comisiones: $${fee.toFixed(2)}`);
    logger.info(`   Total Recibido: $${(totalValue - fee).toFixed(2)}`);
    logger.info(`   Razón: ${reason}`);

    if (buyTx) {
      logger.info(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`   📊 GANANCIA/PÉRDIDA:`);
      logger.info(`   Compré a: $${buyTx.price.toFixed(6)}`);
      logger.info(`   Vendí a: $${price.toFixed(6)}`);
      logger.info(`   Ganancia USD: $${profitUSD.toFixed(2)}`);
      logger.info(`   Ganancia %: ${profitPercent.toFixed(2)}%`);
    }
    logger.info(`=========================================\n`);
  }

  getOpenTrades(): TradePair[] {
    return Array.from(this.openTrades.values()).filter(t => t.sellTransaction === undefined);
  }

  getClosedTrades(): TradePair[] {
    return Array.from(this.openTrades.values()).filter(t => t.sellTransaction !== undefined);
  }

  getSummary() {
    const closed = this.getClosedTrades();
    const open = this.getOpenTrades();

    const totalProfit = closed.reduce((sum, t) => sum + (t.profitUSD || 0), 0);
    const totalProfitPercent = closed.length > 0
      ? closed.reduce((sum, t) => sum + (t.profitPercent || 0), 0) / closed.length
      : 0;

    let currentValue = 0;
    let unrealizedProfit = 0;

    for (const trade of open) {
      const invested = trade.buyTransaction.totalValue + trade.buyTransaction.fee;
      currentValue += invested;
    }

    logger.info(`\n${'═'.repeat(50)}`);
    logger.info(`📈 RESUMEN DE TRADING`);
    logger.info(`${'═'.repeat(50)}`);
    logger.info(`✅ Operaciones Cerradas: ${closed.length}`);
    logger.info(`📦 Posiciones Abiertas: ${open.length}`);
    logger.info(`💰 Ganancia Total: $${totalProfit.toFixed(2)} (${totalProfitPercent.toFixed(2)}% promedio)`);

    if (open.length > 0) {
      logger.info(`\n📊 Posiciones Abiertas:`);
      for (const trade of open) {
        const invested = trade.buyTransaction.totalValue + trade.buyTransaction.fee;
        logger.info(`   • ${trade.pair}: ${trade.buyTransaction.amount.toFixed(8)} @ $${trade.buyTransaction.price.toFixed(6)}`);
      }
    }

    if (closed.length > 0) {
      logger.info(`\n✨ Últimas Operaciones Cerradas:`);
      closed.slice(-5).forEach(trade => {
        logger.info(`   • ${trade.pair}: +$${trade.profitUSD?.toFixed(2)} (${trade.profitPercent?.toFixed(2)}%) - ${trade.duration}`);
      });
    }

    logger.info(`${'═'.repeat(50)}\n`);
  }

  getAllTransactions(): Transaction[] {
    return this.transactions;
  }
}
