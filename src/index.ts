import { TradingBot } from "./bot";
import { config } from "./config";
import { logger } from "./logger";
import fetch, { Headers, Request, Response } from "node-fetch";
import FormData from 'form-data';
// Polyfill global para Node 16
(global as any).fetch = fetch;
(global as any).Headers = Headers;
(global as any).Request = Request;
(global as any).Response = Response;
(globalThis as any).FormData = FormData;
async function main() {
  logger.info("🚀 Iniciando Coinbase Trading Bot...");
  logger.info(`📊 Par de trading: ${config.tradingPairs}`);
  logger.info(`💰 Capital por operación: $${config.tradeAmountUSD}`);
  logger.info(`🤖 Estrategia: Indicadores Técnicos + IA Sentiment`);

  const bot = new TradingBot();

  process.on("SIGINT", async () => {
    logger.info("\n🛑 Deteniendo bot...");
    await bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await bot.stop();
    process.exit(0);
  });

  await bot.start();
}

main().catch((err) => {
  logger.error("Error fatal:", err);
  process.exit(1);
});
