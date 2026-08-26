/* ============================================================================
   NOVA WALLET — user application (vanilla JS)
   Custom auth against `users` table · Supabase Realtime · CoinGecko live INR
   ============================================================================ */

/* ────────────────────────────── CONFIG ─────────────────────────────────── */
/* Paste YOUR Supabase project credentials here (anon/public key only!) */
const SUPABASE_URL    = 'https://gztcszwqlkedisbsfuik.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vB8aiy2kV0NKTmykck_EXA_73kVLUQm';

/* ────────────────────────────── CONSTANTS ──────────────────────────────── */
const COINS = {
  btc :{name:'Bitcoin', sym:'BTC', color:'#F7931A', cg:'bitcoin',     dec:8, fee:0.00005},
  eth :{name:'Ethereum',sym:'ETH', color:'#627EEA', cg:'ethereum',    dec:6, fee:0.0007},
  usdt:{name:'Tether',  sym:'USDT',color:'#26A17B', cg:'tether',      dec:2, fee:0.1},
  sol :{name:'Solana',  sym:'SOL', color:'#9945FF', cg:'solana',      dec:4, fee:0.001},
  xrp :{name:'XRP',     sym:'XRP', color:'#0F172A', cg:'ripple',      dec:4, fee:0.02},
  doge:{name:'Dogecoin',sym:'DOGE',color:'#C2A633', cg:'dogecoin',    dec:2, fee:1},
  bnb :{name:'BNB',     sym:'BNB', color:'#B7950B', cg:'binancecoin', dec:6, fee:0.0008},
};
const KEYS = Object.keys(COINS);
const BAL_COL = {btc:'btc_balance',eth:'eth_balance',usdt:'usdt_balance',sol:'sol_balance',
                 xrp:'xrp_balance',doge:'doge_balance',bnb:'bnb_balance'};
const DEFAULT_PRICES = {BTC:5200000,ETH:275000,USDT:88.5,SOL:16500,XRP:210,DOGE:16.4,BNB:51500};

/* ────────────────────────────── STATE ──────────────────────────────────── */
const state = {
  user:null, wallet:null, prices:{}, watches:[],
  txs:[], notifs:[], filter:'all', mktTab:'trending', range:'7D',
  charts:{}, channel:null, priceTimer:null,
};

/* ────────────────────────────── HELPERS ────────────────────────────────── */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr  = n => '₹' + Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const num  = (n,d=4) => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:d});
const amt  = (coin,v) => v == null ? '—' : num(v, COINS[coin]?.dec ?? 2) + ' ' + COINS[coin].sym;
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
const fmtTime = ts => new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const icons = () => lucide.createIcons();
const randHex = n => [...crypto.getRandomValues(new Uint8Array(Math.ceil(n/2)))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,n);

function price(sym){ return state.prices[sym]?.inr ?? DEFAULT_PRICES[sym] ?? 0; }
function change(sym){ return state.prices[sym]?.chg ?? 0; }
function bal(k){ const c = BAL_COL[k]; return state.wallet ? Number(state.wallet[c]) : 0; }
function valueOf(k){ return bal(k) * price(COINS[k].sym); }

function toast(msg, kind='info'){
  const ic = {success:'check-circle-2', error:'alert-circle', info:'info'}[kind];
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<i data-lucide="${ic}"></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el); icons();
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),260); }, 3600);
}

function openSheet(html, id){
  closeModal();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop'; bd.id = id || '';
  bd.innerHTML = `<div class="sheet"><div class="grabber"></div>${html}</div>`;
  bd.addEventListener('click', e => { if(e.target === bd) closeModal(); });
  $('#modalRoot').appendChild(bd); icons();
  return bd;
}
function closeModal(){
  $$('.modal-backdrop').forEach(m=>m.remove());
  Object.values(state.charts).forEach(c=>{try{c.destroy()}catch(_){}}); state.charts={};
}
document.addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });

function countUp(el, target){
  const start = performance.now(), from = parseFloat(el.dataset.v || 0), dur = 850;
  el.dataset.v = target;
  function tick(t){
    const p = Math.min((t-start)/dur, 1), e = 1-Math.pow(1-p,3);
    el.textContent = inr(from + (target-from)*e);
    if(p<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function coinLogo(k, size=40){
  const c = COINS[k];
  return `<div class="coin-logo" style="width:${size}px;height:${size}px;background:${c.color}">${c.sym.slice(0,3)}</div>`;
}

async function sha256hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function makePasswordHash(pw){
  const salt = randHex(16);
  return salt + '$' + await sha256hex(salt + pw);
}
async function verifyPassword(pw, stored){
  const [salt, hash] = String(stored).split('$');
  if(!salt || !hash) return false;
  return (await sha256hex(salt + pw)) === hash;
}

/* ────────────────────────────── SESSION ────────────────────────────────── */
function saveSession(u){ localStorage.setItem('nova_session', JSON.stringify({user_id:u.id, username:u.username, role:u.role, logged_in:true})); }
function getSession(){ try{ return JSON.parse(localStorage.getItem('nova_session')); }catch(_){ return null; } }
function clearSession(){ localStorage.removeItem('nova_session'); localStorage.removeItem('nova_theme_keep'); location.reload(); }

/* ────────────────────────────── SUPABASE ───────────────────────────────── */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ────────────────────────────── LIVE PRICES ────────────────────────────── */
async function fetchPrices(){
  const ids = KEYS.map(k=>COINS[k].cg).join(',');
  try{
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`);
    if(!r.ok) throw new Error('api');
    const data = await r.json();
    data.forEach(d=>{
      const k = Object.keys(COINS).find(x=>COINS[x].cg === d.id);
      state.prices[COINS[k].sym] = {
        inr:d.current_price, chg:d.price_change_percentage_24h ?? 0,
        spark:(d.sparkline_in_7d?.price||[]).map(Number),
      };
    });
    $('#mktsLive').className = 'badge up';
  }catch(_){
    $('#mktsLive').className = 'badge neutral';
    /* fallback: seed table written by supabase.sql */
    try{
      const {data} = await sb.from('market_prices').select('*');
      (data||[]).forEach(m=>{
        if(!state.prices[m.symbol]) state.prices[m.symbol] =
          {inr:+m.current_price_inr, chg:+m.change_percentage,
           spark:Array.from({length:168},(_,i)=>+m.current_price_inr*(1+.02*Math.sin(i/11)+.006*Math.sin(i/3)))};
      });
    }catch(_2){}
  }
  renderPrices();
}
function renderPrices(){
  if(!state.user) return;
  drawHome(); drawWalletScreen(); drawMarkets();
}

/* ────────────────────────────── AUTH SCREENS ───────────────────────────── */
function showAuth(which){
  $('#authLogin').classList.toggle('hidden', which !== 'login');
  $('#authSignup').classList.toggle('hidden', which !== 'signup');
  $('#authArea').classList.remove('hidden'); $('#screens').classList.add('hidden'); $('#bottomNav').classList.add('hidden');
  window.scrollTo(0,0); icons();
}
function authError(id,msg){ const el=$(id); el.textContent=msg; el.classList.add('show'); }
function authErrorClear(){ $$('.form-error').forEach(e=>e.classList.remove('show')); }

 $('#goSignup').onclick = ()=>{ authErrorClear(); showAuth('signup'); };
 $('#goLogin').onclick  = ()=>{ authErrorClear(); showAuth('login'); };
 $$('.pw-toggle').forEach(b => b.onclick = () => {
  const inp = document.getElementById(b.dataset.pw);
  inp.type = inp.type === 'password' ? 'text' : 'password';
  b.innerHTML = `<i data-lucide="${inp.type==='password'?'eye':'eye-off'}"></i>`; icons();
});

 $('#btnForgot').onclick = ()=>{
  openSheet(`
    <div class="sheet-head"><h3>Reset Password</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <p style="font-size:.85rem;color:var(--ink-2);margin-bottom:1rem">This simulator does not send real emails. For recovery testing, ask the platform administrator to reset your password in the admin console.</p>
    <button class="btn btn-ghost" onclick="closeModal()">Understood</button>`);
};

/* SIGNUP */
 $('#btnSignup').onclick = signup;
async function signup(){
  authErrorClear();
  const username = $('#suName').value.trim();
  const mobile   = $('#suMobile').value.trim();
  const email    = $('#suEmail').value.trim().toLowerCase();
  const pw       = $('#suPw').value, pw2 = $('#suPw2').value;

  if(username.length < 3)                          return authError('#signupError','Username must be at least 3 characters.');
  if(!/^[0-9]{10}$/.test(mobile))                  return authError('#signupError','Please enter a valid 10-digit mobile number.');
  if(email && !/^\S+@\S+\.\S+$/.test(email))       return authError('#signupError','That email address looks invalid.');
  if(pw.length < 6)                                return authError('#signupError','Password must be at least 6 characters.');
  if(pw !== pw2)                                   return authError('#signupError','Passwords do not match.');
  if(!$('#suTerms').checked)                       return authError('#signupError','Please accept the terms to continue.');

  const btn = $('#btnSignup'); btn.disabled = true; btn.textContent = 'Creating…';
  try{
    /* duplicate checks */
    let q = sb.from('users').select('id,mobile,email').eq('mobile', mobile);
    if(email) q = q.or(`email.eq.${email}`);
    const {data: dup} = await q;
    if(dup && dup.length){
      btn.disabled=false; btn.textContent='Create Account';
      return authError('#signupError', dup.some(d=>d.mobile===mobile)
        ? 'An account with this mobile number already exists.'
        : 'An account with this email already exists.');
    }
    const hash = await makePasswordHash(pw);
    const {data:u, error:e1} = await sb.from('users').insert({
      username, mobile, email: email || null, password_hash: hash, role:'user'
    }).select().single();
    if(e1) throw e1;

    /* unique simulated wallet address */
    let address, tries = 0;
    do{ address = 'SIM-' + randHex(4).toUpperCase().match(/.{1,4}/g).join('-'); }
    while((await sb.from('wallets').select('id').eq('wallet_address',address)).data?.length && ++tries < 5);

    const {error:e2} = await sb.from('wallets').insert({user_id:u.id, wallet_address:address});
    if(e2) throw e2;
    await sb.from('notifications').insert({user_id:u.id, title:'Welcome to Nova 🎉',
      message:'Your simulated wallet has been created. Explore markets, send demo assets and try withdrawals — everything here is fictional.'});

    toast('Account created. Welcome!','success');
    saveSession(u); await enterApp();
  }catch(err){
    console.error(err); authError('#signupError','Something went wrong. Please try again.');
  }finally{ btn.disabled=false; btn.textContent='Create Account'; }
}

/* LOGIN */
 $('#btnLogin').onclick = login;
 $('#loginPw').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
 $('#loginId').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
async function login(){
  authErrorClear();
  const id = $('#loginId').value.trim(), pw = $('#loginPw').value;
  if(!id || !pw) return authError('#loginError','Please fill in both fields.');
  const btn = $('#btnLogin'); btn.disabled = true; btn.textContent = 'Logging in…';
  try{
    const col = id.includes('@') ? 'email' : 'mobile';
    const {data:u, error:err} = await sb.from('users').select('*').eq(col, col==='email'?id.toLowerCase():id).maybeSingle();
    if(!u || !(await verifyPassword(pw, u.password_hash))){
      btn.disabled=false; btn.textContent='Log In';
      return authError('#loginError','Invalid credentials. Please try again.');
    }
    if(!u.is_active){
      btn.disabled=false; btn.textContent='Log In';
      return authError('#loginError','Your account has been temporarily disabled.');
    }
    await sb.from('users').update({last_login:new Date().toISOString()}).eq('id', u.id);
    await sb.from('notifications').insert({user_id:u.id, title:'New login detected',
      message:`A login to your Nova account occurred on ${new Date().toLocaleString('en-IN')} (simulated security event).`});
    saveSession(u); await enterApp();
  }catch(err){
    console.error(err); authError('#loginError','Something went wrong. Please try again.');
  }finally{ btn.disabled=false; btn.textContent='Log In'; }
}

/* ────────────────────────────── APP BOOT ───────────────────────────────── */
(async function boot(){
  /* theme */
  const theme = localStorage.getItem('nova_theme') || 'light';
  document.documentElement.dataset.theme = theme;
  syncThemeToggle();

  icons();
  const s = getSession();
  if(s?.logged_in) await enterApp(); else showAuth('login');
})();

async function enterApp(){
  const s = getSession();
  if(!s) return showAuth('login');
  $('#authArea').classList.add('hidden');
  $('#screens').classList.remove('hidden');
  $('#bottomNav').classList.remove('hidden');

  const [{data:u},{data:w}] = await Promise.all([
    sb.from('users').select('*').eq('id', s.user_id).maybeSingle(),
    sb.from('wallets').select('*').eq('user_id', s.user_id).maybeSingle(),
  ]);
  if(!u || !w || !u.is_active){ toast('Session expired or disabled.','error'); return clearSession(); }
  state.user = u; state.wallet = w;

  paintIdentity(); loadNotifs(); loadTxs(); loadWatchlist(); loadAnnouncements();
  subscribeRealtime();
  fetchPrices();
  clearInterval(state.priceTimer);
  state.priceTimer = setInterval(fetchPrices, 60000);
  navigate('home');
  icons();
}

function paintIdentity(){
  const u = state.user;
  const hour = new Date().getHours();
  $('#homeGreetTag').textContent = hour<12?'GOOD MORNING':hour<17?'GOOD AFTERNOON':'GOOD EVENING';
  $('#homeGreetName').textContent = u.username;
  $('#avatarBtn').textContent = u.username[0].toUpperCase();
  $('#profAvatar').textContent = u.username[0].toUpperCase();
  $('#profName').textContent = u.username;
  $('#profContact').textContent = u.email || '+91 ' + u.mobile;
  $('#pfUser').textContent = u.username;
  $('#pfMobile').textContent = '+91 ' + u.mobile;
  $('#pfEmail').textContent = u.email || 'Not provided';
  $('#pfAddress').textContent = state.wallet.wallet_address;
  $('#pfJoined').textContent = fmtDate(u.created_at);
  $('#profRoleBadge').textContent = u.role.toUpperCase() + ' · SIMULATED';
  $('#adminLink').classList.toggle('hidden', u.role !== 'admin');
  icons();
}

/* ────────────────────────────── NAVIGATION ─────────────────────────────── */
function navigate(name){
  $$('.screen').forEach(sc=>sc.classList.remove('active'));
  $('#scr-'+name)?.classList.add('active');
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.nav===name));
  $('#screens').scrollTop = 0;
  if(name==='home'){ drawHome(); }
  if(name==='markets'){ drawMarkets(); }
  if(name==='wallet'){ drawWalletScreen(); }
  if(name==='activity'){ drawActivity(); }
}
 $$('.nav-item').forEach(n => n.onclick = ()=>navigate(n.dataset.nav));
 $('#linkAllWallet').onclick = e => { e.preventDefault(); navigate('wallet'); };
 $('#refreshTx').onclick = ()=>loadTxs(true);
 $$('[data-mkt-tab]').forEach(c=>c.onclick=()=>{ state.mktTab=c.dataset.mktTab; $$('[data-mkt-tab]').forEach(x=>x.classList.toggle('active',x===c)); drawMarkets(); });
 $$('[data-tx-f]').forEach(c=>c.onclick=()=>{ state.filter=c.dataset.txF; $$('[data-tx-f]').forEach(x=>x.classList.toggle('active',x===c)); drawActivity(); });
 $('#mktSearch').oninput = ()=>drawMarkets();
 $('#walSearch').oninput = ()=>drawWalletScreen();
 $('#rangeChips').onclick = e=>{
  const b = e.target.closest('.rc'); if(!b) return;
  state.range=b.dataset.r; $$('.rc').forEach(r=>r.classList.toggle('active',r===b)); drawHome(true);
};
 $('#bellBtn').onclick = openNotificationCenter;
 $('#avatarBtn').onclick = ()=>navigate('profile');

/* global openers via data-open attribute */
document.addEventListener('click', e=>{
  const t = e.target.closest('[data-open]');
  if(!t) return;
  ({sendModal:openSend, receiveModal:openReceive, withdrawSheet:openWithdraw, depositModal:openDeposit})[t.dataset.open]?.();
});

/* ────────────────────────────── HOME ───────────────────────────────────── */
function totalValue(){ return KEYS.reduce((s,k)=>s+valueOf(k),0) + Number(state.wallet.inr_balance); }

function drawHome(skipAnim){
  if(!state.wallet) return;
  const total = totalValue();
  const el = $('#portfolioTotal');
  if(!el.classList.contains('skel')){ el.classList.remove('skel'); }
  skipAnim ? (el.dataset.v=total, el.textContent=inr(total)) : countUp(el,total);
  el.classList.remove('skel');

  const dayDelta = KEYS.reduce((s,k)=> s + valueOf(k)*(change(COINS[k].sym)/100), 0);
  const pct = total>0 ? dayDelta/(total-dayDelta)*100 : 0;
  const pd = $('#portfolioDelta');
  pd.className = 'delta '+(pct>=0?'up':'down');
  pd.textContent = `${pct>=0?'+':''}${pct.toFixed(2)}%`;
  $('#portfolioDeltaAmt').textContent = `≈ ${inr(dayDelta)} today`;

  drawPortfolioChart();
  drawTopHoldings();
}

let pfChart=null;
function drawPortfolioChart(){
  const cv = $('#portfolioChart'); if(!cv) return;
  /* composite series: weight each coin's sparkline by its holding value */
  let series = null, divisor = 0;
  KEYS.forEach(k=>{
    const sp = state.prices[COINS[k].sym]?.spark;
    const v = valueOf(k); if(v<=0) return;
    if(sp && sp.length){
      series = series || new Array(sp.length).fill(0);
      sp.forEach((p,i)=> series[i] += (p/COINS[k]?.dec + (state.prices[COINS[k].sym]?.inr>0?p:0))*0 ); // noop guard
      sp.forEach((p,i)=>{});
    }
  });
  /* build simply from average price curves weighted by balance */
  series = null;
  KEYS.forEach(k=>{
    const meta = state.prices[COINS[k].sym];
    const v = bal(k); if(v<=0) return;
    const sp = meta?.spark && meta.spark.length ? meta.spark : null;
    if(sp){
      series = series || new Array(sp.length).fill(0);
      sp.forEach((p,i)=>{});
      sp.forEach((_,i)=> series[i] += v * sp[i]);
    }
    divisor++;
  });
  if(!series || !series.length){
    const cur = totalValue();
    series = Array.from({length:60},(_,i)=>cur*(1+Math.sin(i/7)*.004));
  }
  if(state.range==='24H') series = series.slice(-24);
  if(series.length<2) series=[series[0],series[0]];

  pfChart?.destroy();
  pfChart = new Chart(cv,{
    type:'line',
    data:{labels:series.map((_,i)=>i), datasets:[{data:series,borderColor:'rgba(39,188,149,.95)',borderWidth:2,pointRadius:0,tension:.42,fill:true,
      backgroundColor:(ctx)=>{
        const g=ctx.chart.ctx.createLinearGradient(0,0,0,cv.height||120);
        g.addColorStop(0,'rgba(39,188,149,.28)'); g.addColorStop(1,'rgba(39,188,149,0)');
        return g;
      }}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      scales:{x:{display:false},y:{display:false}},
      animation:{duration:750,easing:'easeOutQuart'}
    }
  });
}

function drawTopHoldings(){
  const box = $('#topHoldings');
  const rows = KEYS.map(k=>({k,v:valueOf(k)})).sort((a,b)=>b.v-a.v).slice(0,4);
  box.innerHTML = rows.map(({k,v})=>{
    const c = COINS[k], ch = change(c.sym), b = bal(k);
    return `<div class="asset-row" onclick="openCoin('${k}')">
      ${coinLogo(k,38)}
      <div class="asset-main"><div class="asset-name">${c.name}</div><div class="asset-sym">${c.sym}</div></div>
      <div class="asset-right"><div class="asset-val">${inr(v)}</div>
        <div class="delta ${ch>=0?'up':'down'}">${ch>=0?'+':''}${ch.toFixed(2)}%</div></div>
      <canvas class="spark" id="sp-${k}" width="112" height="60"></canvas>
    </div>`;
  }).join('');
  KEYS.forEach(drawSpark);
}
function drawSpark(k){
  const cv = document.getElementById('sp-'+k); if(!cv) return;
  const meta = state.prices[COINS[k].sym];
  const pts = meta?.spark?.length ? meta.spark.slice(-72) : [1,1.01,0.99,1.02,1];
  const chg = change(COINS[k].sym)>=0;
  const ctx = cv.getContext('2d');
  const min=Math.min(...pts), max=Math.max(...pts), rng=(max-min)||1;
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.beginPath();
  pts.forEach((p,i)=>{ const x=i/(pts.length-1)*cv.width, y=cv.height-4-(p-min)/rng*(cv.height-8); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.strokeStyle = chg ? '#0FA57D' : '#DF5576';
  ctx.lineWidth = 3; ctx.lineJoin='round'; ctx.stroke();
}

/* ────────────────────────────── WALLET SCREEN ──────────────────────────── */
function drawWalletScreen(){
  if(!state.wallet) return;
  $('#walletTotal').textContent = inr(totalValue());
  $('#inrBal').textContent = inr(state.wallet.inr_balance);
  const q = ($('#walSearch').value||'').toLowerCase();
  const rows = KEYS.filter(k=>!q || COINS[k].name.toLowerCase().includes(q) || COINS[k].sym.toLowerCase().includes(q));
  const list = $('#walletList');
  list.innerHTML = rows.map(k=>{
    const c=COINS[k], b=bal(k), v=valueOf(k), ch=change(c.sym), on=state.watches.includes(c.sym);
    return `<div class="asset-row" onclick="openCoin('${k}')">
      ${coinLogo(k,40)}
      <div class="asset-main"><div class="asset-name">${c.name}</div><div class="asset-sym">${c.sym}</div></div>
      <div class="asset-right"><div class="asset-val">${num(b,c.dec)}</div><div class="asset-amt">${inr(v)}</div></div>
      <div style="text-align:right;min-width:52px">
        <div class="delta ${ch>=0?'up':'down'}">${ch>=0?'+':''}${ch.toFixed(2)}%</div>
        <button class="star ${on?'on':''}" data-watch="${c.sym}" onclick="event.stopPropagation();toggleWatch('${c.sym}')"><i data-lucide="star"></i></button>
      </div>
    </div>`;
  }).join('') || emptyHTML('Search returned nothing');
  icons();
}

/* ────────────────────────────── MARKETS ────────────────────────────────── */
function drawMarkets(){
  const q = ($('#mktSearch').value||'').toLowerCase();
  let rows = KEYS.filter(k=>!q||COINS[k].name.toLowerCase().includes(q)||COINS[k].sym.toLowerCase().includes(q));
  if(state.mktTab==='gainers') rows = [...rows].sort((a,b)=>change(COINS[b.sym])-change(COINS[a.sym])).slice(0,4);
  if(state.mktTab==='losers')  rows = [...rows].sort((a,b)=>change(COINS[a.sym])-change(COINS[b.sym])).slice(0,4);
  if(state.mktTab==='trending')rows = [...rows].sort((a,b)=>bal(b)>0?1:0).length && [...KEYS].sort((a,b)=>(bal(b)||0)-(bal(a)||0)).slice(0,5);
  if(state.mktTab==='watchlist')rows = rows.filter(k=>state.watches.includes(COINS[k].sym));

  const list = $('#marketsList');
  if(q && !rows.length) return list.innerHTML = emptyHTML('No coins matched "'+esc(q)+'"');
  if(!rows.length)      return list.innerHTML = emptyHTML(state.mktTab==='watchlist' ? 'Tap ★ on any asset to build your watchlist' : 'Nothing here yet');

  list.innerHTML = rows.map(k=>{
    const c=COINS[k], p=price(c.sym), ch=change(c.sym), on=state.watches.includes(c.sym);
    return `<div class="asset-row" onclick="openCoin('${k}')">
      ${coinLogo(k,40)}
      <div class="asset-main"><div class="asset-name">${c.name}</div><div class="asset-sym">${c.sym}</div></div>
      <canvas class="spark" id="mk-${k}" width="112" height="60"></canvas>
      <div class="asset-right" style="min-width:86px"><div class="asset-val">${inr(p)}</div>
        <div class="delta ${ch>=0?'up':'down'}">${ch>=0?'+':''}${ch.toFixed(2)}%</div></div>
      <button class="star ${on?'on':''}" onclick="event.stopPropagation();toggleWatch('${c.sym}')"><i data-lucide="star"></i></button>
    </div>`;
  }).join('');
  KEYS.forEach(k=>{ const cv=document.getElementById('mk-'+k); if(!cv) return;
    const tmp=document.getElementById('sp-'+k);
    /* draw straight onto market canvas */
    const meta=state.prices[COINS[k].sym];
    const pts=(meta?.spark?.length?meta.spark.slice(-72):[1,1.01,.99,1.02,1]);
    const ctx=cv.getContext('2d'); const mn=Math.min(...pts),mx=Math.max(...pts),rg=(mx-mn)||1;
    ctx.clearRect(0,0,cv.width,cv.height); ctx.beginPath();
    pts.forEach((p,i)=>{const x=i/(pts.length-1)*cv.width,y=cv.height-4-(p-mn)/rg*(cv.height-8); i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.strokeStyle=change(COINS[k].sym)>=0?'#0FA57D':'#DF5576'; ctx.lineWidth=3; ctx.stroke();
  });
  icons();
}
const emptyHTML = msg => `<div class="empty-state"><i data-lucide="inbox"></i><p>${msg}</p></div>`;

function loadWatchlist(){ state.watches = JSON.parse(localStorage.getItem('nova_watch_'+state.user.id) || '[]'); }
function persistWatchlist(){ localStorage.setItem('nova_watch_'+state.user.id, JSON.stringify(state.watches)); }
function toggleWatch(sym){
  const i = state.watches.indexOf(sym);
  i<0 ? state.watches.push(sym) : state.watches.splice(i,1);
  persistWatchlist(); drawMarkets(); drawWalletScreen();
  toast(i<0 ? sym+' added to watchlist' : sym+' removed from watchlist','info');
}

/* ────────────────────────────── ACTIVITY ───────────────────────────────── */
async function loadTxs(silent){
  if(!silent) $('#activityList').innerHTML = '<div style="margin:0 1.15rem"><div class="skel" style="height:66px;margin-bottom:.5rem"></div><div class="skel" style="height:66px;margin-bottom:.5rem"></div><div class="skel" style="height:66px"></div></div>';
  const uid = state.user.id;
  const {data,error} = await sb.from('transactions').select('*')
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`).order('created_at',{ascending:false}).limit(120);
  if(error){ toast('Unable to load activity.','error'); return; }
  state.txs = data || [];
  drawActivity();
}
function myKind(tx){
  if(tx.sender_id===state.user.id && tx.receiver_id===state.user.id) return 'sent';
  if(tx.transaction_type==='withdrawal') return 'withdrawal';
  if(['admin_credit'].includes(tx.transaction_type)) return tx.coin==='inr' ? 'deposit' : 'admin_credit';
  if(tx.transaction_type==='admin_debit') return 'admin_debit';
  return tx.sender_id===state.user.id ? 'sent' : 'received';
}
function drawActivity(){
  const f = state.filter;
  let rows = state.txs;
  if(f==='sent') rows=rows.filter(t=>myKind(t)==='sent');
  if(f==='received') rows=rows.filter(t=>myKind(t)==='received');
  if(f==='withdrawal') rows=rows.filter(t=>t.transaction_type==='withdrawal');
  if(f==='deposit') rows=rows.filter(t=>t.coin==='inr'&&t.receiver_id===state.user.id);
  $('#activityList').innerHTML = rows.length ? rows.map(tx=>{
    const kind=myKind(tx), isIn=['received','admin_credit'].includes(kind)&&kind!=='sent';
    const conf = tx.transaction_type==='withdrawal' ? '' :
      `<div style="margin-top:.15rem"><span class="badge ${tx.status==='Completed'?'Completed':tx.status==='Processing'?'Processing':tx.status}">${tx.status}${tx.status==='Processing'&&tx.confirmations>0?` · ${tx.confirmations}/3`:''}</span></div>`;
    return `<div class="tx-item" onclick="openTxDetail('${tx.id}')">
      <div class="tx-icon ${kind}"><i data-lucide="${kind==='sent'?'arrow-up-right':kind==='received'?'arrow-down-left':kind==='withdrawal'?'banknote':kind==='deposit'?'plus-circle':kind==='admin_debit'?'minus-circle':'gift'}"></i></div>
      <div style="flex:1;min-width:0">
        <b style="font-size:.86rem">${kind==='sent'?'Sent':kind==='received'?'Received':kind==='withdrawal'?'Withdrawal':kind==='deposit'?'Deposit (demo)':kind==='admin_debit'?'Debit':'Credit'}</b>
        <div style="font-size:.74rem;color:var(--ink-3)">${fmtTime(tx.created_at)}</div>
        ${conf}
      </div>
      <div style="text-align:right">
        <b style="font-size:.86rem" class="${isIn?'':''}" style="color:${isIn?'var(--up)':'var(--ink)'}">${isIn?'+':'−'}${tx.coin==='inr'?'₹'+num(tx.amount,2):amt(tx.coin,tx.amount)}</b>
        ${tx.amount_inr&&tx.coin!=='inr'?`<div style="font-size:.74rem;color:var(--ink-2)">≈ ${inr(tx.amount_inr)}</div>`:''}
      </div>
    </div>`;
  }).join('') : emptyHTML('No transactions yet. Send some demo crypto!');
  icons();
}

/* TX DETAIL MODAL */
window.openTxDetail = async function(id){
  const tx = state.txs.find(t=>t.id===id); if(!tx) return;
  const uidmap = {};
  const ids=[...new Set([tx.sender_id,tx.receiver_id].filter(Boolean))];
  if(ids.length){
    const {data:people}=await sb.from('users').select('id,username').in('id',ids);
    (people||[]).forEach(p=>uidmap[p.id]=p.username);
  }
  const kind=myKind(tx);
  openSheet(`
    <div class="sheet-head"><h3>Transaction Details</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <div style="text-align:center;margin:.4rem 0 1rem">
      <div style="font-family:var(--font-disp);font-size:1.7rem;font-weight:700;color:${kind==='sent'||kind==='withdrawal'||kind==='admin_debit'?'var(--ink)':'var(--up)'}">
        ${tx.coin==='inr'?(myKind(tx)==='admin_debit'?'−':'+')+'₹'+num(tx.amount,2):(isIncoming(myKind(tx))?'+':'−')+amt(tx.coin,tx.amount)}</div>
      ${tx.amount_inr&&tx.coin!=='inr'?`<div style="color:var(--ink-2);font-size:.85rem">≈ ${inr(tx.amount_inr)}</div>`:''}
      <div style="margin-top:.5rem"><span class="badge ${tx.status}">${tx.status}${tx.transaction_type!=='withdrawal'?` · ${tx.confirmations}/3 confirmations`:''}</span></div>
    </div>
    <div style="padding:.2rem .1rem">
      <div class="kv"><span>Type</span><b>${cap(kind)}</b></div>
      <div class="kv"><span>Asset</span><b>${tx.coin==='inr'?'INR (cash)':COINS[tx.coin].name+' ('+COINS[tx.coin].sym+')'}</b></div>
      <div class="kv"><span>Sender</span><b>${tx.sender_id?(uidmap[tx.sender_id]||short(tx.sender_id)):'Nova System (demo)'}</b></div>
      <div class="kv"><span>Receiver</span><b>${tx.receiver_id?(uidmap[tx.receiver_id]||short(tx.receiver_id)):'External (simulated)'}</b></div>
      <div class="kv"><span>Date</span><b>${fmtTime(tx.created_at)}</b></div>
      <div class="kv"><span>Status</span><b>${tx.status}</b></div>
      <div class="kv"><span>TX Hash (simulated)</span><b style="font-size:.7rem;font-family:var(--font-disp)">${tx.tx_hash}</b></div>
    </div>
    <p class="disclaimer" style="padding:.8rem 0 0">Simulated record — this hash exists only within the Nova demo environment.</p>
  `);
};
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
const short = id => id ? id.slice(0,6)+'…' : '—';
function isIncoming(kind){ return ['received','admin_credit','deposit'].includes(kind); }

/* ────────────────────────────── COIN DETAIL (from rows) ─────────────────── */
window.openCoin = function(k){
  const c=COINS[k], p=price(c.sym), ch=change(c.sym);
  openSheet(`
    <div class="sheet-head"><h3>${c.name}</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem">
      ${coinLogo(k,48)}
      <div><b style="font-size:1.1rem">${inr(p)}</b><div class="delta ${ch>=0?'up':'down'}" style="font-size:.85rem">24h ${ch>=0?'+':''}${ch.toFixed(2)}%</div></div>
    </div>
    <div style="background:var(--surface-2);border-radius:14px;padding:1rem;margin-bottom:1rem">
      <div class="kv"><span>You hold</span><b>${num(bal(k),c.dec)} ${c.sym}</b></div>
      <div class="kv"><span>Value</span><b>${inr(valueOf(k))}</b></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
      <button class="btn btn-ghost btn-sm" onclick="closeModal();openSend('${k}')">Send</button>
      <button class="btn btn-sm" onclick="closeModal();openWithdraw('${k}')">Withdraw</button>
    </div>`);
};

/* ────────────────────────────── SEND ───────────────────────────────────── */
window.openSend = function(prefK){
  let sel = prefK && COINS[prefK] ? prefK : 'btc';
  const sheet = openSheet(`
    <div class="sheet-head"><h3>Send Crypto</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <p class="tag" style="margin-bottom:.5rem">SELECT ASSET</p>
    <div style="display:flex;gap:.4rem;overflow-x:auto;padding-bottom:.5rem" id="sndCoins">
      ${KEYS.filter(k=>bal(k)>0).map(k=>`<button class="chip ${k===sel?'active':''}" data-k="${k}">${COINS[k].sym}</button>`).join('')||'<span class="tag">No crypto balances — ask admin or receive from another user.</span>'}
    </div>
    <div class="field-row" style="margin-top:.8rem">
      <label class="input-label">Receiver Simulated Address</label>
      <input class="input" id="sndAddr" placeholder="SIM-XXXX-XXXX-XXXX" spellcheck="false">
    </div>
    <div class="field-row">
      <label class="input-label">Amount <span id="sndAvail" style="float:right;color:var(--ink-3);font-weight:600"></span></label>
      <div class="input-wrap"><input class="input" id="sndAmt" type="number" step="any" min="0" placeholder="0.00">
      <button class="pw-toggle" style="font-weight:800;font-size:.72rem;color:var(--brand)" id="sndMax">MAX</button></div>
      <div style="font-size:.76rem;color:var(--ink-2);margin-top:.3rem">≈ <span id="sndVal">₹0.00</span></div>
    </div>
    <div class="field-row"><label class="input-label">Note (optional)</label><input class="input" id="sndNote" placeholder="What's this for?" maxlength="80"></div>
    <div style="background:var(--surface-2);border-radius:14px;padding:.8rem 1rem;margin-bottom:1rem">
      <div class="kv"><span>Estimated network fee</span><b id="sndFee">—</b></div>
      <div class="kv"><span>Total debited</span><b id="sndTotal">—</b></div>
    </div>
    <button class="btn" id="sndGo">Slide to Send → Send Now</button>
    <p class="disclaimer" style="padding:.9rem 0 0">Simulated transfer — no blockchain interaction occurs.</p>`);
  const S = selK => {
    sel=selK; $$('#sndCoins .chip').forEach(ch=>ch.classList.toggle('active',ch.dataset.k===selK));
    upd();
  };
  function upd(){
    const b=bal(sel),c=COINS[sel];
    $('#sndAvail').textContent=`Available: ${num(b,c.dec)} ${c.sym}`;
    $('#sndFee').textContent=num(c.fee,c.dec)+' '+c.sym+' (demo)';
    const a=parseFloat($('#sndAmt').value)||0;
    $('#sndVal').textContent=inr(a*price(c.sym));
    $('#sndTotal').textContent=num(a+c.fee,c.dec)+' '+c.sym;
  }
  sheet.querySelector('#sndCoins').onclick=e=>{const ch=e.target.closest('.chip'); if(ch) S(ch.dataset.k);};
  sheet.querySelector('#sndAmt').oninput=upd;
  sheet.querySelector('#sndMax').onclick=()=>{ const c=COINS[sel]; sheet.querySelector('#sndAmt').value=Math.max(bal(sel)-c.fee,0); upd(); };
  upd();

  sheet.querySelector('#sndGo').onclick = async ev=>{
    const btn=ev.currentTarget; const addr=sheet.querySelector('#sndAddr').value.trim();
    const a=parseFloat(sheet.querySelector('#sndAmt').value)||0; const c=COINS[sel];
    if(!/^SIM-[A-Z0-9\-]{4,}$/i.test(addr))                  return toast('Invalid wallet address format.','error');
    if(a<=0)                                                 return toast('Enter an amount greater than zero.','error');
    if(a+c.fee>bal(sel))                                     return toast('Insufficient balance (incl. network fee).','error');
    btn.disabled=true; btn.textContent='Submitting…';
    try{
      const {data,error}=await sb.rpc('wallet_send',{p_sender:state.user.id,p_receiver_address:addr,p_coin:sel,p_amount:a});
      if(error){
        const m=String(error.message||'');
        if(m.includes('SIMW404')) return {fail:toast('Wallet address not found in this simulation.','error')}&&void(finish());
        if(m.includes('SIMINS'))  return void(finish(toast('Insufficient wallet balance.','error')));
        throw error;
      }
      toast(`Sent ${num(a,c.dec)} ${c.sym} to ${data.receiver} (simulated).`,'success');
      simulateConfirmations(data.tx_id);
      closeModal(); await Promise.all([refreshWallet(),loadTxs(true)]);
      function finish(){ btn.disabled=false; btn.textContent='Send Now'; }
      finish();
    }catch(err){ console.error(err); toast('Transfer failed. Please retry.','error'); btn.disabled=false; btn.textContent='Send Now'; }
  };
};
async function refreshWallet(){
  const {data} = await sb.from('wallets').select('*').eq('user_id',state.user.id).maybeSingle();
  if(data) state.wallet=data; drawHome(true); drawWalletScreen();
}
/* stagger fake confirmations until Completed */
async function simulateConfirmations(txId){
  for(let c=1;c<=3;c++){
    await new Promise(r=>setTimeout(r,2600+c*900));
    await sb.from('transactions').update({confirmations:c,status:c===3?'Completed':'Processing'}).eq('id',txId);
    if(state.txs.find(t=>t.id===txId)){ loadTxs(true); }
  }
}

/* ────────────────────────────── RECEIVE ────────────────────────────────── */
window.openReceive = function(){
  const addr = state.wallet.wallet_address;
  const sheet = openSheet(`
    <div class="sheet-head"><h3>Receive Crypto</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <p style="font-size:.83rem;color:var(--ink-2);text-align:center">Share your simulated Nova address below.<br>Only Nova-simulator accounts can deliver funds to it.</p>
    <div class="qr-holder"><div id="qrBox"></div></div>
    <div class="addr-pill" id="addrPill">${addr}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:1rem">
      <button class="btn btn-ghost btn-sm" id="cpAddr"><i data-lucide="copy" style="width:15px;height:15px"></i> Copy</button>
      <button class="btn btn-sm" id="shAddr"><i data-lucide="share-2" style="width:15px;height:15px"></i> Share</button>
    </div>
    <div style="margin-top:1.1rem">
      <p class="tag" style="margin-bottom:.5rem">AVAILABLE WALLETS ON THIS ADDRESS</p>
      <div style="display:flex;gap:.45rem;flex-wrap:wrap">${KEYS.map(k=>`<span class="chip" style="cursor:default">${COINS[k].sym}</span>`).join('')}</div>
    </div>
    <p class="disclaimer" style="padding:.9rem 0 0">Simulated address — never send real cryptocurrency to it.</p>`);
  new QRCode(sheet.querySelector('#qrBox'),{text:addr,width:170,height:170,colorDark:'#101725',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  sheet.querySelector('#cpAddr').onclick=async()=>{
    try{ await navigator.clipboard.writeText(addr); toast('Address copied.','success'); }
    catch(_){ toast('Copy not permitted — long-press to copy manually.','info'); }
  };
  sheet.querySelector('#shAddr').onclick=async()=>{
    if(navigator.share){ try{ await navigator.share({title:'My Nova simulated address',text:addr}); }catch(_){} }
    else sheet.querySelector('#cpAddr').click();
  };
};

/* ────────────────────────────── WITHDRAW ───────────────────────────────── */
window.openWithdraw = function(prefK){
  let sel = prefK && COINS[prefK]?prefK:null, method=null, step=1;
  const drawable = KEYS.filter(k=>bal(k)>0);
  if(!drawable.length){
    return openSheet(`<div class="empty-state"><i data-lucide="landmark"></i><p>No crypto available to withdraw yet.<br>Credit demo funds from Profile → Security, or receive from another user.</p></div>
      <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:1rem">Close</button>`);
  }
  sel = sel||drawable[0];

  const sheet=openSheet(`
    <div class="sheet-head"><h3>Withdraw Funds</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <div class="stepper"><div class="on" id="st1"></div><div id="st2"></div><div id="st3"></div></div>
    <div id="wdBody"></div>`);

  const STEP1=()=>{ step=1; sheet.querySelector('#st1').classList.add('on');
    sheet.querySelector('#st2,#st3')?.classList.remove('on'); sheet.querySelector('#st2').classList.remove('on'); sheet.querySelector('#st3').classList.remove('on');
    sheet.querySelector('#wdBody').innerHTML=`
      <p class="tag" style="margin-bottom:.5rem">ASSET TO WITHDRAW</p>
      <div style="display:flex;gap:.4rem;overflow-x:auto;padding-bottom:.6rem;margin-bottom:.9rem">
        ${drawable.map(k=>`<button class="chip ${k===sel?'active':''}" data-wdk="${k}">${COINS[k].sym}</button>`).join('')}
      </div>
      <div class="field-row"><label class="input-label">Amount <span style="float:right;color:var(--ink-3)" id="wdAvail"></span></label>
        <div class="input-wrap"><input class="input" id="wdAmt" type="number" step="any" min="0" placeholder="0.00">
        <button class="pw-toggle" id="wdMax" style="font-weight:800;font-size:.72rem;color:var(--brand)">MAX</button></div>
      </div>
      <div style="background:var(--surface-2);border-radius:14px;padding:.8rem 1rem;margin-bottom:1rem">
        <div class="kv"><span>Current price</span><b id="wdPrice">—</b></div>
        <div class="kv"><span>Estimated INR value</span><b id="wdInr" style="color:var(--brand)">—</b></div>
      </div>
      <button class="btn" id="wdNext">Continue</button>
      <p class="disclaimer" style="padding:.9rem 0 0">Simulated payout only — no real UPI or bank transfer occurs.</p>`;
    const upd=()=>{
      const a=parseFloat(sheet.querySelector('#wdAmt').value)||0;
      sheet.querySelector('#wdAvail').textContent=`Available: ${num(bal(sel),COINS[sel].dec)} ${COINS[sel].sym}`;
      sheet.querySelector('#wdPrice').textContent=inr(price(COINS[sel].sym));
      sheet.querySelector('#wdInr').textContent=inr(a*price(COINS[sel].sym));
    };
    sheet.querySelectorAll('[data-wdk]').forEach(b=>b.onclick=()=>{sel=b.dataset.wdk;sheet.querySelectorAll('[data-wdk]').forEach(x=>x.classList.toggle('active',x===b));upd();});
    sheet.querySelector('#wdAmt').oninput=upd; upd();
    sheet.querySelector('#wdMax').onclick=()=>{sheet.querySelector('#wdAmt').value=bal(sel);upd();};
    sheet.querySelector('#wdNext').onclick=()=>{
      const a=parseFloat(sheet.querySelector('#wdAmt').value)||0;
      if(a<=0) return toast('Enter a valid amount.','error');
      if(a>bal(sel)) return toast('Insufficient wallet balance.','error');
      state._wd={coin:sel,amount:a,inr:a*price(COINS[sel].sym)};
      STEP2();
    };
  };

  const STEP2=()=>{ step=2; sheet.querySelector('#st2').classList.add('on');
    sheet.querySelector('#wdBody').innerHTML=`
      <p class="tag" style="margin-bottom:.6rem">WITHDRAWAL METHOD</p>
      <button class="method-card" data-m="UPI"><i data-lucide="smartphone-nfc"></i>
        <div style="flex:1"><b style="font-size:.9rem">UPI Transfer</b><div style="font-size:.74rem;color:var(--ink-2)">Instant simulation · arrives in 3 business days</div></div>
        <i data-lucide="chevron-right" style="width:16px;color:var(--ink-3)"></i></button>
      <button class="method-card" data-m="BANK"><i data-lucide="landmark"></i>
        <div style="flex:1"><b style="font-size:.9rem">Bank Transfer</b><div style="font-size:.74rem;color:var(--ink-2)">NEFT / IMPS simulation · 3 business days</div></div>
        <i data-lucide="chevron-right" style="width:16px;color:var(--ink-3)"></i></button>
      <div id="methForm" style="margin-top:.9rem"></div>`;
    icons();
    sheet.querySelectorAll('.method-card').forEach(mc=>mc.onclick=()=>{
      sheet.querySelectorAll('.method-card').forEach(x=>x.classList.remove('selected'));
      mc.classList.add('selected'); method=mc.dataset.m; renderMethForm();
    });
    function renderMethForm(){
      const f=sheet.querySelector('#methForm');
      if(method==='UPI') f.innerHTML=`
        <div class="field-row"><label class="input-label">UPI ID</label>
        <input class="input" id="wdUpi" placeholder="e.g. ${state.user.username.toLowerCase()}@upi" value="${state.user.username.toLowerCase()}@upi"></div>`;
      else f.innerHTML=`
        <div class="field-row"><label class="input-label">Bank Name</label><input class="input" id="wdBank" placeholder="e.g. HDFC Bank"></div>
        <div class="field-row"><label class="input-label">Account Holder Name</label><input class="input" id="wdHolder" value="${esc(state.user.username)}"></div>
        <div class="field-row"><label class="input-label">Account Number</label><input class="input" id="wdAcc" inputmode="numeric" maxlength="18"></div>
        <div class="field-row"><label class="input-label">IFSC Code</label><input class="input" id="wdIfsc" maxlength="11" style="text-transform:uppercase"></div>`;
      const older=f.querySelector('#wdNextOld'); if(older) older.remove();
      const goBtn=document.createElement('button'); goBtn.className='btn'; goBtn.id='wdReview'; goBtn.textContent='Review Withdrawal';
      f.appendChild(goBtn);
      goBtn.onclick=()=>{
        const d={};
        if(method==='UPI'){ d.upi_id=f.querySelector('#wdUpi').value.trim();
          if(!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(d.upi_id)) return toast('Enter a valid UPI ID (e.g. name@bank).','error');
        }else{
          d.bank_name=f.querySelector('#wdBank').value.trim();
          d.holder=f.querySelector('#wdHolder').value.trim();
          d.account=f.querySelector('#wdAcc').value.trim();
          d.ifsc=f.querySelector('#wdIfsc').value.trim().toUpperCase();
          if(!d.bank_name) return toast('Bank name is required.','error');
          if(!/^[0-9]{9,18}$/.test(d.account)) return toast('Enter a valid account number (9–18 digits).','error');
          if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(d.ifsc)) return toast('Enter a valid IFSC code.','error');
        }
        state._wd.details=d; STEP3();
      };
    }
  };

  const estArrival=addBizDays(new Date(),3);
  const STEP3=()=>{ step=3; sheet.querySelector('#st2').classList.add('on'); sheet.querySelector('#st3').classList.add('on');
    const w=state._wd, d=w.details;
    sheet.querySelector('#wdBody').innerHTML=`
      <div style="background:var(--surface-2);border-radius:16px;padding:.95rem 1.05rem;margin-bottom:1rem">
        <div class="kv"><span>Asset</span><b>${amt(w.coin,w.amount)}</b></div>
        <div class="kv"><span>Method</span><b>${method==='UPI'?'UPI · '+esc(d.upi_id):'Bank · '+esc(d.bank_name)+' ••••'+esc(String(d.account).slice(-4))}</b></div>
        <div class="kv"><span>Est. INR value</span><b>${inr(w.inr)}</b></div>
        <div class="kv"><span>Estimated arrival</span><b>${estArrival.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}</b></div>
        <div class="kv"><span>Crypto deduction</span><b style="color:var(--down)">Immediate</b></div>
      </div>
      <button class="btn" id="wdSubmit">Submit Request</button>
      <button class="btn btn-ghost btn-sm" id="wdBack" style="margin-top:.5rem">Back</button>
      <p class="disclaimer" style="padding:.9rem 0 0">Demo payout simulation — no money will actually reach any UPI ID or bank account.</p>`;
    sheet.querySelector('#wdBack').onclick=STEP2;
    sheet.querySelector('#wdSubmit').onclick=async ev=>{
      const btn=ev.currentTarget; btn.disabled=true; btn.textContent='Submitting…';
      try{
        const {data,error}=await sb.rpc('request_withdrawal',{
          p_user:state.user.id,p_coin:w.coin,p_crypto:w.amount,
          p_method:method,p_details:JSON.stringify(d)});
        if(error){
          const m=String(error.message||'');
          if(m.includes('SIMINS')){ toast('Insufficient wallet balance.','error'); btn.disabled=false; btn.textContent='Submit Request'; return; }
          throw error;
        }
        await refreshWallet(); loadTxs(true);
        SUCCESS(data);
      }catch(err){ console.error(err); toast('Withdrawal request failed. Please retry.','error'); btn.disabled=false; btn.textContent='Submit Request'; }
    };
  };

  function SUCCESS(res){
    sheet.querySelector('.stepper').classList.add('hidden');
    sheet.querySelector('#wdBody').innerHTML=`
      <div class="success-check"><i data-lucide="check"></i></div>
      <h3 style="text-align:center;font-size:1.1rem">Withdrawal Request Submitted</h3>
      <p style="text-align:center;font-size:.85rem;color:var(--ink-2);margin:.5rem 1rem 1rem">
        Your withdrawal request has been successfully submitted.<br>
        Estimated arrival: <b style="color:var(--ink)">${fmtDate(res.estimated_arrival)} · 3 Business Days</b>.<br>
        Your crypto assets have been deducted from your wallet balance.</p>
      ${timelineHTML(1)}
      <button class="btn btn-ghost btn-sm" onclick="closeModal();navigate('profile')" style="margin-top:1.2rem">View Withdrawal History</button>
      <button class="btn btn-sm" onclick="closeModal();navigate('home')" style="margin-top:.5rem">Done</button>`;
    icons();
    setTimeout(()=>animateTimeline(sheet),400);
  }

  STEP1();
};

/* business-day math mirroring the SQL helper */
function addBizDays(from,n){
  const d=new Date(from); let left=n;
  while(left>0){ d.setDate(d.getDate()+1); if(d.getDay()!==0&&d.getDay()!==6) left--; }
  return d;
}
function timelineHTML(doneCount){
  const steps=[
    ['Request Submitted','We received your withdrawal request'],
    ['Processing','Request accepted into the settlement queue'],
    ['Verification','Compliance & risk checks (simulated)'],
    ['Transfer Processing','Preparing the simulated payout'],
    ['Completed','Funds delivered to destination'],
  ];
  return `<div class="timeline">${steps.map((s,i)=>`
    <div class="tl-step" data-tli="${i}">
      <div class="tl-dot"><i data-lucide="${i===steps.length-1?'flag':'check'}"></i></div>
      <div><b>${s[0]}</b><small>${s[1]}</small></div>
    </div>`).join('')}</div>`;
}
function animateTimeline(scope){
  const steps=[...scope.querySelectorAll('.tl-step')];
  steps.forEach((s,i)=>setTimeout(()=>{
    s.classList.add('done'); s.querySelector('.tl-dot').innerHTML='<i data-lucide="check"></i>'; icons();
    if(i===steps.length-1) toast('Simulation timeline complete.','success');
  },500+i*650));
}

/* WITHDRAWAL HISTORY (user) */
 $('#openWithdrawHistory').onclick = loadWithdrawHistory;
async function loadWithdrawHistory(){
  const {data,error}=await sb.from('withdrawals').select('*').eq('user_id',state.user.id).order('created_at',{ascending:false});
  if(error) return toast('Unable to load withdrawal history.','error');
  openSheet(`
    <div class="sheet-head"><h3>Withdrawal History</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    ${(data||[]).length?data.map(w=>`
      <div style="border:1px solid var(--line);border-radius:14px;padding:.85rem 1rem;margin-bottom:.6rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">
          <b style="font-size:.9rem">${amt(w.coin,w.crypto_amount)}</b>
          <span class="badge ${w.status}">${w.status}</span></div>
        <div class="kv" style="padding:.3rem 0"><span>INR value</span><b>${inr(w.amount_inr)}</b></div>
        <div class="kv" style="padding:.3rem 0"><span>Method</span><b>${w.withdrawal_method==='UPI'?esc(w.upi_id):esc(w.bank_name)+' ••••'+esc(String(w.account_number).slice(-4))}</b></div>
        <div class="kv" style="padding:.3rem 0"><span>Requested</span><b>${fmtTime(w.created_at)}</b></div>
        <div class="kv" style="padding:.3rem 0"><span>Est. arrival</span><b>${fmtDate(w.estimated_arrival)}</b></div>
        ${w.completed_at?`<div class="kv" style="padding:.3rem 0"><span>Completed</span><b>${fmtTime(w.completed_at)}</b></div>`:''}
      </div>`).join(''):emptyHTML('No withdrawals yet')}
    <p class="disclaimer">All payouts shown are simulations. No real bank/UPI transfers occur on Nova.</p>`);
  $('#sheetRoot');
}

/* ────────────────────────────── DEPOSIT (Add Funds) ────────────────────── */
window.openDeposit = function(){
  const presets=[500,1000,5000,10000,50000,100000];
  const sheet=openSheet(`
    <div class="sheet-head"><h3>Add Demo Funds (INR)</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <p style="font-size:.82rem;color:var(--ink-2);margin-bottom:.9rem">Instantly top up fictional INR cash for in-app testing. No payment gateway is connected — nothing real is charged.</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:.9rem" id="depPresets">
      ${presets.map(p=>`<button class="chip" data-p="${p}" style="text-align:center;font-variant-numeric:tabular-nums">₹${p.toLocaleString('en-IN')}</button>`).join('')}
    </div>
    <div class="field-row"><label class="input-label">Custom Amount</label><input class="input" id="depAmt" type="number" min="1" placeholder="₹ 1 – ₹ 1,00,00,000"></div>
    <button class="btn" id="depGo">Add Simulated Balance</button>
    <p class="disclaimer" style="padding:.9rem 0 0">Educational simulation only — no real banking occurs here.</p>`);
  sheet.querySelector('#depPresets').onclick=e=>{
    const b=e.target.closest('[data-p]'); if(!b) return;
    sheet.querySelector('#depAmt').value=b.dataset.p;
  };
  sheet.querySelector('#depGo').onclick=async ev=>{
    const btn=ev.currentTarget,a=parseFloat(sheet.querySelector('#depAmt').value);
    if(!(a>=1)) return toast('Enter a valid amount.','error');
    btn.disabled=true;btn.textContent='Adding…';
    try{
      await sb.rpc('deposit_demo_funds',{p_user:state.user.id,p_amount:a});
      toast(inr(a)+' demo INR added.','success');
      closeModal(); refreshWallet(); loadTxs(true);
    }catch(err){ toast(err.message||'Deposit failed.','error'); btn.disabled=false;btn.textContent='Add Simulated Balance'; }
  };
};

/* ────────────────────────────── NOTIFICATIONS ──────────────────────────── */
async function loadNotifs(){
  const {data}=await sb.from('notifications').select('*').eq('user_id',state.user.id).order('created_at',{ascending:false}).limit(60);
  state.notifs=data||[]; paintBell();
}
function paintBell(){
  const un=state.notifs.filter(n=>!n.read_status).length;
  $('#bellDot').classList.toggle('hidden',un===0);
  $('#bellDot').textContent=un>9?'9+':un;
}
function openNotificationCenter(){
  openSheet(`
    <div class="sheet-head"><h3>Notifications</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <div id="notifList">${notifHTML()}</div>`);
  /* mark visible ones read */
  const unread=state.notifs.filter(n=>!n.read_status).map(n=>n.id);
  if(unread.length){ sb.from('notifications').update({read_status:true}).in('id',unread).then(loadNotifs); }
}
function notifHTML(){
  if(!state.notifs.length) return emptyHTML('Nothing here yet — you’re all caught up.');
  return state.notifs.map(n=>`
    <div style="display:flex;gap:.7rem;padding:.8rem .2rem;border-bottom:1px solid var(--line)">
      <div class="tx-icon ${n.title.includes('received')?'received':n.title.includes('disabled')||n.title.includes('failed')?'sent':'admin_credit'}"
           style="width:34px;height:34px"><i data-lucide="${n.title.includes('received')?'arrow-down-left':n.title.includes('login')?'shield':n.title.includes('Withdrawal')?'banknote':n.title.includes('Delivered')?'package-check':'megaphone'}"></i></div>
      <div style="flex:1"><b style="font-size:.85rem">${esc(n.title)}</b>
        <div style="font-size:.78rem;color:var(--ink-2)">${esc(n.message)}</div>
        <div style="font-size:.7rem;color:var(--ink-3);margin-top:.2rem">${fmtTime(n.created_at)}</div></div>
    </div>`).join('')+icons();
}

/* announcements on home */
async function loadAnnouncements(){
  const {data}=await sb.from('announcements').select('*').order('created_at',{ascending:false}).limit(3);
  const slot=$('#announceSlot');
  slot.innerHTML=(data||[]).map(a=>`
    <div class="announce">
      <div class="a-ic"><i data-lucide="${a.type==='Maintenance'?'wrench':a.type==='Security'?'shield-alert':a.type==='Market'?'chart-line':'megaphone'}"></i></div>
      <div style="min-width:0;flex:1"><b>${esc(a.title)}</b><p>${esc(a.message)}</p></div>
    </div>`).join('');
  icons();
}

/* ────────────────────────────── REALTIME ───────────────────────────────── */
function subscribeRealtime(){
  if(state.channel) sb.removeChannel(state.channel);
  const uid=state.user.id;
  state.channel=sb.channel('nova-user-'+uid)
    .on('postgres_changes',{event:'*',schema:'public',table:'wallets',filter:`user_id=eq.${uid}`},
      p=>{
        const prev={...state.wallet}; state.wallet=p.new;
        drawHome(true); drawWalletScreen();
        KEYS.concat(['inr']).forEach(k=>{
          const col=BAL_COL[k]||'inr_balance';
          const dv=Number(p.new[col])-Number(prev[col]??prev[col]);
          if(Math.abs(dv)>1e-9){
            const txt=k==='inr'?inr(dv):`${dv>0?'+':''}${num(dv,COINS[k].dec)} ${COINS[k].sym}`;
            toast(`Balance updated: ${txt}`, dv>0?'success':'info');
          }
        });
      })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'transactions'},
      p=>{ const tx=p.new;
        if(tx.receiver_id===uid||tx.sender_id===uid){
          state.txs.unshift(tx);
          if($('#scr-activity').classList.contains('active')) drawActivity();
          if(document.getElementById('scr-home')) loadTxs(true);
        }})
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${uid}`},
      p=>{
        state.notifs.unshift(p.new); paintBell();
        if(localStorage.getItem('nova_notif_pref')!=='off'){
          toast(p.new.title,'info');
          const sheet=$('#notifList'); if(sheet) sheet.innerHTML=notifHTML();
        }
      })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'withdrawals',filter:`user_id=eq.${uid}`},
      p=>{
        const s=p.new.status;
        if(s==='Completed') toast('Funds Successfully Delivered ✔ (simulated)','success');
        else if(s==='Rejected') toast('Withdrawal rejected — amount refunded to wallet.','error');
        else if(s==='Failed') toast('Withdrawal failed — amount refunded to wallet.','error');
        else if(s==='Processing') toast('Withdrawal approved — now processing.','info');
      })
    .subscribe();
}

/* ────────────────────────────── PROFILE ACTIONS ────────────────────────── */
function syncThemeToggle(){
  const dark=document.documentElement.dataset.theme==='dark';
  const t=$('#themeToggle'); if(t) t.classList.toggle('on',dark);
  const st=$('#secDark'); if(st) st.classList.toggle('on',dark);
}
 $('#themeToggle').onclick=()=>{
  const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next; localStorage.setItem('nova_theme',next); syncThemeToggle();
};
 $('#notifToggle').onclick=e=>{
  const t=e.currentTarget; t.classList.toggle('on');
  localStorage.setItem('nova_notif_pref',t.classList.contains('on')?'on':'off');
  toast(t.classList.contains('on')?'Local alerts enabled.':'Local alerts muted.','info');
};
 $('#notifToggle').classList.toggle('on',localStorage.getItem('nova_notif_pref')!=='off');
 $('#langSel').onchange=()=>toast('Language switching is a UI simulation.','info');
 $('#btnLogout').onclick=()=>clearSession();

 $('#openSecurity').onclick=async()=>{
  const dev=localStorage.getItem('nova_device')||(()=>'Chrome · Android/Linux · '+randHex(4))( '');
  localStorage.setItem('nova_device',dev);
  const twoFa=localStorage.getItem('nova_2fa_'+state.user.id)==='on';
  const logins=await sb.from('notifications').select('*').eq('user_id',state.user.id).ilike('title','%login%').order('created_at',{ascending:false}).limit(4);
  const score=60+(twoFa?25:0)+(state.user.email?10:0)+(logins.data?.length?5:0);
  openSheet(`
    <div class="sheet-head"><h3>Security</h3><button class="icon-btn" onclick="closeModal()"><i data-lucide="x"></i></button></div>
    <div class="ring-wrap card" style="margin:0 0 1rem">
      <div class="ring">
        <svg width="82" height="82" viewBox="0 0 82 82">
          <circle cx="41" cy="41" r="35" fill="none" stroke="var(--line)" stroke-width="8"/>
          <circle cx="41" cy="41" r="35" fill="none" stroke="var(--brand)" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${score*2.2} 999"/>
        </svg><b>${score}</b>
      </div>
      <div><b style="font-size:.95rem">Security Score</b>
        <p style="font-size:.78rem;color:var(--ink-2)">Interface simulation — indicators are illustrative and not audited protection.</p></div>
    </div>
    <div class="setting-group" style="margin:0 0 1rem">
      <div class="setting-row"><i data-lucide="scan-face"></i><span class="grow">Two-Factor Authentication<span class="muted">Interface simulation</span></span><button class="toggle ${twoFa?'on':''}" id="twoFaT"></button></div>
      <div class="setting-row"><i data-lucide="monitor-smartphone"></i><span class="grow">Current Device</span><span style="color:var(--ink-2);font-size:.76rem;text-align:right">${esc(dev)}</span></div>
      <div class="setting-row" style="color:var(--down)"><i data-lucide="log-out" style="color:var(--down)"></i><span class="grow">Terminate all other sessions (simulated)</span></div>
    </div>
    <p class="tag" style="margin-bottom:.5rem">RECENT LOGIN ACTIVITY</p>
    ${(logins.data||[]).map(l=>`<div class="kv"><span>🔐 ${esc(l.title)}</span><b style="font-size:.76rem">${fmtTime(l.created_at)}</b></div>`).join('')||'<div class="kv"><span>No recorded logins yet</span><b>—</b></div>'}`);
  sheetReady();
  function sheetReady(){
    const t=$('#twoFaT'); if(!t) return;
    t.onclick=()=>{
      t.classList.toggle('on');
      localStorage.setItem('nova_2fa_'+state.user.id,t.classList.contains('on')?'on':'off');
      toast('2FA interface preference saved (simulation only).','info');
      t.parentElement.parentElement.click?.(); $('#openSecurity').click?.();
    };
  }
};
