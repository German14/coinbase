import dotenv from "dotenv";
dotenv.config();

export const config = {
  coinbaseApiKey: process.env.COINBASE_API_KEY || "",
  coinbaseApiSecret: process.env.COINBASE_API_SECRET || "",
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || "30000"),
  trailingStopPct: parseFloat(process.env.TRAILING_STOP_PCT || "3.5"),
  minProfitFees: parseFloat(process.env.MIN_PROFIT_TO_COVER_FEES || "2.2"),
  rotationThreshold: parseInt(process.env.ROTATION_THRESHOLD || "25"),
  minSignalScore: parseInt(process.env.MIN_SIGNAL_SCORE || "60"),
  tradeAmountUsdc: process.env.TRADE_AMOUNT_USDC || "MAX",
  watchlist: (process.env.WATCHLIST || "BTC-USDC").split(","),
  groqApiKey: process.env.GROQ_API_KEY || "",
  initialInvestment: parseFloat(process.env.INITIAL_INVESTMENT || "25.00"),
  stopLossPercent: Number(process.env.STOP_LOSS_PERCENT) || 5,
  takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT) || 10,
  emaPeriod: Number(process.env.EMA_PERIOD) || 200,
};

export function validateConfig(): void {
  const missingKeys = [];

  if (!config.coinbaseApiKey) missingKeys.push("COINBASE_API_KEY");
  if (!config.coinbaseApiSecret) missingKeys.push("COINBASE_API_SECRET");

  if (missingKeys.length > 0) {
    throw new Error(
      `❌ Faltan variables críticas en el .env: ${missingKeys.join(", ")}`,
    );
  }

  if (isNaN(config.checkIntervalMs) || config.checkIntervalMs < 5000) {
    throw new Error(
      "❌ El CHECK_INTERVAL_MS debe ser un número mayor a 5000 (5 segundos).",
    );
  }

  if (config.trailingStopPct <= 0) {
    throw new Error("❌ El TRAILING_STOP_PCT debe ser mayor a 0.");
  }

  console.log("✅ Configuración validada correctamente.");
}
