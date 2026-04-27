import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { logger } from './logger';

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
  side: 'BUY' | 'SELL';
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
  private readonly baseUrl = 'https://api.coinbase.com';

  private sign(method: string, path: string): Record<string, string> {
  const secret = config.coinbaseApiSecret.replace(/\\n/g, '\n');

  // Quitar query params del path para el uri claim
  const cleanPath = path.split('?')[0];
  const uri = `${method.toUpperCase()} api.coinbase.com${cleanPath}`;

  const payload = {
    iss: 'cdp',
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
    sub: config.coinbaseApiKey,
    uri,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (jwt as any).sign(payload, secret, {
    algorithm: 'ES256',
    header: {
      kid: config.coinbaseApiKey,
      nonce: require('crypto').randomBytes(16).toString('hex'),
    },
  });

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

  private async request<T>(method: string, path: string, body?: object): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : '';
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

  async getCandles(productId: string, granularity: string = 'ONE_MINUTE', limit: number = 100): Promise<Candle[]> {
    const end = Math.floor(Date.now() / 1000);
    const granularitySeconds: Record<string, number> = {
      ONE_MINUTE: 60, FIVE_MINUTE: 300, FIFTEEN_MINUTE: 900,
      ONE_HOUR: 3600, SIX_HOUR: 21600, ONE_DAY: 86400,
    };
    const start = end - (granularitySeconds[granularity] || 60) * limit;
    const path = `/api/v3/brokerage/products/${productId}/candles?start=${start}&end=${end}&granularity=${granularity}`;
    const data = await this.request<{ candles: Array<{start: string; open: string; high: string; low: string; close: string; volume: string}> }>('GET', path);

    return (data.candles || []).map((c) => ({
      timestamp: parseInt(c.start),
      open: parseFloat(c.open), high: parseFloat(c.high),
      low: parseFloat(c.low), close: parseFloat(c.close), volume: parseFloat(c.volume),
    })).reverse();
  }

  async getPrice(productId: string): Promise<number> {
    const path = `/api/v3/brokerage/products/${productId}`;
    const data = await this.request<{ price: string }>('GET', path);
    return parseFloat(data.price);
  }

  async getBalances(): Promise<AccountBalance[]> {
    const data = await this.request<{ accounts: Array<{currency: string; available_balance: {value: string}; hold: {value: string}}>}>('GET', '/api/v3/brokerage/accounts');
    return (data.accounts || []).map((a) => ({
      currency: a.currency,
      availableBalance: parseFloat(a.available_balance?.value || '0'),
      holdBalance: parseFloat(a.hold?.value || '0'),
    }));
  }

  async getBalance(currency: string): Promise<number> {
    const balances = await this.getBalances();
    const account = balances.find((b) => b.currency === currency);
    return account?.availableBalance || 0;
  }

 async marketBuy(productId: string, quoteSize: number): Promise<OrderResult> {
  const clientOrderId = `bot-buy-${Date.now()}`;
  const bodyMarket = {
    client_order_id: clientOrderId,
    product_id: productId,
    side: 'BUY',
    order_configuration: { market_market_ioc: { quote_size: quoteSize.toFixed(2) } },
  };

  try {
    const data: any = await this.request('POST', '/api/v3/brokerage/orders', bodyMarket);
    if (!data.success && data.error_response?.message?.includes("limit order type")) throw new Error("LIMIT_ONLY");
    if (!data.success) throw new Error(data.error_response?.message);
    await new Promise(r => setTimeout(r, 2000));
    return this.getOrderDetails(data.success_response.order_id, 'BUY');
  } catch (error: any) {
    if (error.message === "LIMIT_ONLY") {
      logger.warn(`⚠️ Modo Limit detectado en ${productId}. Usando orden Limit...`);
      const price = await this.getPrice(productId);
      const limitPrice = price * 1.005; // 0.5% arriba para asegurar compra
      const baseSize = (quoteSize / limitPrice).toFixed(8);
      const bodyLimit = {
        client_order_id: `${clientOrderId}-limit`,
        product_id: productId,
        side: 'BUY',
        order_configuration: { limit_limit_gtc: { base_size: baseSize, limit_price: limitPrice.toFixed(8), post_only: true } }
      };
      const dataLimit: any = await this.request('POST', '/api/v3/brokerage/orders', bodyLimit);
      return this.getOrderDetails(dataLimit.success_response.order_id, 'BUY');
    }
    throw error;
  }
}

async marketSell(productId: string, baseSize: number): Promise<OrderResult> {
  const clientOrderId = `bot-sell-${Date.now()}`;

  const bodyMarket = {
    client_order_id: clientOrderId,
    product_id: productId,
    side: 'SELL',
    order_configuration: { market_market_ioc: { base_size: baseSize.toFixed(8) } },
  };

  try {
    logger.trade(`Enviando orden SELL: ${baseSize} de ${productId}`);
    const data = await this.request<any>('POST', '/api/v3/brokerage/orders', bodyMarket);


    if (!data.success) {
      if (data.error_response?.message?.includes("limit only mode")) {
        throw new Error("LIMIT_ONLY_RETRY");
      }
      throw new Error(data.error_response?.message);
    }

    await new Promise((r) => setTimeout(r, 1500));
    return this.getOrderDetails(data.success_response!.order_id, 'SELL');

  } catch (error: any) {
    if (error.message === "LIMIT_ONLY_RETRY") {
      logger.warn(`⚠️ Modo Limit Only detectado para VENTA en ${productId}.`);

      const currentPrice = await this.getPrice(productId);
      // Ajustamos el precio un 0.5% ABAJO para vender rápido en el libro de órdenes
      const limitPrice = currentPrice * 0.995;

      const bodyLimit = {
        client_order_id: `${clientOrderId}-limit`,
        product_id: productId,
        side: 'SELL',
        order_configuration: {
          limit_limit_gtc: {
            base_size: baseSize.toFixed(8),
            limit_price: limitPrice.toFixed(8),
            post_only: false
          }
        },
      };

      const dataLimit = await this.request<any>('POST', '/api/v3/brokerage/orders', bodyLimit);
      if (!dataLimit.success) throw new Error(`Error en LIMIT SELL: ${dataLimit.error_response?.message}`);

      await new Promise((r) => setTimeout(r, 1500));
      return this.getOrderDetails(dataLimit.success_response!.order_id, 'SELL');
    }
    throw error;
  }
}
  private async getOrderDetails(orderId: string, side: 'BUY' | 'SELL'): Promise<OrderResult> {
    const data = await this.request<{
      order: { order_id: string; status: string; filled_size: string; filled_value: string; average_filled_price: string }
    }>('GET', `/api/v3/brokerage/orders/historical/${orderId}`);
    const o = data.order;
    return {
      orderId: o.order_id, status: o.status, side,
      filledSize: parseFloat(o.filled_size || '0'),
      filledValue: parseFloat(o.filled_value || '0'),
      averagePrice: parseFloat(o.average_filled_price || '0'),
    };
  }
}