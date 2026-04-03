const TREASURY_ADDRESS = '0xa348396A85180926958a1B30c39dD1ad63889A30';
const BOOK_PRICE_USD = 9.9;
const BSC_RPC_ENDPOINTS = [
  'https://bsc-dataseed-public.bnbchain.org',
  'https://bsc-dataseed1.bnbchain.org',
  'https://bsc-dataseed.binance.org'
];
const BNB_PRICE_ENDPOINT =
  'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd';

const elements = {
  form: document.querySelector('#email-form'),
  emailInput: document.querySelector('#email-input'),
  checkButton: document.querySelector('#check-button'),
  registerButton: document.querySelector('#register-button'),
  refreshStatsButton: document.querySelector('#refresh-stats-button'),
  refreshTreasuryButton: document.querySelector('#refresh-treasury-button'),
  feedbackBanner: document.querySelector('#feedback-banner'),
  copyCaButton: document.querySelector('#copy-ca-button'),
  caAddress: document.querySelector('#ca-address'),
  caFeedback: document.querySelector('#ca-feedback'),
  treasuryAddress: document.querySelector('#treasury-address'),
  treasuryBnb: document.querySelector('#treasury-bnb'),
  treasuryUsd: document.querySelector('#treasury-usd'),
  treasuryBooks: document.querySelector('#treasury-books'),
  registeredCount: document.querySelector('#registered-count'),
  sentCount: document.querySelector('#sent-count'),
  pendingCount: document.querySelector('#pending-count'),
  processingCount: document.querySelector('#processing-count'),
  statusBadge: document.querySelector('#status-badge'),
  statusEmail: document.querySelector('#status-email'),
  statusDescription: document.querySelector('#status-description'),
  statusExists: document.querySelector('#status-exists'),
  statusSent: document.querySelector('#status-sent'),
  bookTitle: document.querySelector('#book-title')
};

const statusMap = {
  not_found: {
    label: '尚未登記',
    description: '這個 email 還沒加入名單，可以直接點「加入名單」。',
    className: 'not-found'
  },
  pending: {
    label: '已登記',
    description: '這個 email 已經登記成功，等待送書。',
    className: 'pending'
  },
  processing: {
    label: '處理中',
    description: '系統正在處理這個 email 的送書流程。',
    className: 'processing'
  },
  ordered: {
    label: '已送出',
    description: '這個 email 已經收到電子書。',
    className: 'sent'
  }
};

async function boot() {
  bindEvents();
  elements.treasuryAddress.textContent = TREASURY_ADDRESS;
  await Promise.all([loadStats(), loadBookMeta(), loadTreasuryStats()]);
  window.setInterval(loadTreasuryStats, 60000);
}

function bindEvents() {
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = getEmailValue();
    if (!email) {
      showBanner('請先輸入 email。', 'error');
      return;
    }

    await registerEmail(email);
  });

  elements.checkButton.addEventListener('click', async () => {
    const email = getEmailValue();
    if (!email) {
      showBanner('請先輸入 email。', 'error');
      return;
    }

    await checkEmailStatus(email);
  });

  elements.refreshStatsButton.addEventListener('click', loadStats);
  elements.refreshTreasuryButton.addEventListener('click', loadTreasuryStats);
  elements.copyCaButton.addEventListener('click', copyContractAddress);

  elements.emailInput.addEventListener('blur', async () => {
    const email = getEmailValue();
    if (!email || !isLikelyEmail(email)) {
      return;
    }

    await checkEmailStatus(email, { silent: true });
  });
}

function getEmailValue() {
  return elements.emailInput.value.trim().toLowerCase();
}

async function registerEmail(email) {
  setBusy(true);

  try {
    const response = await fetch('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '加入名單失敗');
    }

    renderStatus(payload.status);
    renderStats(payload.stats);

    if (payload.created) {
      showBanner('已成功加入送書名單。', 'success');
      return;
    }

    if (payload.status.alreadySent) {
      showBanner('這個 email 已經收過書了。', 'warning');
      return;
    }

    showBanner('這個 email 已經在名單中。', 'warning');
  } catch (error) {
    showBanner(error.message || '加入名單失敗', 'error');
  } finally {
    setBusy(false);
  }
}

async function checkEmailStatus(email, options = {}) {
  const { silent = false } = options;
  if (!silent) {
    setBusy(true);
  }

  try {
    const response = await fetch(`/api/emails/status?email=${encodeURIComponent(email)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || '查詢失敗');
    }

    renderStatus(payload.status);

    if (!silent) {
      if (payload.status.exists) {
        showBanner(payload.status.alreadySent ? '這個 email 已經送過書。' : '這個 email 已存在。', 'success');
      } else {
        showBanner('這個 email 尚未登記，可以直接加入名單。', 'warning');
      }
    }
  } catch (error) {
    if (!silent) {
      showBanner(error.message || '查詢失敗', 'error');
    }
  } finally {
    if (!silent) {
      setBusy(false);
    }
  }
}

async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '無法載入統計');
    }

    renderStats(payload.stats);
  } catch (error) {
    showBanner(error.message || '無法載入統計', 'error');
  }
}

async function loadTreasuryStats() {
  elements.treasuryBnb.textContent = '載入中';
  elements.treasuryUsd.textContent = '正在讀取 BNB 與 USD 價格';
  elements.treasuryBooks.textContent = '載入中';

  try {
    const [balanceWeiHex, bnbPriceUsd] = await Promise.all([
      fetchBscBalance(TREASURY_ADDRESS),
      fetchBnbPriceUsd()
    ]);

    const balanceBnb = weiHexToBnb(balanceWeiHex);
    const usdValue = balanceBnb * bnbPriceUsd;
    const books = Math.floor(usdValue / BOOK_PRICE_USD);

    elements.treasuryBnb.textContent = formatNumber(balanceBnb, 4);
    elements.treasuryUsd.textContent = `約 US$${formatNumber(usdValue, 2)} @ BNB US$${formatNumber(bnbPriceUsd, 2)}`;
    elements.treasuryBooks.textContent = String(books);
  } catch (error) {
    elements.treasuryBnb.textContent = '--';
    elements.treasuryUsd.textContent = error.message || '無法取得價格';
    elements.treasuryBooks.textContent = '--';
  }
}

async function fetchBscBalance(address) {
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'eth_getBalance',
    params: [address, 'latest']
  };

  let lastError;
  for (const endpoint of BSC_RPC_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`RPC ${response.status}`);
      }

      const payload = await response.json();
      if (payload.error) {
        throw new Error(payload.error.message || 'RPC error');
      }

      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || '無法連到 BSC RPC');
}

async function fetchBnbPriceUsd() {
  const response = await fetch(BNB_PRICE_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('無法取得 BNB 價格');
  }

  const payload = await response.json();
  const price = Number(payload?.binancecoin?.usd);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('BNB 價格資料格式錯誤');
  }

  return price;
}

function weiHexToBnb(hexValue) {
  const wei = BigInt(hexValue);
  const whole = wei / 1000000000000000000n;
  const fraction = Number((wei % 1000000000000000000n) / 10000000000n) / 1e8;
  return Number(whole) + fraction;
}

async function loadBookMeta() {
  try {
    const response = await fetch('/health');
    const payload = await response.json();
    if (response.ok && payload?.ebook?.title) {
      elements.bookTitle.textContent = payload.ebook.title;
    }
  } catch {
  }
}

async function copyContractAddress() {
  const value = elements.caAddress.textContent.trim();

  try {
    await navigator.clipboard.writeText(value);
    elements.caFeedback.textContent = 'CA 已複製到剪貼簿。';
  } catch {
    elements.caFeedback.textContent = '複製失敗，請手動選取地址。';
  }
}

function renderStats(stats) {
  elements.registeredCount.textContent = String(stats.registeredEmails ?? 0);
  elements.sentCount.textContent = String(stats.sentEmails ?? 0);
  elements.pendingCount.textContent = String(stats.notSentEmails ?? stats.pendingEmails ?? 0);
  elements.processingCount.textContent = String(stats.processingEmails ?? 0);
}

function renderStatus(status) {
  const view = statusMap[status.status] ?? statusMap.not_found;
  elements.statusBadge.textContent = view.label;
  elements.statusBadge.className = `status-badge ${view.className}`;
  elements.statusEmail.textContent = status.email || '請先輸入 email';
  elements.statusDescription.textContent = view.description;
  elements.statusExists.textContent = status.exists ? '是' : '否';
  elements.statusSent.textContent = status.alreadySent ? '是' : '否';
}

function showBanner(message, type) {
  elements.feedbackBanner.textContent = message;
  elements.feedbackBanner.className = `feedback-banner ${type}`;
}

function setBusy(isBusy) {
  elements.checkButton.disabled = isBusy;
  elements.registerButton.disabled = isBusy;
  elements.refreshStatsButton.disabled = isBusy;
  elements.refreshTreasuryButton.disabled = isBusy;
}

function formatNumber(value, digits) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function isLikelyEmail(value) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
}

boot();
