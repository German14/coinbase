# 🤖 Coinbase Trading Bot

Bot de trading automatizado para **Coinbase Advanced Trade** escrito en **TypeScript**.  
Combina **indicadores técnicos clásicos** con **análisis de sentimiento por IA** (Claude) para tomar decisiones de compra/venta.

---

## ⚙️ Arquitectura

```
src/
├── index.ts       → Punto de entrada, manejo de señales del proceso
├── bot.ts         → Orquestación principal del ciclo de trading
├── coinbase.ts    → Cliente HTTP para la API de Coinbase Advanced Trade
├── indicators.ts  → RSI, MACD, EMA (cálculo puro, sin librerías externas)
├── sentiment.ts   → Análisis de sentimiento vía Claude (Anthropic API)
├── risk.ts        → Gestión de posiciones, stop loss, take profit, historial
├── config.ts      → Configuración centralizada desde variables de entorno
└── logger.ts      → Logger con colores para terminal
```

### Estrategia combinada (60% técnico + 40% IA)

| Indicador     | Peso | Descripción                              |
|---------------|------|------------------------------------------|
| RSI           | ~24% | Sobrecompra/sobreventa (periodo 14)       |
| MACD          | ~24% | Cruce de líneas y histograma              |
| EMA           | ~12% | Precio vs media exponencial (periodo 20)  |
| IA Sentiment  | 40%  | Claude analiza momentum, volumen, precio  |

**Score final**: -100 (muy bajista) → 0 (neutro) → +100 (muy alcista)  
**Umbral para operar**: ≥60 para BUY, ≤-60 para SELL (configurable)

---

## 🚀 Instalación

### Requisitos
- Node.js v18 o superior
- Cuenta en [Coinbase Advanced Trade](https://advanced.coinbase.com)
- API Key de [Anthropic](https://console.anthropic.com)

### Pasos

```bash
# 1. Instalar dependencias
cd coinbase-bot
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus claves API

# 3. Compilar TypeScript
npm run build

# 4. Ejecutar
npm start

# O en modo desarrollo (sin compilar)
npm run dev
```

---

## 🔑 Configuración de API Keys

### Coinbase Advanced Trade
1. Ve a [coinbase.com/settings/api](https://www.coinbase.com/settings/api)
2. Crea una nueva API Key
3. Permisos necesarios: **View** y **Trade** (⚠️ NO marques "Withdraw" ni "Transfer")
4. Guarda el API Key y Secret en tu `.env`

### Anthropic (Claude)
1. Ve a [console.anthropic.com](https://console.anthropic.com)
2. Crea una API Key
3. Ponla en `ANTHROPIC_API_KEY` en tu `.env`

---

## ⚠️ Risk Management

El bot incluye protección automática:

| Protección     | Por defecto | Variable          |
|----------------|-------------|-------------------|
| Stop Loss      | -2%         | `STOP_LOSS_PCT`   |
| Take Profit    | +4%         | `TAKE_PROFIT_PCT` |
| Capital por op | $50 USD     | `TRADE_AMOUNT_USD`|

**Solo se mantiene 1 posición abierta a la vez.**  
Una vez abierta, el bot solo monitorea stop loss / take profit hasta cerrarla.

---

## 📊 Ejemplo de output en terminal

```
────────────────────────────────────────────────
  ⏱ CICLO #5 — 14:32:01
────────────────────────────────────────────────
ℹ  Precio actual: $67,432.10
ℹ  Calculando indicadores técnicos...
▶  RSI: 28.4 | MACD hist: -0.0023 | EMA20: $68,100.00
ℹ    → RSI sobrevendido (28.4) → señal BUY
ℹ    → MACD cruce bajista (hist: -0.0023)
ℹ  Consultando análisis de sentimiento IA...
▶  IA Sentiment: BUY (+72) | Momentum de recuperación
ℹ    → RSI en zona de sobreventa con volumen creciente sugiere rebote inminente.
▶  Score combinado: [░░░░░░░░░░|████████░░] 68.8 | Confianza: 74%
▶  Señal final: BUY
◆  Ejecutando BUY de $50...
✔  Orden BUY ejecutada | ID: abc123 | Precio: $67,432.10 | Size: 0.000742
✔  Stop Loss: $66,083.45 (-2%) | Take Profit: $70,129.38 (+4%)
```

---

## 🔧 Configuración avanzada

Edita `.env` para ajustar el comportamiento:

```env
# Par de trading
TRADING_PAIR=ETH-USD       # BTC-USD, SOL-USD, DOGE-USD...

# Más agresivo (menos capital, más operaciones)
TRADE_AMOUNT_USD=25
MIN_SIGNAL_SCORE=50

# Más conservador (stop loss más ajustado)
STOP_LOSS_PCT=1.5
TAKE_PROFIT_PCT=3

# Análisis cada 5 minutos
CHECK_INTERVAL_MS=300000
```

---

## ⚡ Disclaimer

> Este bot es un **proyecto educativo/experimental**. El trading de criptomonedas conlleva **riesgo de pérdida total del capital**. Empieza con cantidades muy pequeñas ($10-$25) hasta entender bien el comportamiento. El autor no se responsabiliza de pérdidas económicas.
