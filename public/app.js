const state = { token: localStorage.getItem('msToken') || '', user: JSON.parse(localStorage.getItem('msUser') || 'null'), requests: [] };
const $ = s => document.querySelector(s);
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function notify(message, error = false) {
  const toast = $('#toast'); toast.textContent = message; toast.className = `toast ${error ? 'error' : ''}`;
  setTimeout(() => toast.classList.add('hidden'), 3500);
}
function setSession(payload) {
  state.token = payload.token; state.user = payload.user;
  localStorage.setItem('msToken', state.token); localStorage.setItem('msUser', JSON.stringify(state.user)); renderSession(); loadRequests();
}
function logout() {
  localStorage.removeItem('msToken'); localStorage.removeItem('msUser'); state.token = ''; state.user = null; state.requests = []; renderSession();
}
function renderSession() {
  const loggedIn = Boolean(state.token && state.user);
  $('#loginView').classList.toggle('hidden', loggedIn); $('#appView').classList.toggle('hidden', !loggedIn);
  $('#userCard').classList.toggle('hidden', !loggedIn); $('#logoutBtn').classList.toggle('hidden', !loggedIn);
  if (loggedIn) $('#userCard').innerHTML = `<strong>${escapeHtml(state.user.username)}</strong><span>${escapeHtml(state.user.role)}</span>`;
  $('#newRequestBtn').classList.toggle('hidden', loggedIn && state.user.role !== 'DEVELOPER');
}
async function loadRequests() {
  try { state.requests = await api('/api/requests'); renderRequests(); } catch (e) { notify(e.message, true); if (/Authentication/.test(e.message)) logout(); }
}
function renderStats(items = state.requests) {
  const pending = items.filter(x => x.status === 'PENDING_APPROVAL').length;
  const completed = items.filter(x => ['COMPLETED','DRY_RUN_COMPLETED'].includes(x.status)).length;
  const failed = items.filter(x => x.status === 'FAILED').length;
  $('#stats').innerHTML = [
    ['Total requests', items.length], ['Pending approval', pending], ['Completed', completed], ['Failed', failed]
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
}
function badge(status) { return `<span class="badge ${status.toLowerCase().replaceAll('_','-')}">${escapeHtml(status.replaceAll('_',' '))}</span>`; }
function renderRequests() {
  const query = $('#searchBox').value.toLowerCase().trim();
  const items = state.requests.filter(x => [x.serviceName,x.namespace,x.requestedBy,x.status].join(' ').toLowerCase().includes(query));
  renderStats(state.requests);
  if (!items.length) { $('#requestList').innerHTML = '<div class="empty">No requests found.</div>'; return; }
  $('#requestList').innerHTML = items.map(item => {
    const db = item.databaseRequired ? `${escapeHtml(item.databaseType || 'DB')} · ${escapeHtml(item.databaseName || item.schemaName || 'Pending details')}` : 'Not required';
    const canReview = state.user.role === 'DEVOPS' && ['PENDING_APPROVAL','FAILED'].includes(item.status);
    const steps = (item.steps || []).map(s => `<li><span>${escapeHtml(s.name)}</span>${badge(s.status)}</li>`).join('');
    return `<article class="request-card">
      <div class="request-top"><div><h3>${escapeHtml(item.serviceName)}</h3><p>${escapeHtml(item.namespace)} · Requested by ${escapeHtml(item.requestedBy)}</p></div>${badge(item.status)}</div>
      <div class="details"><div><span>Ingress</span><strong>${escapeHtml(item.ingressHost || 'No host')}${escapeHtml(item.ingressPath)}</strong></div><div><span>Ports</span><strong>${item.servicePort} → ${item.containerPort}</strong></div><div><span>Database</span><strong>${db}</strong></div></div>
      ${item.description ? `<p class="description">${escapeHtml(item.description)}</p>` : ''}
      ${item.repositoryUrl ? `<a href="${escapeHtml(item.repositoryUrl)}" target="_blank" rel="noreferrer">Open generated repository</a>` : ''}
      ${steps ? `<ul class="steps">${steps}</ul>` : ''}
      ${item.approvalComment ? `<p class="comment"><strong>DevOps:</strong> ${escapeHtml(item.approvalComment)}</p>` : ''}
      ${canReview ? `<button class="review" data-id="${item.id}">${item.status === 'FAILED' ? 'Retry provisioning' : 'Review request'}</button>` : ''}
    </article>`;
  }).join('');
  document.querySelectorAll('.review').forEach(btn => btn.addEventListener('click', () => openAction(btn.dataset.id)));
}
function openAction(id) { $('#actionForm').requestId.value = id; $('#actionDialog').showModal(); }
async function performAction(action) {
  const form = $('#actionForm'); const id = form.requestId.value; const comment = form.comment.value;
  try { await api(`/api/requests/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) }); $('#actionDialog').close(); form.reset(); notify(action === 'approve' ? 'Provisioning completed' : 'Request rejected'); loadRequests(); }
  catch (e) { notify(e.message, true); loadRequests(); }
}

$('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const values = Object.fromEntries(new FormData(e.target)); try { setSession(await api('/api/login', { method: 'POST', body: JSON.stringify(values) })); e.target.reset(); } catch (err) { notify(err.message, true); } });
$('#requestForm').addEventListener('submit', async e => {
  e.preventDefault(); const fd = new FormData(e.target); const body = Object.fromEntries(fd); body.databaseRequired = fd.has('databaseRequired');
  try { await api('/api/requests', { method: 'POST', body: JSON.stringify(body) }); $('#requestDialog').close(); e.target.reset(); $('#dbFields').classList.add('hidden'); notify('Request submitted for approval'); loadRequests(); } catch (err) { notify(err.message, true); }
});
$('#newRequestBtn').addEventListener('click', () => $('#requestDialog').showModal());
$('#logoutBtn').addEventListener('click', logout); $('#refreshBtn').addEventListener('click', loadRequests); $('#searchBox').addEventListener('input', renderRequests);
$('#databaseRequired').addEventListener('change', e => $('#dbFields').classList.toggle('hidden', !e.target.checked));
$('#approveBtn').addEventListener('click', () => performAction('approve')); $('#rejectBtn').addEventListener('click', () => performAction('reject'));
document.querySelectorAll('[data-close]').forEach(x => x.addEventListener('click', () => x.closest('dialog').close()));
renderSession(); if (state.token) loadRequests();
