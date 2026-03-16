// ☘️ St. Patrick's Day Filter v8
// Look-up: chin Y in canvas space — looking up = chin moves toward top (Y decreases)
// Denser pile: smaller settled coins, tighter random packing, more columns

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

const smoothX    = new Smoother(0.3);
const smoothY    = new Smoother(0.3);
const smoothFW   = new Smoother(0.25);
const smoothAng  = new AngleSmoother(0.2);
const smoothChin = new Smoother(0.08);  // pile limit tracker

// ─────────────────────────────────────────
// Look-up detection — chin canvas Y
// ─────────────────────────────────────────
// Strategy: collect a rolling baseline of chin Y over the first ~60 frames.
// When chin rises more than THRESHOLD px above baseline → looking up.
// This is distance/person-agnostic.

let chinBaseline  = null;   // stable resting chin Y (canvas px)
let baselineSamples = [];
const BASELINE_FRAMES = 60;      // frames to collect before activating
const LOOKUP_RISE_PX  = 0.05;    // fraction of canvas height chin must rise above baseline

let lookUpFrames  = 0;
let isLookingUp   = false;
let chinCanvasY   = 0;
let smoothedChinY = null;  // EMA for look-up detection (faster alpha)

function updateLookUp(lm) {
  const [, cy] = lmToCanvas(lm[152]);  // chin in canvas px
  chinCanvasY = cy;

  // Fast EMA just for the look-up signal (separate from pile limit smoother)
  smoothedChinY = smoothedChinY === null ? cy : smoothedChinY * 0.75 + cy * 0.25;

  // Accumulate baseline during warm-up
  if (baselineSamples.length < BASELINE_FRAMES) {
    baselineSamples.push(smoothedChinY);
    if (baselineSamples.length === BASELINE_FRAMES) {
      // Use median of samples as baseline (robust to any stray frames)
      const sorted = [...baselineSamples].sort((a, b) => a - b);
      chinBaseline = sorted[Math.floor(sorted.length / 2)];
    }
    isLookingUp = false;
    return;
  }

  // Recalibrate baseline slowly so posture drift doesn't lock out the trigger
  // Only update when NOT looking up (so the trigger doesn't cancel itself)
  const threshold = canvas.height * LOOKUP_RISE_PX;
  const risen = smoothedChinY < chinBaseline - threshold;

  if (!risen) {
    // Drift baseline toward current position very slowly (≈every 180 frames it fully adapts)
    chinBaseline = chinBaseline * 0.994 + smoothedChinY * 0.006;
  }

  lookUpFrames = risen
    ? Math.min(lookUpFrames + 1, 16)
    : Math.max(lookUpFrames - 2,  0);

  isLookingUp = lookUpFrames >= 6;
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
// Pile — column height-map + settled PNGs
// ─────────────────────────────────────────
const NUM_COLS = 90;          // more columns = finer packing resolution
let colSurface = [];
let settled    = [];
let pileChainY = -1;          // tracked chin for pile ceiling

function potFloorForCol(c) {
  const { cx, rimY, rimRX } = getPot();
  const colW  = canvas.width / NUM_COLS;
  const colCX = (c + 0.5) * colW;
  return Math.abs(colCX - cx) < rimRX * 0.95 ? rimY : canvas.height + 20;
}

function initPile() {
  colSurface = Array.from({ length: NUM_COLS }, (_, c) => potFloorForCol(c));
}

function colIndex(x) {
  return Math.max(0, Math.min(NUM_COLS - 1, Math.floor(x / canvas.width * NUM_COLS)));
}
function surfaceAt(x) { return colSurface[colIndex(x)]; }

function getPileLimit() {
  return pileChainY > 0 ? pileChainY + 4 : canvas.height * 0.48;
}

function settleCoin(coin) {
  const colW = canvas.width / NUM_COLS;

  // Random jitter so coins don't land perfectly centred — creates organic pile
  const jitter = (Math.random() - 0.5) * coin.size * 0.55;
  const landX  = Math.max(coin.size * 0.5, Math.min(canvas.width - coin.size * 0.5, coin.x + jitter));

  const c0 = Math.max(0, Math.floor((landX - coin.size * 0.44) / colW));
  const c1 = Math.min(NUM_COLS - 1, Math.floor((landX + coin.size * 0.44) / colW));

  let surface = canvas.height;
  for (let c = c0; c <= c1; c++) surface = Math.min(surface, colSurface[c]);

  // Sink coins slightly into each other for a denser look
  const settledY  = surface - coin.size * 0.52;
  const pileLimit = getPileLimit();
  if (settledY < pileLimit) return;

  for (let c = c0; c <= c1; c++) {
    const ns = Math.min(colSurface[c], settledY - coin.size * 0.42);
    colSurface[c] = Math.max(ns, pileLimit);
  }

  // Random tilt when settled (-25° to +25°)
  const settledRot = (Math.random() - 0.5) * 0.9;

  settled.push({ x: landX, y: settledY, size: coin.size, img: coin.img, rot: settledRot });
  if (settled.length > 280) settled.splice(0, settled.length - 280);
}

function drawSettled() {
  // Draw back-to-front so top of pile is on top visually
  for (const s of settled) {
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(s.rot);
    ctx.drawImage(s.img, -s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Pot of gold
// ─────────────────────────────────────────
function drawPot() {
  const { cx, rimY, rimRX, rimRY } = getPot();
  const bodyR  = rimRX * 0.98;
  const bodyCY = rimY + bodyR * 0.04;

  ctx.save();

  // Body clipped below rim
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, rimY - 2, canvas.width, canvas.height - rimY + 4);
  ctx.clip();

  ctx.beginPath();
  ctx.arc(cx, bodyCY, bodyR, 0, Math.PI * 2);
  const bg = ctx.createRadialGradient(
    cx - bodyR * 0.28, bodyCY - bodyR * 0.28, bodyR * 0.04,
    cx, bodyCY, bodyR * 1.08
  );
  bg.addColorStop(0,   '#5a5a5a');
  bg.addColorStop(0.3, '#2a2a2a');
  bg.addColorStop(0.7, '#131313');
  bg.addColorStop(1,   '#050505');
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx - bodyR * 0.26, bodyCY - bodyR * 0.12, bodyR * 0.11, bodyR * 0.34, -0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,120,120,0.16)';
  ctx.fill();
  ctx.restore();

  // Rim shadow
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY * 0.6, rimRX * 0.98, rimRY * 0.65, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fill();

  // Gold rim
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX, rimRY, 0, 0, Math.PI * 2);
  const rg = ctx.createLinearGradient(cx - rimRX, rimY - rimRY, cx + rimRX, rimY + rimRY);
  rg.addColorStop(0,    '#ffe84a');
  rg.addColorStop(0.20, '#fff276');
  rg.addColorStop(0.50, '#c89010');
  rg.addColorStop(0.78, '#a06808');
  rg.addColorStop(1,    '#7a4e04');
  ctx.fillStyle = rg;
  ctx.fill();

  // Inner shadow
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY * 0.28, rimRX * 0.82, rimRY * 0.52, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.60)';
  ctx.fill();

  // Shine
  ctx.beginPath();
  ctx.ellipse(cx - rimRX * 0.23, rimY - rimRY * 0.28, rimRX * 0.26, rimRY * 0.30, -0.14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,215,0.42)';
  ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────
// Falling coins
// ─────────────────────────────────────────
let falling     = [];
let lastSpawnMs = 0;

function spawnFromSky() {
  const now = performance.now();
  if (now - lastSpawnMs < 80) return;
  lastSpawnMs = now;

  for (let i = 0; i < 3; i++) {
    const isCoin = Math.random() < 0.65;
    // Smaller settled size for denser packing — falling shows at 1.4× then shrinks on land
    const base = isCoin ? (13 + Math.random() * 14) : (10 + Math.random() * 12);
    const size = base * window.devicePixelRatio;
    falling.push({
      x:    canvas.width * (0.05 + Math.random() * 0.90),
      y:    -size,
      vx:   (Math.random() - 0.5) * 3.5,
      vy:   1.4 + Math.random() * 2.0,
      ay:   0.26 + Math.random() * 0.10,
      rot:  Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.12,
      size,
      img:  isCoin ? coinImg : shamrockImg,
    });
  }
  if (falling.length > 140) falling.splice(0, falling.length - 140);
}

function stepFalling() {
  const toRemove = [];
  for (let i = 0; i < falling.length; i++) {
    const p = falling[i];
    p.vy += p.ay; p.x += p.vx; p.y += p.vy; p.rot += p.spin;

    if (p.x - p.size * 0.5 < 0)            { p.x = p.size * 0.5;              p.vx =  Math.abs(p.vx) * 0.6; }
    if (p.x + p.size * 0.5 > canvas.width) { p.x = canvas.width - p.size*0.5; p.vx = -Math.abs(p.vx) * 0.6; }

    if (p.y + p.size * 0.5 >= surfaceAt(p.x)) {
      settleCoin(p);
      toRemove.push(i);
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
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
    size: (10 + Math.random() * 13) * window.devicePixelRatio,
    vx: (Math.random() - 0.5) * 0.55, vy: -(0.3 + Math.random() * 0.4),
    rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.016,
    alpha: 0.10 + Math.random() * 0.12,
  });
}
function stepAmbient() {
  for (const p of ambient) {
    p.x += p.vx; p.y += p.vy; p.rot += p.spin;
    if (p.y < -50) { p.y = canvas.height + 30; p.x = Math.random() * canvas.width; }
    ctx.save(); ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.drawImage(shamrockImg, -p.size / 2, -p.size / 2, p.size, p.size);
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
    ctx.arc(cx, cy, radius + i * bw, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${r},${g},${b},${rainbowAlpha})`;
    ctx.lineWidth = bw * 1.15; ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face tint
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234, y234] = lmToCanvas(lm[234]);
  const [x454, y454] = lmToCanvas(lm[454]);
  const [x10,  y10 ] = lmToCanvas(lm[10]);
  const [x152, y152] = lmToCanvas(lm[152]);
  const fcx = (x234+x454)/2, fcy = (y10+y152)/2;
  const faceW = Math.hypot(x454-x234, y454-y234);
  const faceH = Math.abs(y152-y10)*1.05;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(fcx, fcy, faceW*0.52, faceH*0.52, 0, 0, Math.PI*2);
  ctx.clip();
  const g = ctx.createRadialGradient(fcx, fcy-faceH*0.1, 0, fcx, fcy, faceW*0.55);
  g.addColorStop(0,   'rgba(0,200,50,0.00)');
  g.addColorStop(0.5, 'rgba(0,180,40,0.05)');
  g.addColorStop(1,   'rgba(0,140,30,0.13)');
  ctx.fillStyle = g;
  ctx.fillRect(fcx-faceW, fcy-faceH, faceW*2, faceH*2);
  ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrocks
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234] = lmToCanvas(lm[234]);
  const [x454] = lmToCanvas(lm[454]);
  const [,y234] = lmToCanvas(lm[234]);
  const [,y454] = lmToCanvas(lm[454]);
  const faceW = Math.hypot(x454-x234, y454-y234);
  const size = faceW * 0.13;
  for (const idx of [50, 280]) {
    const [cx, cy] = lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha = 0.75;
    ctx.drawImage(shamrockImg, cx-size/2, cy-size/2, size, size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat
// ─────────────────────────────────────────
const BRIM_BOTTOM_FRAC = 855 / 900;
const CROWN_TOP_FRAC   =  80 / 900;

function drawHat(lm) {
  const [x10,  y10 ] = lmToCanvas(lm[10]);
  const [x234, y234] = lmToCanvas(lm[234]);
  const [x454, y454] = lmToCanvas(lm[454]);
  const [xL, yL, xR, yR] = x234 <= x454 ? [x234,y234,x454,y454] : [x454,y454,x234,y234];
  const angle = Math.atan2(yR-yL, xR-xL);
  const faceW = Math.hypot(xR-xL, yR-yL);
  const sx = smoothX.update(x10), sy = smoothY.update(y10);
  const sw = smoothFW.update(faceW), sa = smoothAng.update(angle);
  const hatW = sw * 1.25, hatH = hatW * (900/800);
  const anchorY = hatH * BRIM_BOTTOM_FRAC;
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(sa);
  ctx.shadowColor = 'rgba(0,20,0,0.5)';
  ctx.shadowBlur  = 16 * window.devicePixelRatio;
  ctx.shadowOffsetY = 6 * window.devicePixelRatio;
  ctx.drawImage(hatImg, -hatW/2, -anchorY, hatW, hatH);
  ctx.restore();
  return { rcx: sx, rcy: sy - anchorY + hatH * CROWN_TOP_FRAC, faceW: sw };
}

// ─────────────────────────────────────────
// Debug overlay (remove once confirmed)
// ─────────────────────────────────────────
function drawDebug() {
  const warmup = baselineSamples.length < BASELINE_FRAMES;
  const status = warmup
    ? `calibrating… ${baselineSamples.length}/${BASELINE_FRAMES}`
    : isLookingUp ? '👆 LOOKING UP' : '😐 straight';
  const rise   = chinBaseline !== null
    ? (chinBaseline - smoothedChinY).toFixed(1) + 'px'
    : '--';
  const dpr    = window.devicePixelRatio;
  ctx.save();
  ctx.font = `bold ${13 * dpr}px -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(8, 8, 260 * dpr, 30 * dpr);
  ctx.fillStyle = isLookingUp ? '#00ff88' : '#fff';
  ctx.fillText(`chin rise: ${rise}  ${status}`, 14, 26 * dpr);
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
  if (currentFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  // 2. Ambient
  if (ambient.length === 0) initAmbient();
  stepAmbient();

  // 3. Settled pile (behind pot rim)
  drawSettled();

  // 4. Pot
  drawPot();

  let hatAnchor = null;

  // 5. Face
  if (results.multiFaceLandmarks?.length) {
    const lm = results.multiFaceLandmarks[0];
    const [, cy152] = lmToCanvas(lm[152]);
    pileChainY = smoothChin.update(cy152);
    drawFaceGrading(lm);
    hatAnchor = drawHat(lm);
    drawCheekStickers(lm);
    updateLookUp(lm);
  } else {
    lookUpFrames = Math.max(lookUpFrames - 1, 0);
    isLookingUp  = lookUpFrames >= 6;
  }

  // 6. Rainbow
  rainbowTarget = isLookingUp ? 0.60 : 0;
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  if (hatAnchor) drawRainbow(hatAnchor.rcx, hatAnchor.rcy, hatAnchor.faceW * 1.1);

  // 7. Coins
  if (isLookingUp) spawnFromSky();
  stepFalling();

  // 8. Debug
  drawDebug();
}

// ─────────────────────────────────────────
// Camera / FaceMesh
// ─────────────────────────────────────────
async function start() {
  const fm = new FaceMesh({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
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
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  smoothX.reset(); smoothY.reset(); smoothFW.reset(); smoothAng.reset();
  // Reset look-up calibration on camera flip
  baselineSamples = []; chinBaseline = null; smoothedChinY = null;
  start();
});

shutterBtn.addEventListener('click', async () => {
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 180);
  try {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    off.getContext('2d').drawImage(canvas, 0, 0);
    const blob = await new Promise(r => off.toBlob(r, 'image/png'));
    const file = new File([blob], 'stpaddys.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '☘️ Happy St. Patrick\'s Day!' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: 'stpaddys.png' });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
  } catch (e) { console.error(e); }
});

document.addEventListener('DOMContentLoaded', () => start().catch(console.error));
