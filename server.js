import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const config = {
  clientId: process.env.EBAY_CLIENT_ID,
  clientSecret: process.env.EBAY_CLIENT_SECRET,
  marketplaceId: process.env.EBAY_MARKETPLACE_ID || "EBAY_US",
  environment: process.env.EBAY_ENV || "production",
  insightsPath:
    process.env.EBAY_MARKETPLACE_INSIGHTS_PATH ||
    "/buy/marketplace_insights/v1_beta/item_sales/search",
};

const NEW_CONDITION_IDS = ["1000", "1500", "1750"];
const USED_CONDITION_IDS = ["2750", "3000", "4000", "5000", "6000"];
const CONDITIONS = {
  new: { label: "New", ids: NEW_CONDITION_IDS },
  used: { label: "Used", ids: USED_CONDITION_IDS },
};

let tokenCache = null;

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function ebayHost() {
  return config.environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

async function getAccessToken() {
  if (!config.clientId || !config.clientSecret) return null;
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;

  const host = config.environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${host}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`eBay OAuth failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000,
  };
  return tokenCache.value;
}

async function ebayGet(path, params, token) {
  const url = new URL(`${ebayHost()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": config.marketplaceId,
      "Accept-Language": "en-US",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`eBay API failed (${response.status}): ${body}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function searchActive(gtin, conditionIds, token) {
  const filter = `conditionIds:{${conditionIds.join("|")}},buyingOptions:{FIXED_PRICE|AUCTION}`;
  const data = await ebayGet(
    "/buy/browse/v1/item_summary/search",
    { gtin, limit: "200", filter, fieldgroups: "CONDITION_REFINEMENTS" },
    token
  );
  return {
    count: Number(data.total || 0),
    sample: data.itemSummaries || [],
  };
}

async function searchSold(gtin, conditionIds, token) {
  const filter = `conditionIds:{${conditionIds.join("|")}}`;
  const data = await ebayGet(config.insightsPath, { gtin, limit: "200", filter }, token);
  const items = data.itemSales || data.itemSummaries || [];
  return {
    count: Number(data.total || items.length || 0),
    sample: items,
  };
}

function numericPrice(item) {
  const price = item.price || item.currentBidPrice || item.itemPrice || item.soldPrice;
  const value = Number(price?.value);
  return Number.isFinite(value) ? value : null;
}

function summarizeSold(items) {
  const prices = items.map(numericPrice).filter((value) => value !== null);
  const sum = prices.reduce((total, price) => total + price, 0);
  const average = prices.length ? sum / prices.length : null;
  const currency =
    items.find((item) => item.price?.currency || item.currentBidPrice?.currency || item.itemPrice?.currency)?.price
      ?.currency || "USD";
  return {
    sampleSize: prices.length,
    averagePrice: average,
    currency,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
  };
}

async function analyzeBarcode(gtin) {
  const token = await getAccessToken();
  if (!token) return mockAnalyze(gtin);

  const result = {};
  const notices = [];
  for (const [key, condition] of Object.entries(CONDITIONS)) {
    const active = await searchActive(gtin, condition.ids, token);
    let sold = { count: null, sample: [] };
    let soldAccess = "live";
    try {
      sold = await searchSold(gtin, condition.ids, token);
    } catch (error) {
      soldAccess = "pending";
      if (!notices.length) {
        notices.push(
          "Active listings are live. Sold listing stats need eBay Marketplace Insights approval before they can be shown."
        );
      }
    }
    const soldSummary = summarizeSold(sold.sample);
    result[key] = {
      label: condition.label,
      activeCount: active.count,
      soldCount: sold.count,
      soldAccess,
      sellThroughRate: active.count && sold.count !== null ? sold.count / active.count : null,
      ...soldSummary,
      examples: sold.sample.slice(0, 5).map((item) => ({
        title: item.title || item.shortDescription || "Sold listing",
        price: numericPrice(item),
        url: item.itemWebUrl || item.itemHref || null,
      })),
    };
  }

  return {
    gtin,
    source: "live",
    marketplaceId: config.marketplaceId,
    generatedAt: new Date().toISOString(),
    notice: notices.join(" "),
    results: result,
  };
}

function mockAnalyze(gtin) {
  const seed = Number(gtin.slice(-4)) || 1849;
  const usedActive = 16 + (seed % 28);
  const usedSold = 9 + (seed % 21);
  const newActive = 5 + (seed % 16);
  const newSold = 2 + (seed % 10);
  return {
    gtin,
    source: "demo",
    marketplaceId: config.marketplaceId,
    generatedAt: new Date().toISOString(),
    notice:
      "Demo mode: add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to use live active listings. Sold listings also require eBay Marketplace Insights access.",
    results: {
      used: {
        label: "Used",
        activeCount: usedActive,
        soldCount: usedSold,
        sellThroughRate: usedSold / usedActive,
        sampleSize: 18,
        averagePrice: 12.75 + (seed % 900) / 100,
        minPrice: 6.99,
        maxPrice: 31.5,
        currency: "USD",
        examples: [],
      },
      new: {
        label: "New",
        activeCount: newActive,
        soldCount: newSold,
        sellThroughRate: newSold / newActive,
        sampleSize: 9,
        averagePrice: 21.2 + (seed % 1200) / 100,
        minPrice: 14.99,
        maxPrice: 44.95,
        currency: "USD",
        examples: [],
      },
    },
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

async function handleApi(request, response) {
  if (request.method === "GET" && request.url === "/api/config") {
    return sendJson(response, 200, {
      hasCredentials: Boolean(config.clientId && config.clientSecret),
      marketplaceId: config.marketplaceId,
      environment: config.environment,
    });
  }

  if (request.method === "POST" && request.url === "/api/analyze") {
    const body = await readJson(request);
    const gtin = String(body.code || "").replace(/\D/g, "");
    if (!/^\d{8,14}$/.test(gtin)) {
      return sendJson(response, 400, { error: "Enter a valid UPC, EAN, ISBN-10, or ISBN-13 barcode." });
    }
    try {
      return sendJson(response, 200, await analyzeBarcode(gtin));
    } catch (error) {
      return sendJson(response, error.status || 502, {
        error: error.message,
        hint:
          "Live calls require eBay app credentials. Sold listing calls require Marketplace Insights approval from eBay.",
      });
    }
  }

  sendJson(response, 404, { error: "Not found" });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    handleApi(request, response).catch((error) => sendJson(response, 500, { error: error.message }));
    return;
  }
  serveStatic(request, response).catch((error) => {
    response.writeHead(500);
    response.end(error.message);
  });
}).listen(port, host, () => {
  console.log(`eBay Book Scanner running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
});
