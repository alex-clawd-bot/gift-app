import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';

async function createTestApp() {
  const store = new MemoryStore();
  await store.init();

  const server = createServer({
    config: {
      ebookAsin: 'B0BOOK123',
      ebookTitle: 'Same Ebook',
      adminRouteSlug: 'hidden-admin'
    },
    store,
    amazonProvider: {
      name: 'mock',
      async redeemGiftCard({ code }) {
        return { providerRequestId: `redeem-${code}` };
      },
      async orderEbookGift({ email }) {
        return { providerOrderId: `order-${email}` };
      }
    },
    bitrefillClient: {
      enabled: true,
      async purchaseAmazonGiftCard({ amount, quantity }) {
        return {
          invoice: {
            id: 'inv-1',
            status: 'paid',
            totalPrice: amount * quantity,
            paymentMethod: 'balance'
          },
          product: {
            id: 'amazon-us',
            name: 'Amazon.com Gift Card',
            countryCode: 'US'
          },
          orders: [{
            id: 'ord-1',
            status: 'delivered',
            redemptionInfo: {
              code: 'GC-CODE-123',
              pin: null,
              link: null,
              instructions: 'Redeem on Amazon.com'
            }
          }],
          redemptionCodes: [{
            code: 'GC-CODE-123',
            pin: null,
            link: null,
            instructions: 'Redeem on Amazon.com'
          }]
        };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}


test('hidden admin route serves admin page', async () => {
  const app = await createTestApp();

  try {
    const response = await fetch(`${app.baseUrl}/hidden-admin`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /email 管理後台/);
  } finally {
    await app.close();
  }
});

test('admin can list emails and update status', async () => {
  const app = await createTestApp();

  try {
    await fetch(`${app.baseUrl}/api/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin-test@example.com' })
    });

    let response = await fetch(`${app.baseUrl}/api/admin/hidden-admin/emails`);
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.emails[0].email, 'admin-test@example.com');
    assert.equal(payload.emails[0].status, 'pending');

    response = await fetch(`${app.baseUrl}/api/admin/hidden-admin/emails/admin-test%40example.com`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ordered' })
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.email.status, 'ordered');
    assert.equal(payload.stats.sentEmails, 1);
  } finally {
    await app.close();
  }
});

test('homepage serves the giveaway UI', async () => {
  const app = await createTestApp();

  try {
    const response = await fetch(`${app.baseUrl}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /送你一本書/);
    assert.match(html, /Email Checker/);
  } finally {
    await app.close();
  }
});

test('email register returns frontend-friendly status and stats', async () => {
  const app = await createTestApp();

  try {
    const response = await fetch(`${app.baseUrl}/api/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com' })
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.created, true);
    assert.equal(payload.status.exists, true);
    assert.equal(payload.status.alreadySent, false);
    assert.equal(payload.stats.registeredEmails, 1);
    assert.equal(payload.stats.sentEmails, 0);
  } finally {
    await app.close();
  }
});

test('email status endpoint reports not found without 404', async () => {
  const app = await createTestApp();

  try {
    const response = await fetch(`${app.baseUrl}/api/emails/status?email=missing@example.com`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.status.exists, false);
    assert.equal(payload.status.alreadySent, false);
    assert.equal(payload.status.status, 'not_found');
  } finally {
    await app.close();
  }
});

test('email can only receive one ebook once', async () => {
  const app = await createTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com' })
    });
    assert.equal(response.status, 201);

    response = await fetch(`${app.baseUrl}/api/amazon/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com' })
    });
    assert.equal(response.status, 201);
    const firstOrder = await response.json();
    assert.equal(firstOrder.order.email, 'reader@example.com');

    response = await fetch(`${app.baseUrl}/api/amazon/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'reader@example.com' })
    });
    assert.equal(response.status, 409);
  } finally {
    await app.close();
  }
});

test('stats endpoint returns registered and sent counts', async () => {
  const app = await createTestApp();

  try {
    await fetch(`${app.baseUrl}/api/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' })
    });

    await fetch(`${app.baseUrl}/api/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com' })
    });

    await fetch(`${app.baseUrl}/api/amazon/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com' })
    });

    const response = await fetch(`${app.baseUrl}/api/stats`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.stats.registeredEmails, 2);
    assert.equal(payload.stats.sentEmails, 1);
    assert.equal(payload.stats.notSentEmails, 1);
  } finally {
    await app.close();
  }
});

test('recharge card cannot be redeemed twice', async () => {
  const app = await createTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/amazon/recharge-cards/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'CARD-123' })
    });
    assert.equal(response.status, 201);

    response = await fetch(`${app.baseUrl}/api/amazon/recharge-cards/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'CARD-123' })
    });
    assert.equal(response.status, 409);
  } finally {
    await app.close();
  }
});

test('bitrefill amazon gift card purchase is saved and retrievable', async () => {
  const app = await createTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/bitrefill/amazon-gift-cards/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: 25,
        quantity: 1,
        requestedByEmail: 'ops@example.com'
      })
    });
    assert.equal(response.status, 201);

    const created = await response.json();
    assert.equal(created.purchase.amount, 25);
    assert.equal(created.purchase.redemptionCodes[0].code, 'GC-CODE-123');

    response = await fetch(`${app.baseUrl}/api/bitrefill/purchases/${created.purchase.id}`);
    assert.equal(response.status, 200);

    const fetched = await response.json();
    assert.equal(fetched.purchase.id, created.purchase.id);
    assert.equal(fetched.purchase.requestedByEmail, 'ops@example.com');
  } finally {
    await app.close();
  }
});
