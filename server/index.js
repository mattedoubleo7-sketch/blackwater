// BLACKWATER public server. Runs the game's own simulation headlessly (game.js is built
// from ../index.html) and streams snapshots to browsers over WebSockets.
//   node index.js            → ws://localhost:8765     (PORT env overrides)
//   BOTS=6 MAX=16 SEED=…     → tuning
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');
const build = require('./build');
build();                                   // always run the sim that matches the page we serve
const boot = require('./game');

const PORT = +process.env.PORT || 8765;
const MAX  = +process.env.MAX  || 16;
const BOTS = process.env.BOTS != null ? +process.env.BOTS : 6;
const SEED = process.env.SEED ? +process.env.SEED : (Math.random()*0x7fffffff)|0;
const TICK = 1000/60, SNAP_EVERY = 2;       // 60 Hz sim, 30 Hz snapshots

const SRV = boot();
SRV.init(SEED, BOTS);
console.log(`world seed ${SEED}, ${BOTS} bots`);

// every sound the sim makes becomes an event for the clients (they filter by distance)
const events = [];
for(const k of Object.keys(SRV.A)){
  if(k==='on'||k==='setVol') continue;
  const orig = SRV.A[k];
  SRV.A[k] = (...args) => { if(typeof args[0]==='number' || k==='shot') events.push([k, ...args]); return orig(...args); };
}

const clients = new Map();   // ws → {a, known:Set(lootIds), name}
const server = http.createServer((req,res)=>{ res.setHeader('Access-Control-Allow-Origin','*'); res.end(JSON.stringify({ok:true, online:clients.size, bots:BOTS, max:MAX})); });
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  let c = null;
  ws.on('message', data => {
    let m; try{ m = JSON.parse(data); }catch(e){ return; }
    if(!c){
      if(m.k==='ping'){ ws.send(JSON.stringify({k:'pong', online:clients.size})); return; }
      if(m.k!=='join') return;
      if(clients.size >= MAX){ ws.send(JSON.stringify({k:'full', max:MAX})); ws.close(); return; }
      const name = String(m.name||'drifter').replace(/[^\w \-'.]/g,'').slice(0,12) || 'drifter';
      const a = SRV.join(name);
      c = { a, known:new Set(), name };
      clients.set(ws, c);
      ws.send(JSON.stringify({k:'init', seed:SRV.state.rd.seed, id:a.id, x:a.x, y:a.y, online:clients.size, map:SRV.state.map}));
      SRV.LOG.push(`${name} drifted onto the strip${a.dead?' — spectating until the next round':''}`);
      console.log(`+ ${name} (${clients.size} online)`);
      return;
    }
    if(Array.isArray(m) && m.length>=4) SRV.input(c.a, m);   // [mx,my,ang,flags,slot,seq]
  });
  ws.on('close', () => { if(c){ clients.delete(ws); SRV.leave(c.a); SRV.LOG.push(`${c.name} left the strip`); console.log(`- ${c.name} (${clients.size} online)`); } });
  ws.on('error', () => {});
});

/* ── sim loop: fixed 60 Hz with catch-up, never more than 5 steps per wake ── */
let acc = 0, last = Date.now(), tickN = 0;
function loop(){
  const now = Date.now(); acc += now - last; last = now;
  let n = 0;
  while(acc >= TICK && n < 5){ try{ SRV.step(); }catch(e){ console.error('sim error', e); } acc -= TICK; n++; tickN++;
    if(tickN % SNAP_EVERY === 0) broadcast(); }
  if(acc > TICK*5) acc = TICK*5;
  setTimeout(loop, 4);
}

const rem = (t, now) => Math.max(0, Math.round(t - now));
function packActor(a, now){
  const w = SRV.wep(a), s = a.swing;
  return { id:a.id, n:a.name, bot:a.isBot?1:0, x:Math.round(a.x*10)/10, y:Math.round(a.y*10)/10, a:Math.round(a.ang*1000)/1000,
    hp:Math.round(a.hp), mh:a.maxhp, d:a.dead?1:0, dn:a.downed?1:0, dh:a.downed?Math.round(a.downHp):0, v:a.vest, h:a.helm, l:a.light?1:0, k:a.kills|0, st:a.streak|0,
    bl:a.block?1:0, rl:a.reloading?1:0, hf:a.hurtFlash>now?1:0, sg:a.stagger>now?1:0, ex:a.exhaust?1:0,
    gs:rem(a.gunStun,now), he:a.healEnd>now?rem(a.healEnd,now):0, hk:a.healKind||undefined, rc:a.fireAt>now?1:0, hs:a.hsMode?1:0,
    wk:w.kind, w:w.id, sw: s ? [s.phase, Math.round(s.prog*100)/100, Math.round(now-s.t0), s.wind, s.act, s.rec, s.a0, s.a1, s.heavy?1:0] : undefined,
    ds:a.dashState||undefined, sn:a.sneak?1:0 };
}
function packMe(a, now){
  return { stam:Math.round(a.stam), ammo:a.ammo, heals:a.heals, nades:a.nades, bleed:Math.round(a.bleed*10)/10, slots:a.slots, sel:a.sel, last:a.last,
    vh:a.vestHp, vestLvl:a.vest, helmLvl:a.helm, hsCd:rem(a.hsCd,now), fs:rem(a.fireSlow,now), dr:rem(a.drawEnd||0,now), su:rem(a.suppress||0,now), ads:a.ads?1:0, seq:a.ackSeq|0 };
}
function broadcast(){
  if(!clients.size){ events.length = 0; SRV.LOG.length = 0; return; }
  const st = SRV.state, now = st.tNow;
  const actors = [...st.players, ...st.bots].map(a => packActor(a, now));
  const bullets = st.bullets.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.dx*100)/100, Math.round(b.dy*100)/100]);
  const nades = st.nades.map(n => [Math.round(n.x), Math.round(n.y), rem(n.fuse, now)]);
  const board = [...st.players, ...st.bots].filter(a=>!a.isBot || a.kills>0).sort((p,q)=>(q.kills|0)-(p.kills|0)).slice(0,6).map(a=>[a.name, a.kills|0, a.id]);
  const feed = SRV.LOG.splice(0), ev = events.splice(0);
  const crates = brokenCrates();
  const R = st.rd, aliveN = [...st.players, ...st.bots].filter(a=>!a.dead).length;
  const rd = [R.phase, rem(R.until, now), aliveN, R.winner, R.n, st.map, R.seed];
  if(st.map !== lastMap){ lastMap = st.map; crateCount = -1; }
  const B = st.bank, bk = [B.open?1:0, B.crackBy?B.crackBy.id:0, rem(B.crackEnd, now)];
  const zn = st.zone, z = [Math.round(zn.x), Math.round(zn.y), Math.round(zn.r), Math.round(zn.tx), Math.round(zn.ty), Math.round(zn.tr), zn.moving?1:0, zn.stage];
  const lootIds = new Set(st.loot.map(l => l.lid));
  for(const [ws, c] of clients){
    if(ws.readyState !== 1) continue;
    const la = [], lr = [];
    for(const l of st.loot) if(!c.known.has(l.lid)){ c.known.add(l.lid); la.push({lid:l.lid, x:Math.round(l.x), y:Math.round(l.y), t:l.t, id:l.id, lvl:l.lvl, n:l.n, hp:l.hp, rounds:l.rounds}); }
    for(const id of [...c.known]) if(!lootIds.has(id)){ c.known.delete(id); lr.push(id); }
    const msg = { k:'s', t:now, a:actors, b:bullets, n:nades, online:clients.size, board, me:packMe(c.a, now), rd, z, bk };
    if(la.length) msg.la = la; if(lr.length) msg.lr = lr; if(crates.length) msg.cr = crates; if(feed.length) msg.feed = feed; if(ev.length) msg.ev = ev;
    ws.send(JSON.stringify(msg));
  }
}
let crateCount = -1;
function brokenCrates(){ // crates that vanished since last snapshot, by position
  const st = SRV.state, crates = st.obs.filter(o => o.kind==='crate'||o.kind==='wwall');
  if(crateCount < 0){ crateCount = crates.length; lastCrates = crates.map(o=>[o.x,o.y]); return []; }
  if(crates.length === crateCount) return [];
  const have = new Set(crates.map(o => o.x+','+o.y));
  const gone = lastCrates.filter(([x,y]) => !have.has(x+','+y));
  crateCount = crates.length; lastCrates = crates.map(o=>[o.x,o.y]);
  return gone;
}
let lastCrates = [], lastMap = null;

server.listen(PORT, () => { console.log(`BLACKWATER public server on port ${PORT}`); loop(); });
