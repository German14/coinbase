import fetch, { Headers, Request, Response } from 'node-fetch';
(global as any).fetch = fetch;
(global as any).Headers = Headers;
(global as any).Request = Request;
(global as any).Response = Response;

import { CoinbaseClient } from './coinbase';
import { validateConfig } from './config';
import chalk from 'chalk';
import fs from 'fs'; // Necesario para leer el historial de ganancias

async function showBalance() {
  validateConfig();
  const client = new CoinbaseClient();

  // 1. SECCIÓN DE PORTFOLIO (Tu código actual)
  console.log(chalk.gray('\n' + '─'.repeat(50)));
  console.log(chalk.bold.white('  💼 PORTFOLIO ACTUAL'));
  console.log(chalk.gray('─'.repeat(50)));

  const balances = await client.getBalances();
  const active = balances.filter((b) => b.availableBalance + b.holdBalance > 0);

  let totalUSD = 0;
  if (active.length === 0) {
    console.log(chalk.yellow('  Sin saldo en ninguna moneda.'));
  } else {
    for (const b of active) {
      const total = b.availableBalance + b.holdBalance;
      let usdValue = 0;
      let priceStr = '';

      if (['USD', 'USDC', 'USDT'].includes(b.currency)) {
        usdValue = total;
        priceStr = chalk.gray('(stable)');
      } else {
        try {
          const price = await client.getPrice(`${b.currency}-USD`);
          usdValue = total * price;
          priceStr = chalk.gray(`@ $${price.toFixed(2)}`);
        } catch { priceStr = chalk.gray('(sin precio)'); }
      }
      totalUSD += usdValue;
      console.log(`  ${chalk.bold.cyan(b.currency.padEnd(8))} ${total.toFixed(6).padStart(18)} ${priceStr.padEnd(20)} = ${chalk.green(`$${usdValue.toFixed(2)}`)}`);
    }
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  ${chalk.bold.white('TOTAL ESTIMADO'.padEnd(28))} ${chalk.bold.green('$' + totalUSD.toFixed(2))} USD`);
  }

  // 2. NUEVA SECCIÓN: MONITOR DE GANANCIAS (PnL)
  console.log('\n' + chalk.gray('─'.repeat(50)));
  console.log(chalk.bold.magenta('  📊 RENDIMIENTO DEL BOT (PnL)'));
  console.log(chalk.gray('─'.repeat(50)));

  try {
    // Intentamos leer el archivo donde el bot guarda las ganancias
    if (fs.existsSync('./pnl_history.json')) {
      const pnlData = JSON.parse(fs.readFileSync('./pnl_history.json', 'utf-8'));

      const winRate = ((pnlData.wins / (pnlData.wins + pnlData.losses)) * 100) || 0;
      const colorPnL = pnlData.totalPnL >= 0 ? chalk.green : chalk.red;

      console.log(`  ${chalk.white('Ganancia Total:'.padEnd(25))} ${colorPnL('$' + pnlData.totalPnL.toFixed(2))}`);
      console.log(`  ${chalk.white('Operaciones Ganadas:'.padEnd(25))} ${chalk.green(pnlData.wins)}`);
      console.log(`  ${chalk.white('Operaciones Perdidas:'.padEnd(25))} ${chalk.red(pnlData.losses)}`);
      console.log(`  ${chalk.white('Ratio de Acierto:'.padEnd(25))} ${chalk.cyan(winRate.toFixed(2) + '%')}`);
    } else {
      console.log(chalk.gray('  No hay historial de trading todavía.'));
    }
  } catch (err) {
    console.log(chalk.red('  Error al cargar datos de PnL.'));
  }

  console.log(chalk.gray('─'.repeat(50) + '\n'));
}

showBalance().catch((err) => {
  console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
  process.exit(1);
});
