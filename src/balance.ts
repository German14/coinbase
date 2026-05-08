import { CoinbaseClient } from './coinbase';
import { TransactionTracker } from './transactionTracker';
import * as fs from 'fs';
import { config } from './config';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface HistoryEntry {
  date: string;
  totalValue: number;
}

export class BalanceManager {
  private client: CoinbaseClient;
  private tracker: TransactionTracker;
  private readonly DUST_THRESHOLD = 0.01;
  private readonly historyFile = './history.json';

  constructor(client: CoinbaseClient) {
    this.client = client;
    this.tracker = new TransactionTracker();
  }

  private saveToHistory(totalValue: number): HistoryEntry[] {
    let history: HistoryEntry[] = [];
    try {
      if (fs.existsSync(this.historyFile)) {
        history = JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
      }
    } catch (e) {
      history = [];
    }
    const today = new Date().toISOString().split('T')[0];
    const existingIndex = history.findIndex(e => e.date === today);
    if (existingIndex !== -1) {
      history[existingIndex].totalValue = totalValue;
    } else {
      history.push({ date: today, totalValue });
    }
    if (history.length > 30) history.shift();
    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));
    return history;
  }

  async printReport() {
    try {




      const rawBalances = await this.client.getBalances();

      let totalValue = 0;
      // Usamos el capital inicial del .env
      const initialInv = parseFloat(process.env.INITIAL_INVESTMENT || '25.00');

      console.log(`\n${BOLD}${CYAN}==========================================${RESET}`);
      console.log(`${BOLD}${CYAN}    📊 PERFORMANCE & TRADING REPORT       ${RESET}`);
      console.log(`${BOLD}${CYAN}==========================================${RESET}\n`);

      for (const account of rawBalances) {
        if (account.availableBalance <= 0) continue;
        let valueInUSDC = 0;

        if (['USDC', 'USD', 'EUR'].includes(account.currency)) {
          valueInUSDC = account.availableBalance;
        } else {
          try {
            const price = await this.client.getPrice(`${account.currency}-USDC`);
            valueInUSDC = account.availableBalance * price;
          } catch (e) { valueInUSDC = 0; }
        }

        if (valueInUSDC > this.DUST_THRESHOLD) {
          totalValue += valueInUSDC;
          console.log(
            `${GREEN}  ✔ ${account.currency.padEnd(6)}${RESET} | ` +
            `Cant: ${YELLOW}${account.availableBalance.toFixed(4).padEnd(10)}${RESET} | ` +
            `Valor: ${GREEN}$${valueInUSDC.toFixed(2)}${RESET} USDC`
          );
        }
      }

      const history = this.saveToHistory(totalValue);
      const lastWeekEntry = history.length >= 7 ? history[history.length - 7] : history[0];

      const totalProfit = totalValue - initialInv;

      // --- CÁLCULO DE EFICIENCIA ---
      // La eficiencia es el ratio de beneficio respecto a la inversión inicial
      // Un 100% significa que has duplicado el capital.
      // Un 0% significa que estás en el punto de equilibrio (break-even).
      const efficiency = (totalProfit / initialInv) * 100;
      const effColor = efficiency >= 0 ? GREEN : RED;

      console.log(`\n${BOLD}${CYAN}------------------------------------------${RESET}`);
      console.log(`${BOLD}  VALOR ACTUAL:       ${GREEN}$${totalValue.toFixed(2)} USDC${RESET}`);
      console.log(`${BOLD}  INVERSIÓN INICIAL:  ${YELLOW}$${initialInv.toFixed(2)} USDC${RESET}`);

      console.log(`\n${BOLD}  EFICIENCIA DEL BOT: ${effColor}${efficiency.toFixed(2)}% ${efficiency >= 0 ? '🚀' : '📉'}${RESET}`);

      console.log(`${BOLD}  HISTÓRICO TOTAL:    ${totalProfit >= 0 ? GREEN : RED}${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)} USDC${RESET}`);
      console.log(`${BOLD}${CYAN}------------------------------------------${RESET}\n`);

      // ===== TRANSACCIONES DETALLADAS =====
      console.log(`${BOLD}${CYAN}📈 DETALLE DE TRANSACCIONES${RESET}`);
      this.tracker.getSummary();

    } catch (error: any) {
      console.log(`${RED}❌ Error: ${error.message}${RESET}`);
    }
  }
}

async function run() {
  try {
    const client = new CoinbaseClient();
    const manager = new BalanceManager(client);
    await manager.printReport();
    process.exit(0);
  } catch (error) { process.exit(1); }
}

run();