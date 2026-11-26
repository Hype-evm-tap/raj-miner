import { createAppKit, SolanaAdapter, networks } from 'https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.8.24/dist/appkit.js';
import { DefaultSIWX } from 'https://cdn.jsdelivr.net/npm/@reown/appkit-siwx@1.8.24/+esm';

(function initRajSolanaWallet(){
  let modal=null, connectedAddress='', authenticated=false, initializing=null, lastError='';
  const getButton=()=>document.getElementById('sol-wallet-btn');
  function paint(message){
    const b=getButton(); if(!b)return;
    b.classList.toggle('connected',!!connectedAddress);
    b.disabled=false;
    b.title=message || (connectedAddress?(authenticated?'Solana wallet connected and signed in':'Solana wallet connected'):lastError||'Connect Solana wallet');
    b.setAttribute('aria-label',connectedAddress?'Disconnect Solana wallet':'Connect Solana wallet');
    const span=b.querySelector('span');
    if(span)span.textContent=connectedAddress?connectedAddress.slice(0,4)+'…'+connectedAddress.slice(-4):'';
  }
  async function initialize(){
    if(modal)return modal;
    if(initializing)return initializing;
    initializing=(async()=>{
      const cfg=await fetch('/api/reown-config',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Wallet configuration request failed');return r.json()});
      if(!cfg.ok||!cfg.projectId)throw new Error('Reown Project ID is missing in server configuration');
      const adapter=new SolanaAdapter();
      let siwx=null;
      try { siwx=new DefaultSIWX({required:true}); } catch(e){ console.warn('SIWX setup unavailable:',e); }
      const options={
        adapters:[adapter],projectId:cfg.projectId,
        networks:[networks.solana],defaultNetwork:networks.solana,
        metadata:{name:'Raj Miner',description:'Raj Miner Solana wallet',url:location.origin,icons:[location.origin+'/icon.jpg']},
        themeMode:'dark',features:{analytics:false,email:false,socials:[]},enableWalletGuide:false
      };
      if(siwx)options.siwx=siwx;
      modal=createAppKit(options);
      modal.subscribeAccount(state=>{
        connectedAddress=state&&state.isConnected&&state.address?String(state.address):'';
        paint();
      });
      modal.subscribeEvents(event=>{
        const name=event&&event.data&&event.data.event||event&&event.event||'';
        if(name==='SIWX_AUTH_SUCCESS'){authenticated=true;paint('Solana sign-in approved');}
        if(name==='SIWX_AUTH_ERROR'){authenticated=false;lastError='Wallet connected, but message signing failed. Tap wallet and retry.';paint(lastError);}
        if(name==='CONNECT_ERROR'){const msg=event&&event.data&&event.data.properties&&event.data.properties.message;lastError='Wallet connection failed'+(msg?': '+msg:'');paint(lastError);}
        if(name)console.info('Raj Solana wallet event:',name);
      });
      window.__rajSolanaAppKit=modal;
      return modal;
    })();
    try{return await initializing;}catch(error){initializing=null;lastError='Wallet unavailable: '+(error&&error.message?error.message:'initialization failed');paint(lastError);throw error;}
  }
  // Register the click handler immediately, even while the remote wallet SDK loads.
  document.addEventListener('click',async event=>{
    const b=event.target&&event.target.closest?event.target.closest('#sol-wallet-btn'):null;
    if(!b)return;
    event.preventDefault();event.stopPropagation();
    b.disabled=true;paint('Opening Solana wallet…');
    try{
      const app=await initialize();
      if(connectedAddress){await app.disconnect({namespace:'solana'});connectedAddress='';authenticated=false;paint('Solana wallet disconnected');}
      else {await app.open({view:'Connect',namespace:'solana'});paint('Choose a Solana wallet to connect');}
    }catch(error){console.error('Raj Solana wallet action failed:',error);lastError='Wallet error: '+(error&&error.message?error.message:'Please retry');paint(lastError);}
    finally{b.disabled=false;}
  },true);
  initialize().catch(error=>console.error('Raj Solana wallet initialization failed:',error));
})();