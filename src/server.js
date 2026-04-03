import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { normalizeEmail } from './store.js';

const publicDir = path.resolve(process.cwd(), 'public');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

export function createServer({ config, store, amazonProvider, bitrefillClient }) {
  const adminRoutePath = `/${config.adminRouteSlug}`;
  const adminApiBase = `/api/admin/${config.adminRouteSlug}`;

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

      if (isReadMethod(request.method) && (url.pathname === '/' || url.pathname === '/index.html')) {
        return serveStaticFile(response, 'index.html', request.method);
      }

      if (isReadMethod(request.method) && url.pathname === adminRoutePath) {
        return serveStaticFile(response, 'admin.html', request.method);
      }

      if (isReadMethod(request.method) && !url.pathname.startsWith('/api/') && url.pathname !== '/health') {
        const served = await tryServePublicAsset(response, url.pathname, request.method);
        if (served) {
          return;
        }
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, {
          ok: true,
          amazonProvider: amazonProvider.name,
          bitrefillEnabled: bitrefillClient?.enabled ?? false,
          ebook: {
            asin: config.ebookAsin,
            title: config.ebookTitle
          }
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/stats') {
        return sendJson(response, 200, {
          stats: await store.getEmailStats()
        });
      }

      if (request.method === 'GET' && url.pathname === `${adminApiBase}/emails`) {
        return sendJson(response, 200, {
          emails: await store.listEmails(),
          stats: await store.getEmailStats()
        });
      }

      if (request.method === 'PATCH' && url.pathname.startsWith(`${adminApiBase}/emails/`)) {
        const email = normalizeEmail(decodeURIComponent(url.pathname.replace(`${adminApiBase}/emails/`, '')));
        const body = await readJson(request);
        const status = String(body.status ?? '').trim();
        const record = await store.updateEmailAdminStatus(email, status);

        return sendJson(response, 200, {
          email: record,
          stats: await store.getEmailStats()
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/emails') {
        const body = await readJson(request);
        const email = normalizeEmail(body.email);

        if (!isValidEmail(email)) {
          return sendJson(response, 400, { error: 'A valid email is required.' });
        }

        const result = await store.addEmail(email);
        const status = await store.getEmailStatus(email);
        return sendJson(response, result.created ? 201 : 200, {
          created: result.created,
          status,
          stats: await store.getEmailStats()
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/emails/status') {
        const email = normalizeEmail(url.searchParams.get('email'));

        if (!isValidEmail(email)) {
          return sendJson(response, 400, { error: 'A valid email is required.' });
        }

        return sendJson(response, 200, {
          status: await store.getEmailStatus(email)
        });
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/emails/')) {
        const email = normalizeEmail(decodeURIComponent(url.pathname.replace('/api/emails/', '')));
        const record = await store.getEmail(email);

        if (!record) {
          return sendJson(response, 404, { error: 'Email not found.' });
        }

        return sendJson(response, 200, {
          email: record,
          order: await store.getOrderByEmail(email)
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/bitrefill/amazon-gift-cards/purchase') {
        const body = await readJson(request);
        const amount = Number(body.amount);
        const quantity = body.quantity == null ? 1 : Number.parseInt(body.quantity, 10);
        const requestedByEmail = body.requestedByEmail ? normalizeEmail(body.requestedByEmail) : null;

        if (!Number.isFinite(amount) || amount <= 0) {
          return sendJson(response, 400, { error: 'A positive numeric amount is required.' });
        }

        if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 20) {
          return sendJson(response, 400, { error: 'Quantity must be an integer between 1 and 20.' });
        }

        if (requestedByEmail && !isValidEmail(requestedByEmail)) {
          return sendJson(response, 400, { error: 'requestedByEmail must be a valid email.' });
        }

        const purchaseResult = await bitrefillClient.purchaseAmazonGiftCard({ amount, quantity });
        const purchase = await store.saveBitrefillPurchase({
          amount,
          quantity,
          requestedByEmail,
          result: purchaseResult
        });

        return sendJson(response, 201, { purchase });
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/bitrefill/purchases/')) {
        const purchaseId = decodeURIComponent(url.pathname.replace('/api/bitrefill/purchases/', ''));
        const purchase = await store.getBitrefillPurchaseById(purchaseId);

        if (!purchase) {
          return sendJson(response, 404, { error: 'Bitrefill purchase not found.' });
        }

        return sendJson(response, 200, { purchase });
      }

      if (request.method === 'POST' && url.pathname === '/api/amazon/recharge-cards/redeem') {
        const body = await readJson(request);
        const code = String(body.code ?? '').trim();

        if (!code) {
          return sendJson(response, 400, { error: 'A recharge card code is required.' });
        }

        const reserveResult = await store.reserveRechargeCard(code);
        if (!reserveResult.reserved) {
          return sendJson(response, 409, {
            error: 'This recharge card has already been redeemed or is processing.',
            rechargeCard: reserveResult.rechargeCard
          });
        }

        try {
          const providerResult = await amazonProvider.redeemGiftCard({ code });
          const rechargeCard = await store.completeRechargeCard(code, providerResult.providerRequestId);

          return sendJson(response, 201, {
            rechargeCard,
            provider: amazonProvider.name
          });
        } catch (error) {
          await store.releaseRechargeCard(code);
          throw error;
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/amazon/orders') {
        const body = await readJson(request);
        const email = normalizeEmail(body.email);

        if (!isValidEmail(email)) {
          return sendJson(response, 400, { error: 'A valid email is required.' });
        }

        let reserveResult;
        try {
          reserveResult = await store.reserveOrderForEmail(email);
        } catch (error) {
          if (error.message === 'EMAIL_NOT_FOUND') {
            return sendJson(response, 404, { error: 'Email not registered yet.' });
          }

          throw error;
        }

        if (!reserveResult.reserved) {
          return sendJson(response, 409, {
            error: 'This email has already received the ebook or is processing.',
            email: reserveResult.email,
            order: reserveResult.order
          });
        }

        try {
          const providerResult = await amazonProvider.orderEbookGift({
            email,
            ebookAsin: config.ebookAsin,
            ebookTitle: config.ebookTitle
          });

          const orderResult = await store.completeOrder({
            email,
            ebookAsin: config.ebookAsin,
            ebookTitle: config.ebookTitle,
            providerOrderId: providerResult.providerOrderId
          });

          return sendJson(response, 201, {
            order: orderResult.order,
            provider: amazonProvider.name
          });
        } catch (error) {
          await store.releaseOrder(email);
          throw error;
        }
      }

      return sendJson(response, 404, { error: 'Route not found.' });
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      return sendJson(response, statusCode, {
        error: error.message || 'Internal server error.'
      });
    }
  });
}

async function tryServePublicAsset(response, pathnameValue, method) {
  const cleanedPath = path.normalize(pathnameValue).replace(/^\.+/, '');
  const relativePath = cleanedPath.startsWith(path.sep) ? cleanedPath.slice(1) : cleanedPath;

  if (!relativePath) {
    return false;
  }

  try {
    await serveStaticFile(response, relativePath, method);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function serveStaticFile(response, relativePath, method = 'GET') {
  const filePath = path.resolve(publicDir, relativePath);

  if (!filePath.startsWith(publicDir)) {
    const error = new Error('Invalid path.');
    error.statusCode = 400;
    throw error;
  }

  const file = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'content-type': contentTypes[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  response.end(method === 'HEAD' ? undefined : file);
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, null, 2));
}

function isReadMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
