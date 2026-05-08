import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { logger } from "./logger";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderResult {
  orderId: string;
  status: string;
  side: "BUY" | "SELL";
  filledSize: number;
  filledValue: number;
  averagePrice: number;
}

export interface AccountBalance {
  currency: string;
  availableBalance: number;
  holdBalance: number;
}

export class CoinbaseClient {
  private readonly baseUrl = "https://api.coinbase.com";

  private sign(method: string, path: string): Record<string, string> {
    const secret = config.coinbaseApiSecret.replace(/\\n/g, "\n");
    const cleanPath = path.split("?")[0];
    const uri = `${method.toUpperCase()} api.coinbase.com${cleanPath}`;

    const payload = {
      iss: "cdp",
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      sub: config.coinbaseApiKey,
      uri,
    };

    const token = (jwt as any).sign(payload, secret, {
      algorithm: "ES256",
      header: {
        kid: config.coinbaseApiKey,
        nonce: require("crypto").randomBytes(16).toString("hex"),
      },
    });

    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: object,
  ): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : "";
    const headers = this.sign(method, path);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: bodyStr || undefined,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Coinbase API error ${res.status}: ${err}`);
    }

    return res.json() as Promise<T>;
  }

  async getPrice(productId: string): Promise<number> {
    const path = `/api/v3/brokerage/products/${productId}`;
    const data = await this.request<{ price: string }>("GET", path);
    return parseFloat(data.price);
  }

  async getBalances(): Promise<AccountBalance[]> {
    const data = await this.request<{ accounts: any[] }>(
      "GET",
      "/api/v3/brokerage/accounts",
    );
    data.accounts.forEach((a) => {
      if (
        parseFloat(a.available_balance.value) > 0 ||
        parseFloat(a.hold.value) > 0
      ) {
        logger.info(
          `   💰 ${a.currency} | Disponible: ${a.available_balance.value} | Retenido: ${a.hold.value}`,
        );
      }
    });

    return (data.accounts || []).map((a) => ({
      currency: a.currency,
      availableBalance: parseFloat(a.available_balance?.value || "0"),
      holdBalance: parseFloat(a.hold?.value || "0"),
    }));
  }
  async getBalance(currency: string): Promise<number> {
    const balances = await this.getBalances();
    // Buscamos coincidencia exacta (BTC, USDC, etc)
    const account = balances.find((b) => b.currency === currency);
    return account?.availableBalance || 0;
  }

  async marketBuy(productId: string, quoteSize: number): Promise<OrderResult> {
    const clientOrderId = `bot-buy-${Date.now()}`;
    const bodyMarket = {
      client_order_id: clientOrderId,
      product_id: productId,
      side: "BUY",
      order_configuration: {
        market_market_ioc: { quote_size: quoteSize.toFixed(2) },
      },
    };

    const data: any = await this.request(
      "POST",
      "/api/v3/brokerage/orders",
      bodyMarket,
    );
    if (!data.success) throw new Error(data.error_response?.message);
    return this.getOrderDetails(data.success_response.order_id, "BUY");
  }

  async marketSell(productId: string, baseSize: number): Promise<OrderResult> {
    const clientOrderId = Math.random().toString(36).substring(7);
    const bodyMarket = {
      client_order_id: clientOrderId,
      product_id: productId,
      side: "SELL",
      order_configuration: {
        market_market_ioc: { base_size: baseSize.toString() },
      },
    };

    logger.trade(`Enviando orden SELL: ${baseSize} de ${productId}`);
    const data = await this.request<any>(
      "POST",
      "/api/v3/brokerage/orders",
      bodyMarket,
    );
    if (!data.success) throw new Error(data.error_response?.message);

    await new Promise((r) => setTimeout(r, 1500));
    return this.getOrderDetails(data.success_response!.order_id, "SELL");
  }

  private async getOrderDetails(
    orderId: string,
    side: "BUY" | "SELL",
  ): Promise<OrderResult> {
    const data = await this.request<any>(
      "GET",
      `/api/v3/brokerage/orders/historical/${orderId}`,
    );
    const o = data.order;
    return {
      orderId: o.order_id,
      status: o.status,
      side,
      filledSize: parseFloat(o.filled_size || "0"),
      filledValue: parseFloat(o.filled_value || "0"),
      averagePrice: parseFloat(o.average_filled_price || "0"),
    };
  }
  async getCandles(productId: string): Promise<any[]> {
    const start = Math.floor(Date.now() / 1000) - 24 * 3600;
    const end = Math.floor(Date.now() / 1000);
    const path = `/api/v3/brokerage/products/${productId}/candles?start=${start}&end=${end}&granularity=FIVE_MINUTE`;

    try {
      const data = await this.request<any>("GET", path);
      if (!data || !data.candles || !Array.isArray(data.candles)) {
        console.warn(`⚠️  [CANDLES] No hay datos de velas para ${productId}`);
        return [];
      }

      const filtered = data.candles
        .map((c: any) => ({
          close: parseFloat(c.close || "0"),
          high: parseFloat(c.high || "0"),
          low: parseFloat(c.low || "0"),
          open: parseFloat(c.open || "0"),
        }))
        .filter((c: any) => c.close > 0)
        .reverse();

      if (filtered.length === 0) {
        console.warn(
          `⚠️  [CANDLES] ${productId}: Se obtuvieron ${data.candles.length} velas pero todas tienen precio 0`,
        );
      }

      return filtered;
    } catch (error: any) {
      console.warn(
        `⚠️  [CANDLES] Error obteniendo velas para ${productId}: ${error.message}`,
      );
      return [];
    }
  }
}
