# Raj Miner (Telegram Mini App)

## Deploy (Railway + GitHub)
1. Push this folder to a new GitHub repo.
2. Railway -> New Project -> Deploy from GitHub repo -> select it.
3. Variables: BOT_TOKEN = token from @BotFather, ADMIN_ID = 8990854464
4. Settings -> Networking -> Generate Domain.
5. BotFather -> /mybots -> your bot -> Bot Settings -> Menu Button (or /newapp) -> set the Railway URL.
6. public/index.html: change CONFIG.BOT to your bot username (used for invite links).

## What works
- Real Telegram profile (name, @username, photo) and Premium/wallet verified tick
- Real TonConnect: Tonkeeper, Telegram Wallet and other TON wallets
- Admin tab appears only after the server verifies initData and ID = ADMIN_ID

## Not done yet
Balances are stored in the browser only. Real balances, referrals and payouts need a database (e.g. Railway Postgres) behind the server.
