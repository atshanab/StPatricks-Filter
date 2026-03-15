// ☘️ St. Patrick's Day Face Filter
// MediaPipe FaceMesh · realistic hat · face color grading ·
// gold coin particles · shamrock sparkles · rainbow arc

const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const photoBtn = document.getElementById('photoBtn');
const flipCam  = document.getElementById('flipCam');

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
const sparkleImg  = loadImg('assets/sparkle.png');

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
  return { rW, rH, ox, oy, vw, vh, cw, ch };
}

function toCanvas(x, y) {
  const { rW, rH, ox, oy } = coverMap();
  return [x * rW + ox, y * rH + oy];
}

// ─────────────────────────────────────────
// Smooth tracker (exponential lerp)
// ─────────────────────────────────────────
class Smoother {
  constructor(alpha = 0.35) { this.alpha = alpha; this.val = null; }
  update(v) {
    if (this.val === null) { this.val = v; return v; }
    this.val = this.alpha * v + (1 - this.alpha) * this.val;
    return this.val;
  }
}

const sCx    = new Smoother(0.4);   // face center x
const sCy    = new Smoother(0.4);   // face center y
const sAngle = new Smoother(0.3);   // rotation angle
const sFW    = new Smoother(0.35);  // face width

// ─────────────────────────────────────────
// Particles
// ─────────────────────────────────────────
let particles = [];
let lastSpawnMs = 0;
const SPAWN_CD = 120;   // ms between bursts
const MAX_P    = 180;

function spawnParticles(x, y, faceW) {
  const now = performance.now();
  if (now - lastSpawnMs < SPAWN_CD) return;
  lastSpawnMs = now;

  for (let i = 0; i < 4; i++) {
    const isGold = Math.random() < 0.55;
    particles.push({
      x: x + (Math.random() - 0.5) * faceW * 0.3,
      y: y,
      img: isGold ? coinImg : shamrockImg,
      size: isGold
        ? 28 + Math.random() * 28
        : 20 + Math.random() * 24,
      vx: (Math.random() - 0.5) * 2.8,
      vy: -(1.5 + Math.random() * 2.5),
      ay: 0.14 + Math.random() * 0.06,  // gravity
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
    p.vy += p.ay;
    p.x  += p.vx;
    p.y  += p.vy;
    p.rot += p.spin;
    p.age++;
    if (p.age > p.fadeDelay) p.alpha = Math.max(0, p.alpha - 0.035);

    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  particles = particles.filter(p => p.alpha > 0.02 &&
    p.y < canvas.height + 80 && p.x > -80 && p.x < canvas.width + 80);
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
      alpha: 0.25 + Math.random() * 0.2,
    });
  }
}

function stepAmbient() {
  for (const p of ambient) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;
    // wrap when off top
    if (p.y < -50) {
      p.y = canvas.height + 30;
      p.x = Math.random() * canvas.width;
    }
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
let rainbowAlpha = 0;
let rainbowTarget = 0;

function drawRainbow(cx, cy, radius) {
  if (rainbowAlpha < 0.01) return;

  const colors = [
    `rgba(255,50,50,${rainbowAlpha})`,
    `rgba(255,140,0,${rainbowAlpha})`,
    `rgba(255,230,0,${rainbowAlpha})`,
    `rgba(50,210,50,${rainbowAlpha})`,
    `rgba(50,120,255,${rainbowAlpha})`,
    `rgba(180,50,255,${rainbowAlpha})`,
  ];

  const startAngle = Math.PI;       // left
  const endAngle   = 2 * Math.PI;   // right (arc above)
  const bandW      = radius * 0.065;

  for (let i = 0; i < colors.length; i++) {
    const r = radius + i * bandW;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = colors[i];
    ctx.lineWidth   = bandW * 1.1;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face color grading (green luck tint)
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  // Build a rough face ellipse from cheek points
  const [x234, y234] = toCanvas(lm[234].x, lm[234].y);
  const [x454, y454] = toCanvas(lm[454].x, lm[454].y);
  const [x10,  y10]  = toCanvas(lm[10].x,  lm[10].y);
  const [x152, y152] = toCanvas(lm[152].x, lm[152].y);

  const fcx   = (x234 + x454) / 2;
  const fcy   = (y10  + y152) / 2;
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const faceH = Math.abs(y152 - y10) * 1.05;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(fcx, fcy, faceW * 0.52, faceH * 0.52, 0, 0, Math.PI * 2);
  ctx.clip();

  // Subtle green shimmer gradient
  const grad = ctx.createRadialGradient(fcx, fcy - faceH * 0.1, 0, fcx, fcy, faceW * 0.55);
  grad.addColorStop(0,   'rgba(0,200,50,0.00)');
  grad.addColorStop(0.5, 'rgba(0,180,40,0.06)');
  grad.addColorStop(1,   'rgba(0,140,30,0.15)');
  ctx.fillStyle = grad;
  ctx.fillRect(fcx - faceW, fcy - faceH, faceW * 2, faceH * 2);

  ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrocks (face paint style)
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const cheekLandmarks = [
    [lm[50].x, lm[50].y,  -1],  // left cheek
    [lm[280].x, lm[280].y, 1],  // right cheek
  ];
  const [x234, y234] = toCanvas(lm[234].x, lm[234].y);
  const [x454, y454] = toCanvas(lm[454].x, lm[454].y);
  const faceW = Math.hypot(x454 - x234, y454 - y234);
  const size  = faceW * 0.13;

  for (const [nx, ny] of cheekLandmarks) {
    const [cx, cy] = toCanvas(nx, ny);
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.drawImage(shamrockImg, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat placement
// ─────────────────────────────────────────
// Hat asset dimensions: 800 × 900 px
// The brim sits at y ≈ 760; crown top ≈ 80
// We want the brim bottom aligned just above the forehead point.
const HAT_CROWN_FRAC = 80  / 900;   // how far down the crown top is
const HAT_BRIM_FRAC  = 855 / 900;   // how far down the brim bottom is

function drawHat(lm) {
  const [x10,  y10]  = toCanvas(lm[10].x,  lm[10].y);   // forehead center
  const [x234, y234] = toCanvas(lm[234].x, lm[234].y);
  const [x454, y454] = toCanvas(lm[454].x, lm[454].y);

  const dx     = x454 - x234;
  const dy     = y454 - y234;
  const angle  = Math.atan2(dy, dx);
  const faceW  = Math.hypot(dx, dy);

  // Smooth tracking
  const sCxV  = sCx.update(x10);
  const sCyV  = sCy.update(y10);
  const sAngV = sAngle.update(angle);
  const sFWV  = sFW.update(faceW);

  // Hat should be ~1.5× face width
  const hatW = sFWV * 1.52;
  const hatH = hatW * (900 / 800);

  // We anchor so the brim bottom aligns ~5px above the forehead point
  // In hat-local coords (before rotation), the brim bottom is at hatH * HAT_BRIM_FRAC
  // We want that point to sit at sCyV
  const brimBottomLocal = hatH * HAT_BRIM_FRAC;
  const crownTopLocal   = hatH * HAT_CROWN_FRAC;

  // Draw origin is top-left of hat rect.
  // After placing, the hat should sit ON the forehead:
  const hatDrawY = -(brimBottomLocal);    // shift so brim bottom = y=0 in hat space
  const hatDrawX = -hatW / 2;            // center horizontally

  ctx.save();
  ctx.translate(sCxV, sCyV);
  ctx.rotate(sAngV);

  // Drop shadow
  ctx.shadowColor   = 'rgba(0,30,0,0.45)';
  ctx.shadowBlur    = 20 * window.devicePixelRatio;
  ctx.shadowOffsetY = 8  * window.devicePixelRatio;

  ctx.drawImage(hatImg, hatDrawX, hatDrawY, hatW, hatH);
  ctx.restore();

  // Return rainbow anchor (top of crown)
  return {
    rcx: sCxV,
    rcy: sCyV + (hatDrawY + crownTopLocal),  // top of crown in screen coords
    faceW: sFWV,
  };
}

// ─────────────────────────────────────────
// Main results handler
// ─────────────────────────────────────────
let frameCount = 0;

function onResults(results) {
  resizeCanvas();
  const { rW, rH, ox, oy } = coverMap();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw video frame (cover-fit, mirrored for selfie)
  ctx.save();
  if (currentFacingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, ox, oy, rW, rH);
  ctx.restore();

  // Ambient shamrocks (background layer)
  if (ambient.length === 0) initAmbient();
  stepAmbient();

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    stepParticles();
    return;
  }

  const lm = results.multiFaceLandmarks[0];

  // ── Face color grading ──
  drawFaceGrading(lm);

  // ── Hat ──
  const { rcx, rcy, faceW } = drawHat(lm);

  // ── Rainbow (fades in/out with mouth) ──
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  drawRainbow(rcx, rcy, faceW * 1.1);

  // ── Cheek stickers ──
  drawCheekStickers(lm);

  // ── Mouth detection ──
  const [x13, y13] = toCanvas(lm[13].x, lm[13].y);
  const [x14, y14] = toCanvas(lm[14].x, lm[14].y);
  const mouthGap   = Math.abs(y14 - y13);
  const mouthOpen  = mouthGap > faceW * 0.11;

  rainbowTarget = mouthOpen ? 0.55 : 0;

  if (mouthOpen) {
    spawnParticles((x13 + x14) * 0.5, (y13 + y14) * 0.5, faceW);
  }

  // ── Particles ──
  stepParticles();

  frameCount++;
}

// ─────────────────────────────────────────
// Camera / FaceMesh lifecycle
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
flipCam.addEventListener('change', () => {
  currentFacingMode = flipCam.checked ? 'environment' : 'user';
  start();
});

photoBtn.addEventListener('click', async () => {
  try {
    const off  = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    off.getContext('2d').drawImage(canvas, 0, 0);
    const blob = await new Promise(r => off.toBlob(r, 'image/png'));
    const file = new File([blob], 'stpaddys.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '☘️ Happy St. Patrick\'s Day!' });
    } else {
      const url = URL.createObjectURL(blob);
      const a   = Object.assign(document.createElement('a'), { href: url, download: 'stpaddys.png' });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (e) { console.error(e); }
});

document.addEventListener('DOMContentLoaded', () => start().catch(console.error));
