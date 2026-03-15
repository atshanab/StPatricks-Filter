// ☘️ St. Patrick's Day Face Filter v2
// Fix: mirrored landmark X for selfie mode · redesigned UI

const video     = document.getElementById('video');
const canvas    = document.getElementById('canvas');
const ctx       = canvas.getContext('2d');
const shutterBtn = document.getElementById('shutterBtn');
const flipBtn   = document.getElementById('flipBtn');
const flash     = document.getElementById('flash');

let currentFacingMode = 'user';
let camera = null;

// ─────────────────────────────────────────
// Asset loading
// ─────────────────────────────────────────
function loadImg(src) {
  const img = new Image();
  img.src = src;
  return img;
}

const hatImg      = loadImg('assets/leprechaun_hat.png');
const shamrockImg = loadImg('assets/shamrock.png');
const coinImg     = loadImg('assets/coin.png');

// ─────────────────────────────────────────
// Canvas resize / cover mapping
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
  if (va > ca) {
    rH = ch; rW = ch * va; ox = (cw - rW) / 2; oy = 0;
  } else {
    rW = cw; rH = cw / va; ox = 0; oy = (ch - rH) / 2;
  }
  return { rW, rH, ox, oy };
}

// Convert normalized landmark coords → canvas pixels.
// In selfie (user-facing) mode the canvas is drawn mirrored,
// so we flip the X axis to keep overlays aligned.
function toCanvas(x, y) {
  const { rW, rH, ox, oy } = coverMap();
  const cx = currentFacingMode === 'user'
    ? (canvas.width - (x * rW + ox))   // mirrored X
    : (x * rW + ox);
  return [cx, y * rH + oy];
}

// ─────────────────────────────────────────
// Exponential smoothers
// ─────────────────────────────────────────
class Smoother {
  constructor(a = 0.35) { this.a = a; this.v = null; }
  update(v) {
    if (this.v === null) { this.v = v; return v; }
    this.v = this.a * v + (1 - this.a) * this.v;
    return this.v;
  }
}

const sCx    = new Smoother(0.4);
const sCy    = new Smoother(0.4);
const sAngle = new Smoother(0.3);
const sFW    = new Smoother(0.35);

// ─────────────────────────────────────────
// Particles (coins + shamrocks from mouth)
// ─────────────────────────────────────────
let particles = [];
let lastSpawnMs = 0;
const SPAWN_CD = 120;
const MAX_P    = 180;

function spawnParticles(x, y, faceW) {
  const now = performance.now();
  if (now - lastSpawnMs < SPAWN_CD) return;
  lastSpawnMs = now;
  for (let i = 0; i < 4; i++) {
    const isGold = Math.random() < 0.55;
    particles.push({
      x: x + (Math.random() - 0.5) * faceW * 0.3,
      y,
      img: isGold ? coinImg : shamrockImg,
      size: isGold ? 28 + Math.random() * 28 : 20 + Math.random() * 24,
      vx: (Math.random() - 0.5) * 2.8,
      vy: -(1.5 + Math.random() * 2.5),
      ay: 0.14 + Math.random() * 0.06,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.14,
      alpha: 1,
      fadeDelay: 60 + Math.random() * 40,
      age: 0,
    });
  }
  if (particles.length > MAX_P) particles.splice(0, particles.length - MAX_P);
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
// Ambient floating shamrocks
// ─────────────────────────────────────────
let ambient = [];
function initAmbient() {
  for (let i = 0; i < 6; i++) {
    ambient.push({
      x: Math.random() * canvas.width,
      y: canvas.height + Math.random() * canvas.height,
      size: 14 + Math.random() * 20,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -(0.4 + Math.random() * 0.5),
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.02,
      alpha: 0.18 + Math.random() * 0.18,
    });
  }
}

function stepAmbient() {
  for (const p of ambient) {
    p.x += p.vx; p.y += p.vy; p.rot += p.spin;
    if (p.y < -50) { p.y = canvas.height + 30; p.x = Math.random() * canvas.width; }
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(shamrockImg, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Rainbow arc
// ─────────────────────────────────────────
let rainbowAlpha  = 0;
let rainbowTarget = 0;

function drawRainbow(cx, cy, radius) {
  if (rainbowAlpha < 0.01) return;
  const colors = [
    [255, 50,  50 ],
    [255, 140,  0 ],
    [255, 230,  0 ],
    [ 50, 210, 50 ],
    [ 50, 120, 255],
    [180,  50, 255],
  ];
  const bandW = radius * 0.07;
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = colors[i];
    const rad = radius + i * bandW;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, Math.PI, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${r},${g},${b},${rainbowAlpha})`;
    ctx.lineWidth = bandW * 1.15;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face color grading (subtle green tint)
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234, y234] = toCanvas(lm[234].x, lm[234].y);
  const [x454, y454] = toCanvas(lm[454].x, lm[454].y);
  const [x10,  y10 ] = toCanvas(lm[10].x,  lm[10].y );
  const [x152, y152] = toCanvas(lm[152].x, lm[152].y);
  const fcx   = (x234 + x454) / 2;
  const fcy   = (y10  + y152) / 2;
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const faceH = Math.abs(y152 - y10) * 1.05;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(fcx, fcy, faceW * 0.52, faceH * 0.52, 0, 0, Math.PI * 2);
  ctx.clip();
  const grad = ctx.createRadialGradient(fcx, fcy - faceH * 0.1, 0, fcx, fcy, faceW * 0.55);
  grad.addColorStop(0,   'rgba(0,200,50,0.00)');
  grad.addColorStop(0.5, 'rgba(0,180,40,0.06)');
  grad.addColorStop(1,   'rgba(0,140,30,0.14)');
  ctx.fillStyle = grad;
  ctx.fillRect(fcx - faceW, fcy - faceH, faceW * 2, faceH * 2);
  ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrock stickers
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234, y234] = toCanvas(lm[234].x, lm[234].y);
  const [x454, y454] = toCanvas(lm[454].x, lm[454].y);
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const size  = faceW * 0.13;
  for (const idx of [50, 280]) {
    const [cx, cy] = toCanvas(lm[idx].x, lm[idx].y);
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.drawImage(shamrockImg, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat placement
// ─────────────────────────────────────────
const HAT_BRIM_FRAC  = 855 / 900;
const HAT_CROWN_FRAC =  80 / 900;

function drawHat(lm) {
  const [x10,  y10 ] = toCanvas(lm[10].x,  lm[10].y );
  const [x234, y234] = toCanvas(lm[234].x, lm[234].y);
  const [x454, y454] = toCanvas(lm[454].x, lm[454].y);

  const dx    = x454 - x234;
  const dy    = y454 - y234;
  const angle = Math.atan2(dy, dx);
  const faceW = Math.hypot(dx, dy);

  const scxV  = sCx.update(x10);
  const scyV  = sCy.update(y10);
  const angV  = sAngle.update(angle);
  const fwV   = sFW.update(faceW);

  const hatW = fwV * 1.52;
  const hatH = hatW * (900 / 800);
  const brimBottomLocal = hatH * HAT_BRIM_FRAC;
  const crownTopLocal   = hatH * HAT_CROWN_FRAC;

  ctx.save();
  ctx.translate(scxV, scyV);
  ctx.rotate(angV);
  ctx.shadowColor   = 'rgba(0,30,0,0.45)';
  ctx.shadowBlur    = 18 * window.devicePixelRatio;
  ctx.shadowOffsetY =  8 * window.devicePixelRatio;
  ctx.drawImage(hatImg, -hatW / 2, -brimBottomLocal, hatW, hatH);
  ctx.restore();

  return {
    rcx: scxV,
    rcy: scyV - brimBottomLocal + crownTopLocal,
    faceW: fwV,
  };
}

// ─────────────────────────────────────────
// Main results handler
// ─────────────────────────────────────────
function onResults(results) {
  resizeCanvas();
  const { rW, rH, ox, oy } = coverMap();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw video — mirror for selfie
  ctx.save();
  if (currentFacingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  if (ambient.length === 0) initAmbient();
  stepAmbient();

  if (!results.multiFaceLandmarks?.length) {
    stepParticles();
    return;
  }

  const lm = results.multiFaceLandmarks[0];

  drawFaceGrading(lm);

  const { rcx, rcy, faceW } = drawHat(lm);

  // Rainbow
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  drawRainbow(rcx, rcy, faceW * 1.1);

  drawCheekStickers(lm);

  // Mouth detection
  const [, y13] = toCanvas(lm[13].x, lm[13].y);
  const [x14, y14] = toCanvas(lm[14].x, lm[14].y);
  const [x13c]  = toCanvas(lm[13].x, lm[13].y);
  const mouthGap  = Math.abs(y14 - y13);
  const mouthOpen = mouthGap > faceW * 0.11;
  rainbowTarget   = mouthOpen ? 0.55 : 0;
  if (mouthOpen) spawnParticles((x13c + x14) * 0.5, (y13 + y14) * 0.5, faceW);

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
// UI handlers
// ─────────────────────────────────────────
flipBtn.addEventListener('click', () => {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  start();
});

shutterBtn.addEventListener('click', async () => {
  // Flash effect
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 180);

  try {
    const off = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    off.getContext('2d').drawImage(canvas, 0, 0);
    const blob = await new Promise(r => off.toBlob(r, 'image/png'));
    const file = new File([blob], 'stpaddys.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '☘️ Happy St. Patrick\'s Day!' });
    } else {
      const url = URL.createObjectURL(blob);
      const a   = Object.assign(document.createElement('a'),
                    { href: url, download: 'stpaddys.png' });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (e) { console.error(e); }
});

document.addEventListener('DOMContentLoaded', () => start().catch(console.error));
