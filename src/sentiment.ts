import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config';
import { logger } from './logger';
import { Candle } from './coinbase';
import Groq from "groq-sdk";
import fetch, { Headers, Request, Response } from "node-fetch";
import FormData from 'form-data';

export interface SentimentResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  confidence: number;
  reasoning: string;
  marketCondition: string;
}
// Pasamos el fetch directamente al constructor
const groq = new Groq({
  apiKey: config.groqApiKey,
  fetch: fetch as any,
});

export async function analyzeSentiment(
  pair: string,
  candles: Candle[],
  technicalScore: number,
): Promise<SentimentResult> {
  // ... (toda tu lógica de cálculo de precios, volumen y volatilidad se queda igual) ...
  const recent = candles.slice(-20);
  const currentPrice = recent[recent.length - 1].close;

  const prompt = `Eres un analista experto de criptomonedas. Analiza estos datos:
  Par: ${pair}
  Precio actual: $${currentPrice.toFixed(2)}
  Score Técnico: ${technicalScore}
  (Analiza la tendencia y el volumen),Prioriza monedas que estén rompiendo resistencias con volumen creciente y tambien se lo más agresivo que puedas con las monedas

  Responde ÚNICAMENTE con JSON válido, sin markdown ni texto extra:
  {"signal":"BUY","score":75,"confidence":80,"marketCondition":"estable","reasoning":"explicación corta"}`;

  try {
    // LLAMADA A GROQ
    const chatCompletion = await groq.chat.completions.create({

      messages: [
        {
          role: "system",
          content: "Eres un bot de trading de alta precisión. Solo respondes en formato JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.1, // Baja temperatura para respuestas más consistentes
    });

    const responseContent = chatCompletion.choices[0]?.message?.content || "";

    // Limpiamos la respuesta por si la IA añade markdown de bloque de código
    const text = responseContent.trim().replace(/```json/g, '').replace(/```/g, '').trim();

    return JSON.parse(text) as SentimentResult;
  } catch (err) {
    if (err instanceof Error) {
      logger.warn(`Error Groq: ${err.message}`);
    }
    // Fallback: Si la IA falla, devolvemos un score neutral para que decidan los indicadores técnicos
    return {
      signal: 'HOLD',
      score: 0,
      confidence: 0,
      reasoning: 'Error en Groq API.',
      marketCondition: 'Desconocido'
    };
  }
}

export function combineSignals(
  technicalScore: number,
  technicalConfidence: number,
  sentimentScore: number,
  sentimentConfidence: number,
): { signal: 'BUY' | 'SELL' | 'HOLD'; finalScore: number; confidence: number } {
  const weightedScore = technicalScore * 0.6 + sentimentScore * 0.4;
  const weightedConfidence = technicalConfidence * 0.6 + sentimentConfidence * 0.4;
  const signal: 'BUY' | 'SELL' | 'HOLD' =
    weightedScore >= config.minSignalScore ? 'BUY' :
    weightedScore <= -config.minSignalScore ? 'SELL' : 'HOLD';
  return { signal, finalScore: weightedScore, confidence: weightedConfidence };
}