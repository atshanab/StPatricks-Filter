// ☘️ St. Patrick's Day Filter v9
// Hat: chin→forehead axis anchor + pitch foreshortening
// Coins: constrained to pot opening, cartoon gold heap rendering

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

const smoothHatX   = new Smoother(0.28);
const smoothHatY   = new Smoother(0.28);
const smoothFW     = new Smoother(0.25);
const smoothRoll   = new AngleSmoother(0.2);
const smoothPitch  = new Smoother(0.18);  // pitchScale 0..1
const smoothChin   = new Smoother(0.06);  // pile ceiling

// ─────────────────────────────────────────
// Look-up detection (baseline chin Y)
// ─────────────────────────────────────────
let chinBaseline    = null;
let baselineSamples = [];
const BASELINE_FRAMES = 60;
const LOOKUP_RISE     = 0.05; // fraction of canvas height

let lookUpFrames = 0;
let isLookingUp  = false;
let smoothedChinY = null;

function updateLookUp(lm) {
  const [, cy] = lmToCanvas(lm[152]);
  smoothedChinY = smoothedChinY === null ? cy : smoothedChinY * 0.75 + cy * 0.25;

  if (baselineSamples.length < BASELINE_FRAMES) {
    baselineSamples.push(smoothedChinY);
    if (baselineSamples.length === BASELINE_FRAMES) {
      const sorted = [...baselineSamples].sort((a, b) => a - b);
      chinBaseline = sorted[Math.floor(sorted.length / 2)];
    }
    isLookingUp = false; return;
  }

  const threshold = canvas.height * LOOKUP_RISE;
  const risen = smoothedChinY < chinBaseline - threshold;
  if (!risen) chinBaseline = chinBaseline * 0.994 + smoothedChinY * 0.006;

  lookUpFrames = risen
    ? Math.min(lookUpFrames + 1, 16)
    : Math.max(lookUpFrames - 2, 0);
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
// Pile — coin stack height per column
//        Cartoon heap rendered as layered circles
// ─────────────────────────────────────────
const NUM_COLS   = 80;
let   colHeight  = [];  // how many pixels of coins stacked per column (0 = empty)
let   pileChainY = -1;  // chin-based ceiling in canvas px

function initPile() {
  colHeight = new Array(NUM_COLS).fill(0);
}

function getPileLimit() {
  // Pile stops just below the chin (or 50% down if not tracked yet)
  return pileChainY > 0 ? pileChainY : canvas.height * 0.50;
}

function colIndex(x) {
  return Math.max(0, Math.min(NUM_COLS - 1, Math.floor(x / canvas.width * NUM_COLS)));
}

// Add coins into the pile; constrain to pot interior
function settleCoin(coin) {
  const { cx, rimY, rimRX } = getPot();

  // Only accept coins that land inside the pot opening
  if (Math.abs(coin.x - cx) > rimRX * 0.92) return;

  const jitter = (Math.random() - 0.5) * coin.size * 0.7;
  const landX  = Math.max(cx - rimRX * 0.88,
                   Math.min(cx + rimRX * 0.88, coin.x + jitter));

  const c0 = Math.max(0, Math.floor((landX - coin.size * 0.5) / (canvas.width / NUM_COLS)));
  const c1 = Math.min(NUM_COLS - 1, Math.floor((landX + coin.size * 0.5) / (canvas.width / NUM_COLS)));

  const increment = coin.size * 0.55; // how much each coin raises the pile
  for (let c = c0; c <= c1; c++) {
    const newSurface = rimY - colHeight[c] - increment;
    if (newSurface > getPileLimit()) {
      colHeight[c] += increment;
    }
  }
}

// Draw the cartoon coin heap inside the pot
function drawPile() {
  const { cx, rimY, rimRX, rimRY } = getPot();
  const colW = canvas.width / NUM_COLS;

  // Only draw columns that are inside the pot opening
  let anyCoins = false;
  for (let c = 0; c < NUM_COLS; c++) {
    if (colHeight[c] > 1) { anyCoins = true; break; }
  }
  if (!anyCoins) return;

  // ── 1. Gold bulk fill ─────────────────────────────────────────
  // Build a polygon: bottom = rimY, top = per-column surface (smooth)
  ctx.save();

  // Clip to the pot opening ellipse so gold doesn't spill out
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rimRX * 0.93, rimRY * 2.5, 0, 0, Math.PI * 2);
  ctx.rect(0, rimY, canvas.width, canvas.height);
  // Use clipping to only show pile inside pot and below rim
  ctx.beginPath();
  // clip rect: full width below rimY, but intersected with pot opening width
  ctx.rect(cx - rimRX * 0.92, rimY - 2, rimRX * 1.84, canvas.height);
  ctx.clip();

  // Build smooth surface polygon
  const points = [];
  for (let c = 0; c < NUM_COLS; c++) {
    const colCX = (c + 0.5) * colW;
    if (Math.abs(colCX - cx) > rimRX * 0.92) continue;
    const surf = rimY - colHeight[c];
    points.push([colCX, surf]);
  }

  if (points.length >= 2) {
    // Smooth the surface with neighbour averaging
    const smoothed = points.map(([x, y], i) => {
      const prev = points[Math.max(0, i - 1)][1];
      const next = points[Math.min(points.length - 1, i + 1)][1];
      return [x, (prev + y * 2 + next) / 4];
    });

    // Gold fill
    ctx.beginPath();
    ctx.moveTo(smoothed[0][0], rimY);
    for (const [x, y] of smoothed) ctx.lineTo(x, y);
    ctx.lineTo(smoothed[smoothed.length - 1][0], rimY);
    ctx.closePath();

    const topY = Math.min(...smoothed.map(p => p[1]));
    const grad = ctx.createLinearGradient(0, topY, 0, rimY);
    grad.addColorStop(0,    '#FFE033');
    grad.addColorStop(0.3,  '#FFD700');
    grad.addColorStop(0.65, '#C89010');
    grad.addColorStop(1,    '#9A6A08');
    ctx.fillStyle = grad;
    ctx.fill();

    // ── 2. Cartoon coin circles at the top surface ────────────────
    // Draw overlapping coin circles along the top edge for a cartoon heap look
    const coinR = colW * 1.1;
    for (let i = 0; i < smoothed.length; i++) {
      const [sx, sy] = smoothed[i];

      // Only draw top-layer coins (surface near the peak)
      const localMin = Math.min(
        smoothed[Math.max(0, i-1)][1],
        sy,
        smoothed[Math.min(smoothed.length-1, i+1)][1]
      );
      if (sy > localMin + coinR * 0.8) continue; // skip buried coins

      // Coin circle
      ctx.beginPath();
      ctx.arc(sx, sy, coinR, 0, Math.PI * 2);
      const cg = ctx.createRadialGradient(
        sx - coinR * 0.3, sy - coinR * 0.3, coinR * 0.05,
        sx, sy, coinR
      );
      cg.addColorStop(0,   '#FFF176');
      cg.addColorStop(0.4, '#FFD700');
      cg.addColorStop(0.8, '#C89010');
      cg.addColorStop(1,   '#8B6000');
      ctx.fillStyle = cg;
      ctx.fill();

      // Coin edge
      ctx.strokeStyle = 'rgba(150,90,5,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Coin shine
      ctx.beginPath();
      ctx.arc(sx - coinR * 0.28, sy - coinR * 0.3, coinR * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,200,0.50)';
      ctx.fill();

      // Shamrock stamp on every 4th coin
      if (i % 4 === 0 && shamrockImg.complete) {
        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.drawImage(shamrockImg, sx - coinR * 0.7, sy - coinR * 0.7, coinR * 1.4, coinR * 1.4);
        ctx.restore();
      }
    }

    // ── 3. Mid-pile coin circles (every ~3 columns, below surface) ─
    for (let i = 0; i < smoothed.length; i += 3) {
      const [sx, sy] = smoothed[i];
      const depth = rimY - sy; // how tall the pile is here
      if (depth < coinR * 2.5) continue;

      // Draw 1-2 partially-buried coins below the surface row
      for (let layer = 1; layer <= 2; layer++) {
        const ly = sy + coinR * layer * 1.6 + (Math.random() - 0.5) * coinR * 0.4;
        if (ly > rimY - 2) continue;
        const lx = sx + (Math.random() - 0.5) * colW * 2.2;

        ctx.beginPath();
        ctx.arc(lx, ly, coinR * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = layer === 1 ? '#E8B800' : '#C09000';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,70,0,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────
// Pot of gold (drawn OVER the pile)
// ─────────────────────────────────────────
function drawPot() {
  const { cx, rimY, rimRX, rimRY } = getPot();
  const bodyR  = rimRX * 0.98;
  const bodyCY = rimY + bodyR * 0.04;

  ctx.save();

  // Body clipped below rimY
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, rimY - 2, canvas.width, canvas.height - rimY + 4);
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

  // Shine
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
  if (now - lastSpawnMs < 80) return;
  lastSpawnMs = now;
  for (let i = 0; i < 3; i++) {
    const isCoin = Math.random() < 0.70;
    const base   = isCoin ? (13 + Math.random() * 12) : (10 + Math.random() * 10);
    const size   = base * window.devicePixelRatio;
    falling.push({
      x:    canvas.width * (0.05 + Math.random() * 0.90),
      y:    -size,
      vx:   (Math.random() - 0.5) * 3.5,
      vy:   1.4 + Math.random() * 2.0,
      ay:   0.26 + Math.random() * 0.10,
      rot:  Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.12,
      size, img: isCoin ? coinImg : shamrockImg,
    });
  }
  if (falling.length > 130) falling.splice(0, falling.length - 130);
}

function stepFalling() {
  const { rimY } = getPot();
  const toRemove = [];
  for (let i = 0; i < falling.length; i++) {
    const p = falling[i];
    p.vy += p.ay; p.x += p.vx; p.y += p.vy; p.rot += p.spin;

    // Bounce off screen edges
    if (p.x - p.size*0.5 < 0)            { p.x = p.size*0.5;              p.vx =  Math.abs(p.vx)*0.6; }
    if (p.x + p.size*0.5 > canvas.width) { p.x = canvas.width-p.size*0.5; p.vx = -Math.abs(p.vx)*0.6; }

    // Settle when hitting rim level (all coins fall to pot level)
    if (p.y + p.size*0.5 >= rimY) {
      settleCoin(p);
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
  const size  = faceW * 0.13;
  for (const idx of [50, 280]) {
    const [cx, cy] = lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha = 0.75;
    ctx.drawImage(shamrockImg, cx-size/2, cy-size/2, size, size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat — pitch-aware anchor + foreshortening
// ─────────────────────────────────────────
// Strategy:
//   1. Anchor point: lm[10] offset along chin→forehead axis
//   2. Roll angle: cheek-to-cheek (same as before, stable)
//   3. Pitch: compare face height vs width → foreshorten hat height
//             and shift hat further up along the face-up axis
const BRIM_BOTTOM_FRAC = 855 / 900;
const CROWN_TOP_FRAC   =  80 / 900;

function drawHat(lm) {
  // Forehead & chin in canvas space
  const [x10,  y10 ] = lmToCanvas(lm[10]);   // upper forehead
  const [x152, y152] = lmToCanvas(lm[152]);  // chin

  // Cheeks for roll angle (sorted L→R)
  const [x234, y234] = lmToCanvas(lm[234]);
  const [x454, y454] = lmToCanvas(lm[454]);
  const [xL, yL, xR, yR] = x234 <= x454 ? [x234,y234,x454,y454] : [x454,y454,x234,y234];
  const rollAngle = Math.atan2(yR-yL, xR-xL);
  const faceW     = Math.hypot(xR-xL, yR-yL);

  // Face-up unit vector (chin → forehead direction)
  const faceUpX = x10 - x152;
  const faceUpY = y10 - y152;
  const faceUpLen = Math.hypot(faceUpX, faceUpY) || 1;
  const uX = faceUpX / faceUpLen;
  const uY = faceUpY / faceUpLen;

  // Pitch estimation: faceH / faceW
  // Straight ≈ 1.3–1.6  |  Looking up ≈ 0.6–1.0 (face foreshortens)
  const faceH     = Math.abs(y152 - y10);
  const pitchRaw  = faceH / (faceW || 1);
  const pitchScale = Math.max(0.45, Math.min(1.0, pitchRaw * 0.70));

  // Smooth all values
  const sx    = smoothHatX.update(x10);
  const sy    = smoothHatY.update(y10);
  const sw    = smoothFW.update(faceW);
  const sa    = smoothRoll.update(rollAngle);
  const sp    = smoothPitch.update(pitchScale);

  // Hat size — normal width, height foreshortened by pitch
  const hatW  = sw * 1.25;
  const hatH  = hatW * (900 / 800) * sp;

  // Anchor: brim-bottom of the (foreshortened) hat
  const anchorY = hatH * BRIM_BOTTOM_FRAC;

  // Push hat slightly further "up" along face axis when pitched back
  // so it doesn't float off the forehead
  const pitchOffset = (1.0 - sp) * hatH * 0.18;
  const anchorX = sx - uX * pitchOffset;
  const anchorY2 = sy - uY * pitchOffset;

  ctx.save();
  ctx.translate(anchorX, anchorY2);
  ctx.rotate(sa);
  ctx.shadowColor = 'rgba(0,20,0,0.5)';
  ctx.shadowBlur  = 14 * window.devicePixelRatio;
  ctx.shadowOffsetY = 5 * window.devicePixelRatio;
  ctx.drawImage(hatImg, -hatW/2, -anchorY, hatW, hatH);
  ctx.restore();

  return {
    rcx:  anchorX,
    rcy:  anchorY2 - anchorY + hatH * CROWN_TOP_FRAC,
    faceW: sw,
  };
}

// ─────────────────────────────────────────
// Debug overlay
// ─────────────────────────────────────────
function drawDebug() {
  const warmup = baselineSamples.length < BASELINE_FRAMES;
  const status = warmup
    ? `calibrating… ${baselineSamples.length}/${BASELINE_FRAMES}`
    : isLookingUp ? '👆 LOOKING UP' : '😐 straight';
  const rise = chinBaseline !== null
    ? (chinBaseline - smoothedChinY).toFixed(1) + 'px' : '--';
  const dpr = window.devicePixelRatio;
  ctx.save();
  ctx.font = `bold ${13*dpr}px -apple-system,sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(8, 8, 260*dpr, 30*dpr);
  ctx.fillStyle = isLookingUp ? '#00ff88' : '#fff';
  ctx.fillText(`chin rise: ${rise}  ${status}`, 14, 26*dpr);
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
  if (currentFacingMode === 'user') { ctx.translate(canvas.width,0); ctx.scale(-1,1); }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  // 2. Ambient
  if (ambient.length === 0) initAmbient();
  stepAmbient();

  // 3. Cartoon gold pile (behind pot rim)
  drawPile();

  // 4. Pot (over pile base)
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
  smoothHatX.reset(); smoothHatY.reset(); smoothFW.reset();
  smoothRoll.reset(); smoothPitch.reset();
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
