const express=require('express'),crypto=require('crypto'),path=require('path');
const app=express();app.set('trust proxy',1);app.use(express.json());
const BOT_TOKEN=process.env.BOT_TOKEN||'',ADMIN_ID=Number(process.env.ADMIN_ID||8990854464);
function verify(initData){
  if(!initData||!BOT_TOKEN)return null;
  const p=new URLSearchParams(initData),hash=p.get('hash');p.delete('hash');
  const str=[...p.entries()].map(([k,v])=>k+'='+v).sort().join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const h=crypto.createHmac('sha256',secret).update(str).digest('hex');
  if(h!==hash)return null;
  if(Date.now()/1000-Number(p.get('auth_date'))>86400)return null;
  try{return JSON.parse(p.get('user'))}catch{return null}
}
app.post('/api/auth',(req,res)=>{
  const u=verify(req.body.initData);
  if(!u)return res.status(401).json({ok:false});
  res.json({ok:true,user:{id:u.id},isAdmin:u.id===ADMIN_ID});
});
app.get('/api/admin/stats',(req,res)=>{
  const u=verify(req.headers['x-init-data']);
  if(!u||u.id!==ADMIN_ID)return res.status(403).json({ok:false});
  res.json({ok:true,note:'connect your database here'});
});
app.get('/tonconnect-manifest.json',(req,res)=>{
  const base=process.env.BASE_URL||(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;
  res.set('Access-Control-Allow-Origin','*').json({url:base,name:'Raj Miner',iconUrl:base+'/icon.png'});
});
app.use(express.static(path.join(__dirname,'public')));
app.listen(process.env.PORT||3000,()=>console.log('Raj Miner running'));
