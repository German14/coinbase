import fs from 'fs';
import path from 'path';
import { logger } from './logger'; // Tu logger actual

interface DailyStats {
  startBalance: number;
  lastResetDay: string | null;
  tradesCount: number;
}

export class StatsManager {
  private statsFilePath = path.join(__dirname, '../data/stats.json');
  private initialInvestment = 17.00; // Tu inversión real
  private stats: DailyStats = {
    startBalance: 17.00,
    lastResetDay: null,
    tradesCount: 0
  };

  constructor() {
    this.loadStats();
  }

  private loadStats() {
    if (fs.existsSync(this.statsFilePath)) {
      this.stats = JSON.parse(fs.readFileSync(this.statsFilePath, 'utf8'));
    } else {
      this.saveStats();
    }
  }

  private saveStats() {
    if (!fs.existsSync(path.dirname(this.statsFilePath))) {
      fs.mkdirSync(path.dirname(this.statsFilePath));
    }
    fs.writeFileSync(this.statsFilePath, JSON.stringify(this.stats, null, 2));
  }

  public incrementTradeCount() {
    this.stats.tradesCount++;
    this.saveStats();
  }

  public async processDailyReport(currentBalance: number) {
    const today = new Date().toISOString().split('T')[0];

    if (this.stats.lastResetDay !== today) {
      // Si no es el primer arranque, mostramos el resumen del día que acaba de terminar
      if (this.stats.lastResetDay !== null) {
        const dailyDiff = currentBalance - this.stats.startBalance;
        const dailyPct = (dailyDiff / this.stats.startBalance) * 100;
        const totalDiff = currentBalance - this.initialInvestment;
        const totalPct = (totalDiff / this.initialInvestment) * 100;

        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        logger.info(`📅 REPORTE DIARIO: ${this.stats.lastResetDay}`);
        logger.info(`💰 Inicio: $${this.stats.startBalance.toFixed(2)} | Final: $${currentBalance.toFixed(2)}`);
        logger.info(`📈 Rendimiento Hoy: ${dailyPct.toFixed(2)}% (${dailyDiff.toFixed(2)} USDC)`);
        logger.info(`🔄 Operaciones Hoy: ${this.stats.tradesCount}`);
        logger.info(`🌍 TOTAL ACUMULADO: ${totalPct.toFixed(2)}% ($${totalDiff.toFixed(2)} USDC)`);
        logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      }

      // Reiniciamos para el nuevo día
      this.stats.startBalance = currentBalance;
      this.stats.lastResetDay = today;
      this.stats.tradesCount = 0;
      this.saveStats();
    }
  }
}