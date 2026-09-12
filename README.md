# BLACKWATER

A tactical top-down battle royale in one HTML file — fourteen on the strip at dusk, nothing in
your hands, fog closing. Loot or die with your fists. Kit Arena for quick rounds, and a
peer-to-peer **1v1 online** mode.

**Play:** https://mattedoubleo7-sketch.github.io/blackwater/

## 1v1 with a friend
Both open the link → **1V1 ONLINE** tab → type a callsign.
1. One of you clicks **CREATE CODE** — it's copied to your clipboard; send it over any chat.
2. The other pastes it, clicks **MAKE REPLY**, sends the reply back.
3. The host pastes the reply and clicks **CONNECT**. Both screens say "connected".
4. Host picks the mode (Battle Royale with bots, or Kit Arena) and presses start.
   Pick a kit on the KITS tab first for the arena.

The match runs directly between the two browsers (WebRTC data channel, deterministic
lockstep) — no server, no account. Keep the tab in front; browsers pause background
tabs and the other player sees "waiting for…" until you're back.

## Controls
WASD move · mouse aim / left attack (hold with a blade for a heavy) · right guard or ADS ·
Shift dash · Ctrl quiet · hold T head mode · 1 2 3 / Q weapons · R reload · F pick up ·
E heal · G hold to cook a frag · V weapon light. Touch controls on phones.

## Public server (.io mode)
`server/` is an authoritative Node server that runs the game's own simulation headlessly:
one persistent strip, drop in with a pistol and machete, loot up, drop your kit when you
die, respawn in 3 s, bots fill the quiet, live leaderboard.

Run it anywhere with Node 18+: `cd server && npm install && node index.js` (port 8765,
`BOTS` / `MAX` / `SEED` env to tune). Point the game at it with the SERVER field on the
PUBLIC SERVER tab, `?server=wss://…` in the URL, or by putting the address in `server.json`
next to `index.html` so everyone who opens the page finds it automatically.

Free 24/7 hosting: create a Render account, **New → Blueprint**, pick this repo — it reads
`render.yaml` and gives you `wss://blackwater-server-xxxx.onrender.com`; put that in
`server.json` and push.
