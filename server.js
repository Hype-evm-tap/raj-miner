const express=require('express'),crypto=require('crypto'),path=require('path'),{Pool}=require('pg');
const app=express();app.disable('etag');app.set('trust proxy',1);app.use(express.json({limit:'32kb'}));
// Prevent stale HTML and API responses from trapping Telegram Mini App on an old loading screen.
// Disable browser, Telegram WebView, and intermediary caching for every app response.
app.use((req,res,next)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');res.set('Pragma','no-cache');res.set('Expires','0');next()});
const BOT_TOKEN=process.env.BOT_TOKEN||'',ADMIN_ID=Number(process.env.ADMIN_ID||8990854464);
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='disable'?false:{rejectUnauthorized:false}}):null;
function verify(initData){
 if(!initData||!BOT_TOKEN)return null;
 const p=new URLSearchParams(initData),hash=p.get('hash');if(!hash)return null;p.delete('hash');
 const str=[...p.entries()].map(([k,v])=>k+'='+v).sort().join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const h=crypto.createHmac('sha256',secret).update(str).digest('hex');
 const a=Buffer.from(h,'hex'),b=Buffer.from(hash,'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
 const age=Date.now()/1000-Number(p.get('auth_date'));if(!Number.isFinite(age)||age< -60||age>86400)return null;
 try{return {user:JSON.parse(p.get('user')),startParam:p.get('start_param')||null}}catch{return null}
}
const ready=(async()=>{
 if(!pool)return;
 await pool.query('CREATE TABLE IF NOT EXISTS users(telegram_id BIGINT PRIMARY KEY,username TEXT,first_name TEXT,last_name TEXT,is_premium BOOLEAN NOT NULL DEFAULT FALSE,is_admin BOOLEAN NOT NULL DEFAULT FALSE,is_banned BOOLEAN NOT NULL DEFAULT FALSE,admin_note TEXT NOT NULL DEFAULT \'\',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW())');
 await pool.query('CREATE TABLE IF NOT EXISTS admin_audit(id BIGSERIAL PRIMARY KEY,admin_id BIGINT NOT NULL,target_id BIGINT,action TEXT NOT NULL,details JSONB NOT NULL DEFAULT \'{}\'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
 await pool.query('CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users(last_seen DESC)');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(30,8) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_revision INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus_earned NUMERIC(30,8) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_commission_earned NUMERIC(30,8) NOT NULL DEFAULT 0");
  await pool.query("CREATE TABLE IF NOT EXISTS user_task_claims(telegram_id BIGINT NOT NULL,task_id BIGINT NOT NULL,claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(telegram_id,task_id))");
  await pool.query("CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value JSONB NOT NULL)");
  await pool.query("CREATE TABLE IF NOT EXISTS app_tasks(id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'social',reward NUMERIC(20,8) NOT NULL DEFAULT 0,link TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  const defaults={referral_reward:100,referral_commission:10,daily_checkin_reward:10,mining_rate:0.028,ad_reward:5,signup_reward:0};
  for(const [key,value] of Object.entries(defaults)) await pool.query("INSERT INTO app_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",[key,JSON.stringify(value)]);
  const taskCount=await pool.query("SELECT COUNT(*)::int n FROM app_tasks");
  if(!taskCount.rows[0].n){const tasks=[['Sponsored task','partners',5,''],['Join Raj Channel','social',5,'https://t.me/Raj_company'],['Follow Raj on X','social',5,''],['React to latest post','social',3,''],['Connect TON wallet','onchain',20,''],['Hold 100 $RAJ','onchain',15,''],['Invite 3 friends','company',30,''],['Reach Level 25','company',25,'']];for(const t of tasks)await pool.query("INSERT INTO app_tasks(title,category,reward,link) VALUES($1,$2,$3,$4)",t)}

})();
app.use(async(req,res,next)=>{try{await ready;next()}catch(e){console.error('DB init failed',e);res.status(503).json({ok:false,error:'Database unavailable'})}});
function telegram(req){return verify(req.headers['x-init-data']||(req.body&&req.body.initData))}
function requireAdmin(req,res,next){const v=telegram(req);if(!v||!v.user||Number(v.user.id)!==ADMIN_ID)return res.status(403).json({ok:false,error:'Admin access denied'});req.tg=v.user;next()}
app.post('/api/auth',async(req,res)=>{
 const v=verify(req.body&&req.body.initData);if(!v||!v.user)return res.status(401).json({ok:false});
 const u=v.user,id=Number(u.id),admin=id===ADMIN_ID,raw=String(v.startParam||'').replace(/^ref[_-]?/,''),refId=/^\d{1,20}$/.test(raw)&&Number(raw)!==id?raw:null;
 try{
  const existing=await pool.query('SELECT is_banned FROM users WHERE telegram_id=$1',[id]);
  if(existing.rowCount&&existing.rows[0].is_banned)return res.status(403).json({ok:false,banned:true});
  if(!existing.rowCount){
   await pool.query('INSERT INTO users(telegram_id,username,first_name,last_name,is_premium,is_admin,referred_by,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())',[id,u.username||null,u.first_name||'',u.last_name||'',!!u.is_premium,admin,refId]);
   const rewards=await pool.query("SELECT key,value FROM app_settings WHERE key IN ('referral_reward','signup_reward')");
   const cfg=Object.fromEntries(rewards.rows.map(x=>[x.key,Number(x.value)]));
   if(refId)await pool.query('UPDATE users SET balance=balance+$2,balance_revision=balance_revision+1,referral_bonus_earned=referral_bonus_earned+$2 WHERE telegram_id=$1',[refId,cfg.referral_reward??100]);
   if((cfg.signup_reward||0)>0)await pool.query('UPDATE users SET balance=balance+$2,balance_revision=balance_revision+1 WHERE telegram_id=$1',[id,cfg.signup_reward]);
  }else{
   await pool.query('UPDATE users SET username=$2,first_name=$3,last_name=$4,is_premium=$5,is_admin=$6,last_seen=NOW() WHERE telegram_id=$1',[id,u.username||null,u.first_name||'',u.last_name||'',!!u.is_premium,admin]);
  }
  const [settings,tasks,account]=await Promise.all([pool.query('SELECT key,value FROM app_settings'),pool.query('SELECT id,title,category,reward,link,active FROM app_tasks WHERE active=TRUE ORDER BY id'),pool.query('SELECT balance::float balance,balance_revision FROM users WHERE telegram_id=$1',[id])]);
  res.json({ok:true,user:{id:u.id},balance:account.rows[0].balance,balanceRevision:account.rows[0].balance_revision,isAdmin:admin,settings:Object.fromEntries(settings.rows.map(x=>[x.key,x.value])),tasks:tasks.rows});
 }catch(e){console.error('auth db',e);res.status(503).json({ok:false,error:'Database unavailable'})}
});
app.get('/api/admin/stats',requireAdmin,async(req,res)=>{
 const q=await pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE last_seen>NOW()-INTERVAL '24 hours')::int active_today,COUNT(*) FILTER(WHERE is_banned)::int suspended FROM users");
 res.json({ok:true,stats:q.rows[0]});
});
app.get('/api/admin/users',requireAdmin,async(req,res)=>{
 const q=String(req.query.q||'').trim().slice(0,80),limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
 const result=await pool.query("SELECT telegram_id::text id,username,first_name,last_name,is_premium,is_banned,admin_note,balance::float balance,created_at,last_seen FROM users WHERE ($1='' OR telegram_id::text ILIKE '%'||$1||'%' OR COALESCE(username,'') ILIKE '%'||$1||'%' OR first_name ILIKE '%'||$1||'%') ORDER BY last_seen DESC LIMIT $2",[q,limit]);
 res.json({ok:true,users:result.rows});
});
app.patch('/api/admin/users/:id',requireAdmin,async(req,res)=>{
 const id=String(req.params.id);if(!/^\d{1,20}$/.test(id))return res.status(400).json({ok:false,error:'Invalid Telegram ID'});
 const banned=typeof req.body.banned==='boolean'?req.body.banned:null,note=typeof req.body.note==='string'?req.body.note.slice(0,500):null;
 if(String(req.tg.id)===id&&banned===true)return res.status(400).json({ok:false,error:'Cannot suspend the admin account'});
 if(banned===null&&note===null)return res.status(400).json({ok:false,error:'No changes supplied'});
 const q=await pool.query('UPDATE users SET is_banned=COALESCE($2,is_banned),admin_note=COALESCE($3,admin_note) WHERE telegram_id=$1 RETURNING telegram_id::text id,is_banned,admin_note',[id,banned,note]);
 if(!q.rowCount)return res.status(404).json({ok:false,error:'User not found'});
 await pool.query('INSERT INTO admin_audit(admin_id,target_id,action,details) VALUES($1,$2,$3,$4)',[req.tg.id,id,banned===null?'note_updated':(banned?'user_suspended':'user_activated'),JSON.stringify({note})]);
 res.json({ok:true,user:q.rows[0]});
});

app.get('/api/public/config',async(req,res)=>{const [a,b]=await Promise.all([pool.query('SELECT key,value FROM app_settings'),pool.query('SELECT id,title,category,reward,link,active FROM app_tasks WHERE active=TRUE ORDER BY id')]);res.json({ok:true,settings:Object.fromEntries(a.rows.map(x=>[x.key,x.value])),tasks:b.rows})});
app.post('/api/progress',async(req,res)=>{const v=telegram(req);if(!v||!v.user)return res.status(401).json({ok:false});const bal=Number(req.body&&req.body.balance),rev=Number(req.body&&req.body.balanceRevision)||0;if(!Number.isFinite(bal)||bal<0||bal>1e15)return res.status(400).json({ok:false});const client=await pool.connect();try{await client.query('BEGIN');const cur=await client.query('SELECT balance::float balance,balance_revision,referred_by FROM users WHERE telegram_id=$1 FOR UPDATE',[v.user.id]);if(!cur.rowCount){await client.query('ROLLBACK');return res.status(404).json({ok:false})}let next=cur.rows[0].balance;if(rev>=cur.rows[0].balance_revision){next=Math.max(next,bal);const delta=next-cur.rows[0].balance;if(delta>0&&cur.rows[0].referred_by){const c=await client.query("SELECT value FROM app_settings WHERE key='referral_commission'");const pct=Number(c.rows[0]?.value??10);if(pct>0)await client.query('UPDATE users SET balance=balance+$2,balance_revision=balance_revision+1,referral_commission_earned=referral_commission_earned+$2 WHERE telegram_id=$1',[cur.rows[0].referred_by,delta*pct/100])}await client.query('UPDATE users SET balance=$2,last_seen=NOW() WHERE telegram_id=$1',[v.user.id,next])}else{await client.query('UPDATE users SET last_seen=NOW() WHERE telegram_id=$1',[v.user.id])}const fresh=await client.query('SELECT balance::float balance,balance_revision FROM users WHERE telegram_id=$1',[v.user.id]);await client.query('COMMIT');res.json({ok:true,balance:fresh.rows[0].balance,balanceRevision:fresh.rows[0].balance_revision})}catch(e){await client.query('ROLLBACK');console.error('progress sync',e);res.status(500).json({ok:false})}finally{client.release()}});
app.get('/api/tasks/claimed',async(req,res)=>{const v=telegram(req);if(!v||!v.user)return res.status(401).json({ok:false});const q=await pool.query('SELECT task_id::text id FROM user_task_claims WHERE telegram_id=$1',[v.user.id]);res.json({ok:true,ids:q.rows.map(x=>x.id)})});
app.post('/api/tasks/:id/claim',async(req,res)=>{const v=telegram(req);if(!v||!v.user)return res.status(401).json({ok:false});const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({ok:false});const client=await pool.connect();try{await client.query('BEGIN');const t=await client.query('SELECT reward FROM app_tasks WHERE id=$1 AND active=TRUE',[id]);if(!t.rowCount){await client.query('ROLLBACK');return res.status(404).json({ok:false,error:'Task unavailable'})}const ins=await client.query('INSERT INTO user_task_claims(telegram_id,task_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING task_id',[v.user.id,id]);if(!ins.rowCount){const bal=await client.query('SELECT balance::float balance,balance_revision FROM users WHERE telegram_id=$1',[v.user.id]);await client.query('COMMIT');return res.json({ok:true,alreadyClaimed:true,balance:bal.rows[0].balance,balanceRevision:bal.rows[0].balance_revision})}const reward=Number(t.rows[0].reward);const bal=await client.query('UPDATE users SET balance=balance+$2,balance_revision=balance_revision+1 WHERE telegram_id=$1 RETURNING balance::float balance,balance_revision',[v.user.id,reward]);await client.query('COMMIT');res.json({ok:true,reward,balance:bal.rows[0].balance,balanceRevision:bal.rows[0].balance_revision})}catch(e){await client.query('ROLLBACK');console.error('task claim',e);res.status(500).json({ok:false})}finally{client.release()}});
app.get('/api/referrals/me',async(req,res)=>{const v=telegram(req);if(!v||!v.user)return res.status(401).json({ok:false});const [q,a]=await Promise.all([pool.query('SELECT COUNT(*)::int count FROM users WHERE referred_by=$1',[v.user.id]),pool.query('SELECT referral_bonus_earned::float bonus,referral_commission_earned::float commission FROM users WHERE telegram_id=$1',[v.user.id])]);res.json({ok:true,count:q.rows[0].count,bonus:a.rows[0]?.bonus||0,commission:a.rows[0]?.commission||0})});
app.get('/api/leaderboard',async(req,res)=>{const q=await pool.query("SELECT telegram_id::text id,username,first_name,balance::float balance FROM users WHERE is_banned=FALSE AND balance>0 ORDER BY balance DESC,last_seen DESC LIMIT 20");res.json({ok:true,users:q.rows})});
app.get('/api/admin/config',requireAdmin,async(req,res)=>{const q=await pool.query('SELECT key,value FROM app_settings');res.json({ok:true,settings:Object.fromEntries(q.rows.map(x=>[x.key,x.value]))})});
app.put('/api/admin/config',requireAdmin,async(req,res)=>{const allowed=['referral_reward','referral_commission','daily_checkin_reward','mining_rate','ad_reward','signup_reward'];for(const k of allowed){if(req.body[k]===undefined)continue;const n=Number(req.body[k]);if(!Number.isFinite(n)||n<0||n>1e12)return res.status(400).json({ok:false,error:'Invalid value: '+k});await pool.query('INSERT INTO app_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[k,JSON.stringify(n)])}await pool.query('INSERT INTO admin_audit(admin_id,action,details) VALUES($1,$2,$3)',[req.tg.id,'settings_updated',JSON.stringify(req.body)]);res.json({ok:true})});
app.get('/api/admin/tasks',requireAdmin,async(req,res)=>{const q=await pool.query('SELECT id,title,category,reward::float reward,link,active FROM app_tasks ORDER BY id');res.json({ok:true,tasks:q.rows})});
app.post('/api/admin/tasks',requireAdmin,async(req,res)=>{const {title,category,reward,link}=req.body||{},n=Number(reward);if(!String(title||'').trim()||!Number.isFinite(n)||n<0||n>1e12)return res.status(400).json({ok:false,error:'Enter task title and valid reward'});const q=await pool.query('INSERT INTO app_tasks(title,category,reward,link) VALUES($1,$2,$3,$4) RETURNING id,title,category,reward::float reward,link,active',[String(title).slice(0,100),String(category||'social').slice(0,30),n,String(link||'').slice(0,500)]);res.json({ok:true,task:q.rows[0]})});
app.patch('/api/admin/tasks/:id',requireAdmin,async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({ok:false});const {title,category,reward,link,active}=req.body||{},n=reward===undefined?null:Number(reward);if(n!==null&&(!Number.isFinite(n)||n<0||n>1e12))return res.status(400).json({ok:false,error:'Invalid reward'});const q=await pool.query('UPDATE app_tasks SET title=COALESCE($2,title),category=COALESCE($3,category),reward=COALESCE($4,reward),link=COALESCE($5,link),active=COALESCE($6,active) WHERE id=$1 RETURNING id,title,category,reward::float reward,link,active',[id,title===undefined?null:String(title).slice(0,100),category===undefined?null:String(category).slice(0,30),n,link===undefined?null:String(link).slice(0,500),typeof active==='boolean'?active:null]);if(!q.rowCount)return res.status(404).json({ok:false});res.json({ok:true,task:q.rows[0]})});
app.delete('/api/admin/tasks/:id',requireAdmin,async(req,res)=>{const q=await pool.query('DELETE FROM app_tasks WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({ok:false});res.json({ok:true})});
app.patch('/api/admin/users/:id/balance',requireAdmin,async(req,res)=>{const id=String(req.params.id),amount=Number(req.body&&req.body.amount),mode=req.body&&req.body.mode;if(!/^\d{1,20}$/.test(id)||!Number.isFinite(amount)||amount<0||amount>1e12||!['add','set','subtract'].includes(mode))return res.status(400).json({ok:false,error:'Invalid balance action'});const expr=mode==='add'?'balance+$2':mode==='subtract'?'GREATEST(0,balance-$2)':'$2';const q=await pool.query('UPDATE users SET balance='+expr+',balance_revision=balance_revision+1 WHERE telegram_id=$1 RETURNING balance::float balance,balance_revision',[id,amount]);if(!q.rowCount)return res.status(404).json({ok:false});await pool.query('INSERT INTO admin_audit(admin_id,target_id,action,details) VALUES($1,$2,$3,$4)',[req.tg.id,id,'balance_'+mode,JSON.stringify({amount})]);res.json({ok:true,balance:q.rows[0].balance})});
app.delete('/api/admin/users/:id',requireAdmin,async(req,res)=>{const id=String(req.params.id);if(!/^\d{1,20}$/.test(id)||id===String(req.tg.id))return res.status(400).json({ok:false,error:'Cannot delete this account'});const q=await pool.query('DELETE FROM users WHERE telegram_id=$1 RETURNING telegram_id',[id]);if(!q.rowCount)return res.status(404).json({ok:false});await pool.query('INSERT INTO admin_audit(admin_id,target_id,action) VALUES($1,$2,$3)',[req.tg.id,id,'user_deleted']);res.json({ok:true})});

app.get('/tonconnect-manifest.json',(req,res)=>{
 const base=process.env.BASE_URL||(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;
 res.set('Access-Control-Allow-Origin','*').json({url:base,name:'Raj Miner',iconUrl:base+'/icon.jpg'});
});
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(req,res)=>res.json({ok:true,database:!!pool}));
app.listen(process.env.PORT||3000,()=>console.log('Raj Miner running'));
