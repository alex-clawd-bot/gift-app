const adminSlug = window.location.pathname.replace(/^\//, '');
const adminApiBase = `/api/admin/${adminSlug}`;

const elements = {
  refreshButton: document.querySelector('#admin-refresh-button'),
  feedback: document.querySelector('#admin-feedback'),
  tbody: document.querySelector('#admin-email-tbody'),
  registeredCount: document.querySelector('#admin-registered-count'),
  sentCount: document.querySelector('#admin-sent-count'),
  pendingCount: document.querySelector('#admin-pending-count'),
  processingCount: document.querySelector('#admin-processing-count')
};

async function boot() {
  elements.refreshButton.addEventListener('click', loadAdminData);
  await loadAdminData();
}

async function loadAdminData() {
  try {
    const response = await fetch(`${adminApiBase}/emails`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || '無法載入 admin email 清單');
    }

    renderStats(payload.stats);
    renderRows(payload.emails);
    hideFeedback();
  } catch (error) {
    showFeedback(error.message || '無法載入 admin email 清單', 'error');
  }
}

function renderStats(stats) {
  elements.registeredCount.textContent = String(stats.registeredEmails ?? 0);
  elements.sentCount.textContent = String(stats.sentEmails ?? 0);
  elements.pendingCount.textContent = String(stats.pendingEmails ?? 0);
  elements.processingCount.textContent = String(stats.processingEmails ?? 0);
}

function renderRows(emails) {
  if (!emails.length) {
    elements.tbody.innerHTML = '<tr><td colspan="4" class="admin-empty">目前還沒有 email。</td></tr>';
    return;
  }

  elements.tbody.innerHTML = emails.map((record) => `
    <tr>
      <td class="admin-email-cell">${escapeHtml(record.email)}</td>
      <td>${formatDate(record.createdAt)}</td>
      <td><span class="status-badge ${statusClass(record.status)}">${escapeHtml(record.status)}</span></td>
      <td>
        <div class="admin-action-row">
          <select class="admin-status-select" data-email="${escapeHtml(record.email)}">
            ${['pending', 'processing', 'ordered'].map((status) => `
              <option value="${status}" ${record.status === status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select>
          <button class="ghost-button small admin-save-button" data-email="${escapeHtml(record.email)}" type="button">保存</button>
        </div>
      </td>
    </tr>
  `).join('');

  for (const button of elements.tbody.querySelectorAll('.admin-save-button')) {
    button.addEventListener('click', handleSaveStatus);
  }
}

async function handleSaveStatus(event) {
  const email = event.currentTarget.dataset.email;
  const select = elements.tbody.querySelector(`.admin-status-select[data-email="${cssEscape(email)}"]`);
  const status = select.value;

  event.currentTarget.disabled = true;

  try {
    const response = await fetch(`${adminApiBase}/emails/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '更新狀態失敗');
    }

    showFeedback(`已更新 ${email} 為 ${status}`, 'success');
    renderStats(payload.stats);
    await loadAdminData();
  } catch (error) {
    showFeedback(error.message || '更新狀態失敗', 'error');
  } finally {
    event.currentTarget.disabled = false;
  }
}

function showFeedback(message, type) {
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback-banner ${type}`;
}

function hideFeedback() {
  elements.feedback.textContent = '';
  elements.feedback.className = 'feedback-banner hidden';
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-Hant', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function statusClass(status) {
  if (status === 'ordered') {
    return 'sent';
  }

  if (status === 'processing') {
    return 'processing';
  }

  return 'pending';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cssEscape(value) {
  return value.replace(/(["\\])/g, '\\$1');
}

boot();
