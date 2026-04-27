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

  /**
   * Analiza datos técnicos y devuelve un score numérico mediante IA
   */
  async analyzeWithGroq(
    pair: string,
    data: { rsi: number; price: number; trend: string },
  ): Promise<number> {
    try {
      const prompt = `
        Analiza como trader experto el par ${pair}:
        - RSI: ${data.rsi.toFixed(2)}
        - Precio: ${data.price}
        - Tendencia: ${data.trend}

        Responde ÚNICAMENTE con un número entero del 1 al 100.
        - 80-100: Compra fuerte (RSI bajo, tendencia recuperando).
        - 60-79: Compra moderada.
        - 40-59: Neutral/Espera.
        - 1-39: Venta (Sobrecarga, RSI muy alto > 70).

        No incluyas texto, solo el número.
      `;

      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Eres un bot de trading de alta precisión. Solo respondes con números.",
          },
          { role: "user", content: prompt },
        ],
        model: "llama-3.1-8b-instant", // El modelo más rápido de Groq
        temperature: 0.1, // Casi sin aleatoriedad para ser consistente
        max_tokens: 10, // No necesitamos más que un par de dígitos
      });

      const response = completion.choices[0]?.message?.content?.trim() || "50";

      // Limpiamos la respuesta por si la IA devuelve algo de texto extra
      const score = parseInt(response.replace(/\D/g, ""));

      if (isNaN(score)) {
        logger.warn(
          `IA devolvió un valor no numérico para ${pair}, usando 50.`,
        );
        return 50;
      }

      return score;
    } catch (error: any) {
      logger.error(`Error en Groq para ${pair}: ${error.message}`);
      return 50; // Retorno neutral por seguridad
    }
  }
}
