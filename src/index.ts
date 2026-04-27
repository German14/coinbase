import { TradingBot } from './bot';
import { logger } from './logger';
import { config, validateConfig } from './config';
import { CoinbaseClient } from './coinbase';

async function start() {
  logger.info('🚀 Iniciando Sistema de Trading Inteligente...');
  try {
    // Validamos antes de instanciar nada
    validateConfig();

    // 1. Instanciar el bot
    // Al instanciarlo fuera del bucle, permitimos que guarde variables como 'highestPrice'
    const bot = new TradingBot();
    const exchange = new CoinbaseClient();
    const btcBalance = await exchange.getBalance('BTC'); // Opcional: ver también BTC
    const realBalance = await exchange.getBalance('USDC');

    logger.info(`⚙️ Configuración cargada:
    - Umbral de Rotación: +${25} puntos
    - Trailing Stop: ${3.5}%
   - Capital Disponible: $${realBalance.toFixed(2)} USDC
   - BTC en Cartera: ${btcBalance.toFixed(8)} BTC
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