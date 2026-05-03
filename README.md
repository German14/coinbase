🤖 Coinbase Intelligent Trading Bot
Este bot es un sistema de trading automatizado diseñado para generar ingresos pasivos mediante la rotación inteligente de activos en Coinbase. El sistema analiza una watchlist de criptomonedas en tiempo real, asigna una puntuación (score) basada en indicadores técnicos y ejecuta operaciones de intercambio buscando maximizar el beneficio neto.

🚀 Características Principales
Análisis Multimoneda: Escaneo constante de 23+ pares (USDC) para identificar la mejor oportunidad.

Sistema de Scoring Dinámico: Evalúa activos basándose en:

RSI (Relative Strength Index): Identificación de sobrecompra/sobreventa.

Trend Analysis: Detección de tendencias alcistas y bajistas.

Gestión de Riesgo Avanzada:

Trailing Stop (3.5%): Protege las ganancias permitiendo que el stop suba junto con el precio.

Emergency Stop: Cambio de urgencia si la moneda cae por debajo del umbral de beneficio.

Cálculo de Comisiones: Las operaciones solo se ejecutan si el beneficio potencial supera las comisiones de Coinbase.

Logs Detallados: Seguimiento en tiempo real de cada ciclo de análisis y ejecución.

📊 Lógica de Operación
1. Fase de Análisis
El bot recorre la watchlist y asigna puntos:

Tendencia Alcista: Incrementa el Score.

RSI Saludable: Optimiza el punto de entrada.

Umbral de Rotación: Solo se considera un cambio de moneda si la nueva oportunidad supera en +25 puntos (configurable) a la posición actual.

2. Ejecución
Mínimo de Entrada: $1.5 USDC (evita operaciones insignificantes).

Target: Busca el activo con el Score más alto que supere el mínimo de confianza (ej. 50 pts).

🛠️ Configuración (Variables de Entorno)
Para que el bot funcione, debes configurar un archivo .env (no incluido en el repositorio por seguridad):

Fragmento de código
COINBASE_API_KEY=tu_api_key
COINBASE_API_SECRET=tu_api_secret
MIN_CAPITAL=1.5
TRAILING_STOP=3.5
ROTATION_THRESHOLD=25
CHECK_INTERVAL_MS=900000
📋 Ejemplo de Logs
Plaintext
[2:55:04] ℹ 🔝 Mejor oportunidad: TIA-USDC (Score: 67)
[2:55:04] ℹ 💚 SIN POSICIÓN ABIERTA - Evaluando entrada
[2:55:04] ⚠ 💸 Capital insuficiente: $0.05 < $1.5 mínimo
⚠️ Descargo de Responsabilidad (Disclaimer)
Este software es para fines educativos y experimentales. El trading de criptomonedas conlleva un riesgo significativo. No inviertas dinero que no puedas permitirte perder. El autor no se hace responsable de pérdidas financieras derivadas del uso de este bot.

🛠️ Requisitos técnicos
Node.js / Python (según tu implementación).

Cuenta de Coinbase con API Trading habilitada.

Stablecoin (USDC) como base de liquidez.