import fs from 'node:fs';
import path from 'node:path';

export function loadConfig() {
  loadDotEnv(path.resolve(process.cwd(), '.env'));

  const cwd = process.cwd();

  return {
    port: parseInteger(process.env.PORT, 3000),
    adminRouteSlug: process.env.ADMIN_ROUTE_SLUG ?? '__gift_admin_9f7c4a__',
    storeProvider: process.env.STORE_PROVIDER ?? 'supabase',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    supabaseEmailsTable: process.env.SUPABASE_EMAILS_TABLE ?? 'email_registrations',
    supabaseOrdersTable: process.env.SUPABASE_ORDERS_TABLE ?? 'ebook_orders',
    supabaseRechargeCardsTable: process.env.SUPABASE_RECHARGE_CARDS_TABLE ?? 'recharge_cards',
    supabaseBitrefillPurchasesTable: process.env.SUPABASE_BITREFILL_PURCHASES_TABLE ?? 'bitrefill_purchases',
    amazonProvider: process.env.AMAZON_PROVIDER ?? 'mock',
    amazonAutomationUrl: process.env.AMAZON_AUTOMATION_URL ?? '',
    amazonAutomationToken: process.env.AMAZON_AUTOMATION_TOKEN ?? '',
    ebookAsin: process.env.AMAZON_EBOOK_ASIN ?? 'B0EXAMPLE123',
    ebookTitle: process.env.AMAZON_EBOOK_TITLE ?? 'Your Kindle Ebook',
    automationPort: parseInteger(process.env.AMAZON_AUTOMATION_PORT, 3001),
    amazonBaseUrl: process.env.AMAZON_BASE_URL ?? 'https://www.amazon.com',
    amazonUserDataDir: path.resolve(cwd, process.env.AMAZON_USER_DATA_DIR ?? '.data/amazon-profile'),
    amazonHeadless: parseBoolean(process.env.AMAZON_HEADLESS, true),
    amazonSlowMoMs: parseInteger(process.env.AMAZON_SLOW_MO_MS, 0),
    amazonGiftMessage: process.env.AMAZON_GIFT_MESSAGE ?? 'Enjoy the book!',
    amazonBrowserChannel: process.env.AMAZON_BROWSER_CHANNEL ?? '',
    amazonDebugDir: path.resolve(cwd, process.env.AMAZON_DEBUG_DIR ?? '.data/amazon-debug'),
    bitrefillBaseUrl: process.env.BITREFILL_BASE_URL ?? 'https://api.bitrefill.com',
    bitrefillApiKey: process.env.BITREFILL_API_KEY ?? '',
    bitrefillApiId: process.env.BITREFILL_API_ID ?? '',
    bitrefillApiSecret: process.env.BITREFILL_API_SECRET ?? '',
    bitrefillPaymentMethod: process.env.BITREFILL_PAYMENT_METHOD ?? 'balance',
    bitrefillAmazonProductId: process.env.BITREFILL_AMAZON_PRODUCT_ID ?? '',
    bitrefillAmazonProductQuery: process.env.BITREFILL_AMAZON_PRODUCT_QUERY ?? 'Amazon.com Gift Card',
    bitrefillPollIntervalMs: parseInteger(process.env.BITREFILL_POLL_INTERVAL_MS, 1500),
    bitrefillOrderTimeoutMs: parseInteger(process.env.BITREFILL_ORDER_TIMEOUT_MS, 45000)
  };
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseBoolean(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
