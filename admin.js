/* ============================================================================
   NOVA ADMIN — operations console (vanilla JS)
   Gate requires users.role === 'admin' from the SAME custom auth table.
   ============================================================================ */

const SUPABASE_URL    = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';

const COINS_ADMIN = {
  btc:['BTC','Bitcoin','#F7931A'], eth:['ETH','Ethereum','#627EEA'],
  usdt:['USDT','Tether','#26A17B'], sol:['SOL','Solana','#9945FF'],
  xrp:['XRP','XRP','#0F172A'], doge:['DOGE','Dogecoin','#C2A633'],
  bnb:['BNB','BNB','#B7950B'], inr:['INR','Indian Rupee','#0E9C78'],
};
const ADM_BAL_COL={btc:'btc_balance',eth:'eth_balance',usdt:'usdt_balance',sol:'sol_balance',
                   xrp:'xrp_balance',doge:'doge_balance',bnb:'bnb_balance',inr:'inr_balance'};

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const num=(n,d=4)=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:d});
const fmt=ts=>ts?new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const day=d=>d?new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
const icons=()=>lucide.createIcons();

const admSb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

function toastAdm(msg,kind='info'){
  const ic={success:'check-circle-2',error:'alert-circle',info:'info'}[kind];
  const el=document.createElement('div');
  el.className='toast '+kind;
  el.innerHTML=`<i data-lucide="${ic}"></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);icons();
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),260)},3500);
}
function admModal(html){
  admCloseModal();
  const bd=document.createElement('div');bd.className='modal-backdrop';
  bd.innerHTML=`<div class="sheet"><div class="grabber"></div>${html}</div>`;
  bd.addEventListener('click',e=>{if(e.target===bd)admCloseModal()});
  $('#modalRoot').appendChild(bd);icons();return bd;
}
function admCloseModal(){$$('.modal-backdrop').forEach(m=>m.remove())}

/* ---------------------------- auth / gating ------------------------------- */
function admErr(msg){const e=$('#admErr');e.textContent=msg;e.classList.add('show')}
(async function bootAdmin(){
  document.documentElement.dataset.theme=localStorage.getItem('nova_theme')||'light';
  icons();
  const s=getSession();
  if(!s?.logged_in){ $('#gateLogin').classList.remove('hidden'); icons(); return; }
  const {data:me}=await admSb.from('users').select('username,role,is_active').eq('id',s.user_id).maybeSingle();
  if(!me||!me.is_active){ $('#gateLogin').classList.remove('hidden'); icons(); return; }
  if(me.role!=='admin'){ $('#unauthorized').classList.remove('hidden'); icons(); return; }
  $('#console').classList.remove('hidden');
  $('#admWho').textContent='Signed in as '+me.username+' · admin';
  icons(); gotoSection('dash');
})();
function getSession(){try{return JSON.parse(localStorage.getItem('nova_session'))}catch(_){return null}}

 $('#admLogin').onclick=async()=>{
  const id=$('#admId').value.trim(),pw=$('#admPw').value;
  if(!id||!pw) return admErr('Fill in both fields.');
  try{
    const col=id.includes('@')?'email':'mobile';
    const {data:u}=await admSb.from('users').select('*').eq(col,col==='email'?id.toLowerCase():id).maybeSingle();
    if(!u||!(await verifyAdm(pw,u.password_hash))) return admErr('Invalid credentials.');
    if(u.role!=='admin'){
      $('#gateLogin').classList.add('hidden');
      $('#unauthorized').classList.remove('hidden');icons();return;
    }
    if(!u.is_active) return admErr('Your account has been temporarily disabled.');
    await admSb.from('users').update({last_login:new Date().toISOString()}).eq('id',u.id);
    localStorage.setItem('nova_session',JSON.stringify({user_id:u.id,username:u.username,role:'admin',logged_in:true}));
    location.reload();
  }catch(err){console.error(err);admErr('Something went wrong.')}
};
 $$('.pw-toggle').forEach(b=>b.onclick=()=>{const i=document.getElementById(b.dataset.pw);i.type=i.type==='password'?'text':'password';
  b.innerHTML=`<i data-lucide="${i.type==='password'?'eye':'eye-off'}"></i>`;icons();});
 $('#admLogout').onclick=()=>{localStorage.removeItem('nova_session');location.reload()};
 $('#hamBtn').onclick=()=>$('#sidebar').classList.toggle('open');

async function verifyAdm(pw,stored){
  const [salt,h]=String(stored).split('$');if(!salt)return false;
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+pw));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')===h;
}

/* ------------------------------ routing ----------------------------------- */
const views={
  dash:viewDash, users:viewUsers, wallets:viewWallets, withdrawals:viewWithdrawals,
  txs:viewTxs, notifs:viewNotifs, anns:viewAnns, settings:viewSettings,
};
 $$('.side-item').forEach(b=>b.onclick=()=>{
  $$('.side-item').forEach(x=>x.classList.toggle('active',x===b));
  gotoSection(b.dataset.a);
  if(innerWidth<=860) $('#sidebar').classList.remove('open');
});
function gotoSection(a){ views[a]?.(); }

/* -------------------------------- DASHBOARD ------------------------------- */
const ACHARTS={};
async function viewDash(){
  $('#admMain').innerHTML=`<h1 class="admin-title">Dashboard</h1>
    <div class="stat-grid" id="statGrid">${'<div class="card stat-panel skel" style="height:96px"></div>'.repeat(6)}</div>
    <div class="dual-grid">
      <div class="card panel"><h3>User Growth (14d)</h3><div class="chart-box"><canvas id="cUsers"></canvas></div></div>
      <div class="card panel"><h3>Transaction Activity (14d)</h3><div class="chart-box"><canvas id="cTx"></canvas></div></div>
    </div>
    <div class="card panel"><h3>Withdrawal Funnel</h3><div class="chart-box" style="height:210px"><canvas id="cWd"></canvas></div></div>
    <p class="disclaimer" style="padding:0 0 1rem">Every figure reflects fictional simulator data only.</p>`;

  const [us,ws,wds,txs]=await Promise.all([
    admSb.from('users').select('id,is_active,created_at'),
    admSb.from('wallets').select('*'),
    admSb.from('withdrawals').select('status,created_at'),
    admSb.from('transactions').select('id,created_at'),
  ]);
  const users=us.data||[],wallas=ws.data||[],wdls=wds.data||[],tls=txs.data||[];
  const totBal=k=>wallas.reduce((s,w)=>s+Number(w[ADM_BAL_COL[k]]||0),0);
  const stats=[
    ['Total Users',users.length],['Active Users',users.filter(u=>u.is_active).length],
    ['Pending Withdrawals',wdls.filter(w=>w.status==='Processing').length],
    ['Completed Withdrawals',wdls.filter(w=>w.status==='Completed').length],
    ['Total Transactions',tls.length],
    ['Simulated BTC Held',num(totBal('btc'),4)+' ₿'],
  ];
  $('#statGrid').innerHTML=stats.map(([l,v])=>`<div class="card stat-card"><div class="tag">${l}</div><b>${v}</b></div>`).join('');

  const last14=n=>Array.from({length:n},(_,i)=>{const d=new Date();d.setDate(d.getDate()-n+1+i);return d;});
  const labels=last14(14).map(d=>d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}));
  const cnt=(arr,key)=>labels.map((_,i)=>{const d=new Date();d.setDate(d.getDate()-14+1+i);
    return arr.filter(x=>new Date(x[key]).toDateString()===d.toDateString()).length;});
  mkChart('cUsers','line',cnt(users,'created_at'),'rgba(123,127,232,.9)');
  mkChart('cTx','bar',cnt(tls,'created_at'),'rgba(39,188,149,.85)');
  mkChart('cWd','doughnut',['Processing','Completed','Failed','Rejected'].map(s=>wdls.filter(w=>w.status===s).length),
    ['#D98A1F','#0FA57D','#DF5576','#7B7FE8'],['Processing','Completed','Failed','Rejected']);
  icons();
}
function mkChart(id,type,data,color,legendLabels){
  const cv=document.getElementById(id);if(!cv)return;
  ACHARTS[id]?.destroy();
  ACHARTS[id]=new Chart(cv,{type,
    data:legendLabels
      ?{labels:legendLabels,datasets:[{data,backgroundColor:color,borderWidth:0}]}
      :{labels:Array.from({length:data.length},(_,i)=>i-data.length+1+'d'),
         datasets:[{data,backgroundColor:type==='bar'?color:color.replace('.9','.18'),borderColor:color,
                    borderWidth:2,borderRadius:6,tension:.4,fill:type==='line',pointRadius:0}]}},
    {responsive:true,maintainAspectRatio:false,
     plugins:{legend:{display:!!legendLabels,position:'right',labels:{boxWidth:10,font:{size:11}}},
              tooltip:{callbacks:legendLabels?undefined:{title:i=>'Day '+i[0].label}}}});
}

/* -------------------------------- USERS ------------------------------------ */
let USERS_CACHE=[];
async function viewUsers(){
  $('#admMain').innerHTML=`<h1 class="admin-title">Users</h1>
    <div class="filters-bar">
      <div class="search-inline"><i data-lucide="search"></i><input id="uQ" placeholder="Search username / mobile / email"></div>
      <select id="uRole"><option value="">All roles</option><option value="user">user</option><option value="admin">admin</option></select>
      <select id="uActive"><option value="">Any status</option><option value="true">Active</option><option value="false">Disabled</option></select>
    </div>
    <div class="table-wrap"><table class="data" id="uTable"></table></div>`;
  $('#uQ').oninput=renderUsers;$('#uRole').onchange=renderUsers;$('#uActive').onchange=renderUsers;
  const {data,error}=await admSb.from('users').select('*').order('created_at',{ascending:false});
  if(error) return toastAdm('Unable to load users.','error');
  USERS_CACHE=data||[];renderUsers();
}
function renderUsers(){
  const q=$('#uQ').value.toLowerCase(),r=$('#uRole').value,a=$('#uActive').value;
  const rows=USERS_CACHE.filter(u=>
    (!q||(u.username||'').toLowerCase().includes(q)||(u.mobile||'').includes(q)||(u.email||'').toLowerCase().includes(q))
    &&(!r||u.role===r)&&(a===''||String(u.is_active)===a));
  $('#uTable').innerHTML=`<thead><tr><th>User</th><th>Contact</th><th>Role</th><th>Status</th><th>Joined</th><th style="text-align:right">Actions</th></tr></thead>
    <tbody>${rows.map(u=>`<tr>
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.mobile)}${u.email?`<br><span style="color:var(--ink-3)">${esc(u.email)}</span>`:''}</td>
      <td><span class="badge ${u.role==='admin'?'neutral':'up'}">${u.role}</span></td>
      <td><span class="badge ${u.is_active?'Completed':'Failed'}">${u.is_active?'Active':'Disabled'}</span></td>
      <td>${day(u.created_at)}</td>
      <td><div class="row-actions">
        <button class="mini-btn" onclick="userDrawer('${u.id}')">Details</button>
        <button class="mini-btn ${u.role==='admin'?'':'ok'}" onclick="swapRole('${u.id}','${u.role==='admin'?'user':'admin'}')">${u.role==='admin'?'Demote':'Promote'}</button>
        <button class="mini-btn ${u.is_active?'no':'ok'}" onclick="toggleActive('${u.id}',${u.is_active})">${u.is_active?'Disable':'Enable'}</button>
      </div></td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--ink-3);padding:2rem">No matches</td></tr>'}</tbody>`;
  icons();
}
window.swapRole=async(id,to)=>{
  const u=USERS_CACHE.find(x=>x.id===id);
  if(!confirm(`Change role of "${u.username}" to ${to}?`))return;
  const {error}=await admSb.from('users').update({role:to}).eq('id',id);
  error?toastAdm('Update failed.','error'):(toastAdm(`"${u.username}" is now ${to}.`,'success'),Object.assign(u,{role:to}),renderUsers());
};
window.toggleActive=async(id,on)=>{
  const u=USERS_CACHE.find(x=>x.id===id);
  if(!confirm(`${on?'Disable':'Enable'} account "${u.username}"?`))return;
  const {error}=await admSb.from('users').update({is_active:!on}).eq('id',id);
  error?toastAdm('Update failed.','error'):(toastAdm(`Account "${u.username}" ${on?'disabled':'enabled'}.`,'success'),u.is_active=!on,renderUsers());
};
window.userDrawer=async id=>{
  const u=USERS_CACHE.find(x=>x.id===id);
  const [{data:w},{data:mytxs},{data:mywds}]=await Promise.all([
    admSb.from('wallets').select('*').eq('user_id',id).maybeSingle(),
    admSb.from('transactions').select('*').or(`sender_id.eq.${id},receiver_id.eq.${id}`).order('created_at',{ascending:false}).limit(20),
    admSb.from('withdrawals').select('*').eq('user_id',id).order('created_at',{ascending:false}).limit(15),
  ]);
  const bd=document.createElement('div');bd.className='drawer-backdrop';
  bd.onclick=()=>{bd.remove();dr.remove()};
  const dr=document.createElement('aside');dr.className='drawer';
  dr.innerHTML=`
    <div class="sheet-head"><h3>@${esc(u.username)}</h3><button class="icon-btn" onclick="this.closest('.drawer').previousSibling.remove();this.closest('.drawer').remove()"><i data-lucide="x"></i></button></div>
    <div class="kv"><span>Mobile</span><b>${esc(u.mobile)}</b></div>
    <div class="kv"><span>Email</span><b>${esc(u.email||'—')}</b></div>
    <div class="kv"><span>Wallet address</span><b style="font-size:.7rem">${esc(w?.wallet_address||'—')}</b></div>
    <div class="kv"><span>Last login</span><b>${fmt(u.last_login)}</b></div>
    <div class="kv"><span>Created</span><b>${fmt(u.created_at)}</b></div>
    <p class="tag" style="margin:1.1rem 0 .4rem">BALANCES</p>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem">
      ${Object.keys(ADM_BAL_COL).map(k=>`<div class="card stat-card" style="padding:.6rem .75rem">
        <div class="tag">${k.toUpperCase()}</div><b style="font-size:.95rem">${k==='inr'?inr(w?.[ADM_BAL_COL[k]]):num(w?.[ADM_BAL_COL[k]],8)}</b></div>`).join('')}
    </div>
    <p class="tag" style="margin:1.1rem 0 .4rem">RECENT TRANSACTIONS</p>
    ${(mytxs||[]).map(t=>`<div class="kv"><span>${t.transaction_type} · ${t.coin}</span><b>${num(t.amount,6)} · <span class="badge ${t.status}" style="font-size:.6rem">${t.status}</span></b></div>`).join('')||'<div class="kv"><span>None</span><b>—</b></div>'}
    <p class="tag" style="margin:1.1rem 0 .4rem">WITHDRAWALS</p>
    ${(mywds||[]).map(x=>`<div class="kv"><span>${fmt(x.created_at)}</span><b>${num(x.crypto_amount,6)} ${x.coin.toUpperCase()} · ${x.status}</b></div>`).join('')||'<div class="kv"><span>None</span><b>—</b></div>'}`;
  document.body.append(bd,dr);icons();
};

/* --------------------------- WALLET MANAGEMENT ----------------------------- */
async function viewWallets(){
  const {data:us}=await admSb.from('users').select('id,username,mobile').order('username');
  const {data:ws}=await admSb.from('wallets').select('user_id,*');
  const {data:adjs}=await admSb.from('transactions').select('*')
    .in('transaction_type',['admin_credit','admin_debit']).order('created_at',{ascending:false}).limit(20);
  const names=Object.fromEntries((us||[]).map(u=>[u.id,u.username]));

  $('#admMain').innerHTML=`<h1 class="admin-title">Wallet Management</h1>
    <div class="card panel">
      <h3>Adjust Simulated Balances</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.8rem;align-items:end">
        <div><label class="input-label">Select user</label>
          <select class="input" id="adjUser">${us.map(u=>`<option value="${u.id}">${esc(u.username)} (${esc(u.mobile)})</option>`).join('')}</select></div>
        <div><label class="input-label">Asset</label>
          <select class="input" id="adjCoin">${Object.keys(ADM_BAL_COL).map(k=>`<option value="${k}">${k.toUpperCase()} — ${COINS_ADMIN[k][1]}</option>`).join('')}</select></div>
        <div><label class="input-label">Amount (use − prefix to debit)</label>
          <input class="input" id="adjAmt" type="number" step="any" placeholder="e.g. 10 or -5"></div>
        <button class="btn btn-sm" id="adjPreview" style="height:46px">Preview & Confirm</button>
      </div>
      <p class="disclaimer" style="padding:.9rem 0 0;text-align:left">Assigns fictional units inside the simulator. Example: pick “Udit”, asset BTC, amount 10 → user receives 10 simulated BTC instantly, with a notification and ledger entry.</p>
    </div>
    <div class="card panel"><h3>Recent Adjustments</h3>
      ${adjs?.length?`<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>User</th><th>Type</th><th>Asset</th><th style="text-align:right">Amount</th></tr></thead><tbody>
        ${adjs.map(a=>`<tr><td>${fmt(a.created_at)}</td><td>${esc(names[a.receiver_id||a.sender_id]||'—')}</td>
          <td><span class="badge ${a.transaction_type==='admin_credit'?'Completed':'Failed'}">${a.transaction_type}</span></td>
          <td>${a.coin.toUpperCase()}</td>
          <td style="text-align:right"><b>${a.coin==='inr'?inr(a.amount):num(a.amount,8)}</b></td></tr>`).join('')}
      </tbody></table></div>`:'<p class="tag">No manual adjustments yet.</p>'}
    </div>`;

  $('#adjPreview').onclick=()=>{
    const uid=$('#adjUser').value,k=$('#adjCoin').value,a=parseFloat($('#adjAmt').value);
    if(!a||a===0) return toastAdm('Enter a non-zero amount.','error');
    const uname=$('#adjUser').selectedOptions[0].textContent.split('(')[0].trim();
    const up=a>0;
    const bd=admModal(`
      <div class="sheet-head"><h3>Confirm Adjustment</h3><button class="icon-btn" onclick="admCloseModal()"><i data-lucide="x"></i></button></div>
      <div style="background:var(--surface-2);border-radius:14px;padding:.9rem 1rem;margin-bottom:1rem">
        <div class="kv"><span>User</span><b>${esc(uname)}</b></div>
        <div class="kv"><span>Action</span><b style="color:${up?'var(--up)':'var(--down)'}">${up?'CREDIT':'DEBIT'} ${a>0?a:(-a)} ${k.toUpperCase()}</b></div>
        <div class="kv"><span>Ledger entry</span><b>${up?'admin_credit':'admin_debit'}</b></div>
      </div>
      <button class="btn ${up?'':'btn-danger'}" id="adjGo">${up?'Credit Now':'Debit Now'}</button>
      <p class="disclaimer" style="padding:.9rem 0 0;text-align:left">Fictional units only — value created here exists solely within the simulator.</p>`);
    bd.querySelector('#adjGo').onclick=async ev=>{
      const btn=ev.currentTarget;btn.disabled=true;btn.textContent='Working…';
      const {data:newBal,error}=await admSb.rpc('admin_adjust_balance',
        {p_admin:getSession().user_id,p_target:uid,p_coin:k,p_amount:a});
      if(error){
        const m=String(error.message||'');
        toastAdm(m.includes('SIMINS')?'Insufficient balance for this debit.':(m.includes('Unauthorized')?'Unauthorized Access':'Adjustment failed.'),'error');
        btn.disabled=false;btn.textContent='Retry';return;
      }
      toastAdm(`${up?'Credited':'Debited'} ${Math.abs(a)} ${k.toUpperCase()} — new balance: ${k==='inr'?inr(newBal):num(newBal,8)}`,'success');
      admCloseModal();viewWallets();
    };
  };
  icons();
}

/* ------------------------------ WITHDRAWALS -------------------------------- */
async function viewWithdrawals(){
  const {data:us}=await admSb.from('users').select('id,username');
  const {data:ws,error}=await admSb.from('withdrawals').select('*').order('created_at',{ascending:false}).limit(200);
  if(error) return toastAdm('Unable to load withdrawals.','error');
  const names=Object.fromEntries((us||[]).map(u=>[u.id,u.username]));
  const WD=list=>{ADM_WD_CACHE=list;drawWdTable()};
  window.ADM_WD_ALL=ws;window.ADM_WD_NAMES=names;
  $('#admMain').innerHTML=`<h1 class="admin-title">Withdrawals</h1>
    <div class="filters-bar">
      <div class="search-inline"><i data-lucide="search"></i><input id="wdq" placeholder="Search user"></div>
      <select id="wds"><option value="">All status</option>${['Processing','Completed','Failed','Rejected'].map(s=>`<option>${s}</option>`).join('')}</select>
      <select id="wdm"><option value="">All methods</option><option>UPI</option><option>BANK</option></select>
    </div>
    <div class="table-wrap"><table class="data" id="wdTbl"></table></div>`;
  $('#wdq').oninput=filterWd;$('#wds').onchange=filterWd;$('#wdm').onchange=filterWd;
  WD(ws);
  function filterWd(){
    const q=$('#wdq').value.toLowerCase(),s=$('#wds').value,m=$('#wdm').value;
    WD(ws.filter(w=>(!q||(names[w.user_id]||'').toLowerCase().includes(q))&&(!s||w.status===s)&&(!m||w.withdrawal_method===m)));
  }
}
function drawWdTable(){
  const rows=ADM_WD_CACHE||[];
  $('#wdTbl').innerHTML=`<thead><tr><th>User</th><th>Asset</th><th>Crypto</th><th>INR</th><th>Method / Details</th><th>Requested</th><th>Est. arrival</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
  <tbody>${rows.map(w=>{
    const act=[]=[];
    const acts=w.status==='Processing'
      ?`<button class="mini-btn ok" onclick="wdSet('${w.id}','Processing')">Approve</button>
        <button class="mini-btn ok" onclick="wdSet('${w.id}','Completed')">Complete</button>
        <button class="mini-btn no" onclick="wdSet('${w.id}','Rejected')">Reject</button>
        <button class="mini-btn no" onclick="wdSet('${w.id}','Failed')">Fail</button>`
      :`<button class="mini-btn" onclick="wdSet('${w.id}','Processing')">Reopen</button>`;
    return `<tr>
      <td><b>${esc(window.ADM_WD_NAMES[w.user_id]||'—')}</b></td>
      <td>${w.coin.toUpperCase()}</td>
      <td>${num(w.crypto_amount,8)}</td><td>${inr(w.amount_inr)}</td>
      <td style="max-width:190px;font-size:.76rem">${w.withdrawal_method} · ${w.withdrawal_method==='UPI'?esc(w.upi_id):esc(w.bank_name)+' ••••'+esc(String(w.account_number||'').slice(-4))+' / '+esc(w.ifsc_code||'')}</td>
      <td>${fmt(w.created_at)}</td><td>${day(w.estimated_arrival)}</td>
      <td><span class="badge ${w.status}">${w.status}</span></td>
      <td><div class="row-actions">${acts}</div></td></tr>`;
  }).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:2rem">No withdrawals found</td></tr>'}</tbody>`;
  icons();
}
window.wdSet=async(id,status)=>{
  if(!confirm(`Set withdrawal status → ${status}?`))return;
  const {error}=await admSb.rpc('admin_set_withdrawal',{p_wid:id,p_new_status:status});
  if(error){toastAdm('Status change failed.','error');return;}
  toastAdm(`Withdrawal → ${status}.${['Rejected','Failed'].includes(status)?' Amount refunded.':''}`,'success');
  viewWithdrawals();
};

/* ------------------------------ TRANSACTIONS -------------------------------- */
let TX_FILTER={q:'',coin:'',type:'',status:''};
async function viewTxs(){
  $('#admMain').innerHTML=`<h1 class="admin-title">Transactions</h1>
    <div class="filters-bar">
      <div class="search-inline"><i data-lucide="search"></i><input id="txq" placeholder="Search TX hash"></div>
      <select id="txc"><option value="">All coins</option>${Object.keys(COINS_ADMIN).map(k=>`<option value="${k}">${k.toUpperCase()}</option>`).join('')}</select>
      <select id="txt"><option value="">All types</option>${['sent','received','withdrawal','admin_credit','admin_debit'].map(t=>`<option>${t}</option>`).join('')}</select>
      <select id="txs"><option value="">All statuses</option>${['Processing','Completed','Failed','Rejected'].map(t=>`<option>${t}</option>`).join('')}</select>
    </div>
    <div class="table-wrap"><table class="data" id="txTbl"></table></div>`;
  ['txq','txc','txt','txs'].forEach(id=>{
    const el=document.getElementById(id);
    el.addEventListener(id==='txq'?'input':'change',()=>{applyTxFilter();});
  });
  applyTxFilter();
}
async function applyTxFilter(){
  TX_FILTER={q:$('#txq').value.trim(),coin:$('#txc').value,type:$('#txt').value,status:$('#txs').value};
  let q=admSb.from('transactions').select('*').order('created_at',{ascending:false}).limit(300);
  if(TX_FILTER.coin)q=q.eq('coin',TX_FILTER.coin);
  if(TX_FILTER.type)q=q.eq('transaction_type',TX_FILTER.type);
  if(TX_FILTER.status)q=q.eq('status',TX_FILTER.status);
  const {data,error}=await q;
  if(error)return toastAdm('Unable to load transactions.','error');
  const rows=(data||[]).filter(t=>!TX_FILTER.q||t.tx_hash.includes(TX_FILTER.q));
  window.TX_LIST=rows;
  $('#txTbl').innerHTML=`<thead><tr><th>Date</th><th>Hash</th><th>Type</th><th>Coin</th><th style="text-align:right">Amount</th><th style="text-align:right">INR</th><th>Status</th><th style="text-align:right">Detail</th></tr></thead>
    <tbody>${rows.map(t=>`<tr>
      <td>${fmt(t.created_at)}</td>
      <td style="font-family:var(--font-disp);font-size:.72rem">${t.tx_hash.slice(0,14)}…</td>
      <td>${t.transaction_type}</td><td>${t.coin.toUpperCase()}</td>
      <td style="text-align:right">${t.coin==='inr'?inr(t.amount):num(t.amount,8)}</td>
      <td style="text-align:right">${t.amount_inr?inr(t.amount_inr):'—'}</td>
      <td><span class="badge ${t.status}">${t.status}</span></td>
      <td style="text-align:right"><button class="mini-btn" onclick="txDrawer('${t.id}')">View</button></td>
    </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--ink-3);padding:2rem">No transactions match</td></tr>'}</tbody>`;
  icons();
}
window.txDrawer=id=>{
  const t=window.TX_LIST.find(x=>x.id===id);
  admModal(`<div class="sheet-head"><h3>Transaction Detail</h3><button class="icon-btn" onclick="admCloseModal()"><i data-lucide="x"></i></button></div>
    <div style="padding:.1rem .1rem">
      <div class="kv"><span>Full hash</span><b style="font-size:.68rem;font-family:var(--font-disp);word-break:break-all">${t.tx_hash}</b></div>
      <div class="kv"><span>Type</span><b>${t.transaction_type}</b></div>
      <div class="kv"><span>Asset</span><b>${t.coin.toUpperCase()}</b></div>
      <div class="kv"><span>Amount</span><b>${t.coin==='inr'?inr(t.amount):num(t.amount,10)}</b></div>
      <div class="kv"><span>INR value</span><b>${t.amount_inr?inr(t.amount_inr):'—'}</b></div>
      <div class="kv"><span>Status</span><b>${t.status} · ${t.confirmations}/3 conf</b></div>
      <div class="kv"><span>Sender</span><b>${t.sender_id?t.sender_id.slice(0,8)+'…':'System'}</b></div>
      <div class="kv"><span>Receiver</span><b>${t.receiver_id?t.receiver_id.slice(0,8)+'…':'External (sim)'}</b></div>
      <div class="kv"><span>Created</span><b>${fmt(t.created_at)}</b></div>
    </div>`);
};

/* ------------------------------ NOTIFY USERS -------------------------------- */
async function viewNotifs(){
  const {data:us}=await admSb.from('users').select('id,username').order('username');
  $('#admMain').innerHTML=`<h1 class="admin-title">Notifications</h1>
    <div class="card panel" style="max-width:560px">
      <h3>Send Notification</h3>
      <div class="field-row"><label class="input-label">Recipient</label>
        <select class="input" id="nTarget"><option value="ALL">📣 All users (broadcast)</option>
          ${us.map(u=>`<option value="${u.id}">@${esc(u.username)}</option>`).join('')}</select></div>
      <div class="field-row"><label class="input-label">Title</label><input class="input" id="nTitle" maxlength="60" placeholder="e.g. Scheduled maintenance"></div>
      <div class="field-row"><label class="input-label">Message</label><textarea class="input" id="nMsg" rows="3" maxlength="300" placeholder="Keep it short and helpful."></textarea></div>
      <button class="btn" id="nSend">Send Notification</button>
    </div>`;
  $('#nSend').onclick=async ev=>{
    const t=$('#nTarget').value,title=$('#nTitle').value.trim(),msg=$('#nMsg').value.trim(),btn=ev.currentTarget;
    if(!title||!msg)return toastAdm('Title and message are required.','error');
    btn.disabled=true;btn.textContent='Sending…';
    const targets=t==='ALL'?us.map(u=>u.id):[t];
    const {error}=await admSb.from('notifications').insert(targets.map(uid=>({user_id:uid,title,message:msg})));
    btn.disabled=false;btn.textContent='Send Notification';
    if(error)return toastAdm('Send failed.','error');
    toastAdm(`Notification delivered to ${targets.length} user(s).`,'success');
    $('#nTitle').value='';$('#nMsg').value='';
  };
}

/* ------------------------------ ANNOUNCEMENTS ------------------------------- */
async function viewAnns(){
  const {data:list}=await admSb.from('announcements').select('*').order('created_at',{ascending:false}).limit(40);
  $('#admMain').innerHTML=`<h1 class="admin-title">Announcements</h1>
    <div class="card panel" style="max-width:560px">
      <h3>Create Announcement</h3>
      <div class="field-row"><label class="input-label">Type</label>
        <select class="input" id="aType"><option>General</option><option>Market</option><option>Maintenance</option><option>Security</option></select></div>
      <div class="field-row"><label class="input-label">Title</label><input class="input" id="aTitle" maxlength="60"></div>
      <div class="field-row"><label class="input-label">Message</label><textarea class="input" id="aMsg" rows="3" maxlength="400"></textarea></div>
      <button class="btn" id="aPub">Publish Announcement</button>
    </div>
    <div style="max-width:640px">
      ${(list||[]).map(a=>`<div class="card panel" style="margin-bottom:.7rem;display:flex;gap:.8rem;align-items:center">
        <span class="badge neutral">${a.type}</span>
        <div style="flex:1;min-width:0"><b style="font-size:.88rem">${esc(a.title)}</b>
          <div style="font-size:.78rem;color:var(--ink-2)">${esc(a.message)}</div>
          <div style="font-size:.7rem;color:var(--ink-3);margin-top:.15rem">${fmt(a.created_at)}</div></div>
        <button class="mini-btn no" onclick="delAnn('${a.id}')">Delete</button>
      </div>`).join('')||'<p class="tag">No announcements published yet.</p>'}
    </div>`;
  $('#aPub').onclick=async ev=>{
    const type=$('#aType').value,title=$('#aTitle').value.trim(),message=$('#aMsg').value.trim();
    if(!title||!message)return toastAdm('Both fields required.','error');
    ev.currentTarget.disabled=true;
    const {error}=await admSb.from('announcements').insert({type,title,message,created_by:getSession().user_id});
    ev.currentTarget.disabled=false;
    error?toastAdm('Publish failed.','error'):(toastAdm('Announcement published — users see it on Home.','success'),viewAnns());
  };
  icons();
}
window.delAnn=async id=>{
  if(!confirm('Delete this announcement?'))return;
  const {error}=await admSb.from('announcements').delete().eq('id',id);
  error?toastAdm('Delete failed.','error'):(toastAdm('Deleted.','success'),viewAnns());
};

/* -------------------------------- SETTINGS ---------------------------------- */
function viewSettings(){
  $('#admMain').innerHTML=`<h1 class="admin-title">Settings</h1>
    <div class="card panel" style="max-width:520px">
      <h3>Appearance</h3>
      <div class="setting-row"><i data-lucide="moon"></i><span class="grow">Dark Mode</span><button class="toggle ${document.documentElement.dataset.theme==='dark'?'on':''}" id="admTheme"></button></div>
      <h3 style="margin-top:1.1rem">Platform Notes</h3>
      <div class="setting-row" style="display:block;font-weight:600;font-size:.83rem;color:var(--ink-2)">
        • This console operates entirely on fictional ledger entries.<br>
        • Admin credentials are provisioned via SQL (<code>create_first_admin</code>) — never embed them here.<br>
        • Only the Supabase <b>anon</b> key appears in frontend code; service-role keys stay server-side.
      </div>
    </div>`;
  $('#admTheme').onclick=()=>{
    const nx=document.documentElement.dataset.theme==='dark'?'light':'dark';
    document.documentElement.dataset.theme=nx;localStorage.setItem('nova_theme',nx);
    $('#admTheme').classList.toggle('on',nx==='dark');
  };
  icons();
}
