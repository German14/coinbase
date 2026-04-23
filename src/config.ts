import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Coinbase Advanced Trade API
  coinbaseApiKey: process.env.COINBASE_API_KEY || "",
  coinbaseApiSecret: process.env.COINBASE_API_SECRET || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  // Anthropic API (para análisis de sentimiento IA)
  // anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  // Trading settings
  // Reemplaza la línea de tradingPair por:
  tradingPairs: (process.env.TRADING_PAIRS || "BTC-USDC,ETH-USDC,SOL-USDC")
    .split(",")
    .map((p) => p.trim()),
  tradeAmountUSD: parseFloat(process.env.TRADE_AMOUNT_USD || "50"),

  // Intervalos
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || "60000"), // 1 minuto

  // Indicadores técnicos
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  emaPeriod: 20,

  // Risk management
  stopLossPercent: parseFloat(process.env.STOP_LOSS_PCT || "2"), // 2%
  takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PCT || "4"), // 4%
  maxOpenTrades: 3,

  // Señal combinada: umbral mínimo para operar (0-100)
  minSignalScore: 40,
};

export function validateConfig(): void {
  const required = [
    "coinbaseApiKey",
    "coinbaseApiSecret",
    "groqApiKey",
  ] as const;
  for (const key of required) {
    if (!config[key]) {
      throw new Error(
        `❌ Falta variable de entorno: ${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`,
      );
    }
  }
}
