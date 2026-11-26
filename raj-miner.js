import http from 'node:http';
import crypto from 'crypto';
import fs from 'fs';

const BOT = process.env.BOT_TOKEN;
const ADMIN = '8990854464'; // locked: only this Telegram ID can use admin
const WEBAPP = process.env.WEBAPP_URL; // your Railway public URL
const DIR = process.env.DATA_DIR || './data';
const FILE = DIR + '/db.json';
fs.mkdirSync(DIR, { recursive: true });

let db = { users: {}, tasks: [
  { id: 'daily', title: 'Daily check-in', reward: 5, every: 24 },
  { id: 'ad', title: 'Watch a video ad', reward: 5, every: 12 }
], channel: '' };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE)) }; } catch {}
let t; const save = () => { clearTimeout(t); t = setTimeout(() => fs.writeFileSync(FILE, JSON.stringify(db)), 500); };

const tg = (m, p) => fetch(`https://api.telegram.org/bot${BOT}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }).then(r => r.json());

const level = b => Math.min(100, Math.floor(Math.sqrt(b / 5)) + 1);
const rate = u => 2 + level(u.bal) * 0.5; // RAJ per hour
const CAP_H = 8;
const getUser = (id, name = '') => db.users[id] ||= { id, name, bal: 0, since: Date.now(), last: Date.now(), refs: 0, tasks: {}, ton: '', banned: false };

function verify(init) {
  const p = new URLSearchParams(init); const hash = p.get('hash'); p.delete('hash');
  const str = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  if (crypto.createHmac('sha256', key).update(str).digest('hex') !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  return { ...JSON.parse(p.get('user')), start: p.get('start_param') };
}
const view = u => ({ id: u.id, name: u.name, bal: u.bal, lvl: level(u.bal), rate: rate(u), refs: u.refs,
  days: Math.ceil((Date.now() - u.since) / 864e5), ton: u.ton,
  pending: Math.min(CAP_H, (Date.now() - u.last) / 36e5) * rate(u), capH: CAP_H,
  tasks: db.tasks.map(k => ({ ...k, wait: Math.max(0, (u.tasks[k.id] || 0) + k.every * 36e5 - Date.now()) })) });

const R = {};
R['POST /api/me'] = u => view(u);
R['POST /api/claim'] = u => {
  const h = Math.min(CAP_H, (Date.now() - u.last) / 36e5);
  if (h < 0.05) return { ...view(u), got: 0 };
  const got = +(h * rate(u)).toFixed(2); u.bal = +(u.bal + got).toFixed(2); u.last = Date.now(); save();
  return { ...view(u), got };
};
R['POST /api/task'] = async (u, b) => {
  const k = db.tasks.find(x => x.id === b.id); if (!k) return {};
  if (Date.now() - (u.tasks[k.id] || 0) < k.every * 36e5) return { ...view(u), got: 0 };
  if (k.chat) { // channel check (bot must be admin in the channel)
    const m = await tg('getChatMember', { chat_id: k.chat, user_id: u.id });
    if (!['member', 'administrator', 'creator'].includes(m.result?.status)) return { ...view(u), got: 0, need: k.url };
  }
  u.tasks[k.id] = Date.now(); u.bal += k.reward; save(); return { ...view(u), got: k.reward };
};
R['POST /api/wallet'] = (u, b) => { u.ton = String(b.ton || '').slice(0, 80); save(); return view(u); };
R['GET /api/top'] = () => Object.values(db.users).sort((a, b) => b.bal - a.bal).slice(0, 20).map(u => ({ name: u.name, bal: u.bal, lvl: level(u.bal) }));

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const out = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HTML); }
  if (!url.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  let raw = ''; for await (const c of req) raw += c;
  let b = {}; try { b = JSON.parse(raw || '{}'); } catch {}
  const f = verify(req.headers['x-init'] || ''); if (!f) return out(401, { error: 'auth' });
  const isNew = !db.users[f.id]; const u = getUser(f.id, f.first_name);
  if (u.banned) return out(403, { error: 'banned' });
  const ref = f.start || req.headers['x-ref'];
  if (isNew && ref && ref !== String(f.id) && db.users[ref]) { db.users[ref].bal += 100; db.users[ref].refs++; }
  save();
  const fn = R[req.method + ' ' + url]; if (!fn) return out(404, {});
  try { out(200, await fn(u, b)); } catch (e) { out(500, { error: 'server' }); }
}).listen(process.env.PORT || 3000);

// ---------- Telegram bot (long polling) ----------
const isAdmin = id => String(id) === ADMIN;
const panel = { inline_keyboard: [[{ text: '📊 Stats', callback_data: 'stats' }, { text: '🏆 Top 10', callback_data: 'top' }],
  [{ text: '📋 Tasks', callback_data: 'tasks' }, { text: '❓ Commands', callback_data: 'help' }]] };
const HELP = `/give id amount\n/ban id  /unban id\n/broadcast text\n/addtask id|title|reward|hours|url|@channel\n/deltask id\n/setchannel @channel`;

async function onMsg(m) {
  const id = m.from.id, txt = (m.text || '').trim();
  if (txt.startsWith('/start')) {
    const ref = txt.split(' ')[1] || '';
    return tg('sendMessage', { chat_id: id, text: '⛏ Welcome to Raj Miner!\nMine $RAJ, finish tasks, invite friends.',
      reply_markup: { inline_keyboard: [[{ text: '⛏ Open Raj Miner', web_app: { url: WEBAPP + (ref ? '?r=' + ref : '') } }]] } });
  }
  if (!isAdmin(id)) return; // everything below is admin only
  const [cmd, ...rest] = txt.split(' '), arg = rest.join(' ');
  if (cmd === '/admin') return tg('sendMessage', { chat_id: id, text: '🛠 Admin Panel', reply_markup: panel });
  if (cmd === '/give') { const [uid, n] = rest; const u = db.users[uid]; if (!u) return say(id, 'user not found'); u.bal += Number(n); save(); return say(id, 'done'); }
  if (cmd === '/ban' || cmd === '/unban') { const u = db.users[arg]; if (!u) return say(id, 'user not found'); u.banned = cmd === '/ban'; save(); return say(id, 'done'); }
  if (cmd === '/broadcast') { let n = 0; for (const u of Object.values(db.users)) { const r = await tg('sendMessage', { chat_id: u.id, text: arg }); if (r.ok) n++; await new Promise(r => setTimeout(r, 40)); } return say(id, `sent to ${n}`); }
  if (cmd === '/addtask') { const [tid, title, reward, every, url, chat] = arg.split('|'); db.tasks = db.tasks.filter(x => x.id !== tid); db.tasks.push({ id: tid, title, reward: +reward, every: +every || 24, url, chat }); save(); return say(id, 'task added'); }
  if (cmd === '/deltask') { db.tasks = db.tasks.filter(x => x.id !== arg); save(); return say(id, 'removed'); }
}
const say = (id, text) => tg('sendMessage', { chat_id: id, text });
async function onCb(c) {
  tg('answerCallbackQuery', { callback_query_id: c.id });
  if (!isAdmin(c.from.id)) return;
  const U = Object.values(db.users), id = c.from.id;
  if (c.data === 'stats') say(id, `👥 Users: ${U.length}\n💰 Total RAJ: ${U.reduce((a, u) => a + u.bal, 0).toFixed(0)}\n🔗 Wallets: ${U.filter(u => u.ton).length}\n🚫 Banned: ${U.filter(u => u.banned).length}`);
  if (c.data === 'top') say(id, U.sort((a, b) => b.bal - a.bal).slice(0, 10).map((u, i) => `${i + 1}. ${u.name} (${u.id}) — ${u.bal.toFixed(0)}`).join('\n') || 'empty');
  if (c.data === 'tasks') say(id, db.tasks.map(k => `${k.id}: ${k.title} +${k.reward}/${k.every}h`).join('\n'));
  if (c.data === 'help') say(id, HELP);
}
(async function poll(off = 0) {
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: off, timeout: 30 });
      for (const u of r.result || []) { off = u.update_id + 1; if (u.message) await onMsg(u.message); if (u.callback_query) await onCb(u.callback_query); }
    } catch { await new Promise(r => setTimeout(r, 3000)); }
  }
})();


// ---------- Mini app UI (served at /) ----------
const HTML = (function () {/*<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Raj Miner</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--g:#ffc83d;--p:#2a1a6e;--c:#2ee6a6}
*{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent}
body{font-family:system-ui,sans-serif;color:#fff;background:#0b0620;min-height:100vh;overflow-x:hidden}
.bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(60% 40% at 20% 10%,#5b2bd9aa,transparent),radial-gradient(50% 40% at 90% 80%,#00c9a755,transparent),linear-gradient(#150a3a,#07031a)}
.bg i{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff;animation:tw 3s infinite}
@keyframes tw{50%{opacity:.1}}
main{padding:16px 16px 110px}
h1{font-size:28px;color:var(--g);text-shadow:0 3px 0 #7a4b00}
.card{background:linear-gradient(160deg,#4a2fb0,#2a1a6e);border:2px solid #ffffff22;border-radius:22px;padding:16px;margin:12px 0;box-shadow:0 6px 0 #150a3a}
.big{font-size:44px;font-weight:900;color:var(--g)}
.coin{display:inline-grid;place-items:center;width:1em;height:1em;border-radius:50%;background:radial-gradient(#ffe27a,#f5a300);color:#7a4b00;font-size:.6em;font-weight:900;border:2px solid #7a4b00;vertical-align:middle}
.btn{border:0;border-radius:16px;padding:12px 20px;font-weight:900;font-size:16px;color:#06222b;background:linear-gradient(#5ee3ff,#18a8e8);box-shadow:0 5px 0 #0b6d99;cursor:pointer}
.btn:active{transform:translateY(4px);box-shadow:0 1px 0 #0b6d99}
.btn.g{background:linear-gradient(#5dffb5,#14b86f);box-shadow:0 5px 0 #0a7a49}
.btn:disabled{filter:grayscale(1);opacity:.6}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.bar{height:16px;border-radius:9px;background:#0007;overflow:hidden;margin:10px 0}
.bar b{display:block;height:100%;background:linear-gradient(90deg,var(--c),var(--g));transition:width 1s linear}
.miner{font-size:110px;text-align:center;animation:dig 1s infinite;filter:drop-shadow(0 10px 18px #000a)}
@keyframes dig{50%{transform:rotate(-8deg) translateY(6px)}}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center}
.stats b{display:block;font-size:20px}.stats small{opacity:.7;font-size:11px}
nav{position:fixed;left:8px;right:8px;bottom:8px;display:flex;background:#2a1a6ee8;backdrop-filter:blur(8px);border-radius:26px;border:2px solid #ffffff22;padding:6px;padding-bottom:calc(6px + env(safe-area-inset-bottom))}
nav a{flex:1;text-align:center;font-size:11px;font-weight:800;opacity:.55;padding:6px 0;border-radius:18px}
nav a span{display:block;font-size:24px}
nav a.on{opacity:1;background:#ffffff1c}
.pop{position:fixed;left:50%;top:40%;font-size:34px;font-weight:900;color:var(--g);animation:up 1.2s forwards;pointer-events:none;text-shadow:0 3px 0 #000}
@keyframes up{to{transform:translate(-50%,-90px);opacity:0}}
input{width:100%;padding:12px;border-radius:12px;border:0;background:#0006;color:#fff;margin:8px 0}
.hide{display:none}
</style></head><body>
<div class="bg" id="bg"></div>
<main id="app"><h1>⛏ Raj Miner</h1><p>Loading…</p></main>
<nav id="nav"></nav>
<script>
const tg=Telegram.WebApp;tg.ready();tg.expand();tg.setHeaderColor('#150a3a');tg.setBackgroundColor('#0b0620');
const ref=new URLSearchParams(location.search).get('r')||'';
const api=(p,b={})=>fetch('/api/'+p,{method:'POST',headers:{'content-type':'application/json','x-init':tg.initData,'x-ref':ref},body:JSON.stringify(b)}).then(r=>r.json());
for(let i=0;i<60;i++){const s=document.createElement('i');s.style.cssText=`left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*3}s`;bg.append(s)}
const tabs=[['mine','⛏','Mine'],['tasks','📜','Tasks'],['top','🏆','Top'],['wallet','👛','Wallet'],['me','🎖','Profile']];
let me,tab='mine',t0=Date.now();
nav.innerHTML=tabs.map(t=>`<a data-t="${t[0]}"><span>${t[1]}</span>${t[2]}</a>`).join('');
nav.onclick=e=>{const a=e.target.closest('a');if(a){tab=a.dataset.t;tg.HapticFeedback?.selectionChanged();draw()}};
const f=n=>Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const pop=txt=>{const d=document.createElement('div');d.className='pop';d.textContent=txt;document.body.append(d);setTimeout(()=>d.remove(),1200)};
const hm=ms=>{const s=Math.ceil(ms/1000);return `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`};
async function draw(){
 nav.querySelectorAll('a').forEach(a=>a.classList.toggle('on',a.dataset.t==tab));
 if(!me)return;let h='';
 if(tab=='mine'){
  h=`<h1>⛏ Raj Miner</h1><div class="card"><small>BALANCE · LEVEL ${me.lvl}</small><div class="big"><span class="coin">R</span> ${f(me.bal)}</div><small>+${me.rate}/hour</small></div>
  <div class="miner">⛏️👷</div>
  <div class="card"><div class="row"><b>Mining storage</b><span id="pend">0</span></div><div class="bar"><b id="fill"></b></div>
  <button class="btn g" id="claim" style="width:100%">CLAIM</button></div>`;
 }
 if(tab=='tasks'){h='<h1>📜 Tasks</h1>'+me.tasks.map(k=>`<div class="card row"><div><b>${k.title}</b><br><span style="color:var(--g)">+${k.reward} RAJ</span> <small>every ${k.every}h</small></div>
  ${k.wait?`<b>${hm(k.wait)}</b>`:`<button class="btn" data-k="${k.id}" data-u="${k.url||''}">Go</button>`}</div>`).join('')+
  `<div class="card"><b>Invite friends</b><br>+100 RAJ per referral<br><br><button class="btn" id="inv" style="width:100%">Share invite link</button></div>`}
 if(tab=='top'){const t=await fetch('/api/top',{headers:{'x-init':tg.initData}}).then(r=>r.json());h='<h1>🏆 Top Miners</h1>'+t.map((u,i)=>`<div class="card row"><span>${i+1}. ${u.name}</span><b>Lv${u.lvl} · ${f(u.bal)}</b></div>`).join('')}
 if(tab=='wallet')h=`<h1>👛 Vault</h1><div class="card"><small>COMBINED HOLDING · DECIDES YOUR LEVEL</small><div class="big"><span class="coin">R</span> ${f(me.bal)}</div></div>
  <div class="card"><b>TON Wallet</b><input id="ton" placeholder="Your TON address (UQ…)" value="${me.ton||''}"><button class="btn" id="sv" style="width:100%">Save wallet</button><p><small>$RAJ is pre-listing. Withdrawals open after TGE.</small></p></div>`;
 if(tab=='me')h=`<h1>🎖 Profile</h1><div class="card" style="text-align:center"><div style="font-size:70px">👷</div><h2>${me.name}</h2><small>Level ${me.lvl} Miner</small></div>
  <div class="card stats"><div><b>${f(me.bal)}</b><small>RAJ</small></div><div><b>${me.lvl}</b><small>LEVEL</small></div><div><b>${me.refs}</b><small>RECRUITS</small></div><div><b>${me.days}</b><small>DAYS</small></div></div>`;
 app.innerHTML=h;
}
app.onclick=async e=>{
 if(e.target.id=='claim'){const r=await api('claim');if(r.got){me=r;tg.HapticFeedback?.notificationOccurred('success');pop('+'+r.got+' RAJ');t0=Date.now();draw()}}
 if(e.target.dataset.k){if(e.target.dataset.u)tg.openTelegramLink?.(e.target.dataset.u);setTimeout(async()=>{const r=await api('task',{id:e.target.dataset.k});if(r.got){me=r;pop('+'+r.got+' RAJ');draw()}else if(r.need)tg.showAlert('Join first, then tap Go again')},e.target.dataset.u?4000:0)}
 if(e.target.id=='sv'){me=await api('wallet',{ton:ton.value});tg.showAlert('Saved')}
 if(e.target.id=='inv'){const l=`https://t.me/${location.hostname?'':''}RajMinerBot?start=${me.id}`;tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(l)+'&text='+encodeURIComponent('Mine $RAJ with me!'))}
};
setInterval(()=>{if(tab!='mine'||!me)return;const h=Math.min(me.capH,(Date.now()-t0)/36e5+me.pending/me.rate),p=h*me.rate;
 const el=document.getElementById('pend');if(el){el.textContent='+'+f(p);fill.style.width=(h/me.capH*100)+'%'}},1000);
api('me').then(r=>{me=r;draw()});
</script></body></html>
*/}).toString().match(/\/\*([\s\S]*)\*\//)[1];
