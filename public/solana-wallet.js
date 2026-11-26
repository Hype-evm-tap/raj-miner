import { createAppKit, SolanaAdapter, networks } from 'https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.8.24/dist/appkit.js';
import { ReownAuthentication } from 'https://cdn.jsdelivr.net/npm/@reown/appkit-siwx@1.8.24/+esm';

(async function initRajSolanaWallet(){
  const button = () => document.getElementById('sol-wallet-btn');
  let modal = null;
  let connectedAddress = '';
  let authenticated = false;
  let siwxAuth = null;
  function paint(){
    const b=button();
    if(!b)return;
    b.classList.toggle('connected',!!connectedAddress);
    b.title=connectedAddress?(authenticated?'Signed in with Solana: '+connectedAddress:'Wallet connected; waiting for sign-in approval: '+connectedAddress):'Connect Solana wallet';
    b.setAttribute('aria-label',connectedAddress?'Disconnect Solana wallet':'Connect Solana wallet');
    const label=connectedAddress?connectedAddress.slice(0,4)+'…'+connectedAddress.slice(-4):'WALLET';
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v2H6.5A2.5 2.5 0 0 0 4 9.5v8A2.5 2.5 0 0 0 6.5 20H19a1 1 0 0 0 1-1v-2H6.5A2.5 2.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 9h15a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 13.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="12.5" r="1" fill="currentColor"/></svg><span></span>';
    b.querySelector('span').textContent=label;
  }
  try {
    const cfg=await fetch('/api/reown-config',{cache:'no-store'}).then(r=>r.json());
    if(!cfg.ok||!cfg.projectId)throw new Error('Reown Project ID is not configured');
    const solanaAdapter=new SolanaAdapter();
    siwxAuth=new ReownAuthentication({required:true});
    siwxAuth.on('sessionChanged',session=>{authenticated=!!session;paint();console.info('Raj Solana sign-in status:',authenticated?'authenticated':'signed out')});
    modal=createAppKit({
      adapters:[solanaAdapter],
      projectId:cfg.projectId,
      networks:[networks.solana],
      defaultNetwork:networks.solana,
      siwx:siwxAuth,
      metadata:{name:'Raj Miner',description:'Raj Miner Solana wallet connection',url:location.origin,icons:[location.origin+'/icon.jpg']},
      themeMode:'dark',
      features:{analytics:false,email:false,socials:[]},
      enableWalletGuide:false
    });
    modal.subscribeAccount(state=>{
      connectedAddress=state&&state.isConnected&&state.address?String(state.address):'';
      paint();
    });
    modal.subscribeNetwork(()=>paint());
    modal.subscribeEvents(event=>{
      const name=event&&event.data&&event.data.event||event&&event.event||'';
      const b=button();
      if(name==='CLICK_SIGN_SIWX_MESSAGE'&&b)b.title='Approve the sign-in message in Trust Wallet';
      if(name==='SIWX_AUTH_SUCCESS'){authenticated=true;paint();if(b)b.title='Signed in with Solana';}
      if(name==='SIWX_AUTH_ERROR'&&b){const detail=event&&event.data&&event.data.properties&&event.data.properties.message;b.title='Sign-in failed: '+(detail||'Reown authentication error');}
      if(name==='CONNECT_ERROR'&&b){const detail=event&&event.data&&event.data.properties&&event.data.properties.message;b.title='Wallet connection failed: '+(detail||'Please retry');}
      if(name)console.info('Raj Reown event:',name,event);
    });
    window.__rajSolanaAppKit=modal;
    paint();
  } catch(error) {
    console.error('Raj Solana wallet initialization failed:',error);
    const b=button();if(b)b.title='Solana wallet unavailable: '+error.message;
  }
  document.addEventListener('click',async event=>{
    const b=event.target.closest('#sol-wallet-btn');
    if(!b)return;
    event.preventDefault();
    if(!modal){b.title='Wallet connection is still loading. Please try again.';return;}
    b.disabled=true;
    try {
      if(connectedAddress) await modal.disconnect({namespace:'solana'});
      else {
        /* Let AppKit manage SIWX nonce/session state. Clearing it before
           every connect can interrupt the wallet sign-message flow. */
        authenticated=false;
        paint();
        await modal.open({view:'Connect',namespace:'solana'});
      }
    } catch(error) {
      console.error('Solana wallet action failed:',error);
      b.title='Wallet action failed: '+(error&&error.message?error.message:'Please try again');
    } finally {b.disabled=false;paint();}
  });
})();
