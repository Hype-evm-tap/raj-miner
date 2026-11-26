import { createAppKit, SolanaAdapter, networks } from 'https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.8.24/dist/appkit.js';

(async function initRajSolanaWallet(){
  const button = () => document.getElementById('sol-wallet-btn');
  let modal = null;
  let connectedAddress = '';
  function paint(){
    const b=button();
    if(!b)return;
    b.classList.toggle('connected',!!connectedAddress);
    b.title=connectedAddress?'Disconnect Solana wallet: '+connectedAddress:'Connect Solana wallet';
    b.setAttribute('aria-label',connectedAddress?'Disconnect Solana wallet':'Connect Solana wallet');
    const label=connectedAddress?connectedAddress.slice(0,4)+'…'+connectedAddress.slice(-4):'WALLET';
    b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v2H6.5A2.5 2.5 0 0 0 4 9.5v8A2.5 2.5 0 0 0 6.5 20H19a1 1 0 0 0 1-1v-2H6.5A2.5 2.5 0 0 1 4 14.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 9h15a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 13.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="12.5" r="1" fill="currentColor"/></svg><span></span>';
    b.querySelector('span').textContent=label;
  }
  try {
    const cfg=await fetch('/api/reown-config',{cache:'no-store'}).then(r=>r.json());
    if(!cfg.ok||!cfg.projectId)throw new Error('Reown Project ID is not configured');
    const solanaAdapter=new SolanaAdapter();
    modal=createAppKit({
      adapters:[solanaAdapter],
      projectId:cfg.projectId,
      networks:[networks.solana],
      defaultNetwork:networks.solana,
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
      else await modal.open({view:'Connect',namespace:'solana'});
    } catch(error) {
      console.error('Solana wallet action failed:',error);
      b.title='Wallet action failed: '+(error&&error.message?error.message:'Please try again');
    } finally {b.disabled=false;paint();}
  });
})();
