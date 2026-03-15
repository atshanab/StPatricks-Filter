// ☘️ St. Patrick's Day Filter v4
// Look-up detection → coins + shamrocks fall from sky
// Pot of gold at bottom fills up as pile grows toward screen top

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
  const newW = canvas.clientWidth  * window.devicePixelRatio;
  const newH = canvas.clientHeight * window.devicePixelRatio;
  if (newW !== canvas.width || newH !== canvas.height) {
    canvas.width  = newW;
    canvas.height = newH;
    initPile(); // re-init pile on resize
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

// ─────────────────────────────────────────
// Look-up detection
// ─────────────────────────────────────────
// Measures face vertical span vs width in normalised coords.
// Straight: ~1.5-1.7   |   Looking up: < 1.25
let lookUpFrames = 0;
let isLookingUp  = false;

function updateLookUp(lm) {
  const vertSpan = lm[152].y - lm[10].y;
  const faceW    = Math.abs(lm[454].x - lm[234].x);
  const ratio    = vertSpan / faceW;
  const up       = ratio < 1.22;
  lookUpFrames   = up
    ? Math.min(lookUpFrames + 1, 12)
    : Math.max(lookUpFrames - 2, 0);
  isLookingUp = lookUpFrames >= 5;
}

// ─────────────────────────────────────────
// Pile (column height-map system)
// ─────────────────────────────────────────
const NUM_COLS = 55;
let colSurface = []; // Y of top of pile in each column (canvas px). Decreases as pile grows.

function initPile() {
  colSurface = new Array(NUM_COLS).fill(canvas.height + 10);
}

function colIndex(x) {
  return Math.max(0, Math.min(NUM_COLS - 1, Math.floor(x / canvas.width * NUM_COLS)));
}

function surfaceAt(x) {
  return colSurface[colIndex(x)];
}

// Called when a coin settles. Returns settled Y.
function settleCoin(coin) {
  const colW = canvas.width / NUM_COLS;
  const c0 = Math.max(0, Math.floor((coin.x - coin.size * 0.5) / colW));
  const c1 = Math.min(NUM_COLS - 1, Math.floor((coin.x + coin.size * 0.5) / colW));
  // Find the highest existing surface in the affected columns
  let surface = canvas.height;
  for (let c = c0; c <= c1; c++) surface = Math.min(surface, colSurface[c]);
  const settledY = surface - coin.size * 0.45;
  // Update each column's surface (clamp to top of canvas)
  for (let c = c0; c <= c1; c++) {
    colSurface[c] = Math.min(colSurface[c], Math.max(0, settledY - coin.size * 0.1));
  }
  return settledY;
}

// ─────────────────────────────────────────
// Draw pile (behind the pot, behind the face)
// ─────────────────────────────────────────
function drawPile() {
  const colW = canvas.width / NUM_COLS;
  const minSurface = Math.min(...colSurface);
  if (minSurface >= canvas.height) return; // nothing settled yet

  // ── Gold fill polygon ──────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, canvas.height + 10);
  for (let i = 0; i < NUM_COLS; i++) {
    // Smooth the profile slightly with neighbours
    const prev = colSurface[Math.max(0, i - 1)];
    const curr = colSurface[i];
    const next = colSurface[Math.min(NUM_COLS - 1, i + 1)];
    const smooth = (prev + curr * 2 + next) / 4;
    const x = (i + 0.5) * colW;
    ctx.lineTo(x, smooth);
  }
  ctx.lineTo(canvas.width, canvas.height + 10);
  ctx.closePath();

  const topY   = Math.max(0, minSurface - 20);
  const grad   = ctx.createLinearGradient(0, topY, 0, canvas.height);
  grad.addColorStop(0,   'rgba(255, 215, 25, 0.97)');
  grad.addColorStop(0.35,'rgba(240, 185, 18, 0.98)');
  grad.addColorStop(0.75,'rgba(200, 145, 12, 1.00)');
  grad.addColorStop(1,   'rgba(160, 100,  8, 1.00)');
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Coin-circle edge detail at surface ────────────────
  const coinR = colW * 0.62;
  for (let i = 0; i < NUM_COLS; i++) {
    const prev = colSurface[Math.max(0, i - 1)];
    const curr = colSurface[i];
    const next = colSurface[Math.min(NUM_COLS - 1, i + 1)];
    const sy = (prev + curr * 2 + next) / 4;
    if (sy >= canvas.height - 4) continue;

    const x = (i + 0.5) * colW;

    // coin face
    ctx.beginPath();
    ctx.arc(x, sy, coinR, 0, Math.PI * 2);
    const cg = ctx.createRadialGradient(x - coinR * 0.25, sy - coinR * 0.25, 0, x, sy, coinR);
    cg.addColorStop(0,   'rgba(255,240,100,0.95)');
    cg.addColorStop(0.55,'rgba(255,205, 40,0.90)');
    cg.addColorStop(1,   'rgba(190,130, 10,0.85)');
    ctx.fillStyle = cg;
    ctx.fill();

    // coin edge
    ctx.strokeStyle = 'rgba(160, 100, 8, 0.55)';
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    // shine
    ctx.beginPath();
    ctx.arc(x - coinR * 0.28, sy - coinR * 0.28, coinR * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,210,0.45)';
    ctx.fill();
  }
  ctx.restore();
}

// ─────────────────────────────────────────
// Draw pot of gold
// ─────────────────────────────────────────
function drawPot() {
  const cx     = canvas.width  * 0.5;
  const rimY   = canvas.height * 0.79;
  const rimRX  = canvas.width  * 0.26;
  const rimRY  = rimRX         * 0.20;
  const bodyH  = canvas.height * 0.20;
  const bodyCY = rimY + bodyH  * 0.52;
  const bodyRX = rimRX         * 0.85;
  const bodyRY = bodyH         * 0.55;
  const legW   = rimRX         * 0.16;
  const legH   = bodyH         * 0.28;
  const legY   = rimY + bodyH  * 0.96;

  ctx.save();

  // ── Three legs ──────────────────────────
  const legPositions = [cx - rimRX * 0.52, cx, cx + rimRX * 0.52];
  for (const lx of legPositions) {
    ctx.beginPath();
    ctx.ellipse(lx, legY, legW * 0.9, legH * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    // leg highlight
    ctx.beginPath();
    ctx.ellipse(lx - legW * 0.2, legY - legH * 0.12, legW * 0.28, legH * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(80,80,80,0.5)';
    ctx.fill();
  }

  // ── Pot body ────────────────────────────
  ctx.beginPath();
  ctx.ellipse(cx, bodyCY, bodyRX, bodyRY, 0, 0, Math.PI * 2);
  const bodyGrad = ctx.createRadialGradient(
    cx - bodyRX * 0.35, bodyCY - bodyRY * 0.35, bodyRY * 0.05,
    cx, bodyCY, Math.max(bodyRX, bodyRY) * 1.1
  );
  bodyGrad.addColorStop(0,   '#555');
  bodyGrad.addColorStop(0.4, '#2a2a2a');
  bodyGrad.addColorStop(1,   '#0a0a0a');
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // body highlight streak
  ctx.beginPath();
  ctx.ellipse(cx - bodyRX * 0.28, bodyCY - bodyRY * 0.35, bodyRX * 0.18, bodyRY * 0.45, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,120,120,0.22)';
  ctx.fill();

  // ── Rim ellipse (gold) ───────────────────
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX, rimRY, 0, 0, Math.PI * 2);
  const rimGrad = ctx.createLinearGradient(cx - rimRX, rimY - rimRY, cx + rimRX, rimY + rimRY);
  rimGrad.addColorStop(0,    '#ffe033');
  rimGrad.addColorStop(0.28, '#ffed70');
  rimGrad.addColorStop(0.55, '#c89010');
  rimGrad.addColorStop(0.78, '#a06808');
  rimGrad.addColorStop(1,    '#7a4e04');
  ctx.fillStyle = rimGrad;
  ctx.fill();

  // rim inner shadow (depth illusion)
  ctx.beginPath();
  ctx.ellipse(cx, rimY + rimRY * 0.35, rimRX * 0.80, rimRY * 0.52, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fill();

  // rim shine
  ctx.beginPath();
  ctx.ellipse(cx - rimRX * 0.25, rimY - rimRY * 0.3, rimRX * 0.32, rimRY * 0.28, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,200,0.38)';
  ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────
// Falling coins
// ─────────────────────────────────────────
let falling    = [];
let lastSpawnMs = 0;

function spawnFromSky() {
  const now = performance.now();
  if (now - lastSpawnMs < 90) return;
  lastSpawnMs = now;

  const count = 3;
  for (let i = 0; i < count; i++) {
    const isCoin = Math.random() < 0.65;
    const size   = isCoin
      ? (22 + Math.random() * 22) * window.devicePixelRatio
      : (16 + Math.random() * 18) * window.devicePixelRatio;
    falling.push({
      x:    Math.random() * canvas.width,
      y:    -size,
      vx:   (Math.random() - 0.5) * 2.5,
      vy:   1.5 + Math.random() * 2.0,
      ay:   0.28 + Math.random() * 0.12,
      rot:  Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.09,
      size,
      img:  isCoin ? coinImg : shamrockImg,
      settled: false,
    });
  }
  if (falling.length > 140) falling.splice(0, falling.length - 140);
}

function stepFalling() {
  const toRemove = [];

  for (let idx = 0; idx < falling.length; idx++) {
    const p = falling[idx];

    // Physics
    p.vy += p.ay;
    p.x  += p.vx;
    p.y  += p.vy;
    p.rot += p.spin;

    // Bounce off screen left / right walls
    if (p.x - p.size * 0.5 < 0) {
      p.x  = p.size * 0.5;
      p.vx = Math.abs(p.vx) * 0.55;
    }
    if (p.x + p.size * 0.5 > canvas.width) {
      p.x  = canvas.width - p.size * 0.5;
      p.vx = -Math.abs(p.vx) * 0.55;
    }

    // Check pile surface for settling
    const surface = surfaceAt(p.x);
    if (p.y + p.size * 0.5 >= surface) {
      p.y = settleCoin(p);
      toRemove.push(idx);
      continue;
    }

    // Draw falling coin
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }

  // Remove settled coins (reverse order to preserve indices)
  for (let i = toRemove.length - 1; i >= 0; i--) {
    falling.splice(toRemove[i], 1);
  }
}

// ─────────────────────────────────────────
// Ambient shamrocks (background)
// ─────────────────────────────────────────
let ambient = [];
function initAmbient() {
  for (let i = 0; i < 5; i++) ambient.push({
    x: Math.random() * canvas.width,
    y: canvas.height + Math.random() * canvas.height,
    size: (12 + Math.random() * 16) * window.devicePixelRatio,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -(0.35 + Math.random() * 0.45),
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.018,
    alpha: 0.12 + Math.random() * 0.14,
  });
}
function stepAmbient() {
  for (const p of ambient) {
    p.x += p.vx; p.y += p.vy; p.rot += p.spin;
    if (p.y < -50) { p.y = canvas.height + 30; p.x = Math.random() * canvas.width; }
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.drawImage(shamrockImg, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Rainbow arc (appears above hat when looking up)
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
    ctx.lineWidth = bw * 1.15;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face green tint
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234, y234] = lmToCanvas(lm[234]);
  const [x454, y454] = lmToCanvas(lm[454]);
  const [x10,  y10 ] = lmToCanvas(lm[10]);
  const [x152, y152] = lmToCanvas(lm[152]);
  const fcx  = (x234 + x454) / 2, fcy = (y10 + y152) / 2;
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const faceH = Math.abs(y152 - y10) * 1.05;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(fcx, fcy, faceW * 0.52, faceH * 0.52, 0, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(fcx, fcy - faceH*0.1, 0, fcx, fcy, faceW*0.55);
  g.addColorStop(0,   'rgba(0,200,50,0.00)');
  g.addColorStop(0.5, 'rgba(0,180,40,0.05)');
  g.addColorStop(1,   'rgba(0,140,30,0.13)');
  ctx.fillStyle = g;
  ctx.fillRect(fcx - faceW, fcy - faceH, faceW * 2, faceH * 2);
  ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrock stickers
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234, y234] = lmToCanvas(lm[234]);
  const [x454, y454] = lmToCanvas(lm[454]);
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const size  = faceW * 0.13;
  for (const idx of [50, 280]) {
    const [cx, cy] = lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha = 0.75;
    ctx.drawImage(shamrockImg, cx - size/2, cy - size/2, size, size);
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

  let [xL, yL, xR, yR] = x234 <= x454
    ? [x234, y234, x454, y454]
    : [x454, y454, x234, y234];

  const angle = Math.atan2(yR - yL, xR - xL);
  const faceW = Math.hypot(xR - xL, yR - yL);

  const sx = smoothX.update(x10);
  const sy = smoothY.update(y10);
  const sw = smoothFW.update(faceW);
  const sa = smoothAng.update(angle);

  const hatW = sw * 1.25;
  const hatH = hatW * (900 / 800);
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

  // 1. Video
  ctx.save();
  if (currentFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  // 2. Ambient background shamrocks
  if (ambient.length === 0) initAmbient();
  stepAmbient();

  let hatAnchor = null;

  // 3. Face effects
  if (results.multiFaceLandmarks?.length) {
    const lm = results.multiFaceLandmarks[0];
    drawFaceGrading(lm);
    hatAnchor = drawHat(lm);
    drawCheekStickers(lm);
    updateLookUp(lm);
  } else {
    lookUpFrames = Math.max(lookUpFrames - 1, 0);
    isLookingUp  = lookUpFrames >= 5;
  }

  // 4. Rainbow (above hat, visible when looking up)
  rainbowTarget = isLookingUp ? 0.6 : 0;
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  if (hatAnchor) drawRainbow(hatAnchor.rcx, hatAnchor.rcy, hatAnchor.faceW * 1.1);

  // 5. Spawn coins from sky when looking up
  if (isLookingUp) spawnFromSky();

  // 6. Gold pile (rendered behind the pot and falling coins)
  drawPile();

  // 7. Pot of gold (rendered over the pile base)
  drawPot();

  // 8. Falling coins (in front of pot)
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
