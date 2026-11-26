import express from "express";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const users = new Map();
const BOT_USERNAME = process.env.BOT_USERNAME || "YourRajMinerBot";
const BASE_REWARD = 5;
const REFERRAL_BONUS = 100;
const TASK_REWARD = 25;
const CLAIM_INTERVAL_MS = 3 * 60 * 60 * 1000;
const BOOST_COST = 250;
const LEVEL_COST = 500;

function getUser(telegramId, username, firstName, referrerId) {
  if (!users.has(telegramId)) {
    users.set(telegramId, {
      telegramId, username: username || "", firstName: firstName || "",
      balance: 0, level: 1, miningPower: 1, boosts: 0, lastClaimAt: 0,
      referrerId: referrerId || null, referrals: 0, completedTasks: []
    });
    if (referrerId && users.has(referrerId)) {
      const referrer = users.get(referrerId);
      referrer.balance += REFERRAL_BONUS;
      referrer.referrals += 1;
    }
  }
  return users.get(telegramId);
}

app.get("/api/me", (req, res) => {
  const telegramId = Number(req.query.telegram_id);
  const referrerId = Number(req.query.ref) || null;
  if (!telegramId) return res.status(400).json({ error: "telegram_id required" });
  const user = getUser(telegramId, req.query.username, req.query.first_name, referrerId);
  const nextClaimAt = user.lastClaimAt ? user.lastClaimAt + CLAIM_INTERVAL_MS : 0;
  res.json({
    ...user, nextClaimAt,
    referralLink: `https://t.me/${BOT_USERNAME}/app?startapp=ref_${user.telegramId}`,
    tasks: [
      { id: "join_channel", title: "Join Raj Miner Channel", reward: TASK_REWARD },
      { id: "share_app", title: "Share Raj Miner", reward: TASK_REWARD },
      { id: "daily_login", title: "Daily Check-in", reward: TASK_REWARD }
    ]
  });
});

app.post("/api/claim", (req, res) => {
  const telegramId = Number(req.body.telegram_id);
  if (!telegramId || !users.has(telegramId)) return res.status(400).json({ error: "User not found" });
  const user = users.get(telegramId);
  const now = Date.now();
  if (user.lastClaimAt && now - user.lastClaimAt < CLAIM_INTERVAL_MS)
    return res.status(429).json({ error: "Mining is not ready", nextClaimAt: user.lastClaimAt + CLAIM_INTERVAL_MS });
  const reward = BASE_REWARD * user.miningPower * (1 + user.boosts * 0.25);
  user.balance += reward;
  user.lastClaimAt = now;
  res.json({ claimed: reward, balance: user.balance, nextClaimAt: now + CLAIM_INTERVAL_MS });
});

app.post("/api/task", (req, res) => {
  const telegramId = Number(req.body.telegram_id);
  const taskId = req.body.task_id;
  if (!telegramId || !users.has(telegramId)) return res.status(400).json({ error: "User not found" });
  const user = users.get(telegramId);
  if (user.completedTasks.includes(taskId)) return res.status(400).json({ error: "Task already completed" });
  user.completedTasks.push(taskId);
  user.balance += TASK_REWARD;
  res.json({ balance: user.balance, completedTasks: user.completedTasks });
});

app.post("/api/boost", (req, res) => {
  const telegramId = Number(req.body.telegram_id);
  if (!telegramId || !users.has(telegramId)) return res.status(400).json({ error: "User not found" });
  const user = users.get(telegramId);
  if (user.balance < BOOST_COST) return res.status(400).json({ error: "Not enough RMC" });
  user.balance -= BOOST_COST; user.boosts += 1; user.miningPower += 0.25;
  res.json({ balance: user.balance, miningPower: user.miningPower, boosts: user.boosts });
});

app.post("/api/level-up", (req, res) => {
  const telegramId = Number(req.body.telegram_id);
  if (!telegramId || !users.has(telegramId)) return res.status(400).json({ error: "User not found" });
  const user = users.get(telegramId);
  if (user.balance < LEVEL_COST) return res.status(400).json({ error: "Not enough RMC" });
  user.balance -= LEVEL_COST; user.level += 1; user.miningPower += 0.5;
  res.json({ balance: user.balance, level: user.level, miningPower: user.miningPower });
});

app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raj Miner</title><script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#070b16;color:#fff;min-height:100vh}
.app{max-width:430px;margin:0 auto;padding:16px 16px 90px}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:10px}.logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-weight:900;background:linear-gradient(135deg,#22d3ee,#6366f1)}
.brand h1{font-size:17px}.brand p{font-size:11px;color:#8b95ad}
.level{background:#131a2c;border:1px solid #26304d;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:700}
.hero{text-align:center;background:radial-gradient(circle at 50% 25%,#1d2a4d,#0b1120);border:1px solid #26304d;border-radius:26px;padding:26px 18px;margin-bottom:16px}
.coin{width:132px;height:132px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;font-size:54px;background:radial-gradient(circle at 30% 25%,#7dd3fc,#2563eb);box-shadow:0 0 42px rgba(56,189,248,.35)}
.balance{font-size:38px;font-weight:800}.unit{color:#8b95ad;font-size:13px}.power{margin-top:10px;color:#8b95ad;font-size:12px}
.tap{width:100%;border:0;border-radius:18px;padding:18px;font-size:17px;font-weight:800;color:#04121f;background:linear-gradient(135deg,#22d3ee,#3b82f6);cursor:pointer}
.status{margin-top:10px;color:#8b95ad;font-size:12px;text-align:center}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.tile{background:#111827;border:1px solid #26304d;border-radius:18px;padding:16px;text-align:center}
.tile b{display:block;font-size:20px;margin-bottom:4px}.tile span{color:#8b95ad;font-size:11px}
.section{background:#111827;border:1px solid #26304d;border-radius:20px;padding:16px;margin-bottom:14px}
.section h2{font-size:15px;margin-bottom:12px}
.task{display:flex;justify-content:space-between;align-items:center;background:#0d1424;border:1px solid #22304f;border-radius:14px;padding:12px;margin-bottom:10px}
.task small{color:#8b95ad;display:block}.task button{border:0;background:#22d3ee;color:#04121f;font-weight:800;padding:9px 12px;border-radius:10px;cursor:pointer}
.nav{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;gap:8px;padding:12px;background:rgba(7,11,22,.94);border-top:1px solid #1e2740}
.nav button{flex:1;max-width:96px;border:0;background:#141c2f;color:#c7d2fe;padding:11px;border-radius:14px;font-weight:700;font-size:13px;cursor:pointer}
.nav button.active{background:#22d3ee;color:#04121f}button:disabled{opacity:.5;cursor:not-allowed}

/* Raj Miner premium dashboard refresh */
:root{color-scheme:dark}
body{background:radial-gradient(ellipse at 50% -15%,#174c3a 0,#091510 38%,#060b0a 100%);color:#f4fff8}
.app{max-width:460px;padding:18px 16px 104px}
.topbar{padding:7px 2px 18px;margin-bottom:12px}
.logo{width:46px;height:46px;border-radius:15px;background:linear-gradient(145deg,#d7ff91,#3dbb77);color:#082315;box-shadow:0 7px 24px #39d17a44;font-size:22px}
.brand h1{font-size:18px;letter-spacing:.2px}.brand p{color:#9db9a8}
.level{background:#13271d;border:1px solid #345c42;color:#d7ff91;padding:9px 14px}
.hero{position:relative;overflow:hidden;text-align:center;background:linear-gradient(155deg,rgba(28,72,49,.94),rgba(10,25,19,.98));border:1px solid #315c42;border-radius:30px;padding:27px 18px 22px;margin-bottom:14px;box-shadow:0 18px 48px #0007,inset 0 1px #ffffff12}
.hero:before{content:"";position:absolute;width:250px;height:250px;border-radius:50%;background:#72e69b12;filter:blur(28px);top:-155px;left:calc(50% - 125px)}
.coin{position:relative;width:142px;height:142px;margin:0 auto 18px;border:7px solid #caff9b;background:radial-gradient(circle at 30% 25%,#efffc2,#83d75d 38%,#218c55 75%,#0c4a31);box-shadow:0 0 0 7px #9be87b18,0 0 48px #66dc8b55,inset 0 5px 16px #fff8;color:#0a3a25;font-size:58px}
.balance{font-size:clamp(34px,10vw,44px);font-weight:900;letter-spacing:-1.5px;color:#f2ffe9}
.unit{color:#b8d9bd;font-size:13px;font-weight:700}
.power{margin:10px 0 18px;color:#b5d2bc;font-size:12px}
.tap{border-radius:17px;padding:17px;font-size:16px;color:#092516;background:linear-gradient(100deg,#d8ff91,#8ce58b 55%,#4fc982);box-shadow:0 8px 25px #53d88735;transition:transform .15s}
.tap:active{transform:scale(.98)}
.status{margin-top:12px;color:#b7d8bf;font-weight:600}
.grid{gap:11px;margin-bottom:14px}
.tile{background:linear-gradient(145deg,#152a20,#0d1a14);border:1px solid #294b36;border-radius:19px;padding:17px 12px;box-shadow:inset 0 1px #ffffff08}
.tile b{font-size:23px;color:#e7ffdf}.tile span{color:#a7c5ad;font-size:11px;letter-spacing:.3px}
.section{background:linear-gradient(145deg,#14271d,#0c1711);border:1px solid #294b36;border-radius:22px;padding:16px;margin-bottom:13px;box-shadow:0 10px 26px #0003}
.section h2{font-size:15px;letter-spacing:.2px;color:#eaffdf;margin-bottom:13px}
.task{background:#0d1b13;border:1px solid #284733;border-radius:15px;padding:13px;margin-bottom:9px}
.task b{color:#edffea;font-size:13px}.task small{color:#9bb8a2;font-size:11px}
.task button{background:linear-gradient(100deg,#d8ff91,#75d98c);color:#092516;border-radius:11px;padding:10px 13px}
.nav{background:rgba(5,15,10,.96);border-top:1px solid #294b36;backdrop-filter:blur(18px);padding:11px 10px calc(11px + env(safe-area-inset-bottom))}
.nav button{background:#14271d;color:#b9d8c0;border:1px solid #294b36;border-radius:13px}
.nav button.active{background:linear-gradient(100deg,#d8ff91,#75d98c);color:#092516;border-color:transparent}
button:disabled{opacity:.45}
@media(max-width:360px){.coin{width:120px;height:120px}.balance{font-size:32px}.app{padding-left:12px;padding-right:12px}}
</style></head><body>
<main class="app">
<div class="topbar"><div class="brand"><div class="logo">R</div><div><h1>Raj Miner</h1><p>Mine • Upgrade • Invite</p></div></div><div class="level" id="level">Level 1</div></div>
<div class="hero"><div class="coin">⛏️</div><div class="balance"><span id="balance">0</span> <span class="unit">RMC</span></div><div class="power">Mining power: <span id="power">1</span>x • Boosts: <span id="boosts">0</span></div><button class="tap" id="mineButton">Start Mining</button><div class="status" id="status">Loading…</div></div>
<div class="grid"><div class="tile"><b id="referrals">0</b><span>Referrals</span></div><div class="tile"><b id="nextReward">5</b><span>RMC per claim</span></div></div>
<div class="section"><h2>Boost</h2><div class="task"><div><b>Increase mining power</b><small>Cost: 250 RMC • +25% mining power</small></div><button id="boostButton">Boost</button></div><div class="task"><div><b>Level up</b><small>Cost: 500 RMC • +0.5x mining power</small></div><button id="levelButton">Level Up</button></div></div>
<div class="section"><h2>Tasks</h2><div id="tasks"></div></div>
<div class="section"><h2>Invite & Earn</h2><p style="font-size:12px;color:#8b95ad;margin-bottom:10px">Invite friends and receive 100 RMC for every new user.</p><button class="tap" id="inviteButton">Copy Invite Link</button></div>
</main>
<div class="nav"><button class="active">Mine</button><button>Tasks</button><button>Friends</button><button>Wallet</button></div>
<script>
const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const params=new URLSearchParams(location.search);
const telegramId=tg?.initDataUnsafe?.user?.id||params.get("telegram_id")||123456789;
const username=tg?.initDataUnsafe?.user?.username||"";
const firstName=tg?.initDataUnsafe?.user?.first_name||"";
const referral=params.get("ref")||"";
const $=id=>document.getElementById(id);
async function load(){const r=await fetch(\`/api/me?telegram_id=\${telegramId}&username=\${username}&first_name=\${encodeURIComponent(firstName)}&ref=\${referral}\`);const u=await r.json();
$("balance").textContent=Math.floor(u.balance).toLocaleString();$("level").textContent="Level "+u.level;$("power").textContent=u.miningPower;$("boosts").textContent=u.boosts;$("referrals").textContent=u.referrals;$("nextReward").textContent=Math.floor(5*u.miningPower*(1+u.boosts*.25));renderTasks(u);updateStatus(u.nextClaimAt);
$("inviteButton").onclick=()=>{navigator.clipboard.writeText(u.referralLink);alert("Invite link copied!")};$("boostButton").onclick=()=>upgrade("/api/boost");$("levelButton").onclick=()=>upgrade("/api/level-up");}
function renderTasks(u){$("tasks").innerHTML="";u.tasks.forEach(t=>{const done=u.completedTasks.includes(t.id);const div=document.createElement("div");div.className="task";div.innerHTML=\`<div><b>\${t.title}</b><small>Reward: \${t.reward} RMC</small></div>\`;const b=document.createElement("button");b.textContent=done?"Done":"Start";b.disabled=done;b.onclick=async()=>{const r=await fetch("/api/task",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegram_id:telegramId,task_id:t.id})});const d=await r.json();if(r.ok){$("balance").textContent=Math.floor(d.balance).toLocaleString();load()}else alert(d.error)};div.appendChild(b);$("tasks").appendChild(div);});}
function updateStatus(next){if(!next){$("status").textContent="Mining is ready";$("mineButton").disabled=false;return}const left=next-Date.now();if(left<=0){$("status").textContent="Mining is ready";$("mineButton").disabled=false;return}$("mineButton").disabled=true;const h=Math.floor(left/3600000),m=Math.floor(left%3600000/60000);$("status").textContent=\`Next claim in \${h}h \${m}m\`;setTimeout(()=>updateStatus(next),30000);}
$("mineButton").onclick=async()=>{$("mineButton").disabled=true;$("status").textContent="Mining…";const r=await fetch("/api/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegram_id:telegramId})});const d=await r.json();if(!r.ok){$("status").textContent=d.error;if(d.nextClaimAt)updateStatus(d.nextClaimAt);return}$("balance").textContent=Math.floor(d.balance).toLocaleString();$("status").textContent=\`+\${Math.floor(d.claimed)} RMC claimed!\`;updateStatus(d.nextClaimAt);};
async function upgrade(endpoint){const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegram_id:telegramId})});const d=await r.json();if(!r.ok)return alert(d.error);$("balance").textContent=Math.floor(d.balance).toLocaleString();load();}
load();
</script></body></html>`);
});

const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`Raj Miner running on port ${port}`));
