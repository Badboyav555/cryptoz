/* =============================================
   CRYPTO WALLET SIMULATOR — ADMIN LOGIC
   ============================================= */

const SUPABASE_URL = 'https://wcgwgaiqjqzsdtqswers.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xU3iy3LkC4tnrMwsU3Tc0Q_InEjND_F';

let supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch(e) {
  supabase = null;
}

const adminState = {
  user: null,
  users: [],
  withdrawals: [],
  transactions: [],
  chart: null,
  wdFilter: 'all'
};

const COINS = ['btc','eth','sol','xrp','doge','bnb','usdt'];
const COIN_NAMES = {btc:'Bitcoin',eth:'Ethereum',sol:'Solana',xrp:'XRP',doge:'Dogecoin',bnb:'BNB',usdt:'Tether'};

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('cv_admin_session');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      if (s.logged_in && s.role === 'admin') {
        adminState.user = s;
        showAdminPanel();
        return;
      }
    } catch(e) {}
  }
  showAdminAuth();
  lucide.createIcons();
});

function showAdminAuth() {
  document.getElementById('adminAuth').style.display = 'flex';
  document.getElementById('adminLayout').classList.add('hidden');
}

function showAdminPanel() {
  document.getElementById('adminAuth').style.display = 'none';
  document.getElementById('adminLayout').classList.remove('hidden');
  if (window.innerWidth >= 769) {
    document.getElementById('adminSidebar').classList.add('active');
    document.getElementById('adminMain').classList.add('with-sidebar');
  }
  lucide.createIcons();
  loadAdminDashboard();
  loadAdminUsers();
  loadAdminWithdrawals();
  loadAdminTransactions();
}

function adminLogout() {
  localStorage.removeItem('cv_admin_session');
  adminState.user = null;
  showAdminAuth();
  toast('Logged out', 'info');
}

// ---- AUTH ----
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_cv_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

document.getElementById('adminLoginBtn').addEventListener('click', async () => {
  const id = document.getElementById('adminLoginId').value.trim();
  const pass = document.getElementById('adminLoginPass').value;
  if (!id || !pass) return toast('Fill all fields', 'error');

  const btn = document.getElementById('adminLoginBtn');
  btn.innerHTML = '<div class="spinner"></div>';
  btn.disabled = true;

  try {
    const hash = await hashPassword(pass);
    let query;
    if (id.includes('@')) {
      query = supabase.from('users').select('*').eq('email', id).eq('password_hash', hash).single();
    } else {
      query = supabase.from('users').select('*').eq('mobile', id).eq('password_hash', hash).single();
    }
    const { data, error } = await query;
    if (error || !data) { toast('Invalid credentials', 'error'); btn.innerHTML = '<span>Access Panel</span>'; btn.disabled = false; return; }
    if (data.role !== 'admin') { toast('Unauthorized. Admin access only.', 'error'); btn.innerHTML = '<span>Access Panel</span>'; btn.disabled = false; return; }

    adminState.user = { user_id: data.id, username: data.username, role: data.role, logged_in: true };
    localStorage.setItem('cv_admin_session', JSON.stringify(adminState.user));
    toast('Welcome, Admin', 'success');
    showAdminPanel();
  } catch(e) {
    toast('Login failed: ' + e.message, 'error');
  }
  btn.innerHTML = '<span>Access Panel</span>';
  btn.disabled = false;
});

// ---- SIDEBAR ----
function toggleSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const isOpen = sidebar.classList.contains('active');
  sidebar.classList.toggle('active', !isOpen);
  overlay.classList.toggle('active', !isOpen);
}

window.addEventListener('resize', () => {
  if (window.innerWidth >= 769) {
    document.getElementById('adminSidebar').classList.add('active');
    document.getElementById('adminMain').classList.add('with-sidebar');
    document.getElementById('sidebarOverlay').classList.remove('active');
  } else {
    document.getElementById('adminMain').classList.remove('with-sidebar');
  }
});

// ---- NAV ----
function switchAdminTab(tab, el) {
  const screens = { dashboard: 'adminDashboard', users: 'adminUsers', withdrawals: 'adminWithdrawals', transactions: 'adminTransactions', announcements: 'adminAnnouncements', settings: 'adminSettings' };
  Object.values(screens).forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById(screens[tab]).classList.add('active');
  document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  if (window.innerWidth < 769) toggleSidebar();
  lucide.createIcons();
}

// ---- DASHBOARD ----
async function loadAdminDashboard() {
  if (!supabase) return;
  const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).neq('role', 'admin');
  const { count: txCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true });
  const { count: wdCount } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'processing');

  document.getElementById('statUsers').textContent = userCount || 0;
  document.getElementById('statTx').textContent = txCount || 0;
  document.getElementById('statPendingWd').textContent = wdCount || 0;

  // Portfolio calc
  const { data: wallets } = await supabase.from('wallets').select('*');
  let total = 0;
  if (wallets) {
    const { data: prices } = await supabase.from('market_prices').select('*');
    const priceMap = {};
    if (prices) prices.forEach(p => { priceMap[p.symbol] = parseFloat(p.current_price_inr); });

    wallets.forEach(w => {
      total += parseFloat(w.inr_balance) || 0;
      COINS.forEach(c => { total += (parseFloat(w[c + '_balance']) || 0) * (priceMap[c] || 0); });
    });
  }
  document.getElementById('statPortfolio').textContent = '₹' + (total >= 10000000 ? (total / 10000000).toFixed(2) + ' Cr' : total >= 100000 ? (total / 100000).toFixed(2) + ' L' : total.toLocaleString('en-IN', { maximumFractionDigits: 0 }));

  // Chart
  const { data: usersByDay } = await supabase.from('users').select('created_at').neq('role', 'admin').order('created_at', { ascending: true });
  const dayMap = {};
  if (usersByDay) {
    usersByDay.forEach(u => {
      const day = u.created_at ? u.created_at.split('T')[0] : 'unknown';
      dayMap[day] = (dayMap[day] || 0) + 1;
    });
  }
  const labels = Object.keys(dayMap).slice(-14);
  const values = labels.map(l => dayMap[l]);

  if (adminState.chart) adminState.chart.destroy();
  const ctx = document.getElementById('adminChart').getContext('2d');
  adminState.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.map(l => { const d = new Date(l); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }),
      datasets: [{
        label: 'New Users',
        data: values,
        borderColor: '#4f7df9',
        backgroundColor: 'rgba(79,125,249,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#4f7df9'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3bf', font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: '#252a3a' }, ticks: { color: '#9ca3bf', stepSize: 1 } }
      }
    }
  });
}

// ---- USERS ----
async function loadAdminUsers() {
  if (!supabase) return;
  const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false });
  adminState.users = data || [];
  renderAdminUsers(adminState.users);
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('adminUserBody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted)">No users found</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><div style="font-weight:600">${u.username}</div><div style="font-size:11px;color:var(--text-muted)">${u.email || '-'}</div></td>
      <td>${u.mobile}</td>
      <td><span class="status-badge ${u.role === 'admin' ? 'completed' : 'pending'}">${u.role}</span></td>
      <td><span class="status-badge ${u.is_active ? 'completed' : 'rejected'}">${u.is_active ? 'Active' : 'Frozen'}</span></td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-xs btn-secondary" onclick="openEditUser('${u.id}')">Edit Balance</button>
          <button class="btn btn-xs ${u.is_active ? 'btn-red' : 'btn-green'}" onclick="toggleFreezeUser('${u.id}',${u.is_active})">${u.is_active ? 'Freeze' : 'Unfreeze'}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterAdminUsers() {
  const q = document.getElementById('adminUserSearch').value.toLowerCase();
  const filtered = adminState.users.filter(u =>
    u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || u.mobile.includes(q)
  );
  renderAdminUsers(filtered);
}

async function openEditUser(userId) {
  if (!supabase) return;
  const { data: w } = await supabase.from('wallets').select('*').eq('user_id', userId).single();
  const user = adminState.users.find(u => u.id === userId);

  document.getElementById('editUserContent').innerHTML = `
    <div style="font-size:14px;font-weight:600;margin-bottom:16px">Edit: ${user ? user.username : 'User'}</div>
    ${COINS.map(c => `<div class="form-group">
      <label class="form-label">${COIN_NAMES[c]} (${c.toUpperCase()})</label>
      <input type="number" class="form-input" id="editBal_${c}" value="${w ? parseFloat(w[c + '_balance']) : 0}" step="any">
    </div>`).join('')}
    <div class="form-group">
      <label class="form-label">INR Balance</label>
      <input type="number" class="form-input" id="editBal_inr" value="${w ? parseFloat(w.inr_balance) : 0}" step="any">
    </div>
    <button class="btn btn-primary" onclick="saveUserBalance('${userId}')" style="width:100%;margin-top:8px">Save Balances</button>
  `;
  openModal('editUserModal');
  lucide.createIcons();
}

async function saveUserBalance(userId) {
  if (!supabase) return;
  const updates = {};
  COINS.forEach(c => { updates[c + '_balance'] = parseFloat(document.getElementById('editBal_' + c).value) || 0; });
  updates.inr_balance = parseFloat(document.getElementById('editBal_inr').value) || 0;

  await supabase.from('wallets').update(updates).eq('user_id', userId);
  toast('Balances updated!', 'success');
  closeModal('editUserModal');
}

async function toggleFreezeUser(userId, isActive) {
  if (!supabase) return;
  await supabase.from('users').update({ is_active: !isActive }).eq('id', userId);
  toast(isActive ? 'User frozen' : 'User unfrozen', 'success');
  loadAdminUsers();
}

// ---- WITHDRAWALS ----
async function loadAdminWithdrawals() {
  if (!supabase) return;
  const { data } = await supabase.from('withdrawals').select('*, users(username)').order('created_at', { ascending: false });
  adminState.withdrawals = (data || []).map(w => ({ ...w, username: w.users ? w.users.username : 'Unknown' }));
  renderAdminWithdrawals();
}

function renderAdminWithdrawals() {
  const filter = adminState.wdFilter;
  const filtered = filter === 'all' ? adminState.withdrawals : adminState.withdrawals.filter(w => w.status === filter);
  const tbody = document.getElementById('adminWdBody');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No withdrawals found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(w => {
    const date = new Date(w.created_at);
    return `<tr>
      <td style="font-weight:600">${w.username}</td>
      <td>${w.coin.toUpperCase()}</td>
      <td>₹${parseFloat(w.amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      <td>${w.withdrawal_method === 'upi' ? 'UPI' : 'Bank'}</td>
      <td><span class="status-badge ${w.status}">${w.status}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${date.toLocaleDateString('en-IN')}</td>
      <td>
        ${w.status === 'processing' ? `
          <div style="display:flex;gap:4px">
            <button class="btn btn-xs btn-green" onclick="approveWithdrawal('${w.id}')">Approve</button>
            <button class="btn btn-xs btn-red" onclick="rejectWithdrawal('${w.id}')">Reject</button>
          </div>
        ` : '-'}
      </td>
    </tr>`;
  }).join('');
}

function filterAdminWd(filter, btn) {
  adminState.wdFilter = filter;
  document.querySelectorAll('#adminWithdrawals .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAdminWithdrawals();
}

async function approveWithdrawal(id) {
  if (!supabase) return;
  await supabase.from('withdrawals').update({ status: 'completed', processing_days_remaining: 0, completed_at: new Date().toISOString() }).eq('id', id);
  toast('Withdrawal approved', 'success');
  loadAdminWithdrawals();
  loadAdminDashboard();
}

async function rejectWithdrawal(id) {
  if (!supabase) return;
  const { data: wd } = await supabase.from('withdrawals').select('*').eq('id', id).single();
  if (wd) {
    // Refund crypto
    const { data: w } = await supabase.from('wallets').select(wd.coin + '_balance').eq('user_id', wd.user_id).single();
    if (w) await supabase.from('wallets').update({ [wd.coin + '_balance']: parseFloat(w[wd.coin + '_balance']) + parseFloat(wd.crypto_amount) }).eq('user_id', wd.user_id);
  }
  await supabase.from('withdrawals').update({ status: 'rejected' }).eq('id', id);
  toast('Withdrawal rejected. Crypto refunded.', 'success');
  loadAdminWithdrawals();
  loadAdminDashboard();
}

// ---- TRANSACTIONS ----
async function loadAdminTransactions() {
  if (!supabase) return;
  const { data } = await supabase.from('transactions').select('*, sender:users!transactions_sender_id(username), receiver:users!transactions_receiver_id(username)').order('created_at', { ascending: false }).limit(200);
  adminState.transactions = (data || []).map(t => ({
    ...t,
    senderName: t.sender ? t.sender.username : 'Unknown',
    receiverName: t.receiver ? t.receiver.username : 'External'
  }));
  renderAdminTransactions(adminState.transactions);
}

function renderAdminTransactions(txs) {
  const tbody = document.getElementById('adminTxBody');
  if (txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No transactions found</td></tr>';
    return;
  }
  tbody.innerHTML = txs.map(t => {
    const date = new Date(t.created_at);
    return `<tr>
      <td style="font-family:monospace;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.tx_hash || ''}">${(t.tx_hash || '-').substring(0, 16)}...</td>
      <td>${t.senderName}</td>
      <td>${t.receiverName}</td>
      <td>${t.coin.toUpperCase()}</td>
      <td style="font-weight:600">${parseFloat(t.amount).toFixed(6)}</td>
      <td><span class="status-badge ${t.status}">${t.status}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${date.toLocaleDateString('en-IN')}</td>
    </tr>`;
  }).join('');
}

function filterAdminTx() {
  const q = document.getElementById('adminTxSearch').value.toLowerCase();
  const filtered = adminState.transactions.filter(t =>
    (t.tx_hash || '').toLowerCase().includes(q) || t.coin.toLowerCase().includes(q) || t.senderName.toLowerCase().includes(q) || t.receiverName.toLowerCase().includes(q)
  );
  renderAdminTransactions(filtered);
}

// ---- ANNOUNCEMENTS ----
async function sendAnnouncement() {
  if (!supabase) return;
  const title = document.getElementById('announceTitle').value.trim();
  const msg = document.getElementById('announceMsg').value.trim();
  const target = document.getElementById('announceTarget').value;

  if (!title || !msg) return toast('Fill title and message', 'error');

  let userIds;
  if (target === 'all') {
    const { data } = await supabase.from('users').select('id').eq('role', 'user').eq('is_active', true);
    userIds = data.map(d => d.id);
  } else {
    userIds = [target];
  }

  if (userIds.length === 0) return toast('No target users found', 'error');

  const notifications = userIds.map(uid => ({ user_id: uid, title, message: msg }));
  // Insert in batches of 100
  for (let i = 0; i < notifications.length; i += 100) {
    await supabase.from('notifications').insert(notifications.slice(i, i + 100));
  }

  toast(`Announcement sent to ${userIds.length} users!`, 'success');
  document.getElementById('announceTitle').value = '';
  document.getElementById('announceMsg').value = '';
}

// Load user options for announcement target
async function loadAnnouncementTargets() {
  if (!supabase) return;
  const { data } = await supabase.from('users').select('id, username').eq('role', 'user').order('username');
  const sel = document.getElementById('announceTarget');
  if (data) {
    data.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.username;
      sel.appendChild(opt);
    });
  }
}

// ---- MODALS ----
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
  lucide.createIcons();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ---- TOAST ----
function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icons = { success: 'check-circle', error: 'alert-circle', info: 'info' };
  t.innerHTML = `<i data-lucide="${icons[type] || 'info'}" style="width:18px;height:18px;flex-shrink:0"></i><span>${msg}</span>`;
  container.appendChild(t);
  lucide.createIcons();
  setTimeout(() => t.remove(), 3200);
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  loadAnnouncementTargets();
});
