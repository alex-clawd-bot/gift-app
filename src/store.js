import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export function createStore(config) {
  if (config.storeProvider === 'memory') {
    return new MemoryStore();
  }

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORE_PROVIDER=supabase');
  }

  return new SupabaseStore(config);
}

export class MemoryStore {
  constructor() {
    this.state = {
      emails: [],
      rechargeCards: [],
      orders: [],
      bitrefillPurchases: []
    };
  }

  async init() {}

  async getEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const record = this.state.emails.find((item) => item.email === normalizedEmail);
    return record ? clone(record) : null;
  }

  async listEmails() {
    return clone([...this.state.emails].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }

  async getEmailStatus(email) {
    const normalizedEmail = normalizeEmail(email);
    const emailRecord = this.state.emails.find((item) => item.email === normalizedEmail) ?? null;
    const order = this.state.orders.find((item) => item.email === normalizedEmail) ?? null;

    return {
      email: normalizedEmail,
      exists: Boolean(emailRecord),
      alreadySent: emailRecord?.status === 'ordered',
      status: emailRecord?.status ?? 'not_found',
      record: emailRecord ? clone(emailRecord) : null,
      order: order ? clone(order) : null
    };
  }

  async getEmailStats() {
    const stats = {
      registeredEmails: this.state.emails.length,
      sentEmails: 0,
      pendingEmails: 0,
      processingEmails: 0,
      notSentEmails: 0,
      totalOrders: this.state.orders.length
    };

    for (const email of this.state.emails) {
      if (email.status === 'ordered') {
        stats.sentEmails += 1;
      } else if (email.status === 'processing') {
        stats.processingEmails += 1;
      } else {
        stats.pendingEmails += 1;
      }
    }

    stats.notSentEmails = stats.registeredEmails - stats.sentEmails;
    return clone(stats);
  }

  async getOrderByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const record = this.state.orders.find((item) => item.email === normalizedEmail);
    return record ? clone(record) : null;
  }

  async getBitrefillPurchaseById(purchaseId) {
    const record = this.state.bitrefillPurchases.find((item) => item.id === purchaseId);
    return record ? clone(record) : null;
  }

  async addEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const existing = this.state.emails.find((item) => item.email === normalizedEmail);

    if (existing) {
      return { email: clone(existing), created: false };
    }

    const now = new Date().toISOString();
    const record = {
      email: normalizedEmail,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      orderedAt: null
    };

    this.state.emails.push(record);
    return { email: clone(record), created: true };
  }

  async updateEmailAdminStatus(email, status) {
    assertValidAdminStatus(status);
    const normalizedEmail = normalizeEmail(email);
    const record = this.state.emails.find((item) => item.email === normalizedEmail);

    if (!record) {
      const error = new Error('EMAIL_NOT_FOUND');
      error.statusCode = 404;
      throw error;
    }

    const now = new Date().toISOString();
    record.status = status;
    record.updatedAt = now;
    record.orderedAt = status === 'ordered' ? (record.orderedAt ?? now) : null;
    return clone(record);
  }

  async reserveRechargeCard(code) {
    const normalizedCode = normalizeCode(code);
    const existing = this.state.rechargeCards.find((item) => item.code === normalizedCode);

    if (existing) {
      return { rechargeCard: clone(existing), reserved: false };
    }

    const record = {
      code: normalizedCode,
      status: 'processing',
      providerRequestId: null,
      createdAt: new Date().toISOString(),
      redeemedAt: null
    };

    this.state.rechargeCards.push(record);
    return { rechargeCard: clone(record), reserved: true };
  }

  async completeRechargeCard(code, providerRequestId) {
    const normalizedCode = normalizeCode(code);
    const record = this.state.rechargeCards.find((item) => item.code === normalizedCode);

    if (!record) {
      throw new Error('RECHARGE_CARD_NOT_FOUND');
    }

    record.status = 'redeemed';
    record.providerRequestId = providerRequestId;
    record.redeemedAt = new Date().toISOString();
    return clone(record);
  }

  async releaseRechargeCard(code) {
    const normalizedCode = normalizeCode(code);
    const index = this.state.rechargeCards.findIndex((item) => item.code === normalizedCode && item.status === 'processing');
    if (index >= 0) {
      this.state.rechargeCards.splice(index, 1);
    }
  }

  async reserveOrderForEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const emailRecord = this.state.emails.find((item) => item.email === normalizedEmail);

    if (!emailRecord) {
      throw new Error('EMAIL_NOT_FOUND');
    }

    if (emailRecord.status !== 'pending') {
      return {
        email: clone(emailRecord),
        reserved: false,
        order: await this.getOrderByEmail(normalizedEmail)
      };
    }

    emailRecord.status = 'processing';
    emailRecord.updatedAt = new Date().toISOString();
    return { email: clone(emailRecord), reserved: true, order: null };
  }

  async completeOrder({ email, ebookAsin, ebookTitle, providerOrderId }) {
    const normalizedEmail = normalizeEmail(email);
    const emailRecord = this.state.emails.find((item) => item.email === normalizedEmail);

    if (!emailRecord) {
      throw new Error('EMAIL_NOT_FOUND');
    }

    const existingOrder = this.state.orders.find((item) => item.email === normalizedEmail);
    if (existingOrder) {
      return { order: clone(existingOrder), created: false };
    }

    const now = new Date().toISOString();
    emailRecord.status = 'ordered';
    emailRecord.updatedAt = now;
    emailRecord.orderedAt = now;

    const order = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      ebookAsin,
      ebookTitle,
      providerOrderId,
      status: 'completed',
      createdAt: now
    };

    this.state.orders.push(order);
    return { order: clone(order), created: true };
  }

  async releaseOrder(email) {
    const normalizedEmail = normalizeEmail(email);
    const emailRecord = this.state.emails.find((item) => item.email === normalizedEmail);
    if (emailRecord && emailRecord.status === 'processing') {
      emailRecord.status = 'pending';
      emailRecord.updatedAt = new Date().toISOString();
    }
  }

  async saveBitrefillPurchase({ amount, quantity, result, requestedByEmail = null }) {
    const record = {
      id: crypto.randomUUID(),
      requestedByEmail: requestedByEmail ? normalizeEmail(requestedByEmail) : null,
      amount,
      quantity,
      provider: 'bitrefill',
      invoice: result.invoice,
      product: result.product,
      orders: result.orders,
      redemptionCodes: result.redemptionCodes,
      createdAt: new Date().toISOString()
    };

    this.state.bitrefillPurchases.push(record);
    return clone(record);
  }
}

export class SupabaseStore {
  constructor(config) {
    this.client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    this.tables = {
      emails: config.supabaseEmailsTable,
      orders: config.supabaseOrdersTable,
      rechargeCards: config.supabaseRechargeCardsTable,
      bitrefillPurchases: config.supabaseBitrefillPurchasesTable
    };
  }

  async init() {}

  async getEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await this.client
      .from(this.tables.emails)
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapEmailRow(data) : null;
  }

  async listEmails() {
    const { data, error } = await this.client
      .from(this.tables.emails)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map(mapEmailRow);
  }

  async getEmailStatus(email) {
    const normalizedEmail = normalizeEmail(email);
    const [emailRecord, order] = await Promise.all([
      this.getEmail(normalizedEmail),
      this.getOrderByEmail(normalizedEmail)
    ]);

    return {
      email: normalizedEmail,
      exists: Boolean(emailRecord),
      alreadySent: emailRecord?.status === 'ordered',
      status: emailRecord?.status ?? 'not_found',
      record: emailRecord,
      order
    };
  }

  async getEmailStats() {
    const [{ data: emails, error: emailsError }, { count, error: ordersError }] = await Promise.all([
      this.client.from(this.tables.emails).select('status'),
      this.client.from(this.tables.orders).select('*', { count: 'exact', head: true })
    ]);

    if (emailsError) {
      throw emailsError;
    }

    if (ordersError) {
      throw ordersError;
    }

    const stats = {
      registeredEmails: emails?.length ?? 0,
      sentEmails: 0,
      pendingEmails: 0,
      processingEmails: 0,
      notSentEmails: 0,
      totalOrders: count ?? 0
    };

    for (const emailRow of emails ?? []) {
      if (emailRow.status === 'ordered') {
        stats.sentEmails += 1;
      } else if (emailRow.status === 'processing') {
        stats.processingEmails += 1;
      } else {
        stats.pendingEmails += 1;
      }
    }

    stats.notSentEmails = stats.registeredEmails - stats.sentEmails;
    return stats;
  }

  async getOrderByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await this.client
      .from(this.tables.orders)
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapOrderRow(data) : null;
  }

  async getBitrefillPurchaseById(purchaseId) {
    const { data, error } = await this.client
      .from(this.tables.bitrefillPurchases)
      .select('*')
      .eq('id', purchaseId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapBitrefillPurchaseRow(data) : null;
  }

  async addEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const now = new Date().toISOString();
    const payload = {
      email: normalizedEmail,
      status: 'pending',
      updated_at: now
    };

    const { data, error } = await this.client
      .from(this.tables.emails)
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (!error) {
      return { email: mapEmailRow(data), created: true };
    }

    if (isUniqueViolation(error)) {
      const existing = await this.getEmail(normalizedEmail);
      return { email: existing, created: false };
    }

    throw error;
  }

  async updateEmailAdminStatus(email, status) {
    assertValidAdminStatus(status);
    const normalizedEmail = normalizeEmail(email);
    const now = new Date().toISOString();
    const orderedAt = status === 'ordered' ? now : null;

    const { data, error } = await this.client
      .from(this.tables.emails)
      .update({
        status,
        updated_at: now,
        ordered_at: orderedAt
      })
      .eq('email', normalizedEmail)
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      const notFoundError = new Error('EMAIL_NOT_FOUND');
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    return mapEmailRow(data);
  }

  async reserveRechargeCard(code) {
    const normalizedCode = normalizeCode(code);
    const payload = {
      code: normalizedCode,
      status: 'processing'
    };

    const { data, error } = await this.client
      .from(this.tables.rechargeCards)
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (!error) {
      return { rechargeCard: mapRechargeCardRow(data), reserved: true };
    }

    if (isUniqueViolation(error)) {
      const { data: existing, error: fetchError } = await this.client
        .from(this.tables.rechargeCards)
        .select('*')
        .eq('code', normalizedCode)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      return { rechargeCard: existing ? mapRechargeCardRow(existing) : null, reserved: false };
    }

    throw error;
  }

  async completeRechargeCard(code, providerRequestId) {
    const normalizedCode = normalizeCode(code);
    const { data, error } = await this.client
      .from(this.tables.rechargeCards)
      .update({
        status: 'redeemed',
        provider_request_id: providerRequestId,
        redeemed_at: new Date().toISOString()
      })
      .eq('code', normalizedCode)
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('RECHARGE_CARD_NOT_FOUND');
    }

    return mapRechargeCardRow(data);
  }

  async releaseRechargeCard(code) {
    const normalizedCode = normalizeCode(code);
    const { error } = await this.client
      .from(this.tables.rechargeCards)
      .delete()
      .eq('code', normalizedCode)
      .eq('status', 'processing');

    if (error) {
      throw error;
    }
  }

  async reserveOrderForEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const emailRecord = await this.getEmail(normalizedEmail);

    if (!emailRecord) {
      throw new Error('EMAIL_NOT_FOUND');
    }

    if (emailRecord.status !== 'pending') {
      return {
        email: emailRecord,
        reserved: false,
        order: await this.getOrderByEmail(normalizedEmail)
      };
    }

    const { data, error } = await this.client
      .from(this.tables.emails)
      .update({
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      const latest = await this.getEmail(normalizedEmail);
      return {
        email: latest,
        reserved: false,
        order: await this.getOrderByEmail(normalizedEmail)
      };
    }

    return { email: mapEmailRow(data), reserved: true, order: null };
  }

  async completeOrder({ email, ebookAsin, ebookTitle, providerOrderId }) {
    const normalizedEmail = normalizeEmail(email);
    const existingOrder = await this.getOrderByEmail(normalizedEmail);
    if (existingOrder) {
      return { order: existingOrder, created: false };
    }

    const now = new Date().toISOString();
    const { data: orderData, error: orderError } = await this.client
      .from(this.tables.orders)
      .insert({
        email: normalizedEmail,
        ebook_asin: ebookAsin,
        ebook_title: ebookTitle,
        provider_order_id: providerOrderId,
        status: 'completed',
        created_at: now
      })
      .select('*')
      .maybeSingle();

    if (orderError) {
      if (isUniqueViolation(orderError)) {
        const existing = await this.getOrderByEmail(normalizedEmail);
        return { order: existing, created: false };
      }

      throw orderError;
    }

    const { error: emailError } = await this.client
      .from(this.tables.emails)
      .update({
        status: 'ordered',
        updated_at: now,
        ordered_at: now
      })
      .eq('email', normalizedEmail);

    if (emailError) {
      throw emailError;
    }

    return { order: mapOrderRow(orderData), created: true };
  }

  async releaseOrder(email) {
    const normalizedEmail = normalizeEmail(email);
    const { error } = await this.client
      .from(this.tables.emails)
      .update({
        status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('email', normalizedEmail)
      .eq('status', 'processing');

    if (error) {
      throw error;
    }
  }

  async saveBitrefillPurchase({ amount, quantity, result, requestedByEmail = null }) {
    const payload = {
      requested_by_email: requestedByEmail ? normalizeEmail(requestedByEmail) : null,
      amount,
      quantity,
      provider: 'bitrefill',
      invoice: result.invoice,
      product: result.product,
      orders: result.orders,
      redemption_codes: result.redemptionCodes
    };

    const { data, error } = await this.client
      .from(this.tables.bitrefillPurchases)
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (error) {
      throw error;
    }

    return mapBitrefillPurchaseRow(data);
  }
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function normalizeCode(code) {
  return String(code ?? '').trim();
}

function mapEmailRow(row) {
  return {
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderedAt: row.ordered_at
  };
}

function mapOrderRow(row) {
  return {
    id: row.id,
    email: row.email,
    ebookAsin: row.ebook_asin,
    ebookTitle: row.ebook_title,
    providerOrderId: row.provider_order_id,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapRechargeCardRow(row) {
  return {
    code: row.code,
    status: row.status,
    providerRequestId: row.provider_request_id,
    createdAt: row.created_at,
    redeemedAt: row.redeemed_at
  };
}

function mapBitrefillPurchaseRow(row) {
  return {
    id: row.id,
    requestedByEmail: row.requested_by_email,
    amount: row.amount,
    quantity: row.quantity,
    provider: row.provider,
    invoice: row.invoice,
    product: row.product,
    orders: row.orders,
    redemptionCodes: row.redemption_codes,
    createdAt: row.created_at
  };
}


function assertValidAdminStatus(status) {
  if (!['pending', 'processing', 'ordered'].includes(status)) {
    const error = new Error('Invalid email status.');
    error.statusCode = 400;
    throw error;
  }
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message ?? '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
