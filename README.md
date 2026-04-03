# Amazon Bot Backend

一個輕量後端，提供幾個 API：

1. Amazon 充值卡兌換
2. Amazon 電子書下單 / 贈送
3. 新增 email 名單
4. 透過 Bitrefill API 購買 Amazon.com Gift Card code

業務規則：

- 所有人收到的是同一本電子書
- 一個 email 只能收到一次
- email 必須先加入，才能下單送書

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

建議使用 `Node.js 20+`。

預設使用 `Supabase` 當資料儲存層，schema 在 `supabase/schema.sql`。
完整設定流程在 `docs/supabase-setup.md`。
Railway 部署說明在 `docs/railway-deploy.md`。

打開 `http://localhost:3000/` 就能看到送書首頁 UI。

## 前端最先會用到的 API
前端完整 handoff 文件在 `docs/frontend-api.md`。

### `POST /api/emails`

註冊 email。

```json
{
  "email": "user@example.com"
}
```

回傳：

- `created`: 這次是不是新註冊
- `status.exists`: email 是否已註冊
- `status.alreadySent`: 這個 email 是否已經送過書
- `stats.registeredEmails`: 已註冊總數
- `stats.sentEmails`: 已送出總數

### `GET /api/emails/status?email=user@example.com`

前端檢查某個 email 是否已註冊、是否已送過。

即使 email 不存在，也會回 `200`，方便前端直接判斷。

### `GET /api/stats`

給前端顯示數字。

### `GET /api/emails/:email`

舊的明細查詢接口，email 不存在時會回 `404`。

## 其他 API

### `POST /api/bitrefill/amazon-gift-cards/purchase`

向 Bitrefill 買 Amazon.com Gift Card code。

### `GET /api/bitrefill/purchases/:id`

查已購買的 Bitrefill 記錄與 code。

### `POST /api/amazon/recharge-cards/redeem`

兌換 Amazon 充值卡。

### `POST /api/amazon/orders`

對指定 email 送固定 ebook。

## 環境變數

### Storage

- `ADMIN_ROUTE_SLUG`: 隱藏 admin 頁面與 admin API 的 secret slug（demo 用）
- `STORE_PROVIDER`: `supabase` 或 `memory`，預設 `supabase`
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: 後端用 service role key
- `SUPABASE_EMAILS_TABLE`: 預設 `email_registrations`
- `SUPABASE_ORDERS_TABLE`: 預設 `ebook_orders`
- `SUPABASE_RECHARGE_CARDS_TABLE`: 預設 `recharge_cards`
- `SUPABASE_BITREFILL_PURCHASES_TABLE`: 預設 `bitrefill_purchases`

### Amazon / Bitrefill

- `AMAZON_PROVIDER`: `mock` 或 `webhook`
- `AMAZON_AUTOMATION_URL`: webhook provider 的外部自動化服務網址
- `AMAZON_AUTOMATION_TOKEN`: webhook provider 的 Bearer token
- `AMAZON_EBOOK_ASIN`: 固定送出的電子書 ASIN
- `AMAZON_EBOOK_TITLE`: 固定送出的電子書名稱
- `AMAZON_AUTOMATION_PORT`: automation service port
- `AMAZON_BASE_URL`: 預設 `https://www.amazon.com`
- `AMAZON_USER_DATA_DIR`: Playwright 持久化登入 session 目錄
- `AMAZON_HEADLESS`: automation service 是否無頭模式
- `AMAZON_SLOW_MO_MS`: 操作放慢，方便 debug
- `AMAZON_GIFT_MESSAGE`: 送書時附帶訊息
- `AMAZON_BROWSER_CHANNEL`: 可指定 `chrome` 等 browser channel
- `AMAZON_DEBUG_DIR`: automation 失敗時截圖存放位置
- `BITREFILL_BASE_URL`: Bitrefill API base URL，預設 `https://api.bitrefill.com`
- `BITREFILL_API_KEY`: Bitrefill Personal Access Token；如果有這個就用 Bearer auth
- `BITREFILL_API_ID`: Bitrefill business API id；和 `BITREFILL_API_SECRET` 一起走 Basic auth
- `BITREFILL_API_SECRET`: Bitrefill business API secret
- `BITREFILL_PAYMENT_METHOD`: 預設 `balance`
- `BITREFILL_AMAZON_PRODUCT_ID`: 如果你知道產品 id，可直接指定，最穩
- `BITREFILL_AMAZON_PRODUCT_QUERY`: 預設搜尋 `Amazon.com Gift Card`
- `BITREFILL_POLL_INTERVAL_MS`: 建單後輪詢 order 的間隔
- `BITREFILL_ORDER_TIMEOUT_MS`: 等待拿到 code 的 timeout
