import Groq from "groq-sdk";
import { config } from "./config";
import { logger } from "./logger";
const fetch = require("node-fetch"); // Importamos fetch manualmente
if (!globalThis.fetch) {
  (globalThis as any).fetch = fetch;
  (globalThis as any).Headers = fetch.Headers;
  (globalThis as any).Request = fetch.Request;
  (globalThis as any).Response = fetch.Response;
  if (!(globalThis as any).FormData) {
    (globalThis as any).FormData = class FormData {};
  }
}
export class SentimentAnalyzer {
  private groq: Groq;
  constructor() {
    this.groq = new Groq({
      apiKey: config.groqApiKey,
      fetch: fetch, // <-- Se lo pasamos directamente aquí
    });
  }

 async analyzeWithGroq(
  pair: string,
  data: { rsi: number; price: number; trend: string; macd: any },
  btcContext: any,
): Promise<number> {
  try {
    const macdSignal = data.macd
      ? `- MACD: ${data.macd.macd.toFixed(4)} | Señal: ${data.macd.signal.toFixed(4)} | Histograma: ${data.macd.histogram > 0 ? '▲ positivo' : '▼ negativo'}`
      : '';

    const prompt = `
Eres un analista de trading cuantitativo. Evalúa el par ${pair} y devuelve un Score del 1 al 100.

CONTEXTO DE MERCADO (BTC):
- Precio BTC: $${btcContext.btcPrice}
- Variación BTC 24h: ${btcContext.btcChange24h}%
- Tendencia BTC: ${btcContext.btcTrend}

DATOS TÉCNICOS DE ${pair}:
- Precio actual: $${data.price}
- RSI (14): ${data.rsi.toFixed(2)}
- Tendencia EMA: ${data.trend}
${macdSignal}

RÚBRICA DE PUNTUACIÓN (úsala exactamente):
90-100: RSI entre 40-60, MACD histograma positivo y creciente, tendencia alcista, BTC alcista
75-89:  RSI entre 35-65, señales mayormente positivas, BTC neutro o alcista
60-74:  Señales mixtas pero con sesgo positivo, sin señales de alarma claras
45-59:  Señales neutras o contradictorias, sin dirección clara
30-44:  RSI < 35 o > 70, tendencia bajista, MACD negativo o BTC bajista fuerte
1-29:   Múltiples señales de venta: RSI extremo + tendencia bajista + BTC en caída

PENALIZACIONES AUTOMÁTICAS:
- RSI > 72: restar 12 puntos al score base
- RSI < 28: restar 8 puntos (sobreventa extrema, riesgo de continuación)
- BTC variación < -3%: restar 10 puntos
- MACD histograma negativo: restar 5 puntos

BONIFICACIONES:
- RSI entre 45-58 (zona óptima de entrada): sumar 8 puntos
- MACD cruzando al alza (histograma positivo y creciente): sumar 7 puntos
- BTC variación > +2%: sumar 5 puntos

Calcula el score final aplicando la rúbrica y los ajustes.
Devuelve SOLO el número final, sin texto adicional.
    `;

    const completion = await this.groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Eres un sistema de scoring cuantitativo. Respondes únicamente con un número entero entre 1 y 100, sin texto adicional.",
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.3-70b-versatile", // ← modelo más capaz, misma velocidad en Groq
      temperature: 0.3,  // algo más de variación para scores granulares
      max_tokens: 10,
    });

    const response = completion.choices[0]?.message?.content?.trim() || "50";
    const score = parseInt(response.replace(/\D/g, ""));

    if (isNaN(score) || score < 1 || score > 100) {
      logger.warn(`IA devolvió valor inválido para ${pair}: "${response}", usando 50`);
      return 50;
    }

    return Math.min(100, Math.max(1, score)); // clampar por seguridad
  } catch (error: any) {
    logger.error(`Error en Groq para ${pair}: ${error.message}`);
    return 50;
  }
}
}
