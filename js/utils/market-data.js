/**
 * market-data.js
 * Live Indian stock prices (NSE/BSE) via a pluggable provider — Alpha
 * Vantage, Groww's Trading API, or Yahoo Finance. All are called directly
 * from the browser since this app has no backend to hide a key behind.
 *
 * ── Alpha Vantage ──
 * Free tier, no server-side approval needed. User pastes a free API key
 * from alphavantage.co. Rate limit: ~25 requests/day, 5/minute.
 *
 * ── Groww ──
 * Groww's Trading API (https://groww.in/trade-api) requires an active paid
 * "Trading API Subscription" and a daily-refreshed Access Token generated
 * from https://groww.in/trade-api/api-keys (the token expires every day at
 * 6:00 AM IST, so it needs to be regenerated and re-pasted each morning).
 * Symbol search uses Groww's public instrument master CSV
 * (growwapi-assets.groww.in/instruments/instrument.csv), which needs no
 * auth and is cached in localStorage for 24h since it's several MB.
 * Live quotes use the authenticated Get LTP endpoint.
 *
 * IMPORTANT CAVEAT: Groww's Trading API is built for server-side algo
 * trading, not browser apps. If Groww does not send CORS headers allowing
 * requests from this page's origin, calls will fail in the browser with a
 * network/CORS error even though the token and symbol are correct — that's
 * a restriction on Groww's end, not a bug here. If that happens, the app
 * will show a clear error explaining it.
 *
 * ── Yahoo Finance ──
 * No API key needed — search uses Yahoo's public (but unofficial and
 * undocumented) `query1.finance.yahoo.com` search/quote endpoints. Indian
 * listings use the `.NS` (NSE) / `.BO` (BSE) symbol suffix, e.g.
 * "RELIANCE.NS".
 *
 * IMPORTANT CAVEAT: this is not an official, supported Yahoo API — there's
 * no key because there's no formal access grant either, and Yahoo can
 * change or block it at any time without notice. Yahoo also does not send
 * CORS headers for browser JS, so a direct fetch() from this page will
 * usually fail. To work around that, requests first try direct, then fall
 * back to a public CORS proxy (corsproxy.io) if the direct call is
 * blocked. The proxy is a third party this app doesn't control — if it's
 * down, rate-limited, or blocked on your network, Yahoo lookups will fail
 * even though nothing here is broken. Alpha Vantage/Groww don't have this
 * extra dependency, so they're more reliable if Yahoo gives you trouble.
 */

const MarketData = {
  QUOTE_CACHE_KEY: 'marketQuoteCache',
  GROWW_INSTRUMENTS_CACHE_KEY: 'growwInstrumentsCache',
  GROWW_INSTRUMENTS_URL: 'https://growwapi-assets.groww.in/instruments/instrument.csv',
  GROWW_INSTRUMENTS_TTL_MS: 24 * 60 * 60 * 1000, // 24h
  YAHOO_CORS_PROXY: 'https://corsproxy.io/?url=',

  /* ---------------- Provider selection ---------------- */

  getProvider() {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    return settings.marketDataProvider || 'yahoo';
  },

  getApiKey(provider) {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    const p = provider || this.getProvider();
    if (p === 'groww') return (settings.growwAccessToken || '').trim();
    if (p === 'yahoo') return ''; // no key required
    return (settings.alphaVantageKey || '').trim();
  },

  hasApiKey(provider) {
    const p = provider || this.getProvider();
    if (p === 'yahoo') return true; // nothing to configure
    return this.getApiKey(p).length > 0;
  },

  /* ---------------- Symbol search ---------------- */

  /** Search for symbols matching a keyword, restricted to Indian exchanges. */
  async searchIndianSymbols(keyword) {
    if (!keyword || keyword.trim().length < 2) return [];
    const provider = this.getProvider();
    if (provider === 'groww') return this._searchGroww(keyword);
    if (provider === 'yahoo') return this._searchYahoo(keyword);
    return this._searchAlphaVantage(keyword);
  },

  async _searchAlphaVantage(keyword) {
    const key = this.getApiKey();
    if (!key) throw new Error('NO_API_KEY');

    const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keyword)}&apikey=${key}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.Note || data.Information) {
      // Alpha Vantage returns 200 OK with a "Note"/"Information" field when
      // the rate limit is hit, instead of a real HTTP error.
      throw new Error('RATE_LIMIT');
    }

    const matches = data.bestMatches || [];
    return matches
      .map((m) => ({
        symbol: m['1. symbol'],
        name: m['2. name'],
        region: m['4. region'],
        currency: m['8. currency'],
      }))
      // Alpha Vantage tags Indian listings with region "India/Bombay" and
      // currency INR; BSE symbols look like "RELIANCE.BSE".
      .filter((m) => m.region && m.region.toLowerCase().includes('india'));
  },

  async _searchGroww(keyword) {
    const rows = await this._getGrowwInstruments();
    const kw = keyword.trim().toLowerCase();

    const matches = [];
    for (const row of rows) {
      if (matches.length >= 20) break;
      if (row.segment !== 'CASH') continue;
      if (row.exchange !== 'NSE' && row.exchange !== 'BSE') continue;
      const symbolHit = row.trading_symbol && row.trading_symbol.toLowerCase().includes(kw);
      const nameHit = row.name && row.name.toLowerCase().includes(kw);
      if (symbolHit || nameHit) {
        matches.push({
          // exchange_symbols format Groww's LTP/OHLC endpoints expect, e.g. "NSE_RELIANCE".
          symbol: `${row.exchange}_${row.trading_symbol}`,
          name: row.name || row.trading_symbol,
          region: 'India',
          currency: 'INR',
        });
      }
    }
    return matches;
  },

  async _searchYahoo(keyword) {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(keyword)}&quotesCount=15&newsCount=0`;
    const data = await this._yahooFetchJson(url);

    const quotes = (data && data.quotes) || [];
    return quotes
      // Indian NSE/BSE listings carry a .NS / .BO suffix on Yahoo.
      .filter((q) => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO')))
      .map((q) => ({
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        region: 'India',
        currency: 'INR',
      }));
  },

  /**
   * fetch() + JSON parse for Yahoo's endpoints, which don't send CORS
   * headers. Tries the request directly first (works if something in the
   * browser/network already permits it), then falls back to a public CORS
   * proxy. Throws NETWORK_ERROR if both fail.
   */
  async _yahooFetchJson(url) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) return await res.json();
    } catch (err) {
      // Likely a CORS block — fall through to the proxy below.
    }

    try {
      const proxied = `${this.YAHOO_CORS_PROXY}${encodeURIComponent(url)}`;
      const res = await fetch(proxied, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('NETWORK_ERROR');
      return await res.json();
    } catch (err) {
      throw new Error('NETWORK_ERROR');
    }
  },

  /** Download (once/day) and parse Groww's public instrument master CSV. */
  async _getGrowwInstruments() {
    const cached = window.Storage.get(this.GROWW_INSTRUMENTS_CACHE_KEY, null);
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < this.GROWW_INSTRUMENTS_TTL_MS) {
      return cached.rows;
    }

    let res;
    try {
      res = await fetch(this.GROWW_INSTRUMENTS_URL);
    } catch (err) {
      throw new Error('NETWORK_ERROR');
    }
    if (!res.ok) throw new Error('NETWORK_ERROR');

    const csvText = await res.text();
    const rows = this._parseInstrumentCsv(csvText);

    try {
      window.Storage.set(this.GROWW_INSTRUMENTS_CACHE_KEY, { fetchedAt: Date.now(), rows });
    } catch (err) {
      // localStorage quota exceeded — fine to proceed without caching.
    }
    return rows;
  },

  /** Minimal CSV parser for Groww's instrument file (no quoted commas in practice). */
  _parseInstrumentCsv(csvText) {
    const lines = csvText.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];

    const header = lines[0].split(',').map((h) => h.trim());
    const exchangeIdx = header.indexOf('exchange');
    const symbolIdx = header.indexOf('trading_symbol');
    const nameIdx = header.indexOf('name');
    const segmentIdx = header.indexOf('segment');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      rows.push({
        exchange: (cols[exchangeIdx] || '').trim(),
        trading_symbol: (cols[symbolIdx] || '').trim(),
        name: (cols[nameIdx] || '').trim(),
        segment: (cols[segmentIdx] || '').trim(),
      });
    }
    return rows;
  },

  /* ---------------- Live quote ---------------- */

  /**
   * Fetch the latest traded price for a symbol. `symbol` must be in the
   * format returned by searchIndianSymbols() for the given provider (e.g.
   * "RELIANCE.BSE" for Alpha Vantage, "NSE_RELIANCE" for Groww). If
   * `provider` is omitted, the currently-active provider (Settings) is used.
   */
  async getQuote(symbol, provider) {
    const detailed = await this.getQuoteDetailed(symbol, provider);
    return detailed.price;
  },

  /**
   * Like getQuote() but also returns the previous close when the provider
   * can supply it, so callers can derive a day's change. `previousClose`
   * is null when the provider doesn't expose it (e.g. Groww's LTP endpoint).
   */
  async getQuoteDetailed(symbol, provider) {
    const p = provider || this.getProvider();
    if (p === 'groww') return this._getQuoteGroww(symbol, p);
    if (p === 'yahoo') return this._getQuoteYahoo(symbol, p);
    return this._getQuoteAlphaVantage(symbol, p);
  },

  async _getQuoteAlphaVantage(symbol, provider) {
    const key = this.getApiKey(provider);
    if (!key) throw new Error('NO_API_KEY');

    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.Note || data.Information) throw new Error('RATE_LIMIT');

    const quote = data['Global Quote'];
    const price = quote && parseFloat(quote['05. price']);
    if (!price || Number.isNaN(price)) throw new Error('NOT_FOUND');

    const previousCloseRaw = quote && parseFloat(quote['08. previous close']);
    const previousClose = Number.isFinite(previousCloseRaw) && previousCloseRaw > 0 ? previousCloseRaw : null;

    this._cacheQuote(symbol, price);
    return { price, previousClose };
  },

  async _getQuoteGroww(symbol, provider) {
    const token = this.getApiKey(provider);
    if (!token) throw new Error('NO_API_KEY');

    const url = `https://api.groww.in/v1/live-data/ltp?segment=CASH&exchange_symbols=${encodeURIComponent(symbol)}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-API-VERSION': '1.0',
        },
      });
    } catch (err) {
      // Covers both real network failures and the browser's CORS block,
      // which surfaces as a generic TypeError with no response object.
      throw new Error('NETWORK_ERROR');
    }

    if (res.status === 401 || res.status === 403) throw new Error('TOKEN_EXPIRED');
    if (!res.ok) throw new Error('NOT_FOUND');

    const data = await res.json();
    if (data.status !== 'SUCCESS') throw new Error('NOT_FOUND');

    const price = data.payload && data.payload[symbol];
    if (typeof price !== 'number') throw new Error('NOT_FOUND');

    this._cacheQuote(symbol, price);
    // Groww's LTP endpoint doesn't expose a previous close, so day's
    // change can't be derived for Groww-linked holdings.
    return { price, previousClose: null };
  },

  async _getQuoteYahoo(symbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const data = await this._yahooFetchJson(url);

    const result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result || !result.meta) throw new Error('NOT_FOUND');

    const price = result.meta.regularMarketPrice;
    if (typeof price !== 'number') throw new Error('NOT_FOUND');

    const previousCloseRaw = result.meta.previousClose ?? result.meta.chartPreviousClose;
    const previousClose = typeof previousCloseRaw === 'number' && previousCloseRaw > 0 ? previousCloseRaw : null;

    this._cacheQuote(symbol, price);
    return { price, previousClose };
  },

  _cacheQuote(symbol, price) {
    const cache = window.Storage.get(this.QUOTE_CACHE_KEY, {});
    cache[symbol] = { price, fetchedAt: new Date().toISOString() };
    window.Storage.set(this.QUOTE_CACHE_KEY, cache);
  },

  getCachedQuote(symbol) {
    const cache = window.Storage.get(this.QUOTE_CACHE_KEY, {});
    return cache[symbol] || null;
  },

  /** Human-readable message for the errors thrown above. */
  describeError(err, providerOverride) {
    const provider = providerOverride || this.getProvider();
    switch (err.message) {
      case 'NO_API_KEY':
        return provider === 'groww'
          ? 'Add a Groww Access Token in Settings > Market Data to use live prices.'
          : 'Add a free Alpha Vantage API key in Settings > Market Data to use live prices.';
      case 'RATE_LIMIT':
        return provider === 'yahoo'
          ? 'Yahoo Finance is rate-limiting requests right now. Wait a bit and try again.'
          : 'Alpha Vantage rate limit reached (free tier: ~25 requests/day). Try again later.';
      case 'TOKEN_EXPIRED':
        return 'Your Groww Access Token has expired (tokens reset daily at 6:00 AM). Generate a new one and update it in Settings.';
      case 'NETWORK_ERROR':
        if (provider === 'groww') {
          return "Could not reach Groww's API. This can happen if Groww blocks direct browser requests (CORS) — their Trading API is built for server-side use.";
        }
        if (provider === 'yahoo') {
          return "Could not reach Yahoo Finance — both the direct request and the CORS proxy fallback failed. Yahoo's endpoint is unofficial and can be blocked or down; try again later, or switch to Alpha Vantage in Settings.";
        }
        return 'Could not reach the market data service.';
      case 'NOT_FOUND':
        return 'Could not find a live price for that symbol.';
      default:
        return 'Could not reach the market data service.';
    }
  },
};

window.MarketData = MarketData;
