// ☘️ St. Patrick's Day Filter v5
// Look-up detection (nose/bridge ratio) · PNG settled items · full-width pot
// Pile stops at chin · coins bounce off screen walls

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
// Canvas / cover map
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
    this.v += this.a * (v - this.v);
    return this.v;
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
    this.v += this.a * d;
    return this.v;
  }
  reset() { this.v = null; }
}

const smoothX   = new Smoother(0.3);
const smoothY   = new Smoother(0.3);
const smoothFW  = new Smoother(0.25);
const smoothAng = new AngleSmoother(0.2);
const smoothChin = new Smoother(0.06); // very slow — pile limit shouldn't jitter

// ─────────────────────────────────────────
// Pot geometry (shared between pile & draw)
// ─────────────────────────────────────────
function getPot() {
  const cx    = canvas.width * 0.5;
  const rimY  = canvas.height * 0.78;   // pot rim Y
  const rimRX = canvas.width * 0.46;    // full-width pot opening
  const rimRY = rimRX * 0.10;
  return { cx, rimY, rimRX, rimRY };
}

// ─────────────────────────────────────────
// Look-up detection
// ─────────────────────────────────────────
// lm[4]   = nose tip
// lm[168] = nose bridge (between eyes)
// When looking up: nose tip rises toward/above the bridge → dy shrinks
let lookUpFrames = 0;
let isLookingUp  = false;

function updateLookUp(lm) {
  const dy = lm[4].y - lm[168].y;   // positive = nose below bridge (normal)
  const up = dy < 0.07;              // looking up threshold
  lookUpFrames = up
    ? Math.min(lookUpFrames + 1, 14)
    : Math.max(lookUpFrames - 2, 0);
  isLookingUp = lookUpFrames >= 7;
}

// ─────────────────────────────────────────
// Pile — column-height-map for collision
//        + settled PNG items for rendering
// ─────────────────────────────────────────
const NUM_COLS = 60;
let colSurface = [];    // Y of pile surface per column (canvas px)
let settled    = [];    // {x, y, size, img, rot} — drawn as PNG

let chinY = -1;         // current chin limit in canvas px (-1 = not set)

function initPile() {
  const { rimY } = getPot();
  colSurface = new Array(NUM_COLS).fill(rimY);
  // Don't clear settled — pile persists between resizes
}

function colIndex(x) {
  return Math.max(0, Math.min(NUM_COLS - 1, Math.floor(x / canvas.width * NUM_COLS)));
}
function surfaceAt(x) { return colSurface[colIndex(x)]; }

function getPileLimit() {
  // Pile stops a little below the chin; default to 55% down the screen
  return chinY > 0 ? chinY + canvas.height * 0.01 : canvas.height * 0.55;
}

// Settle a coin into the pile. Returns true if settled, false if pile is full.
function settleCoin(coin) {
  const colW = canvas.width / NUM_COLS;
  const c0 = Math.max(0, Math.floor((coin.x - coin.size * 0.48) / colW));
  const c1 = Math.min(NUM_COLS - 1, Math.floor((coin.x + coin.size * 0.48) / colW));

  // Highest (smallest Y) surface in the columns this coin covers
  let surface = canvas.height;
  for (let c = c0; c <= c1; c++) surface = Math.min(surface, colSurface[c]);

  const settledY  = surface - coin.size * 0.38;
  const pileLimit = getPileLimit();

  if (settledY < pileLimit) return false; // pile reached the limit

  // Update column surfaces
  for (let c = c0; c <= c1; c++) {
    const ns = Math.min(colSurface[c], settledY - coin.size * 0.36);
    colSurface[c] = Math.max(ns, pileLimit);
  }

  // Add as rendered PNG item
  settled.push({ x: coin.x, y: settledY, size: coin.size, img: coin.img, rot: coin.rot });

  // Cap pile size for performance
  const MAX_SETTLED = 200;
  if (settled.length > MAX_SETTLED) settled.splice(0, settled.length - MAX_SETTLED);

  return true;
}

function drawSettled() {
  for (const s of settled) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.drawImage(s.img, -s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Pot of gold — full-width, cropped bottom
// ─────────────────────────────────────────
function drawPot() {
  const { cx, rimY, rimRX, rimRY } = getPot();
  const bodyR  = rimRX * 1.05;          // large sphere body
  const bodyCY = rimY + rimRY + bodyR * 0.12;

  ctx.save();

  // ── Dark cauldron body (large circle, extends off-screen bottom) ──
  ctx.beginPath();
  ctx.arc(cx, bodyCY, bodyR, 0, Math.PI * 2);
  const bodyGrad = ctx.createRadialGradient(
    cx - bodyR * 0.3, bodyCY - bodyR * 0.3, bodyR * 0.05,
    cx, bodyCY, bodyR * 1.1
  );
  bodyGrad.addColorStop(0,   '#606060');
  bodyGrad.addColorStop(0.3, '#2e2e2e');
  bodyGrad.addColorStop(0.7, '#141414');
  bodyGrad.addColorStop(1,   '#050505');
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Body highlight streak (left side)
  ctx.beginPath();
  ctx.ellipse(cx - bodyR * 0.28, bodyCY - bodyR * 0.3, bodyR * 0.12, bodyR * 0.38, -0.25, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(130,130,130,0.18)';
  ctx.fill();

  // ── Gold rim (ellipse at top of pot opening) ──
  // Draw rim shadow first (depth)
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY * 0.5, rimRX * 0.84, rimRY * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.70)';
  ctx.fill();

  // Rim gold face
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX, rimRY, 0, 0, Math.PI * 2);
  const rimGrad = ctx.createLinearGradient(cx - rimRX, rimY - rimRY, cx + rimRX, rimY + rimRY);
  rimGrad.addColorStop(0,    '#ffe84a');
  rimGrad.addColorStop(0.22, '#fff176');
  rimGrad.addColorStop(0.50, '#c8940e');
  rimGrad.addColorStop(0.75, '#a06808');
  rimGrad.addColorStop(1,    '#7a4e04');
  ctx.fillStyle = rimGrad;
  ctx.fill();

  // Rim top shine
  ctx.beginPath();
  ctx.ellipse(cx - rimRX * 0.22, rimY - rimRY * 0.28, rimRX * 0.28, rimRY * 0.32, -0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,220,0.42)';
  ctx.fill();

  // Rim inner shadow (opening looks deep)
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY * 0.3, rimRX * 0.80, rimRY * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
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
  if (now - lastSpawnMs < 85) return;
  lastSpawnMs = now;

  for (let i = 0; i < 3; i++) {
    const isCoin = Math.random() < 0.65;
    const baseSize = isCoin ? (20 + Math.random() * 22) : (15 + Math.random() * 17);
    const size = baseSize * window.devicePixelRatio;
    falling.push({
      x:    canvas.width  * (0.08 + Math.random() * 0.84),  // within screen
      y:    -size,
      vx:   (Math.random() - 0.5) * 3.0,
      vy:   1.2 + Math.random() * 1.8,
      ay:   0.25 + Math.random() * 0.10,
      rot:  Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.10,
      size,
      img:  isCoin ? coinImg : shamrockImg,
    });
  }
  if (falling.length > 120) falling.splice(0, falling.length - 120);
}

function stepFalling() {
  const toRemove = [];

  for (let i = 0; i < falling.length; i++) {
    const p = falling[i];
    p.vy += p.ay;
    p.x  += p.vx;
    p.y  += p.vy;
    p.rot += p.spin;

    // Bounce off left/right screen edges
    if (p.x - p.size * 0.5 < 0) {
      p.x  = p.size * 0.5;
      p.vx = Math.abs(p.vx) * 0.6;
    }
    if (p.x + p.size * 0.5 > canvas.width) {
      p.x  = canvas.width - p.size * 0.5;
      p.vx = -Math.abs(p.vx) * 0.6;
    }

    // Check if hit pile surface
    const surface = surfaceAt(p.x);
    if (p.y + p.size * 0.5 >= surface) {
      settleCoin(p);
      toRemove.push(i);
      continue;
    }

    // Draw
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }

  // Remove settled (reverse so indices stay valid)
  for (let i = toRemove.length - 1; i >= 0; i--) {
    falling.splice(toRemove[i], 1);
  }
}

// ─────────────────────────────────────────
// Ambient shamrocks (background drift)
// ─────────────────────────────────────────
let ambient = [];
function initAmbient() {
  for (let i = 0; i < 5; i++) ambient.push({
    x: Math.random() * canvas.width,
    y: canvas.height + Math.random() * canvas.height,
    size: (11 + Math.random() * 15) * window.devicePixelRatio,
    vx: (Math.random() - 0.5) * 0.55, vy: -(0.3 + Math.random() * 0.4),
    rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.017,
    alpha: 0.11 + Math.random() * 0.12,
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
// Rainbow arc (fades in when looking up)
// ─────────────────────────────────────────
let rainbowAlpha = 0, rainbowTarget = 0;
function drawRainbow(cx, cy, radius) {
  if (rainbowAlpha < 0.01) return;
  const bands = [[255,50,50],[255,140,0],[255,230,0],[50,210,50],[50,120,255],[180,50,255]];
  const bw = radius * 0.07;
  for (let i = 0; i < bands.length; i++) {
    const [r, g, b] = bands[i];
    ctx.beginPath();
    ctx.arc(cx, cy, radius + i * bw, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${r},${g},${b},${rainbowAlpha})`;
    ctx.lineWidth = bw * 1.15;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face tint
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234] = lmToCanvas(lm[234]);
  const [x454] = lmToCanvas(lm[454]);
  const [, y234] = lmToCanvas(lm[234]);
  const [, y454] = lmToCanvas(lm[454]);
  const [x10,  y10 ] = lmToCanvas(lm[10]);
  const [x152, y152] = lmToCanvas(lm[152]);
  const fcx   = (x234 + x454) / 2, fcy = (y10 + y152) / 2;
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const faceH = Math.abs(y152 - y10) * 1.05;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(fcx, fcy, faceW * 0.52, faceH * 0.52, 0, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(fcx, fcy - faceH * 0.1, 0, fcx, fcy, faceW * 0.55);
  g.addColorStop(0,   'rgba(0,200,50,0.00)');
  g.addColorStop(0.5, 'rgba(0,180,40,0.05)');
  g.addColorStop(1,   'rgba(0,140,30,0.13)');
  ctx.fillStyle = g;
  ctx.fillRect(fcx - faceW, fcy - faceH, faceW * 2, faceH * 2);
  ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrocks
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234] = lmToCanvas(lm[234]);
  const [x454] = lmToCanvas(lm[454]);
  const [, y234] = lmToCanvas(lm[234]);
  const [, y454] = lmToCanvas(lm[454]);
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const size  = faceW * 0.13;
  for (const idx of [50, 280]) {
    const [cx, cy] = lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha = 0.75;
    ctx.drawImage(shamrockImg, cx - size / 2, cy - size / 2, size, size);
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

  const [xL, yL, xR, yR] = x234 <= x454
    ? [x234, y234, x454, y454]
    : [x454, y454, x234, y234];

  const angle = Math.atan2(yR - yL, xR - xL);
  const faceW = Math.hypot(xR - xL, yR - yL);

  const sx = smoothX.update(x10);
  const sy = smoothY.update(y10);
  const sw = smoothFW.update(faceW);
  const sa = smoothAng.update(angle);

  const hatW    = sw * 1.25;
  const hatH    = hatW * (900 / 800);
  const anchorY = hatH * BRIM_BOTTOM_FRAC;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(sa);
  ctx.shadowColor   = 'rgba(0,20,0,0.5)';
  ctx.shadowBlur    = 16 * window.devicePixelRatio;
  ctx.shadowOffsetY =  6 * window.devicePixelRatio;
  ctx.drawImage(hatImg, -hatW / 2, -anchorY, hatW, hatH);
  ctx.restore();

  return {
    rcx: sx,
    rcy: sy - anchorY + hatH * CROWN_TOP_FRAC,
    faceW: sw,
  };
}

// ─────────────────────────────────────────
// Main frame handler
// ─────────────────────────────────────────
function onResults(results) {
  resizeCanvas();
  const { rW, rH, ox, oy } = coverMap();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Video (mirrored selfie)
  ctx.save();
  if (currentFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  // 2. Background ambient shamrocks
  if (ambient.length === 0) initAmbient();
  stepAmbient();

  // 3. Settled PNG pile (rendered before pot so pot rim sits on top)
  drawSettled();

  // 4. Pot of gold (rim covers base of pile; body at bottom)
  drawPot();

  let hatAnchor = null;

  // 5. Face effects
  if (results.multiFaceLandmarks?.length) {
    const lm = results.multiFaceLandmarks[0];

    // Track chin Y for pile limit
    const [, cy152] = lmToCanvas(lm[152]);
    chinY = smoothChin.update(cy152);

    drawFaceGrading(lm);
    hatAnchor = drawHat(lm);
    drawCheekStickers(lm);
    updateLookUp(lm);
  } else {
    // Fade out look-up
    lookUpFrames = Math.max(lookUpFrames - 1, 0);
    isLookingUp  = lookUpFrames >= 7;
  }

  // 6. Rainbow
  rainbowTarget = isLookingUp ? 0.60 : 0;
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  if (hatAnchor) drawRainbow(hatAnchor.rcx, hatAnchor.rcy, hatAnchor.faceW * 1.1);

  // 7. Spawn & step falling items
  if (isLookingUp) spawnFromSky();
  stepFalling();
}

// ─────────────────────────────────────────
// Camera / FaceMesh
// ─────────────────────────────────────────
async function start() {
  const fm = new FaceMesh({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
  });
  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  fm.onResults(onResults);
  if (camera) camera.stop();
  camera = new Camera(video, {
    onFrame: async () => fm.send({ image: video }),
    width: 1280, height: 720,
    facingMode: currentFacingMode,
  });
  await camera.start();
  resizeCanvas();
  initPile();
}

// ─────────────────────────────────────────
// UI
// ─────────────────────────────────────────
flipBtn.addEventListener('click', () => {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  smoothX.reset(); smoothY.reset(); smoothFW.reset(); smoothAng.reset();
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
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (e) { console.error(e); }
});

document.addEventListener('DOMContentLoaded', () => start().catch(console.error));
