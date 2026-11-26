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
const MINERS = [
  { id: 'm1', name: 'Rookie Digger', cost: 50, rate: 0.5 },
  { id: 'm2', name: 'Cave Crawler', cost: 200, rate: 2 },
  { id: 'm3', name: 'Gem Hunter', cost: 800, rate: 8 },
  { id: 'm4', name: 'Mine Boss', cost: 3000, rate: 30 }];
const price = (m, n) => Math.ceil(m.cost * 1.6 ** n);
const lv = u => level(Math.max(u.bal, u.peak || 0));
const rate = u => 2 + lv(u) * 0.5 + MINERS.reduce((a, m) => a + ((u.up || {})[m.id] || 0) * m.rate, 0); // RAJ per hour
let BOTNAME = ''; tg('getMe', {}).then(r => BOTNAME = r.result?.username || '').catch(() => {});
const CAP_H = 8;
const getUser = (id, name = '') => db.users[id] ||= { id, name, bal: 0, since: Date.now(), last: Date.now(), refs: 0, tasks: {}, ton: '', banned: false };

function verify(init) {
  // Reject missing/invalid Telegram WebApp data safely; never pass undefined to HMAC.
  if (!BOT || typeof init !== 'string' || !init.trim()) return null;
  const p = new URLSearchParams(init); const hash = p.get('hash');
  if (!hash || !p.get('auth_date') || !p.get('user')) return null;
  p.delete('hash');
  const str = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT).digest();
  if (crypto.createHmac('sha256', key).update(str).digest('hex') !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  return { ...JSON.parse(p.get('user')), start: p.get('start_param') };
}
const view = u => { u.peak = Math.max(u.peak || 0, u.bal); u.up ||= {};
  return { id: u.id, name: u.name, bal: u.bal, lvl: lv(u), rate: rate(u), refs: u.refs, bot: BOTNAME, mined: u.mined || 0,
  days: Math.ceil((Date.now() - u.since) / 864e5), ton: u.ton,
  pending: Math.min(CAP_H, (Date.now() - u.last) / 36e5) * rate(u), capH: CAP_H,
  gl: Math.max(0, GAME_PLAYS - recent(u).length), gw: recent(u).length >= GAME_PLAYS ? Math.max(0, recent(u)[0] + DAY - Date.now()) : 0,
  miners: MINERS.map(m => ({ ...m, n: u.up[m.id] || 0, price: price(m, u.up[m.id] || 0) })),
  tasks: db.tasks.map(k => ({ ...k, wait: Math.max(0, (u.tasks[k.id] || 0) + k.every * 36e5 - Date.now()) })) }; };
const GAME_PLAYS = 5, DAY = 864e5;
const recent = u => (u.plays = (u.plays || []).filter(t => Date.now() - t < DAY));
const settle = u => { const h = Math.min(CAP_H, (Date.now() - u.last) / 36e5), got = +(h * rate(u)).toFixed(2);
  u.bal = +(u.bal + got).toFixed(2); u.mined = +((u.mined || 0) + got).toFixed(2); u.last = Date.now(); return got; };

const R = {};
R['POST /api/me'] = u => view(u);
R['POST /api/claim'] = u => {
  if ((Date.now() - u.last) / 36e5 < 0.05) return { ...view(u), got: 0 };
  const got = settle(u); save(); return { ...view(u), got };
};
R['POST /api/buy'] = (u, b) => {
  const m = MINERS.find(x => x.id === b.id); if (!m) return { ...view(u), error: 'none' };
  settle(u); u.up ||= {}; const p = price(m, u.up[m.id] || 0);
  if (u.bal < p) { save(); return { ...view(u), error: 'low' }; }
  u.bal = +(u.bal - p).toFixed(2); u.up[m.id] = (u.up[m.id] || 0) + 1; save(); return view(u);
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
R['GET /api/top'] = () => Object.values(db.users).sort((a, b) => b.bal - a.bal).slice(0, 20).map(u => ({ name: u.name, bal: u.bal, lvl: lv(u) }));

R['POST /api/gstart'] = u => {
  if (recent(u).length >= GAME_PLAYS) return { ...view(u), error: 'limit' };
  u.plays.push(Date.now()); u.gs = { sid: crypto.randomBytes(8).toString('hex'), t: Date.now() }; save();
  return { ...view(u), sid: u.gs.sid };
};
R['POST /api/gend'] = (u, b) => {
  const g = u.gs; u.gs = null;
  if (!g || g.sid !== b.sid) return { ...view(u), reward: 0 };
  const sec = (Date.now() - g.t) / 1000;
  if (sec < 27) return { ...view(u), reward: 0 }; // round is 30s; early/fake submits earn nothing
  const score = Math.min(Math.max(0, Math.floor(Number(b.score) || 0)), Math.floor(sec * 5), 100);
  const reward = +(score * 0.1).toFixed(1); u.bal = +(u.bal + reward).toFixed(2); save();
  return { ...view(u), reward, score };
};
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>Raj Miner</title>
<link href="https://fonts.googleapis.com/css2?family=Lilita+One&display=swap" rel="stylesheet">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--g:#ffc83d;--cy:#38d0ff;--gr:#2ee6a6;--dk:#120a33}
*{box-sizing:border-box;margin:0;-webkit-tap-highlight-color:transparent;user-select:none}
body{font-family:'Lilita One',system-ui,sans-serif;letter-spacing:.3px;color:#fff;background:var(--dk);min-height:100vh;overflow-x:hidden}
.bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(70% 45% at 50% 0,#6a3fe0cc,transparent),radial-gradient(60% 40% at 100% 90%,#00c9a733,transparent),linear-gradient(#1c0f4d,#0b0524)}
.bg i{position:absolute;width:4px;height:4px;border-radius:50%;background:#fff;animation:tw 3s infinite}
@keyframes tw{50%{opacity:.1;transform:scale(.5)}}
.t{text-shadow:0 3px 0 #000a,0 0 14px #0007}
#bar{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:linear-gradient(#120a33ee,#120a3300)}
.pill{display:flex;align-items:center;gap:8px;background:#0008;border:2px solid #ffffff2a;border-radius:20px;padding:5px 14px 5px 6px;font-size:20px}
main{padding:calc(64px + env(safe-area-inset-top)) 14px 120px}
h1{font-size:30px;color:var(--g);margin:6px 2px 10px}
.coin{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff2a8,#ffb800 60%,#c77a00);color:#7a4300;font-size:18px;border:2px solid #7a4300;flex:none;text-shadow:0 1px 0 #ffe9a0}
.card{background:linear-gradient(170deg,#5a3cc8,#2f1d7a);border:2px solid #ffffff26;border-radius:24px;padding:16px;margin:12px 0;box-shadow:0 6px 0 #0d0630}
.tile{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;flex:none;box-shadow:0 5px 0 #0003,inset 0 2px 0 #fff5}
.tile svg{width:34px;height:34px}
.c1{background:linear-gradient(#6fe6ff,#17a6e6)}.c2{background:linear-gradient(#ff7ab8,#e02f84)}.c3{background:linear-gradient(#ffd96b,#f39a00)}
.btn{border:0;border-radius:18px;padding:12px 26px;font:inherit;font-size:22px;color:#05222c;background:linear-gradient(#6fe6ff,#17a6e6);box-shadow:0 6px 0 #0a6a99;cursor:pointer;text-shadow:0 1px 0 #fff6}
.btn:active{transform:translateY(5px);box-shadow:0 1px 0 #0a6a99}
.btn.g{background:linear-gradient(#7dffc0,#14b86f);box-shadow:0 6px 0 #0a7a49}
.btn.o{background:linear-gradient(#ffd96b,#f39a00);box-shadow:0 6px 0 #9a5d00}
.btn[disabled]{filter:grayscale(1);opacity:.55}
.row{display:flex;align-items:center;gap:12px}.sp{flex:1}
.sm{font-size:14px;opacity:.75}
.scene{position:relative;height:52vh;min-height:340px;border-radius:28px;overflow:hidden;border:3px solid #ffffff30;box-shadow:0 8px 0 #0a0422,inset 0 0 90px #000b;background:radial-gradient(circle at 50% 45%,#8b63ff 0,transparent 60%),repeating-linear-gradient(35deg,#3f2b80 0 28px,#4d3896 28px 32px,#35256b 32px 62px,#442f8c 62px 66px)}
.ladder{position:absolute;left:50%;top:0;bottom:0;width:92px;margin-left:-46px;background:linear-gradient(90deg,#9a6430 0 12px,transparent 12px 80px,#9a6430 80px);box-shadow:0 0 30px #0008}
.ladder i{position:absolute;inset:0 12px;background:repeating-linear-gradient(#d0924a 0 14px,#0000 14px 56px);animation:climb 1.1s linear infinite}
@keyframes climb{to{background-position:0 56px}}
.mn{position:absolute;left:calc(50% - 80px);bottom:12%;width:160px;animation:bob 1.1s ease-in-out infinite;filter:drop-shadow(0 12px 14px #000a)}
@keyframes bob{50%{transform:translateY(-8px)}}
.sw{transform-origin:96px 92px;animation:sw .9s ease-in-out infinite}
@keyframes sw{0%,100%{transform:rotate(-28deg)}50%{transform:rotate(32deg)}}
#game{position:fixed;inset:0;z-index:50;background:#120a33;touch-action:none}.res{position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:#120a33ee}.res .card{min-width:260px}#fx{position:absolute;inset:0;pointer-events:none}.lamp{animation:lp 1.4s ease-in-out infinite}@keyframes lp{50%{opacity:.5}}
.crys{position:absolute;width:92px;animation:fl 3s ease-in-out infinite}
.crys svg{width:100%;filter:drop-shadow(0 0 14px #ff3b5c99)}
.crys b{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);background:#16103a;border:3px solid #fff;border-radius:16px;padding:0 10px;font-size:18px}
@keyframes fl{50%{transform:translateY(-6px)}}
.pt{position:absolute;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:15px;color:#7a4300;background:radial-gradient(circle at 35% 30%,#fff2a8,#ffb800 60%,#c77a00);border:2px solid #7a4300;animation:rise 1.6s ease-out forwards}
@keyframes rise{to{transform:translate(var(--x),-170px) scale(.6);opacity:0}}
.bar{height:20px;border-radius:12px;background:#0009;overflow:hidden;margin:10px 0;border:2px solid #ffffff22}
.bar b{display:block;height:100%;border-radius:10px;background:linear-gradient(90deg,var(--gr),var(--g));transition:width 1s linear}
nav{position:fixed;left:8px;right:8px;bottom:8px;z-index:6;display:flex;gap:2px;background:linear-gradient(#4a2fb0f0,#2a1a6ef5);backdrop-filter:blur(8px);border-radius:30px;border:2px solid #ffffff2a;padding:7px 6px calc(7px + env(safe-area-inset-bottom))}
nav a{flex:1;text-align:center;font-size:12px;opacity:.7;padding:4px 0;border-radius:20px}
nav a span{display:grid;place-items:center;width:46px;height:46px;margin:0 auto 2px;border-radius:16px;background:#ffffff14}
nav a svg{width:28px;height:28px}
nav a.on{opacity:1}
nav a.on span{background:linear-gradient(#ff8ac0,#e0307f);box-shadow:0 4px 0 #8a1450,0 0 16px #ff4d9a88;transform:translateY(-6px)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);text-align:center;padding:14px 4px}
.stats b{display:block;font-size:26px}.stats div+div{border-left:2px solid #ffffff1f}
.vault{height:150px;border-radius:26px;margin:4px 0;position:relative;overflow:hidden;background:radial-gradient(circle at 50% 100%,#ffd75a 0,#c77a00 25%,transparent 60%),repeating-linear-gradient(90deg,#6a3fb5 0 40px,#58309c 40px 44px);border:3px solid #ffffff30}
.vault:after{content:'';position:absolute;left:50%;bottom:0;width:110px;height:130px;margin-left:-55px;border-radius:55px 55px 0 0;background:radial-gradient(circle at 50% 100%,#fff3a0,#ffb800 55%,#7a4300);border:5px solid #c68642}
.green{background:linear-gradient(150deg,#2ee6a6,#1a8f8f 60%,#2a4aa8);position:relative;overflow:hidden}
.green:after{content:'R';position:absolute;right:-30px;top:-20px;width:190px;height:190px;border-radius:50%;background:#ffffff1c;display:grid;place-items:center;font-size:130px;color:#ffffff30}
.inner{background:#0a2a3a88;border-radius:18px;padding:12px 14px;flex:1}
.avatar{width:130px;height:130px;border-radius:50%;margin:0 auto;display:grid;place-items:center;font-size:60px;background:radial-gradient(circle at 35% 30%,#d6ff6a,#2fd01f);border:6px solid #ffb800;box-shadow:0 0 0 4px #ff5fa2,0 10px 20px #0008;position:relative}
.lvb{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);background:#ffc83d;color:#3a2200;border:4px solid #2a1a6e;border-radius:18px;padding:0 14px;font-size:22px;white-space:nowrap}
.hero{position:relative;border-radius:28px;overflow:hidden;padding:26px 10px 30px;text-align:center;background:linear-gradient(#6a3fe0,#3b2488 60%,#2a1a6e);border:3px solid #ffffff26}
.crew{background:linear-gradient(#ffc83d,#ff9a3d);color:#3a1a00;border-radius:26px;padding:16px;border:3px solid #ffffff55}
input{width:100%;padding:13px;border-radius:14px;border:2px solid #ffffff30;background:#0007;color:#fff;font:inherit;font-size:16px;margin:10px 0}
#promo{position:fixed;inset:0;z-index:20;display:none;place-items:center;text-align:center;background:radial-gradient(circle,#6a3fe0ee,#120a33f5);animation:fi .3s}
#promo h2{font-size:56px;color:var(--g);animation:pp .8s ease-out}#promo h3{font-size:110px;color:var(--g);line-height:1}
@keyframes pp{from{transform:scale(.3);opacity:0}}@keyframes fi{from{opacity:0}}
.toast{position:fixed;left:50%;top:90px;z-index:30;transform:translateX(-50%);background:#0f6b3f;border:3px solid #2ee6a6;border-radius:20px;padding:10px 20px;font-size:22px;animation:fi .2s}
</style></head><body>
<div class="bg" id="bg"></div>
<div id="bar"><div class="pill"><span class="coin">R</span><b id="cv">0</b></div><div class="pill" style="padding-left:14px" id="lv">Lv 1</div></div>
<main id="app"><h1 class="t">Loading…</h1></main>
<div id="promo"><div><div class="hero" style="background:none;border:0"></div></div></div>
<nav id="nav"></nav>
<script>
const tg=Telegram.WebApp;tg.ready();tg.expand();try{tg.disableVerticalSwipes();tg.setHeaderColor('#1c0f4d');tg.setBackgroundColor('#0b0524')}catch(e){}
const ref=new URLSearchParams(location.search).get('r')||'';
const api=(p,b={})=>fetch('/api/'+p,{method:'POST',headers:{'content-type':'application/json','x-init':tg.initData,'x-ref':ref},body:JSON.stringify(b)}).then(r=>r.json());
for(let i=0;i<70;i++){const s=document.createElement('i');s.style.cssText=`left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*3}s`;bg.append(s)}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f=n=>Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const hm=ms=>{const s=Math.ceil(ms/1000);return `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`};
const ranks=['Rookie Digger','Cave Crawler','Gem Hunter','Gold Seeker','Mine Foreman','Mine Boss','Crystal Lord','Raj Legend'],rom=['I','II','III','IV','V'];
const rank=l=>ranks[Math.min(7,Math.floor((l-1)/5))]+' '+rom[(l-1)%5];
const I={
tasks:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="3" fill="#f6e7bd" stroke="#6b4a1e" stroke-width="1.6"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="#1fa65a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
arcade:'<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="11" rx="5.5" fill="#6d7bd1" stroke="#2c2f6b" stroke-width="1.6"/><path d="M7 10v5M4.5 12.5h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="11.5" r="1.4" fill="#ffd34d"/><circle cx="18.6" cy="14" r="1.4" fill="#ff6b6b"/></svg>',
miners:'<svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 0116 0z" fill="#ffc21a" stroke="#8a5a00" stroke-width="1.6"/><rect x="2.5" y="16" width="19" height="3.2" rx="1.6" fill="#f5a300" stroke="#8a5a00" stroke-width="1.4"/><circle cx="12" cy="9" r="2.2" fill="#fff6c2"/></svg>',
mine:'<svg viewBox="0 0 24 24"><path d="M5 19L16 8" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round"/><path d="M9 4q8-2 12 6-4-3-8-2z" fill="#b9c2cc" stroke="#5c6672" stroke-width="1.4"/><path d="M12 20l3-4 4 1 2 3z" fill="#ffc83d" stroke="#8a5a00" stroke-width="1.2"/></svg>',
wallet:'<svg viewBox="0 0 24 24"><path d="M9 5h6l-1.5 3h-3z" fill="#8a5a2b"/><path d="M8 8h8c4 3 5 9 2 12H6c-3-3-2-9 2-12z" fill="#a8652d" stroke="#4a2a10" stroke-width="1.5"/><circle cx="12" cy="14" r="3" fill="#ffc83d" stroke="#8a5a00"/></svg>',
me:'<svg viewBox="0 0 24 24"><path d="M7 2l5 8 5-8" fill="#d93a3a" stroke="#7a1c1c" stroke-width="1.4"/><circle cx="12" cy="15" r="6" fill="#3d7bff" stroke="#1b3d99" stroke-width="1.6"/><path d="M12 11.5l1.1 2.3 2.5.3-1.9 1.7.5 2.5-2.2-1.2-2.2 1.2.5-2.5-1.9-1.7 2.5-.3z" fill="#ffd34d"/></svg>'};
const tabs=[['tasks','Tasks'],['arcade','Arcade'],['miners','Miners'],['mine','Mine'],['wallet','Wallet'],['me','Profile']];
nav.innerHTML=tabs.map(t=>`<a data-t="${t[0]}"><span>${I[t[0]]}</span>${t[1]}</a>`).join('');
const miner=()=>`<svg viewBox="0 0 140 170"><ellipse cx="68" cy="164" rx="34" ry="6" fill="#0007"/>
<rect x="40" y="140" width="22" height="20" rx="8" fill="#6b3a1a"/><rect x="74" y="140" width="22" height="20" rx="8" fill="#6b3a1a"/>
<path d="M40 100h56v44H78v-14H58v14H40z" fill="#2f6fc4"/><path d="M36 70q32-14 64 0l6 40H30z" fill="#d93a3a"/>
<path d="M44 76h48v42H44z" fill="#2f6fc4"/><circle cx="52" cy="90" r="3.5" fill="#ffd34d"/><circle cx="84" cy="90" r="3.5" fill="#ffd34d"/>
<circle cx="68" cy="48" r="24" fill="#f2b98a"/><path d="M45 50q4 36 23 36t23-36q-10 14-23 14t-23-14z" fill="#6b3a1a"/>
<path d="M54 57q14-9 28 0-6 9-14 5-8 4-14-5z" fill="#4a2410"/><circle cx="68" cy="54" r="5" fill="#e59a6c"/>
<circle cx="59" cy="46" r="3" fill="#222"/><circle cx="77" cy="46" r="3" fill="#222"/>
<path d="M42 40q0-30 26-30t26 30z" fill="#ffc21a"/><rect x="37" y="38" width="62" height="9" rx="4" fill="#f5a300"/>
<circle class="lamp" cx="68" cy="20" r="8" fill="#fff6c2" stroke="#e0b800" stroke-width="2"/>
<path d="M92 84q14-4 18 10l-8 6q-4-8-14-6z" fill="#d93a3a"/>
<g class="sw"><rect x="93" y="30" width="7" height="92" rx="3" fill="#8a5a2b"/><path d="M70 30q26-20 56 2-22-3-32 9z" fill="#c4ccd6" stroke="#6c7783" stroke-width="2.5"/><circle cx="97" cy="94" r="8" fill="#f2b98a"/></g></svg>`;
const gem=()=>`<svg viewBox="0 0 80 74"><ellipse cx="40" cy="66" rx="38" ry="8" fill="#5a5a70"/><path d="M10 62L4 40 20 36 30 8 44 30 62 20 76 44 66 62z" fill="#c2182b"/><path d="M30 8l14 22-14 8-10-2zM44 30l18-10 14 24-10 18-12-12z" fill="#ff4d5e"/><path d="M30 8l4 20" stroke="#ffb3bb" stroke-width="3"/></svg>`;
let me,tab='mine',t0=Date.now(),lastLvl=0,top=[];
nav.onclick=e=>{const a=e.target.closest('a');if(a){tab=a.dataset.t;tg.HapticFeedback?.selectionChanged();draw()}};
const toast=t=>{const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.append(d);setTimeout(()=>d.remove(),1800)};
function promo(l){const p=document.getElementById('promo');p.innerHTML=`<div><h2 class="t">PROMOTED!</h2><h3 class="t">Lv ${l}</h3><div style="width:150px;margin:10px auto">${miner()}</div><div class="sm">${rank(l)}</div></div>`;p.style.display='grid';tg.HapticFeedback?.notificationOccurred('success');setTimeout(()=>p.style.display='none',2800);p.onclick=()=>p.style.display='none'}
function set(r){if(!r||r.error||r.lvl===undefined)return;if(lastLvl&&r.lvl>lastLvl)promo(r.lvl);lastLvl=r.lvl;me=r;t0=Date.now();cv.textContent=f(me.bal);lv.textContent='Lv '+me.lvl}
async function draw(){
 nav.querySelectorAll('a').forEach(a=>a.classList.toggle('on',a.dataset.t==tab));
 if(!me)return;let h='';
 if(tab=='mine')h=`<div class="scene"><div class="ladder"><i></i></div>
  <div class="crys" style="left:6%;bottom:20%">${gem()}<b>${me.lvl}</b></div><div class="crys" style="right:6%;top:12%;animation-delay:-1.5s">${gem()}<b>${me.lvl+1}</b></div>
  <div class="mn">${miner()}</div><div id="fx"></div></div>
  <div class="card"><div class="row"><b style="font-size:22px">Mining storage</b><span class="sp"></span><b id="pend" style="color:var(--g);font-size:22px">+0</b></div>
  <div class="bar"><b id="fill"></b></div><div class="row sm"><span>+${f(me.rate)} RAJ / hour</span><span class="sp"></span><span>${me.capH}h capacity</span></div><br>
  <button class="btn g" id="claim" style="width:100%">CLAIM</button></div>`;
 if(tab=='tasks')h=`<h1 class="t">Tasks</h1>`+me.tasks.map((k,i)=>`<div class="card row"><div class="tile c${i%2?2:1}">${I.tasks}</div><div class="sp"><div style="font-size:22px">${esc(k.title)}</div><div style="color:var(--g);font-size:20px">+${k.reward} RAJ <span class="sm">· every ${k.every}h</span></div></div>
  ${k.wait?`<b style="font-size:20px">${hm(k.wait)}</b>`:`<button class="btn" data-k="${esc(k.id)}" data-u="${esc(k.url||'')}">Go</button>`}</div>`).join('')+
  `<div class="crew"><div class="row"><div class="tile c3">${I.miners}</div><div style="font-size:28px">Build your crew!</div></div><div style="font-size:20px;margin:10px 0">+100 RAJ for each qualified referral</div><button class="btn o" id="inv" style="width:100%">Invite friends</button></div>`;
 if(tab=='miners')h=`<h1 class="t">Miners</h1><div class="sm" style="margin:-6px 2px 8px">Hire miners to raise your RAJ per hour</div>`+me.miners.map(m=>`<div class="card row"><div class="tile c3">${I.miners}</div><div class="sp"><div style="font-size:22px">${esc(m.name)}</div><div style="color:var(--gr);font-size:18px">+${m.rate} RAJ/h each</div><div class="sm">Owned: ${m.n}</div></div>
  <button class="btn ${me.bal>=m.price?'o':''}" data-b="${m.id}" ${me.bal>=m.price?'':'disabled'}><span class="coin" style="width:22px;height:22px;font-size:13px;vertical-align:middle">R</span> ${f(m.price)}</button></div>`).join('');
 if(tab=='arcade'){if(!top.length)top=await fetch('/api/top',{headers:{'x-init':tg.initData}}).then(r=>r.json()).catch(()=>[]);
  h=`<h1 class="t">Arcade</h1><div class="card row"><div class="tile c2">${I.arcade}</div><div class="sp"><div style="font-size:24px">Gem Rush</div><div class="sm">Tap gems, dodge bombs · up to 10 RAJ</div><div class="sm">Plays left: ${me.gl}/5${me.gl?'':' · next in '+hm(me.gw)}</div></div><button class="btn o" id="play" ${me.gl?'':'disabled'}>Play</button></div><h1 class="t" style="font-size:24px">Top Miners</h1>`+
  top.map((u,i)=>`<div class="card row" style="padding:10px 14px"><b style="font-size:24px;width:34px;color:var(--g)">${i+1}</b><span class="sp" style="font-size:20px">${esc(u.name)}</span><span class="sm">Lv ${u.lvl}</span><b style="font-size:20px">${f(u.bal)}</b></div>`).join('')}
 if(tab=='wallet')h=`<h1 class="t">Vault</h1><div class="vault"></div>
  <div class="card green"><div class="sm" style="opacity:.9">COMBINED HOLDING · DECIDES YOUR LEVEL</div><div class="row" style="margin:6px 0"><span class="coin" style="width:46px;height:46px;font-size:28px">R</span><b style="font-size:58px" class="t">${f(me.bal)}</b></div><div style="font-size:20px;margin-bottom:12px">Level ${me.lvl}</div>
  <div class="row"><div class="inner"><div style="font-size:18px">In-app</div><b style="font-size:30px">${f(me.bal)}</b></div><div class="inner"><div style="font-size:18px">On-chain</div><b style="font-size:30px">0</b></div></div></div>
  <h1 class="t" style="font-size:26px">TON Wallet</h1><div class="card"><input id="ton" placeholder="Your TON address (UQ…)" value="${esc(me.ton)}"><button class="btn" id="sv" style="width:100%">${me.ton?'Update wallet':'Save wallet'}</button><p class="sm" style="margin-top:10px">$RAJ is pre-listing. On-chain withdrawals open after TGE.</p></div>`;
 if(tab=='me'){const u=tg.initDataUnsafe?.user||{};h=`<div class="hero"><div class="avatar">${esc((me.name||'R')[0].toUpperCase())}<div class="lvb">Lv ${me.lvl}</div></div><div class="t" style="font-size:34px;margin-top:26px">${esc(me.name)}</div>
  <div style="color:#7ad7ff;font-size:20px">${u.username?'@'+esc(u.username):''}</div><div style="color:var(--g);font-size:22px;margin-top:4px">${rank(me.lvl)}</div></div>
  <div class="card stats"><div><b>${f(me.mined)}</b><span class="sm">MINED</span></div><div><b>${me.lvl}</b><span class="sm">PEAK LV</span></div><div><b>${me.refs}</b><span class="sm">RECRUITS</span></div><div><b>${me.days}</b><span class="sm">DAYS</span></div></div>
  <div class="crew"><div class="row"><div class="tile c3">${I.miners}</div><div style="font-size:28px">Build your crew!</div></div><div style="font-size:20px;margin:10px 0">+100 RAJ for each qualified referral</div><button class="btn o" id="inv" style="width:100%">Invite friends</button></div>`}
 app.innerHTML=h;
}
app.onclick=async e=>{const el=e.target.closest('button');if(!el)return;
 if(el.id=='claim'){const r=await api('claim');if(r.got){set(r);toast('+'+r.got+' RAJ — job done!');draw()}else toast('Nothing to claim yet')}
 if(el.dataset.k){const go=async()=>{const r=await api('task',{id:el.dataset.k});if(r.got){set(r);toast('+'+r.got+' RAJ');draw()}else if(r.need)tg.showAlert('Join first, then tap Go again')};
  if(el.dataset.u){tg.openTelegramLink?tg.openTelegramLink(el.dataset.u):window.open(el.dataset.u);setTimeout(go,4000)}else go()}
 if(el.dataset.b){const r=await api('buy',{id:el.dataset.b});set(r);if(r.error==='low')toast('Not enough RAJ');else toast('Miner hired!');draw()}
 if(el.id=='sv'){const r=await api('wallet',{ton:document.getElementById('ton').value});set(r);toast('Wallet saved')}
 if(el.id=='play')playGame();
 if(el.id=='inv'){const l=`https://t.me/${me.bot}?start=${me.id}`;tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(l)+'&text='+encodeURIComponent('Mine $RAJ with me!'))}
};
setInterval(()=>{if(!me)return;const mx=me.capH*me.rate,p=Math.min(mx,me.pending+(Date.now()-t0)/36e5*me.rate);
 const el=document.getElementById('pend');if(el){el.textContent='+'+f(p);fill.style.width=(p/mx*100)+'%'}},1000);
setInterval(()=>{const fx=document.getElementById('fx');if(!fx||tab!='mine')return;const d=document.createElement('div');d.className='pt';d.textContent='R';d.style.cssText=`left:${40+Math.random()*20}%;bottom:30%;--x:${(Math.random()-.5)*120}px`;fx.append(d);setTimeout(()=>d.remove(),1600)},700);

function playGame(){api('gstart').then(r=>{if(r.error){toast('No plays left — come back later');return}set(r);runGame(r.sid)})}
function runGame(sid){
 const o=document.createElement('div');o.id='game';o.innerHTML='<canvas></canvas>';document.body.append(o);
 const cvs=o.firstChild,ctx=cvs.getContext('2d'),dpr=window.devicePixelRatio||1,W=innerWidth,H=innerHeight;
 cvs.width=W*dpr;cvs.height=H*dpr;cvs.style.cssText='width:100%;height:100%;display:block';ctx.scale(dpr,dpr);
 const cols=[['#ff6b8a','#c2183b'],['#6fe6ff','#1783c9'],['#7dffc0','#12a563']];
 let items=[],pops=[],score=0,left=30,last=performance.now(),spawn=0.3,done=false,raf,flash=0;
 const add=()=>{const r=Math.random(),t=r<.2?'bomb':r<.3?'gold':'gem';items.push({x:34+Math.random()*(W-68),y:-30,vy:(170+Math.random()*120)*(1+(30-left)/60),t,c:cols[Math.random()*3|0],s:28,rot:Math.random()*6})};
 const shape=i=>{ctx.save();ctx.translate(i.x,i.y);const s=i.s;
  if(i.t=='gem'){ctx.rotate(Math.sin(i.rot*2)*.25);const g=ctx.createLinearGradient(0,-s,0,s);g.addColorStop(0,i.c[0]);g.addColorStop(1,i.c[1]);ctx.fillStyle=g;ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*.85,-s*.2);ctx.lineTo(0,s);ctx.lineTo(-s*.85,-s*.2);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#fff7';ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(-s*.4,-s*.2);ctx.lineTo(0,-s*.1);ctx.fill()}
  else if(i.t=='gold'){const g=ctx.createRadialGradient(-6,-6,2,0,0,s);g.addColorStop(0,'#fff2a8');g.addColorStop(.6,'#ffb800');g.addColorStop(1,'#c77a00');ctx.fillStyle=g;ctx.strokeStyle='#7a4300';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,s,0,7);ctx.fill();ctx.stroke();ctx.fillStyle='#7a4300';ctx.font="30px 'Lilita One',sans-serif";ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('R',0,2)}
  else{ctx.fillStyle='#1d1a2b';ctx.strokeStyle='#ff4d5e';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,4,s*.9,0,7);ctx.fill();ctx.stroke();ctx.strokeStyle='#c68642';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,-s*.8);ctx.quadraticCurveTo(10,-s*1.2,16,-s*1.1);ctx.stroke();ctx.fillStyle=Math.sin(i.rot*14)>0?'#ffd34d':'#ff6b2c';ctx.beginPath();ctx.arc(17,-s*1.1,6,0,7);ctx.fill();ctx.fillStyle='#ff4d5e';ctx.font="26px 'Lilita One',sans-serif";ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('X',0,6)}
  ctx.restore()};
 const hit=e=>{if(done)return;const x=e.clientX,y=e.clientY;let b=-1,bd=1e9;items.forEach((i,k)=>{const d=Math.hypot(i.x-x,i.y-y);if(d<i.s+22&&d<bd){bd=d;b=k}});if(b<0)return;const i=items.splice(b,1)[0];
  const v=i.t=='gem'?1:i.t=='gold'?3:-2;score=Math.max(0,score+v);pops.push({x:i.x,y:i.y,t:(v>0?'+':'')+v,life:.8,c:v>0?'#ffd34d':'#ff4d5e'});
  if(v<0){flash=.4;tg.HapticFeedback?.notificationOccurred('error')}else tg.HapticFeedback?.impactOccurred('light')};
 cvs.addEventListener('pointerdown',hit);
 const x=document.createElement('button');x.textContent='✕';x.style.cssText='position:absolute;right:14px;top:calc(12px + env(safe-area-inset-top));width:44px;height:44px;border-radius:50%;border:2px solid #fff4;background:#0008;color:#fff;font-size:22px;z-index:2';x.onclick=()=>{done=true;cancelAnimationFrame(raf);o.remove();draw()};o.append(x);
 function tick(now){const dt=Math.min(.05,(now-last)/1000);last=now;left-=dt;spawn-=dt;flash=Math.max(0,flash-dt);
  if(spawn<=0){add();spawn=.6-.25*((30-left)/30)}
  items.forEach(i=>{i.y+=i.vy*dt;i.rot+=dt});items=items.filter(i=>i.y<H+50);pops.forEach(p=>{p.life-=dt;p.y-=60*dt});pops=pops.filter(p=>p.life>0);
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#3b2488');g.addColorStop(1,'#120a33');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#ffffff10';for(let k=0;k<8;k++)ctx.fillRect((k*97)%W,0,3,H);
  items.forEach(shape);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font="30px 'Lilita One',sans-serif";pops.forEach(p=>{ctx.globalAlpha=Math.min(1,p.life*2);ctx.fillStyle=p.c;ctx.fillText(p.t,p.x,p.y)});ctx.globalAlpha=1;
  if(flash>0){ctx.fillStyle=`rgba(255,40,70,${flash})`;ctx.fillRect(0,0,W,H)}
  ctx.fillStyle='#fff';ctx.font="44px 'Lilita One',sans-serif";ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('Score '+score,16,calc());
  ctx.fillStyle='#0008';ctx.fillRect(16,calc()+56,W-32,14);ctx.fillStyle=left>8?'#2ee6a6':'#ff4d5e';ctx.fillRect(16,calc()+56,(W-32)*Math.max(0,left)/30,14);
  if(left<=0)return finish();raf=requestAnimationFrame(tick)}
 const calc=()=>70;
 async function finish(){done=true;const r=await api('gend',{sid,score});set(r);
  const res=document.createElement('div');res.className='res';res.innerHTML=`<div><h2 class="t" style="font-size:44px;color:var(--g)">Time's up!</h2><div class="card"><div style="font-size:24px">Score</div><b style="font-size:60px">${score}</b><div style="font-size:30px;color:var(--gr)">${r.reward?'+'+r.reward+' RAJ':'No reward'}</div><div class="sm">Plays left: ${me.gl}/5</div></div><button class="btn o" id="again" ${me.gl?'':'disabled'}>Play again</button> <button class="btn" id="cls">Close</button></div>`;o.append(res);
  res.querySelector('#cls').onclick=()=>{o.remove();draw()};res.querySelector('#again').onclick=()=>{o.remove();playGame()}}
 raf=requestAnimationFrame(tick)}
api('me').then(r=>{if(r?.error==='auth'){app.innerHTML='<div class="card" style="text-align:center;margin-top:25vh"><h1 class="t">Open in Telegram</h1><p class="sm" style="margin:12px 0">Please open Raj Miner from @Raj_company_bot using the Open Raj Miner button. Direct browser access cannot authenticate your Telegram account.</p><button class="btn" onclick="location.href=\'https://t.me/Raj_company_bot\'">Open Telegram Bot</button></div>';return}if(!r||r.error){app.innerHTML='<div class="card" style="text-align:center;margin-top:25vh"><h1>Connection error</h1><p class="sm">Please close and reopen the Mini App.</p><button class="btn" onclick="location.reload()">Retry</button></div>';return}set(r);draw()}).catch(()=>{app.innerHTML='<div class="card" style="text-align:center;margin-top:25vh"><h1>Network error</h1><p class="sm">Please check your connection and retry.</p><button class="btn" onclick="location.reload()">Retry</button></div>'});
</script></body></html>
*/}).toString().match(/\/\*([\s\S]*)\*\//)[1];
