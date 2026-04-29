import { TradingBot } from './bot';
import { logger } from './logger';
import { config, validateConfig } from './config';
import { CoinbaseClient } from './coinbase';


async function start() {
  logger.info('🚀 Iniciando Sistema de Trading Inteligente...');
  try {
    validateConfig();

    const bot = new TradingBot();
    const exchange = new CoinbaseClient();

    // 1. Obtenemos TODOS los balances de la cuenta
    const allBalances = await exchange.getBalances();

    // 2. Filtramos para quedarnos solo con lo que tenga saldo real (mayor a un umbral)
    // Usamos 0.000001 para ignorar las monedas que están a cero absoluto
    const actualHoldings = allBalances.filter(b => b.availableBalance > 0.000001);

    // 3. Formateamos la lista de monedas para el log
    const holdingsString = actualHoldings
      .map(h => `- ${h.currency}: ${h.availableBalance.toFixed(h.currency === 'USDC' ? 2 : 8)}`)
      .join('\n    ');

    const usdcBalance = actualHoldings.find(h => h.currency === 'USDC')?.availableBalance || 0;

    logger.info(`⚙️ Configuración cargada:
    - Umbral de Rotación: +${25} puntos
    - Trailing Stop: ${3.5}%
    - Capital Disponible: $${usdcBalance.toFixed(2)} USDC
    - Monedas actuales en cartera:
    ${holdingsString}
  `);

    // 2. Bucle de ejecución infinito
    // Usamos un intervalo para que el bot analice el mercado periódicamente
    const intervalMinutes: string = process.env.CHECK_INTERVAL_MS!;

    const run = async () => {
      try {
        // Ejecuta un ciclo completo (Análisis -> Trailing Stop -> Compra/Venta)
        await bot.runCycle();
      } catch (error: any) {
        logger.error(`❌ Error crítico en el ciclo de ejecución: ${error.message}`);
      }

      logger.info(`💤 Esperando ${intervalMinutes} MS para el siguiente ciclo...`);
    };

    // Ejecutar inmediatamente al arrancar
    await run();

    // Programar ejecuciones recurrentes
    setInterval(run, +intervalMinutes);
  }catch (error:any) {
    console.error(error.message);
    process.exit(1); // Detiene el bot si la config está mal
  }
}

// Manejo de errores globales para evitar que el bot se detenga
process.on('uncaughtException', (err) => {
  logger.error(`🚨 Excepción no capturada: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`🚨 Promesa rechazada no manejada: ${reason}`);
});

start();