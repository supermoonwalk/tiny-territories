/* Tiny Territories – Fase 0 (realtime, met animatie-expansie)
   - Overlay setup (naam/kleur/map), unieke kleuren
   - Canvas + resize, recentering
   - Land/water mapgen (presets)
   - Tap to choose spawn, spawn bots
   - Radiale expansie (neutral óf attack), met budget & animatie
   - Pan, pinch-zoom, scroll-zoom
   - Realtime income + interest, simpele bot-expansie
*/

////////////////////////////////////////////////////////////
// DOM refs
////////////////////////////////////////////////////////////
// ===== Extra DOM refs =====
const confirmBtn = document.getElementById("confirmBtn");
const progressFill  = document.getElementById("progressFill");
const progressText  = document.getElementById("progressText");
const leaderboardEl = document.getElementById("leaderboard");
const winOverlay    = document.getElementById("winOverlay");
const btnPlayAgain  = document.getElementById("btnPlayAgain");
// Minimap
const minimap = document.getElementById("minimap");
let miniCtx = minimap ? minimap.getContext("2d") : null;


// ===== Win state =====
let gameWon = false;
const canvas   = document.getElementById("game");
const ctx      = canvas.getContext("2d");
const hintEl   = document.getElementById("hint");
const statsEl  = document.getElementById("stats");
const resetBtn = document.getElementById("resetBtn");
const spawnBtn = document.getElementById("spawnBtn");

const overlayEl  = document.getElementById("setupOverlay");
const inpName    = document.getElementById("inpName");
const inpColor   = document.getElementById("inpColor");
const inpMap     = document.getElementById("inpMap");
const btnStart   = document.getElementById("btnStartGame");
const btnRandCol = document.getElementById("btnRandomize");

const budgetEl    = document.getElementById("budgetRange");
const budgetPctEl = document.getElementById("budgetPct");

////////////////////////////////////////////////////////////
// Config
////////////////////////////////////////////////////////////
// Voorbeeld: 2×
// — Economie ticks —
const ECON_INCOME_SECS   = 1;   // basiskapitaal elke 1s
const ECON_INTEREST_SECS = 4;   // rente elke 4s
const MAX_INTEREST       = 0.15; // 15% per interest-tick

let incomeTimer   = 0;
let interestTimer = 0;

// Dynamische rente: veel land + veel goud -> ~0%, weinig+weinig -> ~15%
function interestPctFor(p){
  const land = landCountFor(p.id);

  // huidig goud voor speler vs bots
  const gNow = (p.id === playerId) ? (gold || 0) : (p.gold || 0);

  // Normalisaties (houd het stabiel; pas gerust aan voor balans):
  // - landNorm t.o.v. totale land op de map
  const totL = Math.max(1, totalLand());
  const landNorm = Math.min(1, land / totL);

  // - goldNorm t.o.v. een grove schaal: 2 goud per land als "veel"
  //   (voelt lekker mee met mapgrootte; tweakbaar)
  const goldScale = totL * 2;
  const goldNorm  = Math.min(1, gNow / Math.max(1, goldScale));

  // penalty gemiddeld van land+goud; 0 => max rente, 1 => 0% rente
  const penalty = (landNorm + goldNorm) / 2;

  return MAX_INTEREST * (1 - penalty); // 0..0.15
}
const GRID_W = 184;  // 92 * 2
const GRID_H = 116;  // 58 * 2
// naval combat
const NAVAL_MAX_WATER_STEPS = 30;    // max aantal aaneengesloten watertiles
const NAVAL_COST_PER_WATER  = 2;    // extra kosten per watertegel
// Referentie (origineel) voor schaal
const BASE_W = 92;
const BASE_H = 58;
const AREA_SCALE = (GRID_W * GRID_H) / (BASE_W * BASE_H);
const LIN_SCALE  = Math.sqrt(AREA_SCALE); // gebruik voor radii/afstanden

const WATER   = -2;
const NEUTRAL = -1;

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 15.0;

const COLORS = [
  "#66e4a9", // speler (mint) — default
  "#f36d6d", "#6db5f3", "#f3c96d", "#b36df3", "#6df3e6",
  "#e86df3", "#8ef36d", "#f39d6d", "#6df39b", "#f36dd1",
];

const COLOR_WATER   = "#0a1220";
const COLOR_NEUTRAL = "#3a4252";
const COLOR_GRID    = "rgba(255,255,255,0.06)";
const COLOR_SEL     = "#ffffff";

// Basispresets op originele schaal (92x58)
const MAP_PRESETS_BASE = {
  continents: { blobs: 9,  radiusMin: 8,  radiusMax: 16, landThreshold: 0.40, edgePenalty: 0.8 },
  islands:    { blobs: 18, radiusMin: 5,  radiusMax: 10, landThreshold: 0.55, edgePenalty: 1.0 },
  pangaea:    { blobs: 4,  radiusMin: 18, radiusMax: 26, landThreshold: 0.25, edgePenalty: 0.4 },
  coast:      { blobs: 10, radiusMin: 8,  radiusMax: 16, landThreshold: 0.45, edgePenalty: 0.8, coastBias: true }
};

// Afgeleide presets geschaald naar huidig GRID
const MAP_PRESETS = Object.fromEntries(
  Object.entries(MAP_PRESETS_BASE).map(([k, p]) => [
    k,
    {
      ...p,
      radiusMin: Math.max(3, Math.round(p.radiusMin * LIN_SCALE)),
      radiusMax: Math.max(4, Math.round(p.radiusMax * LIN_SCALE)),
      // landThreshold en edgePenalty laten we gelijk (werkt meestal prima)
    }
  ])
);

////////////////////////////////////////////////////////////
/* View / transform */
////////////////////////////////////////////////////////////
// === Overlay cache (tekenlaag voor namen + logo's) ===
// Een echt overlay-canvas in de DOM (bovenop #game)
const overlayCanvas = document.getElementById('overlay') || (() => {
  const c = document.createElement('canvas');
  c.id = 'overlay';
  c.style.position = 'absolute';
  c.style.left = '0';
  c.style.top = '0';
  c.style.pointerEvents = 'none'; // laat muis/touch door
  // zorg dat de ouder container positioned is
  const parent = canvas.parentNode || document.body;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  parent.appendChild(c);
  return c;
})();
const overlayCx = overlayCanvas.getContext('2d');
let overlayDirty = true;
let pendingNavalExtraCost = 0;
let cell = 12;    // base cell (zoom=1) – wordt in resize bepaald
let ox = 0, oy = 0; // centrering voor zoom=1
let zoom = 1;
let panX = 0, panY = 0; // extra verschuiving in canvas pixels
// === Logos (modulaire emblemen) ===
let logos = {}; // { playerId: { shape, primary, secondary, emblem } }

function darker(hex, f=0.7) { // 0..1 (lager = donkerder)
  const {r,g,b} = hexToRgb(hex);
  return rgbToHex(Math.round(r*f), Math.round(g*f), Math.round(b*f));
}
function hexToRgb(hex) {
  const s = hex.replace('#','');
  const n = s.length===3
    ? [s[0]+s[0], s[1]+s[1], s[2]+s[2]]
    : [s.slice(0,2), s.slice(2,4), s.slice(4,6)];
  return { r: parseInt(n[0],16), g: parseInt(n[1],16), b: parseInt(n[2],16) };
}
function rgbToHex(r,g,b){
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

// Centroid van een rijk (gemiddelde tilepositie)
function centroidForPlayer(pid){
  let sumX=0, sumY=0, n=0;
  for (let i=0;i<owner.length;i++){
    if (owner[i]===pid){ sumX += (i % GRID_W); sumY += ((i/GRID_W)|0); n++; }
  }
  if (!n) return null;
  return { x: sumX/n, y: sumY/n };
}

// Tekenen van logo
function drawLogo(ctx, cx, cy, size, cfg){
  const s = size;            // totale “diameter”
  const r = s*0.5;           // radius voor ronde vormen
  const p = cfg.primary;
  const q = cfg.secondary || darker(cfg.primary, 0.5);
  const shape = cfg.shape || "shield";

  ctx.save();
  ctx.translate(cx, cy);

  // SCHADUW
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.max(2, s*0.08);
  ctx.shadowOffsetY = Math.max(1, s*0.06);

  // Achtergrondvorm
  switch(shape){
    case "circle": {
      // twee halve cirkels
      ctx.beginPath();
      ctx.arc(0,0,r,Math.PI/2, -Math.PI/2); ctx.closePath();
      ctx.fillStyle = p; ctx.fill();
      ctx.beginPath();
      ctx.arc(0,0,r, -Math.PI/2, Math.PI/2); ctx.closePath();
      ctx.fillStyle = q; ctx.fill();
      break;
    }
    case "diamond": {
      // ruit met diagonale split
      ctx.beginPath();
      ctx.moveTo(0,-r); ctx.lineTo(r,0); ctx.lineTo(0,r); ctx.lineTo(-r,0); ctx.closePath();
      ctx.fillStyle = p; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0,-r*0.9); ctx.lineTo(r*0.9,0); ctx.lineTo(0,r*0.9); ctx.lineTo(-r*0.9,0); ctx.closePath();
      ctx.fillStyle = q; ctx.fill();
      break;
    }
    case "hex": {
      const k = (i)=>({x:r*Math.cos(i), y:r*Math.sin(i)});
      const poly = (rad)=> {
        ctx.beginPath();
        for (let i=0;i<6;i++){
          const a = Math.PI/6 + i*Math.PI/3;
          const x = rad*Math.cos(a), y = rad*Math.sin(a);
          (i?ctx.lineTo(x,y):ctx.moveTo(x,y));
        }
        ctx.closePath();
      };
      poly(r); ctx.fillStyle=p; ctx.fill();
      poly(r*0.82); ctx.fillStyle=q; ctx.fill();
      break;
    }
    case "banner": {
      const w=s*0.9, h=s*0.62;
      // vlak
      ctx.fillStyle=p;
      ctx.fillRect(-w/2,-h/2,w,h);
      // rand onder met happen
      ctx.fillStyle=q;
      ctx.beginPath();
      ctx.moveTo(-w/2, h/2);
      ctx.lineTo(-w/8, h/2);
      ctx.lineTo(0,  h/2 - h*0.25);
      ctx.lineTo(w/8, h/2);
      ctx.lineTo(w/2, h/2);
      ctx.lineTo(w/2, h/2 - h*0.35);
      ctx.lineTo(-w/2, h/2 - h*0.35);
      ctx.closePath();
      ctx.fill();
      // stok
      ctx.fillStyle="#222";
      ctx.fillRect(-w/2- s*0.06, -h/2, s*0.06, h);
      break;
    }
    default: // "shield"
    {
      // eenvoudig schild met top-ronding
      const w = s*0.82, h = s*0.95, rad = s*0.18;
      // vorm
      ctx.beginPath();
      ctx.moveTo(-w/2, -h*0.35);
      ctx.quadraticCurveTo(-w/2, -h/2, -w/2+rad, -h/2);
      ctx.lineTo(w/2-rad, -h/2);
      ctx.quadraticCurveTo(w/2, -h/2, w/2, -h*0.35);
      ctx.lineTo(w/2, 0);
      ctx.quadraticCurveTo(w/4, h/2, 0, h/2);
      ctx.quadraticCurveTo(-w/4, h/2, -w/2, 0);
      ctx.closePath();
      ctx.fillStyle = p; ctx.fill();

      // binnenpaneel
      ctx.beginPath();
      ctx.moveTo(-w*0.42, -h*0.28);
      ctx.quadraticCurveTo(-w*0.42, -h*0.42, -w*0.42+rad*0.8, -h*0.42);
      ctx.lineTo(w*0.42-rad*0.8, -h*0.42);
      ctx.quadraticCurveTo(w*0.42, -h*0.42, w*0.42, -h*0.28);
      ctx.lineTo(w*0.42, -h*0.02);
      ctx.quadraticCurveTo(w*0.20, h*0.28, 0, h*0.28);
      ctx.quadraticCurveTo(-w*0.20, h*0.28, -w*0.42, -h*0.02);
      ctx.closePath();
      ctx.fillStyle = q; ctx.fill();
      break;
    }
  }

  // contour
  ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(1, s*0.06);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.stroke();

  // Embleem (emoji/letter)
  const emblem = cfg.emblem || "⚔️";
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(s*0.6)}px system-ui,Segoe UI Emoji,Apple Color Emoji,EmojiOne`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emblem, 0, 0);

  ctx.restore();
}

// Kies een random vorm/emoji voor bots
function randomShape(){ return ["shield","circle","diamond","hex","banner"][Math.floor(Math.random()*5)]; }
function randomEmblem(){
  const opts = ["⚔️","🛡️","🚢","🏰","🐉","🌟","🪙","🔥","🦅","🧭","⛵","🏴‍☠️","🗡️","🎖️"];
  return opts[Math.floor(Math.random()*opts.length)];
}
// ====== Snapshot van tile-statistieken ======
let ownersChanged = true;                 // zet op true als er eigendom wijzigt
let snapCounts = [];                      // [pid] = aantal tiles
let snapSumX = [];                        // [pid] = som x van tiles
let snapSumY = [];                        // [pid] = som y van tiles

function rebuildSnapshot() {
  const n = Math.max(1, players.length);
  snapCounts = new Array(n).fill(0);
  snapSumX   = new Array(n).fill(0);
  snapSumY   = new Array(n).fill(0);

  for (let i = 0; i < owner.length; i++) {
    const pid = owner[i];
    if (pid < 0) continue; // water/neutraal tellen we niet mee
    const x = i % GRID_W, y = (i / GRID_W) | 0;
    if (pid >= snapCounts.length) continue; // safety
    snapCounts[pid]++;
    snapSumX[pid] += x;
    snapSumY[pid] += y;
  }
  ownersChanged = false;
}

// Gebruik deze helpers i.p.v. telkens scannen:
function playerHasSpawned(){ return landCountFor(playerId) > 0; }

function landCountFor(pid) {
  if (ownersChanged) rebuildSnapshot();
  return snapCounts[pid] || 0;
}
function territoryCentroid(pid) {
  if (ownersChanged) rebuildSnapshot();
  const c = snapCounts[pid] || 0;
  if (!c) return null;
  return { x: snapSumX[pid] / c, y: snapSumY[pid] / c };
}
/* === [PATCH A: PERF GLOBALS + HELPERS] =================================== */
// --- Kleur-LUT om players.find(...) te vermijden ---
function fmtGold(v){
  // nette NL-weergave, afgerond naar beneden
  return Math.floor(v).toLocaleString('nl-NL');
}
let colorById = [];
function rebuildColorLUT(){
  colorById.length = 0;
  for (const p of players) colorById[p.id] = p.color;
}

// --- Dirty rendering: alleen tekenen wat verandert ---
const dirty = new Set(); // tile-indexen die opnieuw getekend moeten worden
let viewDirty = true;    // volledige redraw nodig (bv. pan/zoom/resize)
function markTileDirtyByXY(x,y){ dirty.add(idx(x,y)); }
function markTileDirtyByIdx(k){ dirty.add(k); }
// --- Overlay/Logo throttle, 150ms ---
let nextOverlayAt = 0;
/* ======================================================================== */
function recenterNow() {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const drawnW = cell * zoom * GRID_W;
  const drawnH = cell * zoom * GRID_H;
  ox = Math.floor((cssW - drawnW) / 2);
  oy = Math.floor((cssH - drawnH) / 2);
  panX = 0;
  panY = 0;
  viewDirty = true;
  overlayDirty = true;
}

////////////////////////////////////////////////////////////
/* Game state */
// --- Scoring & Achievements ---
let gameStartTs = 0;
let navalAttacks = 0;
let achievements = { landlord:false, speedrunner:false, admiral:false };
let lastScore = 0;

////////////////////////////////////////////////////////////
let lastUpdate     = performance.now();
let goldPerSecond  = 2;
let incomePerTile  = 1;
let attackCost     = 5;     // (referentie) – per tile cost = tileCost
let botIntervalMs  = 1000;
let botTimerMs     = 0;

let gold = 0;
let owner;     // Int16Array owners per cel
let landMask;  // Uint8Array: 1=land, 0=water
let playerId = 0;
let players = [];           // [{id,color,alive,name}]
let botDensity = "medium";
let autoBotsSpawnedOnce = false;
let botsActive = false;  // bots economy/AI only after player spawns
let selected = null;
let loopStarted = false;

let investPct   = 0.50;     // 0..1
const tileCost  = 5;        // kosten per tile (koppeling met attackCost)

let playerName  = "Speler";
let playerColor = "#66e4a9";
let mapPreset   = "continents";

// radial marker / mode
let pendingCenter = null;       // {x,y}
let pendingMode   = null;       // 'neutral' | 'attack'
let pendingTarget = null;       // enemy id bij attack

// animatie-structuur
let expansionAnim = null;       // { tiles:[{x,y,toPid}], spent, mode, tilesPerSecond, cursor }
// --- NAVAL LANDING ANIM ---
let navalAnim = null; // { path:[{x,y}], step:0, speed, target:{x,y,targetId}, startedAt }
////////////////////////////////////////////////////////////
// --- BOT NAME GENERATOR (500+ combinaties, deterministisch) ---
const NAME_A = [
  "Astra","Baron","Crim","Dread","Ebon","Ferro","Grim","Hex","Ivory","Jade",
  "Kilo","Lumen","Morn","Nero","Obsi","Pyre","Quen","Rift","Slate","Thorn",
  "Umbra","Vanta","Wraith","Xeno","Yonder","Zephyr","Argo","Basil","Cinder","Drake",
  "Elder","Fang","Gale","Helix","Iron","Jolt","Keen","Lotus","Magma","Nimbus",
  "Omen","Pylon","Quill","Razor","Sable","Tempest","Umber","Vigil","Ward","Xan"
];
const NAME_B = [
  "guard","watch","forge","spire","hold","reach","fall","crest","crown","helm",
  "shade","warren","mark","field","gate","haven","brook","peak","keep","rock",
  "den","moor","grove","bay","shore","coast","marsh","ridge","run","rise",
  "point","hollow","bend","tide","storm","flats","vault","rift","bloom","sand",
  "waste","delta","pass","steppe","hearth","meadow","thicket","heights","vale","plain"
];
// levert 50 * 50 = 2500 unieke namen
let __botNameIdx = 0;
function nextBotName() {
  const i = __botNameIdx++;
  const a = NAME_A[i % NAME_A.length];
  const b = NAME_B[Math.floor(i / NAME_A.length) % NAME_B.length];
  return `${a}${b}`;
}
// Helpers
////////////////////////////////////////////////////////////
// Bepaal zwaartepunt (centroid) van alle tiles van een speler

// === BOT-AI HELPERS ===

// Vind alle buur-tegels (4-dir) die land zijn
function frontierNeighborsOf(pid){
  // geeft een Set van indices k die land zijn en grenzen aan pid
  const result = new Set();
  for (let i=0;i<owner.length;i++){
    if (owner[i] !== pid) continue;
    const x = i % GRID_W, y = (i/GRID_W)|0;
    for (const [ax,ay] of neighbors4(x,y)) {
      const k = idx(ax,ay);
      if (landMask[k] === 1) result.add(k);
    }
  }
  return result;
}

// Tel per vijand hoeveel frontier-tiles direct aan bot grenzen
function enemyPressureMap(botId){
  const neigh = frontierNeighborsOf(botId);
  const map = new Map(); // enemyId -> count
  for (const k of neigh){
    const o = owner[k];
    if (o>=0 && o!==botId){
      map.set(o, (map.get(o)||0)+1);
    }
  }
  return map;
}

// Kies een targetId o.b.v. druk (veel grenscontact) en nabijheid
function chooseAttackTarget(botId){
  const pressure = enemyPressureMap(botId);
  if (pressure.size===0) return null;
  // maak gewogen lijst op basis van pressure
  const entries = [...pressure.entries()]; // [enemyId, count]
  entries.sort((a,b)=> b[1]-a[1]);
  // top-2 wat bias geven
  const pool = [];
  entries.forEach(([eid,count],i)=>{
    const weight = (i===0)? 3 : (i===1)? 2 : 1;
    for (let w=0; w<weight; w++) pool.push(eid);
  });
  return pool.length ? pool[Math.floor(Math.random()*pool.length)] : null;
}

// “PseudoBudget” voor bots: schaal met landgrootte
function botPseudoBudgetFor(pid){
  const size = landCountFor(pid);
  // basaal: groeit met gebied, lichte compressie
  // min 6, max ~ afhankelijk van grid
  return Math.max(6, Math.floor( (4 + Math.sqrt(size)*2) ));
}
function tileCenterToScreen(x, y){
  const ec = cell * zoom;
  const sx = ox + panX + (x + 0.5) * ec;
  const sy = oy + panY + (y + 0.5) * ec;
  return { sx, sy };
}

function showConfirmAtTile(x, y, mode){
  const { sx, sy } = tileCenterToScreen(x, y); // bitmap-pixels
  confirmBtn.classList.remove("hidden", "attack");
  confirmBtn.classList.toggle("attack", mode === "attack");
  confirmBtn.textContent = (mode === "attack") ? "⚔️" : "➕";
  confirmBtn.style.left = sx + "px";
  confirmBtn.style.top  = sy + "px";
}

function hideConfirm(){ confirmBtn.classList.add("hidden"); }

function ensureLoop() {
  if (!loopStarted) {
    loopStarted = true;
    lastUpdate = performance.now();
    requestAnimationFrame(gameLoop);
  }
}
// Groeit vanaf de volledige frontier van meId, in lagen (parallel per laag).
// mode: 'neutral' | 'attack'; targetId alleen gebruiken bij 'attack'.
// Geeft terug: { tiles: Array<{x,y,toPid,layer,seedId}>, layers: Array<Array<...>>, navalExtra: number }
function collectFromFrontier(
  maxTiles,
  mode = 'neutral',
  targetId = null,
  refX = null,
  refY = null,
  meId = playerId
) {
  const eligible = (k) => {
    if (landMask[k] !== 1) return false;                 // alleen land
    if (mode === 'neutral') return owner[k] === NEUTRAL; // neutraal
    if (mode === 'attack')  return owner[k] === targetId;// specifieke vijand
    return false;
  };

  const seeds = [];              // {k, navalSteps}
  const seen  = new Uint8Array(GRID_W * GRID_H);

  // a) Land-seeds: eligible tiles die grenzen aan meId
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const k = idx(x, y);
      if (!eligible(k)) continue;
      let touches = false;
      for (const [ax, ay] of neighbors4(x, y)) {
        if (owner[idx(ax, ay)] === meId) { touches = true; break; }
      }
      if (!touches) continue;
      seeds.push({ k, navalSteps: 0 });
      seen[k] = 1;
    }
  }

  // b) Naval-seeds: enemy coastal tiles bereikbaar via water (alleen bij attack)
  if (mode === 'attack' && targetId != null) {
    // mijn kust-tiles
    const myCoasts = [];
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== meId) continue;
      const x = i % GRID_W, y = (i / GRID_W) | 0;
      if (neighbors4(x, y).some(([ax, ay]) => landMask[idx(ax, ay)] === 0)) {
        myCoasts.push([x, y]);
      }
    }
    // vijandelijke kust-tiles
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== targetId) continue;
      const ex = i % GRID_W, ey = (i / GRID_W) | 0;
      // moet kust zijn
      if (!neighbors4(ex, ey).some(([ax, ay]) => landMask[idx(ax, ay)] === 0)) continue;

      // klik-bias: vermijd extreem ver weg
      if (refX != null && refY != null) {
        const d2 = (ex - refX) * (ex - refX) + (ey - refY) * (ey - refY);
        const maxD2 = (Math.max(GRID_W, GRID_H) * 1.35) ** 2;
        if (d2 > maxD2) continue;
      }

      // check waterpad vanaf één van mijn kust-tiles
      let bestSteps = null;
      for (const [sx, sy] of myCoasts) {
        const steps = waterPathExistsLimited(sx, sy, ex, ey, NAVAL_MAX_WATER_STEPS);
        if (steps != null) {
          if (bestSteps == null || steps < bestSteps) bestSteps = steps;
          if (bestSteps <= 2) break; // early accept
        }
      }
      if (bestSteps != null) {
        const k = idx(ex, ey);
        if (!seen[k]) {
          seeds.push({ k, navalSteps: bestSteps });
          seen[k] = 1;
        }
      }
    }
  }

  if (!seeds.length) return { tiles: [], layers: [], navalExtra: 0 };

  // c) klik-bias: seeds dichter bij ref eerst
  if (refX != null && refY != null) {
    seeds.sort((a, b) => {
      const ax = a.k % GRID_W, ay = (a.k / GRID_W) | 0;
      const bx = b.k % GRID_W, by = (b.k / GRID_W) | 0;
      const da = (ax - refX) * (ax - refX) + (ay - refY) * (ay - refY);
      const db = (bx - refX) * (bx - refX) + (by - refY) * (by - refY);
      return da - db;
    });
  }

  // d) BFS/wave met lagen
  const q = [];
  seeds.forEach((s, i) => q.push({ k: s.k, layer: 0, seedId: i }));
  const out = []; // {x,y,toPid,layer,seedId}

  // safety: niet eindeloos; we snoeien straks toch op maxTiles
  const HARD_CAP = Math.min(GRID_W * GRID_H, maxTiles * 3 || GRID_W * GRID_H);
  while (q.length && out.length < HARD_CAP) {
    const { k, layer, seedId } = q.shift();
    const x = k % GRID_W, y = (k / GRID_W) | 0;

    out.push({ x, y, toPid: meId, layer, seedId });

    for (const [ax, ay] of neighbors4(x, y)) {
      const nk = idx(ax, ay);
      if (!seen[nk] && eligible(nk)) {
        seen[nk] = 1;
        q.push({ k: nk, layer: layer + 1, seedId });
      }
    }
  }

  // e) naar lagen groeperen + afkappen op budget (maxTiles)
  out.sort((a, b) => a.layer - b.layer);
  const layersMap = new Map();
  for (const t of out) {
    if (!layersMap.has(t.layer)) layersMap.set(t.layer, []);
    layersMap.get(t.layer).push(t);
  }
  const sortedLayers = [...layersMap.keys()].sort((a, b) => a - b).map(L => layersMap.get(L));

  const chosenLayers = [];
  const chosenTiles  = [];
  let used = 0;
  for (const layerTiles of sortedLayers) {
    if (used >= maxTiles) break;
    if (used + layerTiles.length <= maxTiles) {
      chosenLayers.push(layerTiles);
      chosenTiles.push(...layerTiles);
      used += layerTiles.length;
    } else {
      const rest = maxTiles - used;
      if (rest > 0) {
        chosenLayers.push(layerTiles.slice(0, rest));
        chosenTiles.push(...layerTiles.slice(0, rest));
        used += rest;
      }
      break;
    }
  }

  // f) naval-extra kosten: unieke gebruikte seeds optellen
  const usedSeedIds = new Set(chosenTiles.map(t => t.seedId));
  let navalExtra = 0;
  for (const sid of usedSeedIds) {
    const steps = seeds[sid]?.navalSteps || 0;
    if (steps > 0) navalExtra += steps * NAVAL_COST_PER_WATER;
  }

  return { tiles: chosenTiles, layers: chosenLayers, navalExtra };
}
function isCoastal(x,y, pid){
  if (owner[idx(x,y)] !== pid) return false;
  return neighbors4(x,y).some(([ax,ay]) => landMask[idx(ax,ay)]===0); // grenst aan water
}
// BFS over water die de HELE ROUTE teruggeeft tot naast de target-kusttile
function waterPathWithPathLimited(sx, sy, tx, ty, maxWater) {
  const W = GRID_W, H = GRID_H;
  const seen = new Uint8Array(W * H);
  const parent = new Int32Array(W * H).fill(-1);
  const q = [];

  // start vanaf alle waterburen van jouw kusttile
  for (const [ax, ay] of neighbors4(sx, sy)) {
    if (landMask[idx(ax, ay)] === 0) {
      q.push([ax, ay, 1]);
      seen[idx(ax, ay)] = 1;
      parent[idx(ax, ay)] = idx(sx, sy); // parent van eerste waterstap wijst naar kust
    }
  }

  let endK = -1;
  while (q.length) {
    const [x, y, d] = q.shift();
    if (d > maxWater) continue;

    // als deze watertile grenst aan doel-kust, dan zijn we klaar
    for (const [nx, ny] of neighbors4(x, y)) {
      if (nx === tx && ny === ty) {
        endK = idx(x, y);
        break;
      }
    }
    if (endK !== -1) break;

    for (const [nx, ny] of neighbors4(x, y)) {
      const k = idx(nx, ny);
      if (landMask[k] === 0 && !seen[k]) {
        seen[k] = 1;
        parent[k] = idx(x, y);
        q.push([nx, ny, d + 1]);
      }
    }
  }

  if (endK === -1) return null;

  // reconstrueer waterroute van endK terug naar eerste waterstap
  const route = [];
  let cur = endK;
  while (cur !== -1) {
    const x = cur % GRID_W, y = (cur / GRID_W) | 0;
    if (landMask[cur] === 0) route.push({ x, y });
    const p = parent[cur];
    if (p === -1) break;
    cur = p;
  }
  route.reverse();
  return route;
}

// Vind een zee-route tussen EEN eigen kusttile en EEN vijandelijke kusttile nabij de klik
function findNavalRoute(refX, refY, meId, enemyId) {
  // verzamel mijn kust
  const myCoasts = [];
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== meId) continue;
    const x = i % GRID_W, y = (i / GRID_W) | 0;
    if (neighbors4(x, y).some(([ax, ay]) => landMask[idx(ax, ay)] === 0)) {
      myCoasts.push([x, y]);
    }
  }
  if (!myCoasts.length) return null;

  // vijandelijke kust, gesorteerd op nabijheid t.o.v. klik
  const enemyCoasts = [];
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== enemyId) continue;
    const x = i % GRID_W, y = (i / GRID_W) | 0;
    if (neighbors4(x, y).some(([ax, ay]) => landMask[idx(ax, ay)] === 0)) {
      enemyCoasts.push([x, y]);
    }
  }
  if (!enemyCoasts.length) return null;

  enemyCoasts.sort((a, b) => {
    const da = (a[0] - refX) ** 2 + (a[1] - refY) ** 2;
    const db = (b[0] - refX) ** 2 + (b[1] - refY) ** 2;
    return da - db;
  });

  // probeer dichtstbijzijnde enemy-kusten eerst; kies kortste route
  let best = null;
  for (const [ex, ey] of enemyCoasts) {
    let bestRoute = null, bestPair = null;
    for (const [sx, sy] of myCoasts) {
      const r = waterPathWithPathLimited(sx, sy, ex, ey, NAVAL_MAX_WATER_STEPS);
      if (r) {
        if (!bestRoute || r.length < bestRoute.length) {
          bestRoute = r;
          bestPair = [sx, sy];
        }
      }
    }
    if (bestRoute) {
      best = { route: bestRoute, from: { x: bestPair[0], y: bestPair[1] }, to: { x: ex, y: ey } };
      break; // dichtstbijzijnde enemy‑kust met route volstaat
    }
  }
  return best;
}
// BFS over water tussen (sx,sy) en (tx,ty) met limiet
function waterPathExistsLimited(sx,sy, tx,ty, maxWater){
  const seen = new Uint8Array(GRID_W*GRID_H);
  const q = [];
  // start vanaf alle waterburen van jouw kusttile
  for (const [ax,ay] of neighbors4(sx,sy)){
    if (landMask[idx(ax,ay)]===0){ q.push([ax,ay,1]); seen[idx(ax,ay)]=1; }
  }
  while(q.length){
    const [x,y,d]=q.shift();
    if (d>maxWater) continue;
    // als deze watertile grenst aan target
    for (const [nx,ny] of neighbors4(x,y)){
      const k = idx(nx,ny);
      if (nx===tx && ny===ty) return d;                // gevonden
      if (landMask[k]===0 && !seen[k]){                // water → doorgaan
        seen[k]=1; q.push([nx,ny,d+1]);
      }
    }
  }
  return null;
}
const idx = (x,y) => y*GRID_W + x;
const inBounds = (x,y)=> x>=0 && y>=0 && x<GRID_W && y<GRID_H;
const neighbors4 = (x,y)=>[[x+1,y],[x-1,y],[x,y+1],[x,y-1]].filter(([a,b])=>inBounds(a,b));

function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function clamp(min,max,v){ return Math.max(min, Math.min(max, v)); }
function smoothstep(edge0, edge1, x) {
  let t = clamp(0,1,(x-edge0)/(edge1-edge0 || 1));
  return t*t*(3-2*t);
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function randomHexColor() {
  const r = Math.floor(Math.random()*256).toString(16).padStart(2,"0");
  const g = Math.floor(Math.random()*256).toString(16).padStart(2,"0");
  const b = Math.floor(Math.random()*256).toString(16).padStart(2,"0");
  return `#${r}${g}${b}`;
}

function tilesInCircle(cx, cy, r){
  const out = [];
  const r2 = r*r;
  const minX = Math.max(0, Math.floor(cx - r) );
  const maxX = Math.min(GRID_W-1, Math.ceil (cx + r) );
  const minY = Math.max(0, Math.floor(cy - r) );
  const maxY = Math.min(GRID_H-1, Math.ceil (cy + r) );
  for (let y=minY; y<=maxY; y++){
    for (let x=minX; x<=maxX; x++){
      const dx=x-cx, dy=y-cy, d2 = dx*dx+dy*dy;
      if (d2 <= r2) out.push({x,y,d2});
    }
  }
  out.sort((a,b)=> a.d2 - b.d2); // dichtbij eerst
  return out;
}
function radiusFromBudget(budget){
  if (budget < tileCost) return 0;
  const maxTiles = Math.floor(budget / tileCost);
  const r = Math.floor(Math.sqrt(maxTiles / Math.PI));
  return Math.max(0, r);
}

function totalLand(){
  let c=0;
  for (let i=0;i<landMask.length;i++) if (landMask[i]===1) c++;
  return c;
}

function computeBotCount(landTiles, density){
  let frac, minB, maxB;
  switch ((density||"medium").toLowerCase()){
    case "low":    frac = 0.003; minB=12;  maxB=60;  break;  // ~0.3%
    case "high":   frac = 0.010; minB=40;  maxB=160; break;  // ~1.0%
    case "medium":
    default:       frac = 0.006; minB=24;  maxB=100; break;  // ~0.6%
  }
  let n = Math.round(landTiles * frac);
  if (n < minB) n = minB;
  if (n > maxB) n = maxB;
  return n;
}

function triggerWin(){
  gameWon = true;
  winOverlay?.classList.remove("hidden");
  hintEl.textContent = "Je hebt gewonnen!";
}
// herteken-interval voor leaderboard (throttle)
let lastLeaderboardTs = 0;

// === Compact leaderboard: top-5 + altijd jijzelf, alleen logo + size ===
function rebuildLeaderboard(){
  if (!leaderboardEl) return;

  // Huidige groottes
  const rows = players
    .map(p => ({ p, size: landCountFor(p.id) }))
    .filter(r => r.size > 0)
    .sort((a,b) => b.size - a.size);

  // Bepaal rank per speler
  const rankById = new Map();
  rows.forEach((r, i) => rankById.set(r.p.id, i + 1));

  // Top 5
  const top5 = rows.slice(0, 5);

  // Mijn rij (los toevoegen als niet in top 5)
  const myRank = rankById.get(playerId);
  const myRow  = rows.find(r => r.p.id === playerId);
  const showMineSeparately = myRow && myRank > 5;

  // Opbouw HTML
  const renderRow = (r, isMe=false) => `
    <div class="lb-row ${isMe ? 'lb-me' : ''}" data-pid="${r.p.id}">
      <div class="lb-rank">${rankById.get(r.p.id)}</div>
      <canvas class="lb-logo" width="18" height="18"></canvas>
      <div class="lb-size">${r.size}</div>
    </div>`;

  leaderboardEl.innerHTML =
    top5.map(r => renderRow(r, r.p.id === playerId)).join('') +
    (showMineSeparately ? renderRow(myRow, true) : '');

  // Teken logo's
  leaderboardEl.querySelectorAll('.lb-row').forEach(node => {
    const pid = Number(node.getAttribute('data-pid'));
    const cv  = node.querySelector('canvas');
    const g   = cv.getContext('2d');
    g.clearRect(0,0,cv.width,cv.height);
    const cfg = logos[pid] || { shape:'circle', primary:'#888', secondary:'#555', emblem:'⚑' };
    drawLogo(g, cv.width/2, cv.height/2, Math.min(cv.width, cv.height)*0.95, cfg);
  });
}
////////////////////////////////////////////////////////////
// Map generation
////////////////////////////////////////////////////////////
function generateMap() {
  const P = MAP_PRESETS[mapPreset] || MAP_PRESETS.continents;

  owner    = new Int16Array(GRID_W*GRID_H).fill(NEUTRAL);
  landMask = new Uint8Array(GRID_W*GRID_H).fill(0);
ownersChanged = true;
  const blobs   = P.blobs;
  const radii   = Array.from({length: blobs}, ()=> randInt(P.radiusMin, P.radiusMax));
  const centers = Array.from({length: blobs}, ()=> [randInt(8, GRID_W-8), randInt(8, GRID_H-8)]);

  for (let y=0;y<GRID_H;y++){
    for (let x=0;x<GRID_W;x++){
      let v = 0;
      for (let i=0;i<blobs;i++){
        const [cx,cy] = centers[i];
        const dx=x-cx, dy=y-cy;
        const d = Math.sqrt(dx*dx+dy*dy);
        v += smoothstep(radii[i], 0, d);
      }
      const edge = Math.min(x, y, GRID_W-1-x, GRID_H-1-y);
      const edgePenalty = clamp(0, 1, (10-edge)/10) * (P.edgePenalty ?? 0.8);
      v -= edgePenalty;
      if (P.coastBias) {
        const coast = 1 - (x / (GRID_W - 1));
        v += coast * 0.35;
      }
      if (v >= (P.landThreshold ?? 0.4)) landMask[idx(x,y)] = 1;
    }
  }

  // water markeren
  for (let i=0;i<owner.length;i++){
   if (landMask[i]===0) { owner[i]=WATER; /* full redraw volgt toch */ }
}
  pruneTinyIslands();

  // Auto-spawn bots based on land size (Medium density) once per map
  try {
    if (!autoBotsSpawnedOnce) {
      const land = totalLand();
      const nBots = computeBotCount(land, botDensity);
      if (typeof spawnBots === "function") {
        spawnBots(nBots);
        autoBotsSpawnedOnce = true;
        if (spawnBtn) spawnBtn.disabled = true;
        if (hintEl) hintEl.textContent = "Bots staan klaar. Kies je startpositie — dan gaan ze lopen.";
        overlayDirty = true;
      }
    }
  } catch(e){ console.warn("Auto-bot spawn failed:", e); }
}

function pruneTinyIslands() {
  const seen = new Uint8Array(GRID_W*GRID_H);
  for (let y=0;y<GRID_H;y++){
    for (let x=0;x<GRID_W;x++){
      const i = idx(x,y);
      if (landMask[i]===1 && !seen[i]) {
        const comp = floodCollect(x,y, seen);
        // Oud: if (comp.length < 12) {
const MIN_ISLAND = Math.max(12, Math.round(12 * AREA_SCALE * 0.5)); // iets milder schalen
if (comp.length < MIN_ISLAND) {
  for (const j of comp) { landMask[j]=0; owner[j]=WATER; }
}
        }
      }
    }
  }

function floodCollect(sx,sy, seen){
  const q=[[sx,sy]]; seen[idx(sx,sy)]=1;
  const out=[idx(sx,sy)];
  while(q.length){
    const [x,y]=q.pop();
    for (const [nx,ny] of neighbors4(x,y)) {
      const k=idx(nx,ny);
      if (!seen[k] && landMask[k]===1) { seen[k]=1; q.push([nx,ny]); out.push(k); }
    }
  }
  return out;
}

////////////////////////////////////////////////////////////
// Bots
////////////////////////////////////////////////////////////
// === FRONT LOCKS ===
// Map<tileIndex, { pid:number, until:number(ms) }>
const frontLocks = new Map();

function lockTilesForBattle(tiles, attackerPid, ms){
  const until = performance.now() + ms;
  for (const t of tiles){
    const k = idx(t.x, t.y);
    const L = frontLocks.get(k);
    // alleen overschrijven als leeg of eerder verlopen, of dezelfde aanvaller
    if (!L || L.until <= performance.now() || L.pid === attackerPid){
      frontLocks.set(k, { pid: attackerPid, until });
    }
  }
}

function isLockedByOther(tileIndex, mePid){
  const L = frontLocks.get(tileIndex);
  if (!L) return false;
  if (L.until <= performance.now()){ frontLocks.delete(tileIndex); return false; }
  return L.pid !== mePid;
}

function cleanupLocks(ts){
  // ts is performance.now() uit gameLoop
  if (!frontLocks.size) return;
  for (const [k, L] of frontLocks){
    if (L.until <= ts) frontLocks.delete(k);
  }
}
function botExpand() {
  const now = performance.now();

  for (const bot of players) {
    if (!bot || bot.id === playerId || !bot.alive || !bot.isBot) continue;
    if (landCountFor(bot.id) === 0) continue;

    const ai = bot.ai;
    if (!ai) continue;

    // Beslis-timer
    if (now < (ai.nextAt || 0)) continue;
    const wait = randInt(ai.intervalMin, ai.intervalMax);
    ai.nextAt = now + wait;

    // 1) Kies modus (neutral/attack) en target
    let mode = "neutral";
    let targetId = null;
    if (Math.random() < ai.attackChance) {
      const cand = chooseAttackTarget(bot.id);
      if (cand != null) { mode = "attack"; targetId = cand; }
    }

    // 2) Bepaal investeringsbudget (in goud) volgens profiel
    const pct = randInt(ai.budgetPctMin, ai.budgetPctMax) / 100;
    const available = Math.floor((bot.gold ?? 0));
    const investGold = Math.floor(available * pct);
    if (investGold < tileCost) continue; // niets te besteden

    // 3) Initiele max tiles & seed-bias (centroid)
    let maxTiles = Math.max(1, Math.floor(investGold / tileCost));
    const c = territoryCentroid(bot.id) || { x: (GRID_W/2)|0, y: (GRID_H/2)|0 };

    // 4) Verzamel lagen (radiaal over héle frontier, net als speler)
    let pack = collectFromFrontier(maxTiles, mode, targetId, (c.x|0), (c.y|0), bot.id);
    if (!pack.layers || !pack.layers.length) continue;

    // 5) Kosten checken (tiles + naval-extra). Indien te duur, schaal terug.
    let tilesCount = pack.tiles.length;
    let totalCost  = tilesCount * tileCost + (pack.navalExtra || 0);

    if (totalCost > available) {
      // Herbereken met betaalbare tiles (naval extra blijft meerekenen)
      const affordableTiles = Math.max(0, Math.floor((available - (pack.navalExtra || 0)) / tileCost));
      if (affordableTiles <= 0) continue;
      pack = collectFromFrontier(affordableTiles, mode, targetId, (c.x|0), (c.y|0), bot.id);
      tilesCount = pack.tiles.length;
      totalCost  = tilesCount * tileCost + (pack.navalExtra || 0);
      if (tilesCount <= 0 || totalCost > available) continue;
    }

    // 6) Verdedigingslogica (alleen bij attack)
  if (mode === "attack" && targetId != null && tilesCount > 0) {
  const areaB = Math.max(1, landCountFor(bot.id));
  const TPS   = clamp(10, 900, 25 * (1 + Math.log2(1 + areaB)));
  const estMs = Math.min(6000, Math.max(600, Math.round((tilesCount / Math.max(1, TPS)) * 1000)));
  lockTilesForBattle(pack.tiles, bot.id, estMs + 300);
}

    // Als alles is wegverdedigd, niets doen
    if (!pack.layers.length || tilesCount <= 0) continue;

    // 7) Pas 1..N lagen toe (parallel binnen de laag), begrens door budget
    const maxLayers = Math.max(1, ai.layersPerDecision);
    let appliedTiles = 0;

    for (let li = 0; li < pack.layers.length && li < maxLayers; li++) {
      const L = pack.layers[li];
      for (const t of L) {
        const k = idx(t.x, t.y);
        // respecteer locks: niet door andermans actieve aanval heen schilderen
        if (!isLockedByOther(k, bot.id)) {
          owner[k] = bot.id;
          ownersChanged = true;
          markTileDirtyByIdx(k);
        }
        appliedTiles++;
        if (appliedTiles >= tilesCount) break;
      }
      if (appliedTiles >= tilesCount) break;
    }

    // 8) Betaal aanvalskosten
    bot.gold = (bot.gold ?? 0) - totalCost;
    if (bot.gold < 0) bot.gold = 0;

    overlayDirty = true;
  }
}

////////////////////////////////////////////////////////////
// Init / reset / start
////////////////////////////////////////////////////////////
function startFromMenu() {
  try {
    const _d = document.getElementById('inpDensity');
    if (_d && _d.value) botDensity = _d.value;
  } catch(e) {}

  overlayEl.style.display = "none";
ownersChanged = true;
  players = [{ id: 0, color: playerColor, alive: true, name: playerName }];
rebuildColorLUT();   // <— NIEUW (Stap E)
viewDirty = true;  
overlayDirty= true; // zodat alles 1x opnieuw tekent
// Speler-logo op basis van gekozen kleur (of default)
logos[0] = {
  shape: "shield",                // startvorm speler
  primary: playerColor,           // hoofdkleur = spelerskleur
  secondary: darker(playerColor), // autom. donkerder
  emblem: "⚔️"                    // of wat je wil
};
  generateMap();

  // Reset view + state
  selected = null;
  pendingCenter = null;
  pendingMode = null;
  pendingTarget = null;
  expansionAnim = null;
  gold = 10;
  zoom = 1;
  resize();        // berekent cell/ox/oy
recenterNow();
panX = 0;
panY = 0;   // pan reset + centreren
render();
  hintEl.textContent = "Tik een landtile om je startpositie te kiezen.";
  spawnBtn.disabled  = true;

  updateStats();
  render();
}

function resetGame() {
  generateMap(); // gebruikt huidige preset
 players  = [{ id: 0, color: playerColor, alive: true, name: playerName }];
rebuildColorLUT();   // <— NIEUW (Stap E)
viewDirty = true;
overlayDirty = true;
  selected = null;
  pendingCenter = null;
  pendingMode = null;
  pendingTarget = null;
  expansionAnim = null;
  gold     = 10;

  zoom = 1;
  resize();
zoom = 1;
recenterNow();
panX = 0;
panY = 0;
ownersChanged= true;
  hintEl.textContent = "Tik een landtile om je startpositie te kiezen.";
  spawnBtn.disabled  = true;

  updateStats();
  render();
  gameWon = false;
  winOverlay?.classList.add("hidden");
}

////////////////////////////////////////////////////////////
// Spawns
////////////////////////////////////////////////////////////
function placePlayerAt(x,y, pid=0) {
  if (!inBounds(x,y)) return false;
  const i = idx(x,y);
  if (owner[i]!==NEUTRAL || landMask[i]===0) return false;
  owner[i]=pid;
  ownersChanged = true;
markTileDirtyByIdx(i);
overlayDirty = true; // [PATCH C]
return true;
}
function spawnBots(n = 10) {
  // Maak een kleurenpool zonder spelerskleur én zonder al toegewezen kleuren
  const used = new Set(players.map(p => p.color.toLowerCase()));
  used.add(playerColor.toLowerCase());

  const pool = COLORS
    .map(c => c.toLowerCase())
    .filter(c => !used.has(c));

  // spawn-afstand en pogingen
  const SAFE_DIST = Math.max(12, Math.round(12 * LIN_SCALE * 0.8));
  const MAX_ATTEMPTS = 8000;

  let attempts = 0;
  let placed   = 0;

  while (placed < n && attempts < MAX_ATTEMPTS) {
    attempts++;

    // Kies locatie
    const x = randInt(0, GRID_W - 1);
    const y = randInt(0, GRID_H - 1);
    const k = idx(x, y);

    // Alleen land, neutraal, en niet te dicht bij de speler
    if (landMask[k] !== 1 || owner[k] !== NEUTRAL) continue;
    if (distanceToNearestOwned(x, y, playerId) < SAFE_DIST) continue;

    // Kies kleur (eerst uit pool, anders willekeurig als pool leeg is)
    const botColor = pool.length ? pool.shift() : randomHexColor();
    const pid = players.length;

    // Maak bot + AI-profiel
    const persona = ["spender","saver","balancer"][Math.floor(Math.random()*3)];
    const botName = nextBotName();

    players.push({
      id: pid,
      color: botColor,
      alive: true,
      name: botName,
      isBot: true,
      gold: 10,
      ai: {
        type: persona,
        nextAt: performance.now() + (1500 + Math.random()*1500),
        intervalMin: 2500,
        intervalMax: 4500,
        budgetPctMin: (persona==="saver") ? 35 : (persona==="spender") ? 70 : 50,
        budgetPctMax: (persona==="saver") ? 55 : (persona==="spender") ? 95 : 75,
        attackChance: (persona==="saver") ? 0.25 : (persona==="spender") ? 0.60 : 0.40,
        layersPerDecision: (persona==="spender") ? 3 : (persona==="saver") ? 1 : 2,
        speedFactor: (persona==="spender") ? 1.25 : (persona==="saver") ? 0.85 : 1.0,
      },
    });

    // Registreer logo (vorm/embleem random)
    logos[pid] = {
      shape: randomShape(),
      primary: botColor,
      secondary: darker(botColor, 0.55),
      emblem: randomEmblem(),
    };

    // Claim starttile
    owner[k] = pid;
markTileDirtyByIdx(k); // [PATCH C]
overlayDirty = true;
ownersChanged = true;
    placed++;
  }

  if (placed === 0) {
    hintEl.textContent = "Geen geschikte spawnplekken gevonden. Probeer opnieuw of kies een andere map.";
  } else if (placed < n) {
    hintEl.textContent = `Er zijn ${placed} bot(s) gespawned (beperkt door ruimte/kleuren).`;
  } else {
    hintEl.textContent = "Kies neutraal (wit) of vijand (rood) en bevestig voor een radiale actie.";
  }
rebuildColorLUT();   // <— NIEUW (Stap E)
viewDirty = true;
  updateStats();
  render();
  viewDirty = true;
}

function distanceToNearestOwned(x,y,pid){
  let best=1e9;
  for (let yy=0; yy<GRID_H; yy++){
    for (let xx=0; xx<GRID_W; xx++){
      if (owner[idx(xx,yy)]===pid){
        const d = Math.abs(xx-x)+Math.abs(yy-y);
        if (d<best) best=d;
      }
    }
  }
  return best;
}

////////////////////////////////////////////////////////////
// Input mapping
////////////////////////////////////////////////////////////
function canvasPointFromClientXY(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  // CSS-pixels (géén dpr vermenigvuldiging)
  return { x: cx - rect.left, y: cy - rect.top };
}
function canvasPointFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  return { x, y }; // CSS-pixels
}

////////////////////////////////////////////////////////////
// Radiale expansie – ANIMATIE
////////////////////////////////////////////////////////////
function queueRadialExpansion(cx, cy, mode = "neutral", targetId = null) {
  if (expansionAnim || gameWon) return;

  // 1) Budget → max tiles
  const budget   = Math.floor(gold * investPct);
  const maxTiles = Math.floor(budget / tileCost);
  if (maxTiles <= 0) {
    hintEl.textContent = "Te weinig budget voor expansie.";
    return;
  }

  // 2) Verzamel tegels (met lagen) + evt. naval-extra
  let { tiles, layers, navalExtra } = collectFromFrontier(
    maxTiles, mode, targetId, cx, cy, playerId
  );

  if (!tiles.length) {
    hintEl.textContent = (mode === "attack")
      ? "Geen aanvalsdoelen aan je grens (of via zee)."
      : "Geen neutrale tegels aan je grens.";
    pendingCenter = null; pendingMode = null; pendingTarget = null;
    window.pendingNavalExtraCost = 0;
    hideConfirm();
    return;
  }

  // 3) Kosten checken (tiles + naval)
  \1if ((navalExtra||0) > 0) navalAttacks++; // track naval usage
if (gold < totalCost) {
    hintEl.textContent = `Niet genoeg goud! Nodig: ${totalCost}, je hebt: ${Math.floor(gold)}.`;
    pendingCenter = null; pendingMode = null; pendingTarget = null;
    window.pendingNavalExtraCost = 0;
    hideConfirm();
    return;
  }

  // 4) Betaal aanvaller (geen verdediging meer)
  gold -= totalCost;

  // Als alles om wat voor reden dan ook leeg zou zijn, stop
  if (!layers.length || !tiles.length) {
    hintEl.textContent = "Geen geldige tegels gevonden.";
    pendingCenter = null; pendingMode = null; pendingTarget = null;
    window.pendingNavalExtraCost = 0;
    hideConfirm();
    updateStats();
    return;
  }

  // 5) Front-lock: lock de doel-tiles voor de duur van de animatie
  const area = Math.max(1, landCountFor(playerId));
  const EXP_BASE = 25, EXP_MIN = 10, EXP_MAX = 900;
  const tilesPerSecond = clamp(EXP_MIN, EXP_MAX, EXP_BASE * (1 + Math.log2(1 + area)));
  const estDurationMs  = Math.min(6000, Math.max(600, Math.round((tiles.length / Math.max(1, tilesPerSecond)) * 1000)));
  lockTilesForBattle(tiles, playerId, estDurationMs + 300); // kleine buffer

  // 6) Start animatie
  expansionAnim = { layers, tilesPerSecond, accumulator: 0 };

  // 7) UI opruimen
  updateStats();
  pendingCenter = null;
  pendingMode   = null;
  pendingTarget = null;
  window.pendingNavalExtraCost = 0;
  hideConfirm();
  hintEl.textContent = "Expansie gestart (parallel per laag).";
}
////////////////////////////////////////////////////////////
// Klik/tap
////////////////////////////////////////////////////////////
// Klik/tap (één enkele listener)
canvas.removeEventListener("click", onTap); // voor het geval er al één hing
canvas.addEventListener("click", onTap, { passive: true });

function onTap(ev) {
  if (expansionAnim || gameWon) { hideConfirm(); return; }

  // Scherm -> canvas -> grid
  const { x: mx, y: my } = canvasPointFromEvent(ev);
  const ec = cell * zoom;
  const gx = Math.floor((mx - ox - panX) / ec);
  const gy = Math.floor((my - oy - panY) / ec);
  if (!inBounds(gx, gy)) { hideConfirm(); return; }

  const k = idx(gx, gy);
  const tileOwner = owner[k];

  // Water negeren
  if (landMask[k] === 0) { hideConfirm(); return; }

  // Eerste klik ooit: spawn kiezen
  \1
      if (!gameStartTs) gameStartTs = performance.now();
      if (hintEl) hintEl.textContent = "Startpositie gekozen — bots gaan los!";

    }
    hideConfirm();
    return;
  }

  // Eigen tile selecteren (alleen visuele feedback)
  if (tileOwner === playerId) {
    selected = { x: gx, y: gy };
viewDirty = true; // [PATCH D]
    hideConfirm();
    render();
    return;
  }

  // Neutraal → pending neutral (expand start straks vanaf je eigen grens)
  if (tileOwner === NEUTRAL) {
    pendingCenter = { x: gx, y: gy };
    pendingMode   = "neutral";
    pendingTarget = null;
    selected      = null;
    showConfirmAtTile(gx, gy, "neutral");
    hintEl.textContent = "Bevestig om vanaf je grens uit te breiden.";
    render();
    return;
  }

  // Vijand → pending attack (expand start straks vanaf je eigen grens)
  if (tileOwner >= 0 && tileOwner !== playerId) {
    pendingCenter = { x: gx, y: gy };
    pendingMode   = "attack";
    pendingTarget = tileOwner;
    selected      = null;
    showConfirmAtTile(gx, gy, "attack");
    hintEl.textContent = "Bevestig om aan te vallen vanaf je grens.";
    render();
    return;
  }

  // Anders
  hideConfirm();
}

////////////////////////////////////////////////////////////
// Touch gestures & scroll-zoom
////////////////////////////////////////////////////////////
let lastPan = null;
let pinchPrev = null; // {dist, cx, cy, zoom}

canvas.addEventListener("touchstart", (ev) => {
  if (ev.touches.length === 1) {
    lastPan = canvasPointFromClientXY(ev.touches[0].clientX, ev.touches[0].clientY);
  } else if (ev.touches.length === 2) {
    const p1 = canvasPointFromClientXY(ev.touches[0].clientX, ev.touches[0].clientY);
    const p2 = canvasPointFromClientXY(ev.touches[1].clientX, ev.touches[1].clientY);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const d  = Math.hypot(dx, dy);
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
    pinchPrev = { dist: d, cx, cy, zoom };
  }
}, { passive: true });

canvas.addEventListener("touchmove", (ev) => {
  if (ev.touches.length === 1 && lastPan) {
    const p = canvasPointFromClientXY(ev.touches[0].clientX, ev.touches[0].clientY);
    panX += p.x - lastPan.x;
panY += p.y - lastPan.y;
viewDirty = true; // [PATCH D]
overlayDirty = true;
    lastPan = p;
    render();
  } else if (ev.touches.length === 2 && pinchPrev) {
    const p1 = canvasPointFromClientXY(ev.touches[0].clientX, ev.touches[0].clientY);
    const p2 = canvasPointFromClientXY(ev.touches[1].clientX, ev.touches[1].clientY);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const d  = Math.hypot(dx, dy);
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;

    const newZoom = clamp(MIN_ZOOM, MAX_ZOOM, pinchPrev.zoom * (d / (pinchPrev.dist || 1)));

    const wX = (pinchPrev.cx - ox - panX) / (cell * pinchPrev.zoom);
    const wY = (pinchPrev.cy - oy - panY) / (cell * pinchPrev.zoom);
    panX = cx - ox - wX * (cell * newZoom);
    panY = cy - oy - wY * (cell * newZoom);

    zoom = newZoom;
pinchPrev = { dist: d, cx, cy, zoom };
viewDirty = true; // [PATCH D]
overlayDirty = true;
    render();
  }
}, { passive: true });

canvas.addEventListener("touchend", (ev) => {
  if (ev.touches.length < 2) pinchPrev = null;
  if (ev.touches.length < 1) lastPan = null;
}, { passive: true });

canvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const {x, y} = canvasPointFromEvent(ev);
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const newZoom = clamp(MIN_ZOOM, MAX_ZOOM, zoom * factor);
  const wX = (x - ox - panX) / (cell * zoom);
  const wY = (y - oy - panY) / (cell * zoom);
  panX = x - ox - wX * (cell * newZoom);
  panY = y - oy - wY * (cell * newZoom);
  zoom = newZoom;
viewDirty = true; // [PATCH D]
overlayDirty = true;
}, { passive: false });

////////////////////////////////////////////////////////////
function render() {
  const ec    = cell * zoom;
  const baseX = ox + panX;
  const baseY = oy + panY;

  const colorOf = (o) =>
    (o === WATER)   ? COLOR_WATER :
    (o === NEUTRAL) ? COLOR_NEUTRAL :
    (colorById[o]   || "#ccc");

  // ---------- TILE LAYER ----------
  if (viewDirty) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // run-based fill per scanline (snel & zonder hairlines)
    for (let y = 0; y < GRID_H; y++) {
      let x = 0;
      while (x < GRID_W) {
        const k = idx(x, y);
        const o = owner[k];
        const fill = colorOf(o);
        let x2 = x + 1;
        while (x2 < GRID_W && owner[idx(x2, y)] === o) x2++;

        const px = Math.round(baseX + x * ec);
        const py = Math.round(baseY + y * ec);
        const w  = Math.round((x2 - x) * ec) + 1; // +1px overlap tegen hairlines
        const h  = Math.round(ec) + 1;

        ctx.fillStyle = fill;
        ctx.fillRect(px, py, w, h);
        x = x2;
      
  // Minimap
  try{ drawMinimap(); }catch(e){}
}
    }

    dirty.clear();
    viewDirty    = false;
    overlayDirty = true;
    nextOverlayAt = 0;
  } else if (dirty.size) {
    // alleen gewijzigde tiles
    for (const k of dirty) {
      const x = k % GRID_W, y = (k / GRID_W) | 0;
      const px = Math.round(baseX + x * ec);
      const py = Math.round(baseY + y * ec);
      const w  = Math.round(ec) + 1;
      const h  = Math.round(ec) + 1;
      ctx.fillStyle = colorOf(owner[k]);
      ctx.fillRect(px, py, w, h);
    }
    dirty.clear();
    overlayDirty = true;
  }

  // ---------- SELECTIE ----------
  if (selected) {
    const sx = Math.round(baseX + selected.x * ec) + 0.5;
    const sy = Math.round(baseY + selected.y * ec) + 0.5;
    const sw = Math.round(ec) - 1;
    const sh = Math.round(ec) - 1;
    ctx.strokeStyle = COLOR_SEL;
    ctx.lineWidth   = 2;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  // ---------- OVERLAY (logo/naam/goud) ----------
  const now = performance.now();
  const overlayDue = now >= nextOverlayAt;

  if (overlayDirty || overlayDue) {
    overlayCx.save();
    overlayCx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCx.restore();

    const LOGO_MIN = 14, LOGO_MAX = 64;
    const NAME_MAX = 28, GOLD_MAX = 22;
    const showLabels = ec >= 12;

    for (const p of players) {
      if (!p.alive) continue;
      const c = territoryCentroid(p.id);
      if (!c) continue;

      const cx = baseX + (c.x + 0.5) * ec;
      const cy = baseY + (c.y + 0.5) * ec;

      const area = Math.max(1, landCountFor(p.id));
      const sizeFactorLogo = 1 + 0.35 * Math.log10(1 + area);
      const sizeFactorName = 1 + 0.22 * Math.log10(1 + area);

      const logoSizeBase = Math.max(LOGO_MIN, Math.min(LOGO_MAX, ec * 1.2));
      const logoSize     = Math.max(LOGO_MIN, Math.min(LOGO_MAX, logoSizeBase * sizeFactorLogo));

      const logoY = cy - logoSize * 0.75;
      const nameY = cy + logoSize * 0.70;

      const namePx     = Math.max(10, Math.min(NAME_MAX, logoSize * 0.45 * sizeFactorName));
      const nameStroke = Math.max(2, Math.round(namePx / 6));
      const goldPx     = Math.max(10, Math.min(GOLD_MAX, Math.round(namePx * 0.75)));
      const gapBelowName = Math.max(16, Math.round(namePx * 1.05) + Math.round(nameStroke * 0.75));
      const goldY = nameY + gapBelowName;
  

      // logo
      const cfg = logos[p.id] || { shape: "circle", primary: "#888", secondary: "#555", emblem: "⚑" };
      drawLogo(overlayCx, cx, logoY, logoSize, cfg);

      if (showLabels) {
        // naam
        overlayCx.save();
        overlayCx.textAlign = "center";
        overlayCx.textBaseline = "middle";
        overlayCx.font = `700 ${Math.round(namePx)}px system-ui, sans-serif`;
        overlayCx.lineWidth = nameStroke;
        overlayCx.strokeStyle = "rgba(0,0,0,0.65)";
        overlayCx.strokeText(p.name, cx, nameY);
        overlayCx.fillStyle = "#fff";
        overlayCx.fillText(p.name, cx, nameY);
        overlayCx.restore();

        // goud
        const displayGold = (p.id === playerId) ? gold : (p.gold ?? 0);
        const goldTxt = `🪙 ${fmtGold(displayGold)}`;
        overlayCx.save();
        overlayCx.textAlign = "center";
        overlayCx.textBaseline = "middle";
        overlayCx.font = `600 ${goldPx}px system-ui, sans-serif`;
        overlayCx.lineWidth = Math.max(2, Math.round(goldPx / 6));
        overlayCx.strokeStyle = "rgba(0,0,0,0.6)";
        overlayCx.strokeText(goldTxt, cx, goldY);
        overlayCx.fillStyle = "#EDEDED";
        overlayCx.fillText(goldTxt, cx, goldY);
        overlayCx.restore();
      }
    }
// --- Varende pixel tekenen (1x, buiten de players-loop) ---
if (navalAnim && navalAnim.path && navalAnim.path.length) {
  const ec = cell * zoom;
  const baseX = ox + panX;
  const baseY = oy + panY;

  const i = Math.max(0, Math.min(navalAnim.path.length - 1, Math.floor(navalAnim.step)));
  const frac = navalAnim.step - Math.floor(navalAnim.step);

  const p0 = navalAnim.path[i];
  const p1 = navalAnim.path[Math.min(navalAnim.path.length - 1, i + 1)] || p0;

  const cx = baseX + ((p0.x + 0.5) * ec) * (1 - frac) + ((p1.x + 0.5) * ec) * frac;
  const cy = baseY + ((p0.y + 0.5) * ec) * (1 - frac) + ((p1.y + 0.5) * ec) * frac;

  overlayCx.save();
  overlayCx.beginPath();
  const size = Math.max(3, Math.min(8, Math.round(ec * 0.35)));
  overlayCx.fillStyle = "#EAF8FF";
  overlayCx.strokeStyle = "rgba(0,0,0,0.5)";
  overlayCx.lineWidth = 2;
  overlayCx.arc(cx, cy, size * 0.6, 0, Math.PI * 2);
  overlayCx.fill();
  overlayCx.stroke();
  overlayCx.restore();
}
    overlayDirty  = false;
    nextOverlayAt = now + 150;
  }

  // ---------- CONFIRM KNOP ----------
  if (pendingCenter) {
    showConfirmAtTile(pendingCenter.x, pendingCenter.y, pendingMode);
  } else {
    hideConfirm();
  }
}
/* ======================================================================== */
function updateStats(){
  const mine = landCountFor(playerId);
  const tot  = totalLand();
  const pct  = tot ? Math.round((mine / tot) * 100) : 0;

  statsEl.textContent = `${players[0]?.name || "Speler"} | Land: ${mine} / ${tot} | ${pct}% | Goud: ${fmtGold(gold)}`;

  if (progressFill) progressFill.style.width = pct + "%";
  if (progressText) progressText.textContent = pct + "%";

  if (!gameWon && tot > 0 && mine === tot) {
    triggerWin();
  }
}

////////////////////////////////////////////////////////////
// Resize
////////////////////////////////////////////////////////////
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Canvas in device px + schalen naar CSS px
  canvas.style.width  = w + "px";
  canvas.style.height = h + "px";
  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Overlay-canvas idem
  overlayCanvas.style.width  = w + "px";
  overlayCanvas.style.height = h + "px";
  overlayCanvas.width  = Math.floor(w * dpr);
  overlayCanvas.height = Math.floor(h * dpr);
  overlayCx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCx.scale(dpr, dpr);

  // ▶️ Bepaal cell zodat de héle grid bij zoom=1 past
  const fitX = w / GRID_W;
  const fitY = h / GRID_H;
  cell = Math.max(4, Math.floor(Math.min(fitX, fitY))); // 4px veiligheidsminimum

  // Recenter en redraw
  recenterNow();
  overlayDirty = true;
  render();
}
window.addEventListener("resize", () => { resize(); recenterNow(); render(); });

////////////////////////////////////////////////////////////
// Game loop
////////////////////////////////////////////////////////////

function gameLoop(ts) {
  const dt = (ts - lastUpdate) / 1000;
  lastUpdate = ts;

  // -- frontlocks opruimen --
  cleanupLocks(ts);

  // =========================
  // ECONOMIE TICKS
  // =========================
  incomeTimer   += dt;
  interestTimer += dt;

  // 1) Basiskapitaal elke 1s
  while (incomeTimer >= ECON_INCOME_SECS) {
    incomeTimer -= ECON_INCOME_SECS;

    for (const p of players) {
      // Gate bots economy until player spawned
      if (p.isBot && !playerHasSpawned()) { continue; }

      const size = landCountFor(p.id);
      const baseIncome =
        goldPerSecond * ECON_INCOME_SECS +
        incomePerTile * size;

      if (p.id === playerId) {
        gold = (gold || 0) + baseIncome;
      } else {
        p.gold = (p.gold || 0) + baseIncome;
      }
    }
    overlayDirty = true; // goudlabels verversen
  }

  // 2) Rente elke 4s
  while (interestTimer >= ECON_INTEREST_SECS) {
    interestTimer -= ECON_INTEREST_SECS;

    for (const p of players) {
      const r = interestPctFor(p); // 0..0.15 per tick
      if (p.id === playerId) {
        gold = (gold || 0);
        gold += gold * r;
      } else {
        p.gold = (p.gold || 0);
        p.gold += p.gold * r;
      }
    }
    overlayDirty = true;
  }

  // =========================
  // BOTS
  // =========================
  botTimerMs += dt * 1000;
  if (botTimerMs >= botIntervalMs) {
    botTimerMs = 0;
    if (botsActive && playerHasSpawned()) { botExpand(); }
  }
// =========================
  // NAVAL LANDING ANIMATIE
  // =========================
  if (navalAnim && navalAnim.path && navalAnim.path.length) {
    const stepsPerSec = navalAnim.speed || 6;
    const advance = dt * stepsPerSec;
    // accumuleren: we stappen per hele tile
    navalAnim.step += advance;

    // zodra we voorbij het pad zijn, land!
    if (navalAnim.step >= navalAnim.path.length) {
      // Claim de target kusttile als eerste landing
      const tx = navalAnim.target.x, ty = navalAnim.target.y;
      const k  = idx(tx, ty);
      if (!isLockedByOther(k, playerId)) {
        owner[k] = playerId;
        ownersChanged = true;
        markTileDirtyByIdx(k);
      }

      // Start nu de echte overname vanaf de klikrichting (geen extra confirm, geen verdediging)
      queueRadialExpansion(tx, ty, "attack", navalAnim.target.targetId);

      navalAnim = null;      // klaar met varen
      overlayDirty = true;   // update labels/overlay
    } else {
      // blijf varen, alleen overlay tekenen (zie render)
      overlayDirty = true;
    }
  }
  // =========================
  // EXPANSIE-ANIMATIE (stream tiles)
  // =========================
  if (expansionAnim) {
    const anim = expansionAnim;
    anim.accumulator += dt * anim.tilesPerSecond;

    // verwerk zoveel tiles als de accumulator toelaat
    let quota = Math.floor(anim.accumulator); // aantal tiles dat we nu mogen zetten
    if (quota > 0) anim.accumulator -= quota;

    while (quota > 0 && anim.layers.length) {
      const L = anim.layers[0];

      // neem telkens 1 tile uit de huidige laag
      const t = L.shift();
      if (t) {
        const k = idx(t.x, t.y);
        owner[k] = t.toPid;
        markTileDirtyByIdx(k);
        ownersChanged = true;   // <- snapshot ongeldig maken
        quota--;
      }

      // volgende laag zodra deze leeg is
      if (L.length === 0) anim.layers.shift();
    }

    overlayDirty = true;

    if (anim.layers.length === 0) {
      expansionAnim = null;
      hintEl.textContent = "Actie voltooid.";
    }
  }

  // =========================
  // UI / BOOKKEEPING
  // =========================
  updateStats();

  // leaderboard ~ elke 0.4s
  if (ts - lastLeaderboardTs > 400) {
    rebuildLeaderboard();
    lastLeaderboardTs = ts;
  }

  render();
  requestAnimationFrame(gameLoop);
}
function isFrontierTile(x, y, mode, targetId) {
  if (owner[idx(x, y)] !== playerId) return false;   // moet jouw land zijn
  // moet grenzen aan een geldige doel-tegel (neutraal of specifieke vijand)
  return neighbors4(x, y).some(([ax, ay]) => {
    const k = idx(ax, ay);
    if (landMask[k] !== 1) return false;             // alleen land
    if (mode === "neutral") return owner[k] === NEUTRAL;
    if (mode === "attack")  return owner[k] === targetId;
    return false;
  });
}

function findNearestFrontier(refX, refY, mode, targetId) {
  let best = null, bestD2 = Infinity;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!isFrontierTile(x, y, mode, targetId)) continue;
      const dx = x - refX, dy = y - refY;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestD2) { bestD2 = d2; best = { x, y }; }
    }
  }
  return best;
}
////////////////////////////////////////////////////////////
// UI wiring
////////////////////////////////////////////////////////////

// === Confirm button gedrag ===
// voorkom dat de klik bubbelt naar het canvas
// voorkom dat de klik via de knop ook een canvas-click triggert
["pointerdown","touchstart","mousedown"].forEach(type => {
  confirmBtn.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
});

// ENKEL DEZE click-listener 
confirmBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!pendingCenter || !pendingMode) { hideConfirm(); return; }

  if (pendingMode === "attack" && typeof pendingTarget === "number") {
    // Check: hebben we een land‑grens? (dan direct expand zoals normaal)
    const hasLandFrontier = !!findNearestFrontier(
      pendingCenter.x,
      pendingCenter.y,
      "attack",
      pendingTarget
    );

    if (!hasLandFrontier) {
      // Probeer een zee‑route
      const naval = findNavalRoute(pendingCenter.x, pendingCenter.y, playerId, pendingTarget);
      if (!naval) {
        hintEl.textContent = "Geen zee-route naar die kust gevonden.";
        hideConfirm();
        return;
      }

      // Start varende pixel
      navalAnim = {
        path: naval.route,            // lijst water-tiles
        step: 0,
        speed: 18,                    // water-tiles per seconde (tweak naar smaak)
        target: { x: naval.to.x, y: naval.to.y, targetId: pendingTarget },
        startedAt: performance.now()
      };

      hintEl.textContent = "Vloot onderweg...";
      // maak UI schoon
      pendingCenter = null; pendingMode = null; pendingTarget = null;
      hideConfirm();
      render();
      return; // We wachten tot landing in gameLoop
    }
  }

  // Standaard pad (landfrontier of neutral): direct expand
  queueRadialExpansion(pendingCenter.x, pendingCenter.y, pendingMode, pendingTarget);
  hideConfirm();
});

// snelle toetsen: Enter = bevestigen, Esc = annuleren
window.addEventListener("keydown", (e) => {
  if (confirmBtn.classList.contains("hidden")) return;

  if (e.key === "Enter") {
    e.preventDefault();
    confirmBtn.click(); // dezelfde code als wanneer je de knop klikt
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideConfirm();
    pendingCenter = null;
    pendingMode   = null;
    pendingTarget = null;
    window.pendingNavalExtraCost = 0;
    render();
  }
});
if (btnRandCol) {
  btnRandCol.addEventListener("click", () => {
    inpColor.value = randomHexColor();
  });
}
if (btnStart) {
  btnStart.addEventListener("click", () => {
    playerName  = (inpName?.value || "Speler").slice(0,16);
    playerColor = (inpColor?.value || "#66e4a9").toLowerCase();
    mapPreset   = inpMap?.value || "continents";
    startFromMenu();
  });
}
if (budgetEl && budgetPctEl) {
  budgetEl.addEventListener('input', () => {
    investPct = Number(budgetEl.value) / 100;
    budgetPctEl.textContent = budgetEl.value + '%';
    render();
  });
}

////////////////////////////////////////////////////////////
// Buttons
////////////////////////////////////////////////////////////

btnPlayAgain?.addEventListener("click", () => {
  gameWon = false;
  winOverlay?.classList.add("hidden");
  resetGame();
});
resetBtn?.addEventListener("click", resetGame);
spawnBtn?.addEventListener("click", ()=> {
  if (landCountFor(playerId)===0) {
    hintEl.textContent = "Kies eerst je startpositie (tik een landtile).";
    return;
  }
  spawnBots(12);
  if (!loopStarted) {
    loopStarted = true;
    lastUpdate = performance.now();
    requestAnimationFrame(gameLoop);
  }
});

////////////////////////////////////////////////////////////
// Boot
////////////////////////////////////////////////////////////
(function boot(){
  // init overlay inputs (optioneel)
  if (inpName)  inpName.value  = playerName;
  if (inpColor) inpColor.value = playerColor;
  if (inpMap)   inpMap.value   = mapPreset;

  resize();
  recenterNow();
  render();
})();

// ================= Minimap =================
function drawMinimap(){
  if (!minimap || !miniCtx) return;
  const mw = minimap.width, mh = minimap.height;
  // Background
  miniCtx.fillStyle = "#0a0f1a";
  miniCtx.fillRect(0,0,mw,mh);
  // Draw land/water coarse (sample every 2 tiles)
  const sx = Math.ceil(GRID_W / mw);
  const sy = Math.ceil(GRID_H / mh);
  for (let y=0;y<GRID_H;y+=sy){
    for (let x=0;x<GRID_W;x+=sx){
      const k = idx(x,y);
      const o = owner[k];
      const c =
        (landMask[k]===0) ? COLOR_WATER :
        (o===NEUTRAL) ? COLOR_NEUTRAL :
        (colorById[o] || "#ccc");
      miniCtx.fillStyle = c;
      miniCtx.fillRect(Math.floor(x/GRID_W*mw), Math.floor(y/GRID_H*mh), Math.max(1,Math.ceil(mw/GRID_W*sx)), Math.max(1,Math.ceil(mh/GRID_H*sy)));
    }
  }
  // Viewport rectangle
  const ec = cell * zoom;
  const baseX = ox + panX;
  const baseY = oy + panY;
  const vx0 = Math.max(0, Math.floor((-baseX) / ec));
  const vy0 = Math.max(0, Math.floor((-baseY) / ec));
  const vx1 = Math.min(GRID_W, Math.ceil((canvas.width - baseX) / ec));
  const vy1 = Math.min(GRID_H, Math.ceil((canvas.height - baseY) / ec));
  const rx0 = Math.floor(vx0 / GRID_W * mw);
  const ry0 = Math.floor(vy0 / GRID_H * mh);
  const rw  = Math.max(2, Math.floor((vx1 - vx0) / GRID_W * mw));
  const rh  = Math.max(2, Math.floor((vy1 - vy0) / GRID_H * mh));
  miniCtx.strokeStyle = "#ffffff";
  miniCtx.lineWidth = 1;
  miniCtx.strokeRect(rx0+0.5, ry0+0.5, rw, rh);
}
if (minimap){
  minimap.addEventListener('click', (ev)=>{
    const rect = minimap.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const gx = Math.floor(mx / minimap.width * GRID_W);
    const gy = Math.floor(my / minimap.height * GRID_H);
    // Center view on (gx,gy)
    const ec = cell * zoom;
    panX = Math.round((canvas.width/2) - (ox + (gx+0.5) * ec));
    panY = Math.round((canvas.height/2) - (oy + (gy+0.5) * ec));
    viewDirty = true; overlayDirty = true; render();
  }, {passive:true});
}
