// ☘️ St. Patrick's Day Filter v13
// - Pile clears when smile stops (fade out)
// - No chin tracking (fixed pile cap = clean, no jitter)
// - Cartoon dome pile matching reference: uniform coin PNGs, tightly packed rows

const video      = document.getElementById('video');
const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const shutterBtn = document.getElementById('shutterBtn');
const flipBtn    = document.getElementById('flipBtn');
const flash      = document.getElementById('flash');

let currentFacingMode = 'user';
let camera = null;

// ─────────────────────────────────────────
// Assets
// ─────────────────────────────────────────
function loadImg(src) { const i = new Image(); i.src = src; return i; }
const hatImg      = loadImg('assets/leprechaun_hat.png');
const shamrockImg = loadImg('assets/shamrock.png');
const coinImg     = loadImg('assets/coin.png');

// ─────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────
function resizeCanvas() {
  const nw = canvas.clientWidth  * window.devicePixelRatio;
  const nh = canvas.clientHeight * window.devicePixelRatio;
  if (nw !== canvas.width || nh !== canvas.height) {
    canvas.width = nw; canvas.height = nh;
    initPile();
  }
}
window.addEventListener('resize', resizeCanvas, { passive: true });

function coverMap() {
  const vw = video.videoWidth  || 1280;
  const vh = video.videoHeight || 720;
  const cw = canvas.width, ch = canvas.height;
  const va = vw / vh, ca = cw / ch;
  let rW, rH, ox, oy;
  if (va > ca) { rH = ch; rW = ch * va; ox = (cw - rW) / 2; oy = 0; }
  else          { rW = cw; rH = cw / va; ox = 0; oy = (ch - rH) / 2; }
  return { rW, rH, ox, oy };
}

function lmToCanvas(lm) {
  const { rW, rH, ox, oy } = coverMap();
  const rawX = lm.x * rW + ox;
  const cx   = currentFacingMode === 'user' ? (canvas.width - rawX) : rawX;
  return [cx, lm.y * rH + oy];
}

// ─────────────────────────────────────────
// Smoothers
// ─────────────────────────────────────────
class Smoother {
  constructor(a = 0.3) { this.a = a; this.v = null; }
  update(v) {
    if (this.v === null) { this.v = v; return v; }
    this.v += this.a * (v - this.v); return this.v;
  }
  reset() { this.v = null; }
}
class AngleSmoother {
  constructor(a = 0.2) { this.a = a; this.v = null; }
  update(v) {
    if (this.v === null) { this.v = v; return v; }
    let d = v - this.v;
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.v += this.a * d; return this.v;
  }
  reset() { this.v = null; }
}

const smoothHatX  = new Smoother(0.28);
const smoothHatY  = new Smoother(0.28);
const smoothFW    = new Smoother(0.25);
const smoothRoll  = new AngleSmoother(0.2);
const smoothPitch = new Smoother(0.18);
const smoothSmile = new Smoother(0.15);
const smoothTeeth = new Smoother(0.15);

// ─────────────────────────────────────────
// Trigger: smile OR teeth
// ─────────────────────────────────────────
let triggered     = false;
let triggerFrames = 0;
let smileBaseline = null;
let smileSamples  = [];
const SMILE_CAL_FRAMES     = 45;
const SMILE_RISE_THRESHOLD = 0.040;
const TEETH_THRESHOLD      = 0.032;
let dbgSmile = 0, dbgTeeth = 0;

function updateTrigger(lm) {
  const mouthW = Math.hypot(lm[291].x - lm[61].x, lm[291].y - lm[61].y);
  const faceW  = Math.abs(lm[454].x - lm[234].x) || 0.01;
  const sRatio = smoothSmile.update(mouthW / faceW);
  dbgSmile = sRatio;

  if (smileBaseline === null) {
    smileSamples.push(sRatio);
    if (smileSamples.length >= SMILE_CAL_FRAMES) {
      const sorted = [...smileSamples].sort((a,b) => a-b);
      smileBaseline = sorted[Math.floor(sorted.length / 2)];
    }
    triggered = false; return;
  }

  const isSmiling = sRatio > smileBaseline + SMILE_RISE_THRESHOLD;
  if (!isSmiling) smileBaseline = smileBaseline * 0.992 + sRatio * 0.008;

  const lipGap = Math.abs(lm[14].y - lm[13].y);
  const tRatio = smoothTeeth.update(lipGap / faceW);
  dbgTeeth = tRatio;
  const isTeeth = tRatio > TEETH_THRESHOLD;

  const active = isSmiling || isTeeth;
  triggerFrames = active
    ? Math.min(triggerFrames + 1, 20)
    : Math.max(triggerFrames - 2, 0);

  const wasTriggered = triggered;
  triggered = triggerFrames >= 4;

  // When smile stops → fade out pile
  if (wasTriggered && !triggered) {
    startPileFade();
  }
}

// ─────────────────────────────────────────
// Pot geometry
// ─────────────────────────────────────────
function getPot() {
  const cx    = canvas.width  * 0.5;
  const rimY  = canvas.height * 0.83;
  const rimRX = canvas.width  * 0.47;
  const rimRY = rimRX * 0.085;
  return { cx, rimY, rimRX, rimRY };
}

// ─────────────────────────────────────────
// Pile — column height map (physics) +
//        uniform-coin dome rendering (visual)
// Fixed cap: pile cannot rise above 38% of canvas height above rimY
// NO chin tracking — avoids jitter when user moves
// ─────────────────────────────────────────
const NUM_COLS      = 90;
let   colHeight     = [];   // px stacked per column
let   pileAlpha     = 1.0;  // 1=visible, fades to 0 then resets
let   fadingPile    = false;

// Coin display size in the pile (uniform, matching reference image)
function pileCoinSize() {
  return Math.round(canvas.width * 0.038);  // ~3.8% of screen width
}

// Max pile height above rimY — fixed fraction, no face tracking
function maxPileHeight() {
  const { rimY } = getPot();
  return rimY * 0.55;  // pile can grow up to 55% of rimY above it
}

function initPile() {
  colHeight  = new Array(NUM_COLS).fill(0);
  pileAlpha  = 1.0;
  fadingPile = false;
}

function startPileFade() {
  fadingPile = true;
}

function updatePileFade() {
  if (!fadingPile) return;
  pileAlpha -= 0.045;   // fade out over ~22 frames
  if (pileAlpha <= 0) {
    pileAlpha  = 1.0;
    fadingPile = false;
    initPile();   // reset pile fully after fade
    falling = []; // also clear any mid-air coins
  }
}

function colIndex(x) {
  return Math.max(0, Math.min(NUM_COLS - 1, Math.floor(x / canvas.width * NUM_COLS)));
}

function surfaceYAt(x) {
  const { rimY } = getPot();
  return rimY - colHeight[colIndex(x)];
}

function addToPile(coin) {
  const { cx, rimY, rimRX } = getPot();
  const colW = canvas.width / NUM_COLS;
  const cs   = pileCoinSize();

  const jitter = (Math.random() - 0.5) * cs * 0.8;
  const landX  = Math.max(cx - rimRX * 0.84,
                   Math.min(cx + rimRX * 0.84, coin.x + jitter));

  if (Math.abs(landX - cx) > rimRX * 0.88) return;

  const c0 = Math.max(0, Math.floor((landX - cs * 0.5) / colW));
  const c1 = Math.min(NUM_COLS - 1, Math.floor((landX + cs * 0.5) / colW));

  let maxH = 0;
  for (let c = c0; c <= c1; c++) maxH = Math.max(maxH, colHeight[c]);

  if (maxH + cs * 0.55 > maxPileHeight()) return;  // fixed cap, no chin

  const raise = cs * 0.52;
  for (let c = c0; c <= c1; c++) colHeight[c] += raise;
}

// ─────────────────────────────────────────
// Cartoon dome pile rendering
// Matches reference: uniform coin circles, tightly packed rows, dome shape
// ─────────────────────────────────────────
function drawPile() {
  const hasCoins = colHeight.some(h => h > 1);
  if (!hasCoins) return;

  const { cx, rimY, rimRX } = getPot();
  const colW = canvas.width / NUM_COLS;
  const cs   = pileCoinSize();  // uniform coin radius

  // Build smoothed surface profile
  const cols = [];
  for (let c = 0; c < NUM_COLS; c++) {
    const colCX = (c + 0.5) * colW;
    if (Math.abs(colCX - cx) > rimRX * 0.90) continue;
    cols.push({ c, x: colCX, h: colHeight[c] });
  }
  if (cols.length === 0) return;

  // Smooth heights with neighbours
  const smoothH = cols.map((col, i) => {
    const p = cols[Math.max(0, i-1)].h;
    const n = cols[Math.min(cols.length-1, i+1)].h;
    return (p + col.h * 2 + n) / 4;
  });

  ctx.save();
  ctx.globalAlpha = pileAlpha;

  // Clip to pot opening so coins don't spill outside
  ctx.beginPath();
  ctx.rect(cx - rimRX * 0.91, 0, rimRX * 1.82, rimY + 4);
  ctx.clip();

  // ── Draw coin rows from bottom up ──────────────────────────
  // We render layers: for each column, draw coins stacked from rimY up to surface
  // Each coin is a PNG drawn at uniform size, slightly overlapping
  const step  = cs * 0.88;   // horizontal spacing (tight overlap)
  const vStep = cs * 0.82;   // vertical spacing (coins overlap vertically)

  // Determine how many rows deep each column is
  for (let i = 0; i < cols.length; i++) {
    const { x: colX } = cols[i];
    const h = smoothH[i];
    if (h < cs * 0.3) continue;

    const rows = Math.ceil(h / vStep);
    for (let row = 0; row < rows; row++) {
      const cy = rimY - row * vStep - cs * 0.4;
      if (cy - cs * 0.5 < 0) continue;       // never above top of screen

      // Only draw the top coin of each column unclipped;
      // bury lower rows slightly
      const isTop = (row === rows - 1);

      // Small per-coin jitter for organic look
      const jx = (Math.sin(i * 7.3 + row * 3.1) * cs * 0.18);
      const jy = (Math.cos(i * 4.7 + row * 2.9) * cs * 0.12);

      ctx.save();
      ctx.translate(colX + jx, cy + jy);
      // Slight random tilt per coin, seeded so it's stable each frame
      const tilt = Math.sin(i * 13.7 + row * 5.3) * 0.30;
      ctx.rotate(tilt);
      const sz = isTop ? cs * 2.05 : cs * 2.0;
      ctx.drawImage(coinImg, -sz/2, -sz/2, sz, sz);
      ctx.restore();
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────
// Pot of gold
// ─────────────────────────────────────────
function drawPot() {
  const { cx, rimY, rimRX, rimRY } = getPot();
  const bodyR  = rimRX * 0.98;
  const bodyCY = rimY + bodyR * 0.04;

  ctx.save();

  // Body clipped below rimY
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, rimY - 2, canvas.width, canvas.height);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(cx, bodyCY, bodyR, 0, Math.PI * 2);
  const bg = ctx.createRadialGradient(
    cx - bodyR*0.28, bodyCY - bodyR*0.28, bodyR*0.04,
    cx, bodyCY, bodyR*1.08
  );
  bg.addColorStop(0,   '#5a5a5a');
  bg.addColorStop(0.3, '#2a2a2a');
  bg.addColorStop(0.7, '#131313');
  bg.addColorStop(1,   '#050505');
  ctx.fillStyle = bg; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - bodyR*0.26, bodyCY - bodyR*0.12, bodyR*0.11, bodyR*0.34, -0.22, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(120,120,120,0.16)'; ctx.fill();
  ctx.restore();

  // Rim shadow
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY*0.6, rimRX*0.98, rimRY*0.65, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fill();

  // Gold rim
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX, rimRY, 0, 0, Math.PI*2);
  const rg = ctx.createLinearGradient(cx-rimRX, rimY-rimRY, cx+rimRX, rimY+rimRY);
  rg.addColorStop(0,    '#ffe84a');
  rg.addColorStop(0.20, '#fff276');
  rg.addColorStop(0.50, '#c89010');
  rg.addColorStop(0.78, '#a06808');
  rg.addColorStop(1,    '#7a4e04');
  ctx.fillStyle = rg; ctx.fill();

  // Inner shadow
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY*0.28, rimRX*0.82, rimRY*0.52, 0, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(0,0,0,0.60)'; ctx.fill();

  // Rim shine
  ctx.beginPath();
  ctx.ellipse(cx - rimRX*0.23, rimY - rimRY*0.28, rimRX*0.26, rimRY*0.30, -0.14, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,215,0.42)'; ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────
// Falling coins
// ─────────────────────────────────────────
let falling = [], lastSpawnMs = 0;

function spawnFromSky() {
  const now = performance.now();
  if (now - lastSpawnMs < 75) return;
  lastSpawnMs = now;
  for (let i = 0; i < 3; i++) {
    const isCoin = Math.random() < 0.72;
    const base   = isCoin ? (13 + Math.random() * 11) : (10 + Math.random() * 9);
    const size   = base * window.devicePixelRatio;
    falling.push({
      x:    canvas.width * (0.06 + Math.random() * 0.88),
      y:    -size,
      vx:   (Math.random() - 0.5) * 3.5,
      vy:   1.5 + Math.random() * 2.0,
      ay:   0.25 + Math.random() * 0.10,
      rot:  Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.12,
      size, img: isCoin ? coinImg : shamrockImg,
    });
  }
  if (falling.length > 130) falling.splice(0, falling.length - 130);
}

function stepFalling() {
  const toRemove = [];
  for (let i = 0; i < falling.length; i++) {
    const p = falling[i];
    p.vy += p.ay; p.x += p.vx; p.y += p.vy; p.rot += p.spin;
    if (p.x - p.size*0.5 < 0)            { p.x = p.size*0.5;              p.vx =  Math.abs(p.vx)*0.6; }
    if (p.x + p.size*0.5 > canvas.width) { p.x = canvas.width-p.size*0.5; p.vx = -Math.abs(p.vx)*0.6; }
    const surf = surfaceYAt(p.x);
    if (p.y + p.size*0.5 >= surf) {
      addToPile(p);
      toRemove.push(i);
      continue;
    }
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.drawImage(p.img, -p.size/2, -p.size/2, p.size, p.size);
    ctx.restore();
  }
  for (let i = toRemove.length - 1; i >= 0; i--) falling.splice(toRemove[i], 1);
}

// ─────────────────────────────────────────
// Ambient shamrocks
// ─────────────────────────────────────────
let ambient = [];
function initAmbient() {
  for (let i = 0; i < 5; i++) ambient.push({
    x: Math.random() * canvas.width,
    y: canvas.height + Math.random() * canvas.height,
    size: (10 + Math.random() * 12) * window.devicePixelRatio,
    vx: (Math.random() - 0.5) * 0.5, vy: -(0.28 + Math.random() * 0.38),
    rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.015,
    alpha: 0.09 + Math.random() * 0.11,
  });
}
function stepAmbient() {
  for (const p of ambient) {
    p.x += p.vx; p.y += p.vy; p.rot += p.spin;
    if (p.y < -50) { p.y = canvas.height + 30; p.x = Math.random() * canvas.width; }
    ctx.save(); ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.drawImage(shamrockImg, -p.size/2, -p.size/2, p.size, p.size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Rainbow
// ─────────────────────────────────────────
let rainbowAlpha = 0, rainbowTarget = 0;
function drawRainbow(cx, cy, radius) {
  if (rainbowAlpha < 0.01) return;
  const bands = [[255,50,50],[255,140,0],[255,230,0],[50,210,50],[50,120,255],[180,50,255]];
  const bw = radius * 0.07;
  for (let i = 0; i < bands.length; i++) {
    const [r,g,b] = bands[i];
    ctx.beginPath();
    ctx.arc(cx, cy, radius + i*bw, Math.PI, 2*Math.PI);
    ctx.strokeStyle = `rgba(${r},${g},${b},${rainbowAlpha})`;
    ctx.lineWidth = bw*1.15; ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face tint
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234,y234]=lmToCanvas(lm[234]); const [x454,y454]=lmToCanvas(lm[454]);
  const [x10,y10]=lmToCanvas(lm[10]);   const [x152,y152]=lmToCanvas(lm[152]);
  const fcx=(x234+x454)/2, fcy=(y10+y152)/2;
  const faceW=Math.hypot(x454-x234,y454-y234), faceH=Math.abs(y152-y10)*1.05;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(fcx,fcy,faceW*0.52,faceH*0.52,0,0,Math.PI*2); ctx.clip();
  const g=ctx.createRadialGradient(fcx,fcy-faceH*0.1,0,fcx,fcy,faceW*0.55);
  g.addColorStop(0,'rgba(0,200,50,0.00)'); g.addColorStop(0.5,'rgba(0,180,40,0.05)');
  g.addColorStop(1,'rgba(0,140,30,0.13)');
  ctx.fillStyle=g; ctx.fillRect(fcx-faceW,fcy-faceH,faceW*2,faceH*2); ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrocks
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234]=lmToCanvas(lm[234]); const [,y234]=lmToCanvas(lm[234]);
  const [x454]=lmToCanvas(lm[454]); const [,y454]=lmToCanvas(lm[454]);
  const faceW=Math.hypot(x454-x234,y454-y234), size=faceW*0.13;
  for (const idx of [50,280]) {
    const [cx,cy]=lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha=0.75;
    ctx.drawImage(shamrockImg,cx-size/2,cy-size/2,size,size); ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat — pitch-aware
// ─────────────────────────────────────────
const BRIM_BOTTOM_FRAC=855/900, CROWN_TOP_FRAC=80/900;
function drawHat(lm) {
  const [x10,y10]=lmToCanvas(lm[10]); const [x152,y152]=lmToCanvas(lm[152]);
  const [x234,y234]=lmToCanvas(lm[234]); const [x454,y454]=lmToCanvas(lm[454]);
  const [xL,yL,xR,yR]=x234<=x454?[x234,y234,x454,y454]:[x454,y454,x234,y234];
  const rollAngle=Math.atan2(yR-yL,xR-xL), faceW=Math.hypot(xR-xL,yR-yL);
  const faceH=Math.abs(y152-y10);
  const pitchScale=Math.max(0.45,Math.min(1.0,(faceH/(faceW||1))*0.70));
  const faceUpLen=Math.hypot(x10-x152,y10-y152)||1;
  const uX=(x10-x152)/faceUpLen, uY=(y10-y152)/faceUpLen;
  const sx=smoothHatX.update(x10), sy=smoothHatY.update(y10);
  const sw=smoothFW.update(faceW),  sa=smoothRoll.update(rollAngle);
  const sp=smoothPitch.update(pitchScale);
  const hatW=sw*1.25, hatH=hatW*(900/800)*sp;
  const anchorY=hatH*BRIM_BOTTOM_FRAC, pitchOff=(1.0-sp)*hatH*0.18;
  ctx.save();
  ctx.translate(sx-uX*pitchOff, sy-uY*pitchOff); ctx.rotate(sa);
  ctx.shadowColor='rgba(0,20,0,0.5)'; ctx.shadowBlur=14*window.devicePixelRatio;
  ctx.shadowOffsetY=5*window.devicePixelRatio;
  ctx.drawImage(hatImg,-hatW/2,-anchorY,hatW,hatH); ctx.restore();
  return { rcx:sx, rcy:sy-anchorY+hatH*CROWN_TOP_FRAC, faceW:sw };
}

// ─────────────────────────────────────────
// Debug overlay
// ─────────────────────────────────────────
function drawDebug() {
  const warming = smileBaseline === null;
  const base    = smileBaseline ? smileBaseline.toFixed(3) : '…';
  const status  = warming
    ? `calibrating ${smileSamples.length}/${SMILE_CAL_FRAMES}`
    : triggered ? '😄 TRIGGERED' : '😐 neutral';
  const dpr=window.devicePixelRatio;
  ctx.save();
  ctx.font=`bold ${13*dpr}px -apple-system,sans-serif`;
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.fillRect(8,8,310*dpr,30*dpr);
  ctx.fillStyle=triggered?'#00ff88':'#fff';
  ctx.fillText(`smile:${dbgSmile.toFixed(3)} base:${base} teeth:${dbgTeeth.toFixed(3)}  ${status}`,14,26*dpr);
  ctx.restore();
}

// ─────────────────────────────────────────
// Main frame
// ─────────────────────────────────────────
function onResults(results) {
  resizeCanvas();
  const { rW, rH, ox, oy } = coverMap();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Video
  ctx.save();
  if (currentFacingMode==='user') { ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  // 2. Ambient shamrocks
  if (ambient.length===0) initAmbient();
  stepAmbient();

  // 3. Pile fade update
  updatePileFade();

  // 4. Pot body + rim
  drawPot();

  // 5. PNG coin pile — drawn AFTER pot, so it overflows on top
  drawPile();

  let hatAnchor = null;

  // 6. Face
  if (results.multiFaceLandmarks?.length) {
    const lm = results.multiFaceLandmarks[0];
    drawFaceGrading(lm);
    hatAnchor = drawHat(lm);
    drawCheekStickers(lm);
    updateTrigger(lm);
  } else {
    triggerFrames = Math.max(triggerFrames - 1, 0);
    if (triggered && triggerFrames < 4) { triggered = false; startPileFade(); }
  }

  // 7. Rainbow
  rainbowTarget = triggered ? 0.60 : 0;
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  if (hatAnchor) drawRainbow(hatAnchor.rcx, hatAnchor.rcy, hatAnchor.faceW * 1.1);

  // 8. Coins
  if (triggered) spawnFromSky();
  stepFalling();

  // 9. Debug
  drawDebug();
}

// ─────────────────────────────────────────
// Camera / FaceMesh
// ─────────────────────────────────────────
async function start() {
  const fm = new FaceMesh({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
  fm.setOptions({ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5 });
  fm.onResults(onResults);
  if (camera) camera.stop();
  camera = new Camera(video, {
    onFrame: async () => fm.send({ image: video }),
    width: 1280, height: 720, facingMode: currentFacingMode,
  });
  await camera.start();
  resizeCanvas(); initPile();
}

// ─────────────────────────────────────────
// UI
// ─────────────────────────────────────────
flipBtn.addEventListener('click', () => {
  currentFacingMode = currentFacingMode==='user'?'environment':'user';
  smoothHatX.reset(); smoothHatY.reset(); smoothFW.reset();
  smoothRoll.reset(); smoothPitch.reset(); smoothSmile.reset(); smoothTeeth.reset();
  triggerFrames=0; triggered=false;
  smileSamples=[]; smileBaseline=null;
  initPile(); falling=[];
  start();
});

shutterBtn.addEventListener('click', async () => {
  flash.classList.add('active');
  setTimeout(()=>flash.classList.remove('active'),180);
  try {
    const off=document.createElement('canvas');
    off.width=canvas.width; off.height=canvas.height;
    off.getContext('2d').drawImage(canvas,0,0);
    const blob=await new Promise(r=>off.toBlob(r,'image/png'));
    const file=new File([blob],'stpaddys.png',{type:'image/png'});
    if (navigator.canShare?.({files:[file]})) {
      await navigator.share({files:[file],title:"☘️ Happy St. Patrick's Day!"});
    } else {
      const url=URL.createObjectURL(blob);
      const a=Object.assign(document.createElement('a'),{href:url,download:'stpaddys.png'});
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
  } catch(e){ console.error(e); }
});

document.addEventListener('DOMContentLoaded', ()=>start().catch(console.error));
