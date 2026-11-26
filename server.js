const express=require('express'),crypto=require('crypto'),path=require('path'),{Pool}=require('pg');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'32kb'}));
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
})();
app.use(async(req,res,next)=>{try{await ready;next()}catch(e){console.error('DB init failed',e);res.status(503).json({ok:false,error:'Database unavailable'})}});
function telegram(req){return verify(req.headers['x-init-data']||(req.body&&req.body.initData))}
function requireAdmin(req,res,next){const v=telegram(req);if(!v||!v.user||Number(v.user.id)!==ADMIN_ID)return res.status(403).json({ok:false,error:'Admin access denied'});req.tg=v.user;next()}
app.post('/api/auth',async(req,res)=>{
 const v=verify(req.body&&req.body.initData);if(!v||!v.user)return res.status(401).json({ok:false});
 const u=v.user,id=Number(u.id),admin=id===ADMIN_ID;
 try{
  const existing=await pool.query('SELECT is_banned FROM users WHERE telegram_id=$1',[id]);
  if(existing.rowCount&&existing.rows[0].is_banned)return res.status(403).json({ok:false,banned:true});
  await pool.query('INSERT INTO users(telegram_id,username,first_name,last_name,is_premium,is_admin,last_seen) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,is_premium=EXCLUDED.is_premium,is_admin=EXCLUDED.is_admin,last_seen=NOW()',[id,u.username||null,u.first_name||'',u.last_name||'',!!u.is_premium,admin]);
  res.json({ok:true,user:{id:u.id},isAdmin:admin});
 }catch(e){console.error('auth db',e);res.status(503).json({ok:false,error:'Database unavailable'})}
});
app.get('/api/admin/stats',requireAdmin,async(req,res)=>{
 const q=await pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE last_seen>NOW()-INTERVAL '24 hours')::int active_today,COUNT(*) FILTER(WHERE is_banned)::int suspended FROM users");
 res.json({ok:true,stats:q.rows[0]});
});
app.get('/api/admin/users',requireAdmin,async(req,res)=>{
 const q=String(req.query.q||'').trim().slice(0,80),limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
 const result=await pool.query("SELECT telegram_id::text id,username,first_name,last_name,is_premium,is_banned,admin_note,created_at,last_seen FROM users WHERE ($1='' OR telegram_id::text ILIKE '%'||$1||'%' OR COALESCE(username,'') ILIKE '%'||$1||'%' OR first_name ILIKE '%'||$1||'%') ORDER BY last_seen DESC LIMIT $2",[q,limit]);
 res.json({ok:true,users:result.rows});
});
app.patch('/api/admin/users/:id',requireAdmin,async(req,res)=>{
 const id=String(req.params.id);if(!/^\d{1,20}$/.test(id))return res.status(400).json({ok:false,error:'Invalid Telegram ID'});
 const banned=typeof req.body.banned==='boolean'?req.body.banned:null,note=typeof req.body.note==='string'?req.body.note.slice(0,500):null;
 if(banned===null&&note===null)return res.status(400).json({ok:false,error:'No changes supplied'});
 const q=await pool.query('UPDATE users SET is_banned=COALESCE($2,is_banned),admin_note=COALESCE($3,admin_note) WHERE telegram_id=$1 RETURNING telegram_id::text id,is_banned,admin_note',[id,banned,note]);
 if(!q.rowCount)return res.status(404).json({ok:false,error:'User not found'});
 await pool.query('INSERT INTO admin_audit(admin_id,target_id,action,details) VALUES($1,$2,$3,$4)',[req.tg.id,id,banned===null?'note_updated':(banned?'user_suspended':'user_activated'),JSON.stringify({note})]);
 res.json({ok:true,user:q.rows[0]});
});
app.get('/tonconnect-manifest.json',(req,res)=>{
 const base=process.env.BASE_URL||(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;
 res.set('Access-Control-Allow-Origin','*').json({url:base,name:'Raj Miner',iconUrl:base+'/icon.png'});
});
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(req,res)=>res.json({ok:true,database:!!pool}));
app.listen(process.env.PORT||3000,()=>console.log('Raj Miner running'));
