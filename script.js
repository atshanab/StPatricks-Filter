// ☘️ St. Patrick's Day Face Filter v3
// Fixes: angle calc (no more spinning), hat scale/anchor, angle unwrap smoother

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
// Canvas / cover mapping
// ─────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
  canvas.height = canvas.clientHeight * window.devicePixelRatio;
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

// Landmark → canvas pixels.
// Mirror X for selfie so overlays match the flipped video draw.
function lmToCanvas(lm) {
  const { rW, rH, ox, oy } = coverMap();
  const rawX = lm.x * rW + ox;
  const cx   = currentFacingMode === 'user' ? (canvas.width - rawX) : rawX;
  return [cx, lm.y * rH + oy];
}

// ─────────────────────────────────────────
// Smoothers
// ─────────────────────────────────────────
// Regular value smoother
class Smoother {
  constructor(a = 0.3) { this.a = a; this.v = null; }
  update(v) {
    if (this.v === null) { this.v = v; return v; }
    this.v += this.a * (v - this.v);
    return this.v;
  }
}

// Angle smoother — handles ±π wrap so it never spins
class AngleSmoother {
  constructor(a = 0.2) { this.a = a; this.v = null; }
  update(v) {
    if (this.v === null) { this.v = v; return v; }
    let d = v - this.v;
    // Clamp delta to [-π, π]
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.v += this.a * d;
    return this.v;
  }
}

const smoothX   = new Smoother(0.3);
const smoothY   = new Smoother(0.3);
const smoothFW  = new Smoother(0.25);
const smoothAng = new AngleSmoother(0.2);

// ─────────────────────────────────────────
// Hat
// ─────────────────────────────────────────
// Asset: 800 × 900 px
// Crown bottom / brim top:  y ≈ 760  → frac 0.844
// Brim outer bottom:        y ≈ 855  → frac 0.950
// We anchor so the brim-bottom sits at the forehead landmark.
const BRIM_BOTTOM_FRAC = 855 / 900;

function drawHat(lm) {
  const [x10,  y10 ] = lmToCanvas(lm[10]);   // upper forehead center
  const [x234, y234] = lmToCanvas(lm[234]);   // cheek A
  const [x454, y454] = lmToCanvas(lm[454]);   // cheek B

  // ── Always measure angle left→right on screen ──────────────────
  // After mirroring, lm[234] and lm[454] can be on either side.
  // Sort by screen X so dx is always positive and angle is stable.
  let [xL, yL, xR, yR] = x234 <= x454
    ? [x234, y234, x454, y454]
    : [x454, y454, x234, y234];

  const dx    = xR - xL;
  const dy    = yR - yL;
  const angle = Math.atan2(dy, dx);          // range [-π/2, π/2] for normal head tilts
  const faceW = Math.hypot(dx, dy);

  // Smooth everything
  const sx = smoothX.update(x10);
  const sy = smoothY.update(y10);
  const sw = smoothFW.update(faceW);
  const sa = smoothAng.update(angle);

  // Hat dimensions — 1.25× face width feels natural
  const hatW = sw * 1.25;
  const hatH = hatW * (900 / 800);
  const anchorY = hatH * BRIM_BOTTOM_FRAC;   // brim bottom in hat-local coords

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(sa);
  ctx.shadowColor   = 'rgba(0,20,0,0.5)';
  ctx.shadowBlur    = 16 * window.devicePixelRatio;
  ctx.shadowOffsetY =  6 * window.devicePixelRatio;
  // Draw so brim bottom sits at the translated origin (= forehead point)
  ctx.drawImage(hatImg, -hatW / 2, -anchorY, hatW, hatH);
  ctx.restore();

  // Return hat crown top position for the rainbow anchor
  const crownTopOffset = hatH * (80 / 900);
  return { rcx: sx, rcy: sy - anchorY + crownTopOffset, faceW: sw };
}

// ─────────────────────────────────────────
// Particles (coins + shamrocks)
// ─────────────────────────────────────────
let particles = [], lastSpawnMs = 0;

function spawnParticles(x, y, faceW) {
  const now = performance.now();
  if (now - lastSpawnMs < 110) return;
  lastSpawnMs = now;
  for (let i = 0; i < 4; i++) {
    const gold = Math.random() < 0.55;
    particles.push({
      x: x + (Math.random() - 0.5) * faceW * 0.3,
      y,
      img:  gold ? coinImg : shamrockImg,
      size: gold ? 28 + Math.random() * 26 : 18 + Math.random() * 22,
      vx: (Math.random() - 0.5) * 2.8,
      vy: -(1.5 + Math.random() * 2.5),
      ay:  0.13 + Math.random() * 0.06,
      rot:  Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.13,
      alpha: 1, fadeDelay: 60 + Math.random() * 40, age: 0,
    });
  }
  if (particles.length > 160) particles.splice(0, particles.length - 160);
}

function stepParticles() {
  for (const p of particles) {
    p.vy += p.ay; p.x += p.vx; p.y += p.vy;
    p.rot += p.spin; p.age++;
    if (p.age > p.fadeDelay) p.alpha = Math.max(0, p.alpha - 0.035);
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  particles = particles.filter(p =>
    p.alpha > 0.02 && p.y < canvas.height + 80 &&
    p.x > -80 && p.x < canvas.width + 80
  );
}

// ─────────────────────────────────────────
// Ambient shamrocks
// ─────────────────────────────────────────
let ambient = [];
function initAmbient() {
  for (let i = 0; i < 6; i++) ambient.push({
    x: Math.random() * canvas.width,
    y: canvas.height + Math.random() * canvas.height,
    size: 14 + Math.random() * 18,
    vx: (Math.random() - 0.5) * 0.5, vy: -(0.4 + Math.random() * 0.5),
    rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.02,
    alpha: 0.15 + Math.random() * 0.15,
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
// Rainbow arc (fades in when mouth opens)
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
  const fcx = (x234 + x454) / 2, fcy = (y10 + y152) / 2;
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
// Cheek shamrocks
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
// Main frame handler
// ─────────────────────────────────────────
function onResults(results) {
  resizeCanvas();
  const { rW, rH, ox, oy } = coverMap();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw mirrored video
  ctx.save();
  if (currentFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  if (ambient.length === 0) initAmbient();
  stepAmbient();

  if (!results.multiFaceLandmarks?.length) { stepParticles(); return; }
  const lm = results.multiFaceLandmarks[0];

  drawFaceGrading(lm);

  const { rcx, rcy, faceW } = drawHat(lm);

  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  drawRainbow(rcx, rcy, faceW * 1.1);

  drawCheekStickers(lm);

  // Mouth open detection
  const [mx,  y13] = lmToCanvas(lm[13]);
  const [mx2, y14] = lmToCanvas(lm[14]);
  const mouthGap   = Math.abs(y14 - y13);
  const mouthOpen  = mouthGap > faceW * 0.11;
  rainbowTarget    = mouthOpen ? 0.55 : 0;
  if (mouthOpen) spawnParticles((mx + mx2) * 0.5, (y13 + y14) * 0.5, faceW);

  stepParticles();
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
}

// ─────────────────────────────────────────
// UI
// ─────────────────────────────────────────
flipBtn.addEventListener('click', () => {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  // Reset smoothers on camera flip so hat doesn't sweep
  smoothX.v = smoothY.v = smoothFW.v = smoothAng.v = null;
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
