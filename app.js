/* =============================================
   CRYPTO WALLET SIMULATOR — MAIN APP LOGIC
   ============================================= */

// ---- CONFIG ----
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

let supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch(e) {
  console.warn('Supabase not configured. Running in demo mode.');
  supabase = null;
}

// ---- STATE ----
const state = {
  user: null,
  wallet: null,
  prices: {},
  transactions: [],
  withdrawals: [],
  notifications: [],
  currentTab: 0,
  currentActivityFilter: 'all',
  withdrawMethod: 'upi',
  theme: 'dark',
  portfolioChart: null
};

const COINS = ['btc','eth','sol','xrp','doge','bnb','usdt'];
const COIN_NAMES = {btc:'Bitcoin',eth:'Ethereum',sol:'Solana',xrp:'XRP',doge:'Dogecoin',bnb:'BNB',usdt:'Tether'};
const COIN_ICONS = {btc:'B',eth:'E',sol:'S',xrp:'X',doge:'D',bnb:'B',usdt:'T'};
const COIN_COLORS = {btc:'#f7931a',eth:'#627eea',sol:'#9945ff',xrp:'#00aae4',doge:'#c2a633',bnb:'#f3ba2f',usdt:'#26a17b'};

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('cv_session');
  const savedTheme = localStorage.getItem('cv_theme') || 'dark';
  applyTheme(savedTheme);

  if (saved) {
    try {
      const session = JSON.parse(saved);
      if (session.logged_in && session.user_id) {
        state.user = session;
        showApp();
        return;
      }
    } catch(e) {}
  }
  showAuth();
  lucide.createIcons();
});

// ---- AUTH ----
function showAuth() {
  document.getElementById('authContainer').style.display = 'flex';
  document.getElementById('appContainer').classList.remove('active');
}

function showApp() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appContainer').classList.add('active');
  lucide.createIcons();
  loadAllData();
  startPriceUpdates();
}

function showLogin() {
  document.getElementById('loginCard').classList.remove('hidden');
  document.getElementById('signupCard').classList.add('hidden');
}

function showSignup() {
  document.getElementById('loginCard').classList.add('hidden');
  document.getElementById('signupCard').classList.remove('hidden');
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_cv_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!identifier || !password) return toast('Please fill all fields', 'error');

  const btn = document.getElementById('loginBtn');
  btn.innerHTML = '<div class="spinner"></div>';
  btn.disabled = true;

  try {
    const hash = await hashPassword(password);
    let query;
    if (identifier.includes('@')) {
      query = supabase.from('users').select('*').eq('email', identifier).eq('password_hash', hash).eq('is_active', true).single();
    } else {
      query = supabase.from('users').select('*').eq('mobile', identifier).eq('password_hash', hash).eq('is_active', true).single();
    }
    const { data, error } = await query;
    if (error || !data) {
      toast('Invalid credentials', 'error');
      btn.innerHTML = '<span>Sign In</span>';
      btn.disabled = false;
      return;
    }

    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', data.id);

    state.user = { user_id: data.id, username: data.username, role: data.role, logged_in: true };
    localStorage.setItem('cv_session', JSON.stringify(state.user));
    toast('Welcome back, ' + data.username + '!', 'success');
    showApp();
  } catch(e) {
    toast('Login failed: ' + e.message, 'error');
  }
  btn.innerHTML = '<span>Sign In</span>';
  btn.disabled = false;
});

document.getElementById('signupBtn').addEventListener('click', async () => {
  const username = document.getElementById('signupUsername').value.trim();
  const mobile = document.getElementById('signupMobile').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;
  const referral = document.getElementById('signupReferral').value.trim();

  if (!username || !mobile || !password) return toast('Please fill required fields', 'error');
  if (password.length < 6) return toast('Password must be at least 6 characters', 'error');
  if (password !== confirm) return toast('Passwords do not match', 'error');
  if (!/^\d{10}$/.test(mobile)) return toast('Enter a valid 10-digit mobile number', 'error');

  const btn = document.getElementById('signupBtn');
  btn.innerHTML = '<div class="spinner"></div>';
  btn.disabled = true;

  try {
    const { data: existing } = await supabase.from('users').select('id').or(`mobile.eq.${mobile},username.eq.${username}`).maybeSingle();
    if (existing) {
      toast('Mobile or username already registered', 'error');
      btn.innerHTML = '<span>Create Wallet</span>';
      btn.disabled = false;
      return;
    }

    const hash = await hashPassword(password);
    const walletAddr = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20))).map(b => b.toString(16).padStart(2, '0')).join('');
    const refCode = username.toUpperCase().substring(0, 4) + Math.random().toString(36).substring(2, 6).toUpperCase();

    const { data: newUser, error } = await supabase.from('users').insert({
      username, mobile, email: email || null, password_hash: hash, role: 'user', is_active: true
    }).select().single();

    if (error) throw error;

    await supabase.from('wallets').insert({ user_id: newUser.id, wallet_address: walletAddr });
    await supabase.from('profiles').insert({ user_id: newUser.id, username, email: email || null, role: 'user' });
    await supabase.from('referrals').insert({ referrer_id: newUser.id, referred_id: newUser.id, referral_code: refCode });

    if (referral) {
      const { data: ref } = await supabase.from('referrals').select('referrer_id').eq('referral_code', referral).maybeSingle();
      if (ref && ref.referrer_id !== newUser.id) {
        await supabase.from('referrals').update({ referrer_id: ref.referrer_id, reward_amount: 10, reward_coin: 'usdt' }).eq('referred_id', newUser.id);
        const { data: refWallet } = await supabase.from('wallets').select('usdt_balance').eq('user_id', ref.referrer_id).single();
        if (refWallet) await supabase.from('wallets').update({ usdt_balance: parseFloat(refWallet.usdt_balance) + 10 }).eq('user_id', ref.referrer_id);
      }
    }

    state.user = { user_id: newUser.id, username: newUser.username, role: 'user', logged_in: true };
    localStorage.setItem('cv_session', JSON.stringify(state.user));
    toast('Wallet created successfully!', 'success');
    showApp();
  } catch(e) {
    toast('Signup failed: ' + (e.message || 'Unknown error'), 'error');
  }
  btn.innerHTML = '<span>Create Wallet</span>';
  btn.disabled = false;
});

function logout() {
  localStorage.removeItem('cv_session');
  state.user = null;
  state.wallet = null;
  state.transactions = [];
  state.withdrawals = [];
  showAuth();
  toast('Logged out', 'info');
}

// ---- DATA LOADING ----
async function loadAllData() {
  await loadPrices();
  await loadWallet();
  await loadTransactions();
  await loadWithdrawals();
  await loadNotifications();
  await loadReferralCode();
  await checkDailyReward();
  renderHome();
  renderMarkets();
  renderWallet();
  renderActivity();
  renderProfile();
  lucide.createIcons();
}

// ---- PRICES ----
async function loadPrices() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple,dogecoin,binancecoin,tether&vs_currencies=inr&include_24hr_change=true');
    const data = await res.json();
    const map = { bitcoin: 'btc', ethereum: 'eth', solana: 'sol', ripple: 'xrp', dogecoin: 'doge', binancecoin: 'bnb', tether: 'usdt' };
    for (const [k, v] of Object.entries(data)) {
      const sym = map[k];
      if (sym) state.prices[sym] = { inr: v.inr, change: v.inr_24h_change || 0 };
    }
    if (supabase) {
      for (const [sym, p] of Object.entries(state.prices)) {
        await supabase.from('market_prices').update({ current_price_inr: p.inr, change_percentage: p.change, updated_at: new Date().toISOString() }).eq('symbol', sym);
      }
    }
  } catch(e) {
    if (supabase) {
      const { data } = await supabase.from('market_prices').select('*');
      if (data) data.forEach(d => { state.prices[d.symbol] = { inr: parseFloat(d.current_price_inr), change: parseFloat(d.change_percentage) }; });
    }
  }
}

function startPriceUpdates() {
  setInterval(loadPrices, 60000);
}

function getPrice(coin) {
  return state.prices[coin] ? state.prices[coin].inr : 0;
}

function getChange(coin) {
  return state.prices[coin] ? state.prices[coin].change : 0;
}

function formatINR(num) {
  if (num === undefined || num === null) return '₹0.00';
  const n = parseFloat(num);
  if (isNaN(n)) return '₹0.00';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + ' Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + ' L';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCrypto(num) {
  const n = parseFloat(num) || 0;
  if (n === 0) return '0.00';
  if (n < 0.00001) return n.toExponential(4);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

// ---- WALLET ----
async function loadWallet() {
  if (!supabase || !state.user) return;
  const { data } = await supabase.from('wallets').select('*').eq('user_id', state.user.user_id).single();
  state.wallet = data;
}

function getTotalBalance() {
  if (!state.wallet) return 0;
  let total = parseFloat(state.wallet.inr_balance) || 0;
  COINS.forEach(c => {
    const bal = parseFloat(state.wallet[c + '_balance']) || 0;
    total += bal * getPrice(c);
  });
  return total;
}

function getCoinBalance(coin) {
  if (!state.wallet) return 0;
  return parseFloat(state.wallet[coin + '_balance']) || 0;
}

// ---- TRANSACTIONS ----
async function loadTransactions() {
  if (!supabase || !state.user) return;
  const { data } = await supabase.from('transactions').select('*').or(`sender_id.eq.${state.user.user_id},receiver_id.eq.${state.user.user_id}`).order('created_at', { ascending: false });
  state.transactions = data || [];
}

// ---- WITHDRAWALS ----
async function loadWithdrawals() {
  if (!supabase || !state.user) return;
  const { data } = await supabase.from('withdrawals').select('*').eq('user_id', state.user.user_id).order('created_at', { ascending: false });
  state.withdrawals = data || [];
}

// ---- NOTIFICATIONS ----
async function loadNotifications() {
  if (!supabase || !state.user) return;
  const { data } = await supabase.from('notifications').select('*').eq('user_id', state.user.user_id).order('created_at', { ascending: false }).limit(50);
  state.notifications = data || [];
  const unread = state.notifications.filter(n => !n.read_status).length;
  const badge = document.getElementById('notifBadge');
  if (unread > 0) { badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
}

async function addNotification(title, message) {
  if (!supabase || !state.user) return;
  await supabase.from('notifications').insert({ user_id: state.user.user_id, title, message });
  await loadNotifications();
}

// ---- REFERRAL ----
async function loadReferralCode() {
  if (!supabase || !state.user) return;
  const { data } = await supabase.from('referrals').select('referral_code').eq('referred_id', state.user.user_id).maybeSingle();
  if (data) document.getElementById('referralCode').textContent = data.referral_code;
}

// ---- DAILY REWARD ----
async function checkDailyReward() {
  if (!supabase || !state.user) return;
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('daily_rewards').select('id').eq('user_id', state.user.user_id).gte('claimed_at', today + 'T00:00:00').maybeSingle();
  if (data) {
    document.getElementById('dailyRewardCard').classList.add('claimed');
    document.getElementById('dailyRewardCard').querySelector('div.flex-1 div:first-child').textContent = 'Reward Claimed';
    document.getElementById('dailyRewardCard').querySelector('div.flex-1 div:last-child').textContent = 'Come back tomorrow!';
  }
}

async function claimDailyReward() {
  if (!supabase || !state.user) return;
  const today = new Date().toISOString().split('T')[0];
  const { data: existing } = await supabase.from('daily_rewards').select('id').eq('user_id', state.user.user_id).gte('claimed_at', today + 'T00:00:00').maybeSingle();
  if (existing) return toast('Already claimed today', 'error');

  const amount = (Math.random() * 0.0005 + 0.0001).toFixed(8);
  await supabase.from('daily_rewards').insert({ user_id: state.user.user_id, reward_amount: amount, reward_coin: 'btc' });
  const { data: w } = await supabase.from('wallets').select('btc_balance').eq('user_id', state.user.user_id).single();
  await supabase.from('wallets').update({ btc_balance: parseFloat(w.btc_balance) + parseFloat(amount) }).eq('user_id', state.user.user_id);

  document.getElementById('dailyRewardCard').classList.add('claimed');
  document.getElementById('dailyRewardCard').querySelector('div.flex-1 div:first-child').textContent = 'Reward Claimed';
  document.getElementById('dailyRewardCard').querySelector('div.flex-1 div:last-child').textContent = 'Come back tomorrow!';
  toast('Claimed ' + amount + ' BTC!', 'success');
  await addNotification('Daily Reward', 'You claimed ' + amount + ' BTC as daily reward.');
  await loadWallet();
  renderHome();
}

// ---- RENDER HOME ----
function renderHome() {
  const total = getTotalBalance();
  document.getElementById('totalBalance').textContent = formatINR(total);

  let totalPrev = 0;
  COINS.forEach(c => { totalPrev += getCoinBalance(c) * getPrice(c) / (1 + getChange(c) / 100); });
  const changePct = totalPrev > 0 ? ((total - totalPrev) / totalPrev * 100) : 0;
  const changeEl = document.getElementById('balanceChange');
  if (changePct >= 0) {
    changeEl.className = 'balance-change up';
    changeEl.innerHTML = '<i data-lucide="trending-up" style="width:14px;height:14px"></i><span>+' + changePct.toFixed(2) + '%</span>';
  } else {
    changeEl.className = 'balance-change down';
    changeEl.innerHTML = '<i data-lucide="trending-down" style="width:14px;height:14px"></i><span>' + changePct.toFixed(2) + '%</span>';
  }

  // Holdings (top 3)
  let holdings = COINS.map(c => ({ coin: c, balance: getCoinBalance(c), value: getCoinBalance(c) * getPrice(c) })).filter(h => h.balance > 0).sort((a, b) => b.value - a.value).slice(0, 3);
  const holdEl = document.getElementById('homeHoldings');
  if (holdings.length === 0) {
    holdEl.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--text-muted);font-size:14px">No holdings yet. Receive crypto to get started.</div>';
  } else {
    holdEl.innerHTML = holdings.map(h => `
      <div class="holding-item">
        <div class="coin-icon ${h.coin}">${COIN_ICONS[h.coin]}</div>
        <div class="holding-info"><div class="holding-name">${COIN_NAMES[h.coin]}</div><div class="holding-symbol">${h.coin.toUpperCase()}</div></div>
        <div class="holding-values"><div class="holding-value">${formatINR(h.value)}</div><div class="holding-amount">${formatCrypto(h.balance)} ${h.coin.toUpperCase()}</div></div>
      </div>
    `).join('');
  }

  // Trending
  const trending = ['btc', 'sol', 'doge'];
  document.getElementById('homeTrending').innerHTML = trending.map(c => {
    const ch = getChange(c);
    return `<div class="market-item">
      <div class="coin-icon ${c}" style="width:38px;height:38px;font-size:14px">${COIN_ICONS[c]}</div>
      <div class="market-info"><div class="market-name">${COIN_NAMES[c]}</div><div class="market-pair">${c.toUpperCase()}/INR</div></div>
      <div class="market-price-col"><div class="market-price">${formatINR(getPrice(c))}</div><div class="market-change ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</div></div>
    </div>`;
  }).join('');

  // Recent activity
  const recent = state.transactions.slice(0, 3);
  const actEl = document.getElementById('homeActivity');
  if (recent.length === 0) {
    actEl.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--text-muted);font-size:14px">No transactions yet</div>';
  } else {
    actEl.innerHTML = recent.map(tx => renderTxItem(tx)).join('');
  }

  // Chart
  renderPortfolioChart();
  lucide.createIcons();
}

function renderPortfolioChart() {
  const canvas = document.getElementById('portfolioChart');
  if (state.portfolioChart) state.portfolioChart.destroy();

  const data = COINS.map(c => getCoinBalance(c) * getPrice(c));
  const hasData = data.some(d => d > 0);

  state.portfolioChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: COINS.map(c => COIN_NAMES[c]),
      datasets: [{
        data: hasData ? data : [1],
        backgroundColor: hasData ? COINS.map(c => COIN_COLORS[c]) : ['#2a2f3e'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: hasData,
          callbacks: {
            label: ctx => ctx.label + ': ' + formatINR(ctx.raw)
          }
        }
      }
    }
  });
}

// ---- RENDER MARKETS ----
function renderMarkets(filter = '') {
  const list = document.getElementById('marketList');
  let coins = COINS.filter(c => {
    if (!filter) return true;
    const name = COIN_NAMES[c].toLowerCase();
    const sym = c.toLowerCase();
    return name.includes(filter) || sym.includes(filter);
  });

  list.innerHTML = coins.map(c => {
    const ch = getChange(c);
    return `<div class="market-item">
      <div class="coin-icon ${c}">${COIN_ICONS[c]}</div>
      <div class="market-info">
        <div class="market-name">${COIN_NAMES[c]}</div>
        <div class="market-pair">${c.toUpperCase()}/INR</div>
      </div>
      <div class="market-price-col">
        <div class="market-price">${formatINR(getPrice(c))}</div>
        <div class="market-change ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</div>
      </div>
    </div>`;
  }).join('');

  if (coins.length === 0) list.innerHTML = '<div style="padding:40px 0;text-align:center;color:var(--text-muted);font-size:14px">No coins found</div>';
  lucide.createIcons();
}

function filterMarkets() {
  const q = document.getElementById('marketSearch').value.toLowerCase();
  renderMarkets(q);
}

// ---- RENDER WALLET ----
function renderWallet() {
  const el = document.getElementById('walletHoldings');
  let html = '';
  let hasBalance = false;

  COINS.forEach(c => {
    const bal = getCoinBalance(c);
    const val = bal * getPrice(c);
    if (bal > 0) {
      hasBalance = true;
      html += `<div class="holding-item">
        <div class="coin-icon ${c}">${COIN_ICONS[c]}</div>
        <div class="holding-info"><div class="holding-name">${COIN_NAMES[c]}</div><div class="holding-symbol">${formatCrypto(bal)} ${c.toUpperCase()}</div></div>
        <div class="holding-values"><div class="holding-value">${formatINR(val)}</div><div class="holding-change ${getChange(c) >= 0 ? 'text-green' : 'text-red'}" style="font-size:12px">${getChange(c) >= 0 ? '+' : ''}${getChange(c).toFixed(2)}%</div></div>
      </div>`;
    }
  });

  if (getCoinBalance('usdt') === 0 && !hasBalance) {
    html += COINS.map(c => `<div class="holding-item" style="opacity:0.4">
      <div class="coin-icon ${c}">${COIN_ICONS[c]}</div>
      <div class="holding-info"><div class="holding-name">${COIN_NAMES[c]}</div><div class="holding-symbol">0.00 ${c.toUpperCase()}</div></div>
      <div class="holding-values"><div class="holding-value">${formatINR(0)}</div><div class="holding-change" style="font-size:12px;color:var(--text-muted)">0.00%</div></div>
    </div>`).join('');
  }

  // INR balance
  if (state.wallet) {
    const inrBal = parseFloat(state.wallet.inr_balance) || 0;
    if (inrBal > 0) {
      html += `<div class="holding-item">
        <div class="coin-icon" style="background:rgba(79,125,249,0.1);color:var(--accent-blue)">₹</div>
        <div class="holding-info"><div class="holding-name">Indian Rupee</div><div class="holding-symbol">${formatINR(inrBal)}</div></div>
        <div class="holding-values"><div class="holding-value">${formatINR(inrBal)}</div></div>
      </div>`;
    }
  }

  el.innerHTML = html;
  lucide.createIcons();
}

// ---- RENDER ACTIVITY ----
function renderTxItem(tx) {
  const isSent = tx.sender_id === state.user.user_id;
  const type = isSent ? 'sent' : 'received';
  const iconClass = type === 'sent' ? 'sent' : 'received';
  const iconName = type === 'sent' ? 'arrow-up-right' : 'arrow-down-left';
  const sign = type === 'sent' ? '-' : '+';
  const date = new Date(tx.created_at);
  const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return `<div class="tx-item" onclick="showTxDetail('${tx.id}')">
    <div class="tx-icon ${iconClass}"><i data-lucide="${iconName}" style="width:18px;height:18px"></i></div>
    <div class="tx-info"><div class="tx-title">${type === 'sent' ? 'Sent' : 'Received'} ${tx.coin.toUpperCase()}</div><div class="tx-hash">${tx.tx_hash || 'Processing...'}</div></div>
    <div class="tx-amount"><div class="tx-value ${type === 'sent' ? 'text-red' : 'text-green'}">${sign}${formatCrypto(tx.amount)} ${tx.coin.toUpperCase()}</div><div class="tx-date">${dateStr}</div></div>
  </div>`;
}

function renderWithdrawalItem(wd) {
  const date = new Date(wd.created_at);
  const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const method = wd.withdrawal_method === 'upi' ? 'UPI' : 'Bank';

  return `<div class="tx-item" onclick="showWithdrawalDetail('${wd.id}')">
    <div class="tx-icon withdrawal"><i data-lucide="banknote" style="width:18px;height:18px"></i></div>
    <div class="tx-info"><div class="tx-title">Withdrawal (${method})</div><div class="tx-hash">${wd.coin.toUpperCase()} → INR</div></div>
    <div class="tx-amount"><div class="tx-value" style="color:var(--accent-orange)">${formatINR(wd.amount_inr)}</div><span class="status-badge ${wd.status}">${wd.status}</span></div>
  </div>`;
}

function renderActivity() {
  let items = [];
  const filter = state.currentActivityFilter;
  const searchQ = (document.getElementById('activitySearch')?.value || '').toLowerCase();

  if (filter === 'all' || filter === 'sent' || filter === 'received') {
    state.transactions.forEach(tx => {
      const isSent = tx.sender_id === state.user.user_id;
      const type = isSent ? 'sent' : 'received';
      if (filter !== 'all' && filter !== type) return;
      if (searchQ) {
        const hay = (tx.coin + ' ' + (tx.tx_hash || '') + ' ' + type).toLowerCase();
        if (!hay.includes(searchQ)) return;
      }
      items.push({ type: 'tx', data: tx, date: tx.created_at });
    });
  }

  if (filter === 'all' || filter === 'withdrawal') {
    state.withdrawals.forEach(wd => {
      if (searchQ) {
        const hay = (wd.coin + ' ' + wd.status + ' ' + (wd.withdrawal_method || '')).toLowerCase();
        if (!hay.includes(searchQ)) return;
      }
      items.push({ type: 'wd', data: wd, date: wd.created_at });
    });
  }

  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  const el = document.getElementById('activityList');
  if (items.length === 0) {
    el.innerHTML = '<div style="padding:40px 0;text-align:center;color:var(--text-muted);font-size:14px">No transactions found</div>';
  } else {
    el.innerHTML = items.map(i => i.type === 'tx' ? renderTxItem(i.data) : renderWithdrawalItem(i.data)).join('');
  }
  lucide.createIcons();
}

function filterActivity(filter, btn) {
  state.currentActivityFilter = filter;
  document.querySelectorAll('#activityTabs .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderActivity();
}

function filterActivityText() { renderActivity(); }

// ---- TX DETAIL ----
function showTxDetail(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  const isSent = tx.sender_id === state.user.user_id;
  const type = isSent ? 'Sent' : 'Received';
  const date = new Date(tx.created_at);

  document.getElementById('txDetailContent').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div class="tx-icon ${isSent ? 'sent' : 'received'}" style="width:56px;height:56px;margin:0 auto 12px"><i data-lucide="${isSent ? 'arrow-up-right' : 'arrow-down-left'}" style="width:24px;height:24px"></i></div>
      <div style="font-size:18px;font-weight:700">${type} ${tx.coin.toUpperCase()}</div>
      <div style="font-size:24px;font-weight:800;margin-top:4px" class="${isSent ? 'text-red' : 'text-green'}">${isSent ? '-' : '+'}${formatCrypto(tx.amount)} ${tx.coin.toUpperCase()}</div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">Status</span><span class="status-badge ${tx.status}">${tx.status}</span></div>
      <div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">INR Value</span><span style="font-size:13px;font-weight:600">${formatINR(tx.amount_inr)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">TX Hash</span><span style="font-size:11px;font-family:monospace;color:var(--text-secondary);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tx.tx_hash || 'Pending...'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">Confirmations</span><span style="font-size:13px;font-weight:600">${tx.confirmations || 0}</span></div>
      <div style="display:flex;justify-content:space-between;padding:14px 16px"><span style="color:var(--text-muted);font-size:13px">Date</span><span style="font-size:13px">${date.toLocaleString('en-IN')}</span></div>
    </div>
  `;
  openModal('txDetailModal');
  lucide.createIcons();
}

function showWithdrawalDetail(id) {
  const wd = state.withdrawals.find(w => w.id === id);
  if (!wd) return;
  const method = wd.withdrawal_method === 'upi' ? 'UPI' : 'Bank Transfer';
  const date = new Date(wd.created_at);

  let timelineHTML = '';
  if (wd.status === 'processing') {
    timelineHTML = `<div class="timeline mt-4">
      <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Request Submitted</div><div class="timeline-desc">${date.toLocaleString('en-IN')}</div></div>
      <div class="timeline-item"><div class="timeline-dot active"></div><div class="timeline-title">Processing</div><div class="timeline-desc">Funds being converted to INR</div></div>
      <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-title">Transfer to ${method}</div><div class="timeline-desc">Estimated: ${wd.estimated_arrival ? new Date(wd.estimated_arrival).toLocaleDateString('en-IN') : '3 business days'}</div></div>
      <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-title">Completed</div><div class="timeline-desc">Funds delivered</div></div>
    </div>`;
  } else if (wd.status === 'completed') {
    timelineHTML = `<div class="timeline mt-4">
      <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Request Submitted</div></div>
      <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Processing</div></div>
      <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Transfer to ${method}</div></div>
      <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Completed</div><div class="timeline-desc">${wd.completed_at ? new Date(wd.completed_at).toLocaleString('en-IN') : ''}</div></div>
    </div>`;
  } else {
    timelineHTML = `<div class="mt-4"><span class="status-badge ${wd.status}">${wd.status}</span></div>`;
  }

  document.getElementById('txDetailContent').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div class="tx-icon withdrawal" style="width:56px;height:56px;margin:0 auto 12px"><i data-lucide="banknote" style="width:24px;height:24px"></i></div>
      <div style="font-size:18px;font-weight:700">Withdrawal via ${method}</div>
      <div style="font-size:24px;font-weight:800;margin-top:4px;color:var(--accent-orange)">${formatINR(wd.amount_inr)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:2px">${formatCrypto(wd.crypto_amount)} ${wd.coin.toUpperCase()}</div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">Method</span><span style="font-size:13px;font-weight:600">${method}</span></div>
      ${wd.upi_id ? `<div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">UPI ID</span><span style="font-size:13px;font-weight:600">${wd.upi_id}</span></div>` : ''}
      ${wd.bank_name ? `<div style="display:flex;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border-color)"><span style="color:var(--text-muted);font-size:13px">Bank</span><span style="font-size:13px;font-weight:600">${wd.bank_name}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:14px 16px"><span style="color:var(--text-muted);font-size:13px">Date</span><span style="font-size:13px">${date.toLocaleString('en-IN')}</span></div>
    </div>
    ${timelineHTML}
  `;
  openModal('txDetailModal');
  lucide.createIcons();
}

// ---- RENDER PROFILE ----
function renderProfile() {
  if (!state.user) return;
  document.getElementById('profileAvatar').textContent = (state.user.username || 'U').charAt(0).toUpperCase();
  document.getElementById('profileName').textContent = state.user.username;
  document.getElementById('profileEmail').textContent = state.user.email || 'No email';
  document.getElementById('profileWalletAddr').textContent = state.wallet ? state.wallet.wallet_address : '-';
  document.getElementById('deviceLastLogin').textContent = new Date().toLocaleString('en-IN');
  document.getElementById('deviceInfo').textContent = navigator.userAgent.includes('Mobile') ? 'Mobile • ' + (navigator.userAgent.includes('iPhone') ? 'iOS' : 'Android') : 'Desktop • ' + navigator.platform;
}

// ---- SEND ----
function openSend() {
  updateSendMax();
  openModal('sendModal');
}

function updateSendMax() {
  const coin = document.getElementById('sendCoin').value;
  document.getElementById('sendAvail').textContent = 'Available: ' + formatCrypto(getCoinBalance(coin)) + ' ' + coin.toUpperCase();
  document.getElementById('sendAmount').value = '';
  document.getElementById('sendINREst').textContent = '₹0.00';
}

function setSendMax() {
  const coin = document.getElementById('sendCoin').value;
  document.getElementById('sendAmount').value = getCoinBalance(coin);
  updateSendINR();
}

function updateSendINR() {
  const coin = document.getElementById('sendCoin').value;
  const amount = parseFloat(document.getElementById('sendAmount').value) || 0;
  document.getElementById('sendINREst').textContent = formatINR(amount * getPrice(coin));
}

async function executeSend() {
  const coin = document.getElementById('sendCoin').value;
  const address = document.getElementById('sendAddress').value.trim();
  const amount = parseFloat(document.getElementById('sendAmount').value);

  if (!address) return toast('Enter recipient address', 'error');
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'error');
  if (amount > getCoinBalance(coin)) return toast('Insufficient balance', 'error');

  const btn = document.getElementById('sendBtn');
  btn.innerHTML = '<div class="spinner"></div>';
  btn.disabled = true;

  try {
    const txHash = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
    const inrVal = amount * getPrice(coin);

    // Find recipient wallet
    const { data: recvWallet } = await supabase.from('wallets').select('user_id').eq('wallet_address', address).maybeSingle();

    // Deduct sender
    await supabase.from('wallets').update({ [coin + '_balance']: getCoinBalance(coin) - amount }).eq('user_id', state.user.user_id);

    // Credit receiver if found
    if (recvWallet) {
      const { data: rw } = await supabase.from('wallets').select(coin + '_balance').eq('user_id', recvWallet.user_id).single();
      await supabase.from('wallets').update({ [coin + '_balance']: parseFloat(rw[coin + '_balance']) + amount }).eq('user_id', recvWallet.user_id);

      await supabase.from('notifications').insert({ user_id: recvWallet.user_id, title: 'Crypto Received', message: `You received ${formatCrypto(amount)} ${coin.toUpperCase()} from ${state.user.username}.` });
    }

    // Create transaction
    const { data: tx } = await supabase.from('transactions').insert({
      sender_id: state.user.user_id,
      receiver_id: recvWallet ? recvWallet.user_id : null,
      coin, amount, amount_inr: inrVal, tx_hash: txHash, status: 'pending', confirmations: 0
    }).select().single();

    // Simulate confirmation
    setTimeout(async () => {
      await supabase.from('transactions').update({ status: 'confirming', confirmations: 3 }).eq('id', tx.id);
      setTimeout(async () => {
        await supabase.from('transactions').update({ status: 'completed', confirmations: 12 }).eq('id', tx.id);
        await loadTransactions();
        renderActivity();
      }, 5000);
    }, 3000);

    await addNotification('Crypto Sent', `You sent ${formatCrypto(amount)} ${coin.toUpperCase()} to ${address.substring(0, 10)}...`);

    closeModal('sendModal');
    document.getElementById('sendSuccessDetail').textContent = `${formatCrypto(amount)} ${coin.toUpperCase()} → ${address.substring(0, 16)}...`;
    document.getElementById('sendSuccessHash').textContent = txHash;
    openModal('sendSuccessModal');

    await loadWallet();
    await loadTransactions();
    renderHome();
    renderWallet();
    renderActivity();
    lucide.createIcons();
    toast('Transaction submitted!', 'success');
  } catch(e) {
    toast('Send failed: ' + e.message, 'error');
  }

  btn.innerHTML = '<span>Send</span>';
  btn.disabled = false;
}

// ---- RECEIVE ----
function openReceive() {
  if (!state.wallet) return;
  const container = document.getElementById('qrContainer');
  container.innerHTML = '';
  new QRCode(container, {
    text: state.wallet.wallet_address,
    width: 200,
    height: 200,
    colorDark: '#0d0f1a',
    colorLight: '#ffffff'
  });
  document.getElementById('receiveAddr').textContent = state.wallet.wallet_address;

  const sel = document.getElementById('receiveCoinSelector');
  sel.innerHTML = COINS.map(c => `<div class="coin-chip selected" style="cursor:default"><div class="coin-icon ${c}" style="width:24px;height:24px;font-size:10px;border-radius:50%;display:flex;align-items:center;justify-content:center">${COIN_ICONS[c]}</div>${c.toUpperCase()}</div>`).join('');
  openModal('receiveModal');
}

function copyWalletAddress() {
  if (!state.wallet) return;
  navigator.clipboard.writeText(state.wallet.wallet_address).then(() => toast('Address copied!', 'success')).catch(() => toast('Failed to copy', 'error'));
}

function shareWalletAddress() {
  if (!state.wallet) return;
  if (navigator.share) {
    navigator.share({ title: 'My Wallet Address', text: state.wallet.wallet_address });
  } else {
    copyWalletAddress();
  }
}

// ---- WITHDRAW ----
function openWithdraw() {
  updateWithdrawMax();
  openModal('withdrawModal');
}

function setWithdrawMethod(method, btn) {
  state.withdrawMethod = method;
  document.querySelectorAll('#withdrawModal .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('withdrawUPIForm').classList.toggle('hidden', method !== 'upi');
  document.getElementById('withdrawBankForm').classList.toggle('hidden', method !== 'bank');
}

function updateWithdrawMax() {
  const coin = document.getElementById('withdrawCoin').value;
  document.getElementById('withdrawAvail').textContent = 'Available: ' + formatCrypto(getCoinBalance(coin)) + ' ' + coin.toUpperCase();
  document.getElementById('withdrawAmount').value = '';
  document.getElementById('withdrawINREst').textContent = '₹0.00';
}

function setWithdrawMax() {
  const coin = document.getElementById('withdrawCoin').value;
  document.getElementById('withdrawAmount').value = getCoinBalance(coin);
  updateWithdrawINR();
}

function updateWithdrawINR() {
  const coin = document.getElementById('withdrawCoin').value;
  const amount = parseFloat(document.getElementById('withdrawAmount').value) || 0;
  document.getElementById('withdrawINREst').textContent = formatINR(amount * getPrice(coin));
}

async function executeWithdraw() {
  const coin = document.getElementById('withdrawCoin').value;
  const amount = parseFloat(document.getElementById('withdrawAmount').value);
  const method = state.withdrawMethod;

  if (!amount || amount <= 0) return toast('Enter a valid amount', 'error');
  if (amount > getCoinBalance(coin)) return toast('Insufficient balance', 'error');

  if (method === 'upi') {
    const upi = document.getElementById('withdrawUPI').value.trim();
    if (!upi || !upi.includes('@')) return toast('Enter a valid UPI ID', 'error');
  } else {
    const bank = document.getElementById('withdrawBank').value.trim();
    const holder = document.getElementById('withdrawHolder').value.trim();
    const accNum = document.getElementById('withdrawAccNum').value.trim();
    const ifsc = document.getElementById('withdrawIFSC').value.trim();
    if (!bank || !holder || !accNum || !ifsc) return toast('Fill all bank details', 'error');
  }

  const btn = document.getElementById('withdrawBtn');
  btn.innerHTML = '<div class="spinner"></div>';
  btn.disabled = true;

  try {
    const inrVal = amount * getPrice(coin);
    const estArrival = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    // Deduct crypto
    await supabase.from('wallets').update({ [coin + '_balance']: getCoinBalance(coin) - amount }).eq('user_id', state.user.user_id);

    // Create withdrawal
    const { data: wd } = await supabase.from('withdrawals').insert({
      user_id: state.user.user_id,
      coin,
      crypto_amount: amount,
      amount_inr: inrVal,
      withdrawal_method: method,
      upi_id: method === 'upi' ? document.getElementById('withdrawUPI').value.trim() : null,
      bank_name: method === 'bank' ? document.getElementById('withdrawBank').value.trim() : null,
      account_holder_name: method === 'bank' ? document.getElementById('withdrawHolder').value.trim() : null,
      account_number: method === 'bank' ? document.getElementById('withdrawAccNum').value.trim() : null,
      ifsc_code: method === 'bank' ? document.getElementById('withdrawIFSC').value.trim().toUpperCase() : null,
      status: 'processing',
      processing_days_remaining: 3,
      estimated_arrival: estArrival
    }).select().single();

    await addNotification('Withdrawal Submitted', `Your withdrawal of ${formatINR(inrVal)} via ${method === 'upi' ? 'UPI' : 'Bank Transfer'} is being processed.`);

    closeModal('withdrawModal');

    // Show status modal
    const icon = document.getElementById('withdrawStatusIcon');
    icon.style.background = 'var(--accent-blue)';
    document.getElementById('withdrawStatusTitle').textContent = 'Withdrawal Submitted';
    document.getElementById('withdrawStatusMsg').innerHTML = `Your withdrawal request of <strong>${formatINR(inrVal)}</strong> has been submitted successfully.<br><br>Funds are currently being processed.<br>Estimated arrival: <strong>3 Business Days</strong><br><br>Your ${coin.toUpperCase()} assets have been converted into INR and deducted from your wallet balance.`;
    document.getElementById('withdrawProgressFill').style.width = '10%';
    document.getElementById('withdrawTimeline').innerHTML = `
      <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Request Submitted</div><div class="timeline-desc">${new Date().toLocaleString('en-IN')}</div></div>
      <div class="timeline-item"><div class="timeline-dot active"></div><div class="timeline-title">Processing</div><div class="timeline-desc">Funds being converted to INR</div></div>
      <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-title">Transfer to ${method === 'upi' ? 'UPI' : 'Bank'}</div><div class="timeline-desc">Estimated: ${new Date(estArrival).toLocaleDateString('en-IN')}</div></div>
      <div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-title">Completed</div><div class="timeline-desc">Funds delivered</div></div>
    `;
    openModal('withdrawStatusModal');

    // Animate progress
    setTimeout(() => { document.getElementById('withdrawProgressFill').style.width = '35%'; }, 500);
    setTimeout(() => { document.getElementById('withdrawProgressFill').style.width = '65%'; }, 1500);
    setTimeout(() => { document.getElementById('withdrawProgressFill').style.width = '90%'; }, 3000);

    // Simulate completion
    setTimeout(async () => {
      await supabase.from('withdrawals').update({
        status: 'completed',
        processing_days_remaining: 0,
        completed_at: new Date().toISOString()
      }).eq('id', wd.id);

      icon.style.background = 'var(--accent-green)';
      document.getElementById('withdrawStatusTitle').textContent = 'Funds Successfully Delivered';
      document.getElementById('withdrawStatusMsg').textContent = `Your withdrawal of ${formatINR(inrVal)} has been completed and delivered to your ${method === 'upi' ? 'UPI' : 'bank account'}.`;
      document.getElementById('withdrawProgressFill').style.width = '100%';
      document.getElementById('withdrawTimeline').innerHTML = `
        <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Request Submitted</div></div>
        <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Processing</div></div>
        <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Transfer to ${method === 'upi' ? 'UPI' : 'Bank'}</div></div>
        <div class="timeline-item"><div class="timeline-dot done"></div><div class="timeline-title">Completed</div><div class="timeline-desc">${new Date().toLocaleString('en-IN')}</div></div>
      `;

      await addNotification('Withdrawal Completed', `Your withdrawal of ${formatINR(inrVal)} has been successfully delivered.`);
      await loadWithdrawals();
      renderActivity();
    }, 8000);

    await loadWallet();
    await loadWithdrawals();
    renderHome();
    renderWallet();
    renderActivity();
    toast('Withdrawal submitted!', 'success');
  } catch(e) {
    toast('Withdrawal failed: ' + e.message, 'error');
  }

  btn.innerHTML = '<span>Submit Withdrawal</span>';
  btn.disabled = false;
}

// ---- NOTIFICATIONS ----
function openNotifications() {
  const el = document.getElementById('notifList');
  if (state.notifications.length === 0) {
    el.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:14px">No notifications</div>';
  } else {
    el.innerHTML = state.notifications.map(n => {
      const date = new Date(n.created_at);
      return `<div class="noti-item ${n.read_status ? '' : 'unread'}">
        <div class="noti-title">${n.title}</div>
        <div class="noti-message">${n.message}</div>
        <div class="noti-time">${date.toLocaleString('en-IN')}</div>
      </div>`;
    }).join('');
  }

  // Mark all as read
  if (supabase && state.user) {
    supabase.from('notifications').update({ read_status: true }).eq('user_id', state.user.user_id).eq('read_status', false).then(() => {
      document.getElementById('notifBadge').classList.add('hidden');
      state.notifications.forEach(n => n.read_status = true);
    });
  }

  openModal('notifModal');
}

// ---- SECURITY ----
function openSecuritySettings() {
  openModal('securityModal');
  if (state.user) {
    document.getElementById('loginActivityList').innerHTML = `
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--accent-green);flex-shrink:0"></div>
        <div><div style="font-size:13px;font-weight:600">Current Session</div><div style="font-size:12px;color:var(--text-muted)">${new Date().toLocaleString('en-IN')}</div></div>
      </div>
    `;
  }
}

function toggle2FA() {
  const on = document.getElementById('toggle2FA').checked;
  const knob = document.getElementById('toggle2FAKnob');
  knob.style.left = on ? '22px' : '2px';
  knob.parentElement.querySelector('span:first-of-type').style.background = on ? 'var(--accent-green)' : 'var(--border-color)';
  toast(on ? '2FA enabled (simulated)' : '2FA disabled', 'info');
}

// ---- WATCHLIST ----
async function openWatchlist() {
  if (!supabase || !state.user) { openModal('watchlistModal'); return; }
  const { data } = await supabase.from('watchlist').select('*').eq('user_id', state.user.user_id);
  const el = document.getElementById('watchlistContent');

  if (!data || data.length === 0) {
    el.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--text-muted);font-size:14px">Your watchlist is empty. Add coins from the Markets tab.</div>';
  } else {
    el.innerHTML = data.map(w => {
      const ch = getChange(w.symbol);
      return `<div class="market-item">
        <div class="coin-icon ${w.symbol}">${COIN_ICONS[w.symbol]}</div>
        <div class="market-info"><div class="market-name">${COIN_NAMES[w.symbol]}</div><div class="market-pair">${w.symbol.toUpperCase()}/INR</div></div>
        <div class="market-price-col"><div class="market-price">${formatINR(getPrice(w.symbol))}</div><div class="market-change ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</div></div>
      </div>`;
    }).join('');
  }
  openModal('watchlistModal');
  lucide.createIcons();
}

// ---- PRICE ALERTS ----
async function createPriceAlert() {
  if (!supabase || !state.user) return toast('Not connected', 'error');
  const coin = document.getElementById('alertCoin').value;
  const condition = document.getElementById('alertCondition').value;
  const price = parseFloat(document.getElementById('alertPrice').value);
  if (!price || price <= 0) return toast('Enter a valid price', 'error');

  await supabase.from('price_alerts').insert({ user_id: state.user.user_id, symbol: coin, target_price: price, condition });
  toast('Alert created!', 'success');
  document.getElementById('alertPrice').value = '';
  loadPriceAlerts();
}

async function loadPriceAlerts() {
  if (!supabase || !state.user) return;
  const { data } = await supabase.from('price_alerts').select('*').eq('user_id', state.user.user_id).order('created_at', { ascending: false });
  const el = document.getElementById('alertsList');
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--text-muted);font-size:14px">No alerts set</div>';
  } else {
    el.innerHTML = data.map(a => `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-color)">
      <div><div style="font-size:14px;font-weight:600">${COIN_NAMES[a.symbol]} ${a.condition === 'above' ? '≥' : '≤'} ${formatINR(a.target_price)}</div><div style="font-size:12px;color:var(--text-muted)">${a.condition}</div></div>
      <span class="status-badge ${a.is_triggered ? 'completed' : 'pending'}">${a.is_triggered ? 'Triggered' : 'Active'}</span>
    </div>`).join('');
  }
}

function openPriceAlerts() {
  loadPriceAlerts();
  openModal('priceAlertsModal');
}

function openDeviceHistory() {
  openModal('deviceModal');
}

function copyReferralCode() {
  const code = document.getElementById('referralCode').textContent;
  if (code && code !== '-') {
    navigator.clipboard.writeText(code).then(() => toast('Referral code copied!', 'success'));
  }
}

// ---- NAVIGATION ----
function switchTab(index) {
  state.currentTab = index;
  const screens = ['screenHome', 'screenMarkets', 'screenWallet', 'screenActivity', 'screenProfile'];
  const titles = ['CryptoVault', 'Markets', 'Wallet', 'Activity', 'Profile'];

  screens.forEach((id, i) => {
    document.getElementById(id).classList.toggle('active', i === index);
  });

  document.querySelectorAll('.nav-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });

  document.getElementById('headerTitle').textContent = titles[index];
  document.getElementById('appContent').scrollTop = 0;

  if (index === 1) renderMarkets();
  if (index === 2) { renderWallet(); }
  if (index === 3) renderActivity();
  if (index === 4) renderProfile();

  lucide.createIcons();
}

// ---- THEME ----
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cv_theme', theme);
  const knob = document.getElementById('darkModeKnob');
  const toggle = document.getElementById('darkModeToggle');
  if (knob) knob.style.left = theme === 'dark' ? '22px' : '2px';
  if (knob) knob.parentElement.querySelector('span:first-of-type').style.background = theme === 'dark' ? 'var(--accent-green)' : 'var(--border-color)';
  if (toggle) toggle.checked = theme === 'dark';
  const icon = document.getElementById('themeIcon');
  if (icon) icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
  lucide.createIcons();
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
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

// Close modal on overlay click
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
