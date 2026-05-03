import { config } from "./config";
import { logger } from "./logger";
import fs from "fs";
import path from "path";
export interface Position {
  productId: string;
  entryPrice: number;
  size: number;
  entryValue: number;
  stopLoss: number;
  takeProfit: number;
  highestPrice: number; // Para el Trailing Stop
}

export class RiskManager {
  private openPosition: Position | null = null;
  private readonly URGENT_REBALANCE_LOSS_LIMIT = -0.02; // -2%

  public needsUrgentRebalance(
    currentProfit: number,
    currentScore: number,
    bestNewScore: number,
  ): boolean {
    const totalFees = config.minProfitFees; // Fee estimada en porcentaje
    const netProfitAfterFees = currentProfit - totalFees / 100;
    const scoreDelta = bestNewScore - currentScore;

    if (netProfitAfterFees < 0) {
      console.log(
        `💸 En pérdida neta (${(netProfitAfterFees * 100).toFixed(2)}% después de fees), solo rota si hay un salto fuerte de score`,
      );
      return (
        scoreDelta >= config.rotationThreshold + 10 ||
        (currentScore < 40 && bestNewScore > 85)
      );
    }

    if (currentProfit > 0) {
      if (scoreDelta >= config.rotationThreshold) {
        console.log(
          `🚀 Rotación justificada: diferencia ${scoreDelta.toFixed(1)}pts >= ${config.rotationThreshold}pts`,
        );
        return true;
      }

      if (currentScore < 40 && bestNewScore > 80) {
        console.log(
          `🔥 Rotación justificada por cambio extremo: actual ${currentScore}, nuevo ${bestNewScore}`,
        );
        return true;
      }

      console.log(
        `⏸️ No rota: ganancia ${(currentProfit * 100).toFixed(2)}% no cubre suficientemente las fees para cambiar`,
      );
      return false;
    }

    console.log(
      `⚖️ Estado neutro, se requiere al menos ${config.rotationThreshold}pts de ventaja`,
    );
    return scoreDelta >= config.rotationThreshold;
  }

  public getPnL(currentPrice: number) {
    const pos = this.openPosition;
    if (!pos) return { pnlPercent: 0 };

    const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    return { pnlPercent };
  }
  /**
   * Determina si cambiar a una nueva moneda compensa el coste de las comisiones.
   * @param currentPrice Precio actual de la moneda que poseemos.
   * @param newAssetScore Score de la IA para la nueva moneda.
   * @param currentAssetScore Score de la IA para nuestra moneda actual.
   */
  public isRotationWorthIt(
    currentPrice: number,
    newAssetScore: number,
    currentAssetScore: number,
  ): boolean {
    if (!this.openPosition) return false;

    const { pnlPercent } = this.getPnL(currentPrice);
    const totalFees = config.minProfitFees; // Tu 2.2% configurado

    // Escenario A: Ya estamos en beneficio neto (cubrimos comisiones)
    if (pnlPercent > totalFees) {
      // Rotamos solo si la nueva es significativamente mejor
      return newAssetScore - currentAssetScore >= config.rotationThreshold;
    }

    // Escenario B: Estamos en pérdida o break-even
    // Solo rotamos si la nueva moneda es una "Super Señal" (IA > 85, Tendencia Alcista, RSI sano)
    // y la actual se ha hundido (Diferencia de Score abismal)
    const isEmergencyRotation =
      newAssetScore - currentAssetScore > 40 && newAssetScore > 85;

    return isEmergencyRotation;
  }

  openTrade(
    productId: string,
    entryPrice: number,
    size: number,
    entryValue: number,
  ): Position {
    // El Take Profit debe ser el % que quieres + lo que necesitas para cubrir fees
    const targetPct = (config.takeProfitPercent + config.minProfitFees) / 100;

    this.openPosition = {
      productId,
      entryPrice,
      size,
      entryValue,
      highestPrice: entryPrice,
      stopLoss: entryPrice * (1 - config.stopLossPercent / 100),
      takeProfit: entryPrice * (1 + targetPct),
    };

    logger.success(`✅ Posición en ${productId} abierta a $${entryPrice}`);
    return this.openPosition;
  }

  // Lógica de Trailing Stop: Si el precio sube, el Stop Loss sube con él
  updateTrailingStop(currentPrice: number): void {
    if (!this.openPosition) return;

    if (currentPrice > this.openPosition.highestPrice) {
      this.openPosition.highestPrice = currentPrice;
      const newStopLoss = currentPrice * (1 - config.trailingStopPct / 100);

      // Solo subimos el stop, nunca lo bajamos
      if (newStopLoss > this.openPosition.stopLoss) {
        this.openPosition.stopLoss = newStopLoss;
        logger.info(`📈 Trailing Stop sube a: $${newStopLoss.toFixed(4)}`);
        this.savePosition();
      }
    }
  }

  shouldSell(currentPrice: number): { sell: boolean; reason: string } {
    if (!this.openPosition) return { sell: false, reason: "" };

    if (currentPrice >= this.openPosition.takeProfit)
      return { sell: true, reason: "TAKE_PROFIT" };
    if (currentPrice <= this.openPosition.stopLoss)
      return { sell: true, reason: "STOP_LOSS / TRAILING" };

    return { sell: false, reason: "" };
  }
  savePosition(): void {
    if (!this.openPosition) return;
    const filePath = path.join(__dirname, "../position_state.json");
    fs.writeFileSync(filePath, JSON.stringify(this.openPosition, null, 2));
  }

  loadPosition(): void {
    const filePath = path.join(__dirname, "../position_state.json");
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        this.openPosition = JSON.parse(data);
        logger.success(
          `📋 Posición recuperada: ${this.openPosition!.productId} | StopLoss: $${this.openPosition!.stopLoss.toFixed(4)}`,
        );
      }
    } catch {
      logger.warn("⚠️  No se pudo recuperar estado de posición anterior");
    }
  }

  getOpenPosition() {
    return this.openPosition;
  }
  closeTrade() {
    this.openPosition = null;
  }
}
