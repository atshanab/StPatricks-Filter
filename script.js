// ☘️ St. Patrick's Day Filter v11
// Smile detection → coins fall
// PNG coin pile inside pot (no gradient fill, no dots)

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

// ─────────────────────────────────────────
// Smile detection
// Mouth corners: lm[61] left, lm[291] right
// Mouth width vs face width — neutral ~0.38, smile > 0.47
// Also check corner lift: corners rise relative to upper lip center lm[13]
// ─────────────────────────────────────────
let smileFrames  = 0;
let isSmiling    = false;
let dbgSmile     = 0;

// Collect baseline over first 45 frames
let smileBaseline     = null;
let smileSamples      = [];
const SMILE_BASELINE_FRAMES = 45;
const SMILE_THRESHOLD_ABOVE = 0.045; // how much above baseline ratio triggers smile

function updateSmile(lm) {
  // Mouth corner distance
  const [mx61,  my61 ] = [lm[61].x,  lm[61].y ];
  const [mx291, my291] = [lm[291].x, lm[291].y];
  const mouthW  = Math.hypot(mx291 - mx61, my291 - my61);

  // Face width (cheek to cheek)
  const faceW   = Math.abs(lm[454].x - lm[234].x);

  const ratio   = faceW > 0.01 ? mouthW / faceW : 0.4;
  const s       = smoothSmile.update(ratio);
  dbgSmile      = s;

  // Build baseline
  if (smileBaseline === null) {
    smileSamples.push(s);
    if (smileSamples.length >= SMILE_BASELINE_FRAMES) {
      const sorted = [...smileSamples].sort((a, b) => a - b);
      smileBaseline = sorted[Math.floor(sorted.length / 2)];
    }
    isSmiling = false; return;
  }

  // Drift baseline down slowly (only when not smiling, so it doesn't chase the smile)
  const smiling = s > smileBaseline + SMILE_THRESHOLD_ABOVE;
  if (!smiling) smileBaseline = smileBaseline * 0.992 + s * 0.008;

  smileFrames = smiling
    ? Math.min(smileFrames + 1, 20)
    : Math.max(smileFrames - 2, 0);
  isSmiling = smileFrames >= 4;
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
// Pile — column height map (for physics)
//        + settled PNG list (for rendering)
// ─────────────────────────────────────────
const NUM_COLS   = 90;
let   colHeight  = [];   // pixels stacked per column above rimY
let   settledPNGs = [];  // {x, y, size, img, rot} — drawn as PNGs each frame

const COIN_SIZE_PX = () => Math.round(18 * window.devicePixelRatio);

function initPile() {
  colHeight  = new Array(NUM_COLS).fill(0);
  settledPNGs = [];
}

function colIndex(x) {
  return Math.max(0, Math.min(NUM_COLS - 1,
    Math.floor(x / canvas.width * NUM_COLS)));
}

function surfaceYAt(x) {
  const { rimY } = getPot();
  return rimY - colHeight[colIndex(x)];
}

function addToPile(coin) {
  const { cx, rimY, rimRX } = getPot();
  const colW   = canvas.width / NUM_COLS;
  const coinSz = coin.size;

  // Random jitter so coins land organically
  const jitter = (Math.random() - 0.5) * coinSz * 0.9;
  const landX  = Math.max(cx - rimRX * 0.85,
                   Math.min(cx + rimRX * 0.85, coin.x + jitter));

  // Only accept coins inside the pot opening
  if (Math.abs(landX - cx) > rimRX * 0.88) return;

  const c0 = Math.max(0, Math.floor((landX - coinSz * 0.5) / colW));
  const c1 = Math.min(NUM_COLS - 1, Math.floor((landX + coinSz * 0.5) / colW));

  // Find current surface at landing spot
  let surface = 0;
  for (let c = c0; c <= c1; c++) surface = Math.max(surface, colHeight[c]);

  const settledY = rimY - surface - coinSz * 0.40;

  // Cap: pile can't rise above 82% of screen height above rimY
  if (surface + coinSz * 0.55 > rimY * 0.82) return;

  // Raise columns
  const raise = coinSz * 0.52;
  for (let c = c0; c <= c1; c++) colHeight[c] += raise;

  // Store PNG entry with a gentle random tilt
  const rot = (Math.random() - 0.5) * 0.55;
  settledPNGs.push({ x: landX, y: settledY, size: coinSz, img: coin.img, rot });

  // Performance cap
  if (settledPNGs.length > 320) settledPNGs.splice(0, settledPNGs.length - 320);
}

// Draw the settled PNG pile — oldest (bottom) first, newest (top) last
function drawSettledPile() {
  for (const s of settledPNGs) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
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
  // Highlight streak
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

    // Bounce off screen edges
    if (p.x - p.size*0.5 < 0)            { p.x = p.size*0.5;              p.vx =  Math.abs(p.vx)*0.6; }
    if (p.x + p.size*0.5 > canvas.width) { p.x = canvas.width-p.size*0.5; p.vx = -Math.abs(p.vx)*0.6; }

    // Settle when hitting current pile surface
    const surf = surfaceYAt(p.x);
    if (p.y + p.size * 0.5 >= surf) {
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
    ctx.lineWidth = bw * 1.15; ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face tint
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234,y234] = lmToCanvas(lm[234]);
  const [x454,y454] = lmToCanvas(lm[454]);
  const [x10, y10 ] = lmToCanvas(lm[10]);
  const [x152,y152] = lmToCanvas(lm[152]);
  const fcx=(x234+x454)/2, fcy=(y10+y152)/2;
  const faceW=Math.hypot(x454-x234,y454-y234), faceH=Math.abs(y152-y10)*1.05;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(fcx,fcy,faceW*0.52,faceH*0.52,0,0,Math.PI*2);
  ctx.clip();
  const g=ctx.createRadialGradient(fcx,fcy-faceH*0.1,0,fcx,fcy,faceW*0.55);
  g.addColorStop(0,'rgba(0,200,50,0.00)');
  g.addColorStop(0.5,'rgba(0,180,40,0.05)');
  g.addColorStop(1,'rgba(0,140,30,0.13)');
  ctx.fillStyle=g;
  ctx.fillRect(fcx-faceW,fcy-faceH,faceW*2,faceH*2);
  ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrocks
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234]=lmToCanvas(lm[234]), [,y234]=lmToCanvas(lm[234]);
  const [x454]=lmToCanvas(lm[454]), [,y454]=lmToCanvas(lm[454]);
  const faceW=Math.hypot(x454-x234,y454-y234), size=faceW*0.13;
  for (const idx of [50,280]) {
    const [cx,cy]=lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha=0.75;
    ctx.drawImage(shamrockImg,cx-size/2,cy-size/2,size,size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat — pitch-aware
// ─────────────────────────────────────────
const BRIM_BOTTOM_FRAC = 855/900;
const CROWN_TOP_FRAC   =  80/900;

function drawHat(lm) {
  const [x10, y10 ]=lmToCanvas(lm[10]);
  const [x152,y152]=lmToCanvas(lm[152]);
  const [x234,y234]=lmToCanvas(lm[234]);
  const [x454,y454]=lmToCanvas(lm[454]);
  const [xL,yL,xR,yR]=x234<=x454?[x234,y234,x454,y454]:[x454,y454,x234,y234];
  const rollAngle=Math.atan2(yR-yL,xR-xL);
  const faceW=Math.hypot(xR-xL,yR-yL);
  const faceH=Math.abs(y152-y10);
  const pitchScale=Math.max(0.45,Math.min(1.0,(faceH/(faceW||1))*0.70));
  const faceUpLen=Math.hypot(x10-x152,y10-y152)||1;
  const uX=(x10-x152)/faceUpLen, uY=(y10-y152)/faceUpLen;
  const sx=smoothHatX.update(x10), sy=smoothHatY.update(y10);
  const sw=smoothFW.update(faceW),  sa=smoothRoll.update(rollAngle);
  const sp=smoothPitch.update(pitchScale);
  const hatW=sw*1.25, hatH=hatW*(900/800)*sp;
  const anchorY=hatH*BRIM_BOTTOM_FRAC;
  const pitchOff=(1.0-sp)*hatH*0.18;
  ctx.save();
  ctx.translate(sx-uX*pitchOff, sy-uY*pitchOff);
  ctx.rotate(sa);
  ctx.shadowColor='rgba(0,20,0,0.5)';
  ctx.shadowBlur=14*window.devicePixelRatio;
  ctx.shadowOffsetY=5*window.devicePixelRatio;
  ctx.drawImage(hatImg,-hatW/2,-anchorY,hatW,hatH);
  ctx.restore();
  return { rcx:sx, rcy:sy-anchorY+hatH*CROWN_TOP_FRAC, faceW:sw };
}

// ─────────────────────────────────────────
// Debug overlay
// ─────────────────────────────────────────
function drawDebug() {
  const warmup = smileSamples.length < SMILE_BASELINE_FRAMES && smileBaseline === null;
  const baseline = smileBaseline !== null ? smileBaseline.toFixed(3) : '…';
  const status = warmup
    ? `calibrating ${smileSamples.length}/${SMILE_BASELINE_FRAMES}`
    : isSmiling ? '😄 SMILING' : '😐 neutral';
  const dpr = window.devicePixelRatio;
  ctx.save();
  ctx.font=`bold ${13*dpr}px -apple-system,sans-serif`;
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.fillRect(8,8,280*dpr,30*dpr);
  ctx.fillStyle=isSmiling?'#00ff88':'#fff';
  ctx.fillText(`smile: ${dbgSmile.toFixed(3)} base:${baseline}  ${status}`, 14, 26*dpr);
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

  // 3. PNG coin pile (behind pot rim)
  drawSettledPile();

  // 4. Pot (rim sits on top of pile)
  drawPot();

  let hatAnchor = null;

  // 5. Face
  if (results.multiFaceLandmarks?.length) {
    const lm = results.multiFaceLandmarks[0];
    drawFaceGrading(lm);
    hatAnchor = drawHat(lm);
    drawCheekStickers(lm);
    updateSmile(lm);
  } else {
    smileFrames = Math.max(smileFrames - 1, 0);
    isSmiling   = smileFrames >= 4;
  }

  // 6. Rainbow (shows when smiling)
  rainbowTarget = isSmiling ? 0.60 : 0;
  rainbowAlpha += (rainbowTarget - rainbowAlpha) * 0.08;
  if (hatAnchor) drawRainbow(hatAnchor.rcx, hatAnchor.rcy, hatAnchor.faceW * 1.1);

  // 7. Coins fall while smiling
  if (isSmiling) spawnFromSky();
  stepFalling();

  // 8. Debug
  drawDebug();
}

// ─────────────────────────────────────────
// Camera / FaceMesh
// ─────────────────────────────────────────
async function start() {
  const fm = new FaceMesh({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence:  0.5,
  });
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
  smoothRoll.reset(); smoothPitch.reset(); smoothSmile.reset();
  smileFrames=0; isSmiling=false;
  smileSamples=[]; smileBaseline=null;
  start();
});

shutterBtn.addEventListener('click', async () => {
  flash.classList.add('active');
  setTimeout(()=>flash.classList.remove('active'), 180);
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
  } catch(e) { console.error(e); }
});

document.addEventListener('DOMContentLoaded', ()=>start().catch(console.error));
