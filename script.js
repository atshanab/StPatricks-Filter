// ☘️ St. Patrick's Day Filter v15
// Dome-shaped coin pile · pot text PNG · smile/teeth trigger

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
const hatImg     = loadImg('assets/leprechaun_hat.png');
const shamrockImg= loadImg('assets/shamrock.png');
const coinImg    = loadImg('assets/coin.png');
const potTextImg = loadImg('assets/pot_text.png');  // swap this file to change text

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
  const vw = video.videoWidth||1280, vh = video.videoHeight||720;
  const cw = canvas.width, ch = canvas.height;
  const va = vw/vh, ca = cw/ch;
  let rW,rH,ox,oy;
  if (va>ca){rH=ch;rW=ch*va;ox=(cw-rW)/2;oy=0;}
  else      {rW=cw;rH=cw/va;ox=0;oy=(ch-rH)/2;}
  return {rW,rH,ox,oy};
}

function lmToCanvas(lm) {
  const {rW,rH,ox,oy}=coverMap();
  const rawX=lm.x*rW+ox;
  return [currentFacingMode==='user'?(canvas.width-rawX):rawX, lm.y*rH+oy];
}

// ─────────────────────────────────────────
// Smoothers
// ─────────────────────────────────────────
class Smoother {
  constructor(a=0.3){this.a=a;this.v=null;}
  update(v){if(this.v===null){this.v=v;return v;}this.v+=this.a*(v-this.v);return this.v;}
  reset(){this.v=null;}
}
class AngleSmoother {
  constructor(a=0.2){this.a=a;this.v=null;}
  update(v){
    if(this.v===null){this.v=v;return v;}
    let d=v-this.v;
    while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
    this.v+=this.a*d;return this.v;
  }
  reset(){this.v=null;}
}

const smoothHatX =new Smoother(0.28), smoothHatY =new Smoother(0.28);
const smoothFW   =new Smoother(0.25), smoothRoll =new AngleSmoother(0.2);
const smoothPitch=new Smoother(0.18), smoothSmile=new Smoother(0.15);
const smoothTeeth=new Smoother(0.15);

// ─────────────────────────────────────────
// Trigger: smile OR teeth
// ─────────────────────────────────────────
let triggered=false, triggerFrames=0;
let smileBaseline=null, smileSamples=[];
const SMILE_CAL=45, SMILE_RISE=0.040, TEETH_THRESH=0.032;

function updateTrigger(lm) {
  const mW=Math.hypot(lm[291].x-lm[61].x,lm[291].y-lm[61].y);
  const fW=Math.abs(lm[454].x-lm[234].x)||0.01;
  const sr=smoothSmile.update(mW/fW);

  if (smileBaseline===null) {
    smileSamples.push(sr);
    if (smileSamples.length>=SMILE_CAL) {
      const s=[...smileSamples].sort((a,b)=>a-b);
      smileBaseline=s[Math.floor(s.length/2)];
    }
    triggered=false; return;
  }
  const isSmiling=sr>smileBaseline+SMILE_RISE;
  if (!isSmiling) smileBaseline=smileBaseline*0.992+sr*0.008;

  const tr=smoothTeeth.update(Math.abs(lm[14].y-lm[13].y)/fW);
  const active=isSmiling||tr>TEETH_THRESH;
  const was=triggered;
  triggerFrames=active?Math.min(triggerFrames+1,20):Math.max(triggerFrames-2,0);
  triggered=triggerFrames>=4;
  if (was&&!triggered) startPileFade();
}

// ─────────────────────────────────────────
// Pot geometry
// ─────────────────────────────────────────
function getPot() {
  return {
    cx:   canvas.width  * 0.5,
    rimY: canvas.height * 0.81,
    rimRX:canvas.width  * 0.47,
    rimRY:canvas.width  * 0.47 * 0.085,
  };
}

// ─────────────────────────────────────────
// Pile — slot-based with dome profile
// ─────────────────────────────────────────
const PILE_SLOTS = 26;
let   slotCount  = [];
let   pileAlpha  = 1.0;
let   fadingPile = false;

// Max coins at this slot — dome shape: tallest in center, tapers to edges
function maxForSlot(s) {
  const center = (PILE_SLOTS - 1) / 2;
  const dist   = Math.abs(s - center) / center;           // 0 at center, 1 at edges
  const domeFrac = Math.cos(dist * Math.PI * 0.5);        // cosine taper 1→0
  return Math.max(1, Math.round(domeFrac * domeFrac * 9));  // 9 at center, 1 at edges
}

function initPile() {
  slotCount  = new Array(PILE_SLOTS).fill(0);
  pileAlpha  = 1.0;
  fadingPile = false;
}

function startPileFade() { fadingPile = true; }

function updatePileFade() {
  if (!fadingPile) return;
  pileAlpha -= 0.05;
  if (pileAlpha <= 0) { pileAlpha=1.0; fadingPile=false; initPile(); falling=[]; }
}

function pCS() { return Math.round(canvas.width * 0.040); }

function addCoinToPile(x) {
  const {cx,rimRX}=getPot();
  if (Math.abs(x-cx)>rimRX*0.88) return;
  const t=(x-(cx-rimRX*0.88))/(rimRX*1.76);
  const slot=Math.max(0,Math.min(PILE_SLOTS-1,Math.floor(t*PILE_SLOTS)));
  const max=maxForSlot(slot);
  if (slotCount[slot]<max) slotCount[slot]++;
  // Propagate to neighbours so pile grows smoothly
  if (slot>0          && slotCount[slot-1]<maxForSlot(slot-1))
    slotCount[slot-1]=Math.max(slotCount[slot-1],slotCount[slot]-1);
  if (slot<PILE_SLOTS-1 && slotCount[slot+1]<maxForSlot(slot+1))
    slotCount[slot+1]=Math.max(slotCount[slot+1],slotCount[slot]-1);
}

function surfaceYAt(x) {
  const {cx,rimY,rimRX}=getPot();
  if (Math.abs(x-cx)>rimRX*0.92) return rimY;
  const t=(x-(cx-rimRX*0.88))/(rimRX*1.76);
  const slot=Math.max(0,Math.min(PILE_SLOTS-1,Math.floor(t*PILE_SLOTS)));
  return rimY - slotCount[slot]*pCS()*0.80;
}

// Draw the dome pile with coin PNGs
function drawPile() {
  if (slotCount.every(c=>c===0)) return;
  const {cx,rimY,rimRX}=getPot();
  const cs=pCS();
  const slotW=(rimRX*1.76)/PILE_SLOTS;
  const startX=cx-rimRX*0.88;

  ctx.save();
  ctx.globalAlpha=pileAlpha;

  // Hard clip to pot opening
  ctx.beginPath();
  ctx.rect(cx-rimRX*0.91, 0, rimRX*1.82, rimY+cs);
  ctx.clip();

  for (let s=0; s<PILE_SLOTS; s++) {
    const count=slotCount[s];
    if (count===0) continue;
    const slotCX=startX+(s+0.5)*slotW;

    for (let row=0; row<count; row++) {
      const y=rimY - row*cs*1.60 - cs*0.55;
      if (y+cs<0) continue;

      // Stable per-coin jitter & tilt
      const jx=Math.sin(s*11.3+row*7.1)*cs*0.20;
      const jy=Math.cos(s*8.7 +row*4.3)*cs*0.10;
      const tilt=Math.sin(s*17.1+row*6.3)*0.22;
      const sz=cs*2.10;

      ctx.save();
      ctx.translate(slotCX+jx, y+jy);
      ctx.rotate(tilt);
      ctx.drawImage(coinImg, -sz/2, -sz/2, sz, sz);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ─────────────────────────────────────────
// Pot of gold + text label on the body
// ─────────────────────────────────────────
function drawPot() {
  const {cx,rimY,rimRX,rimRY}=getPot();
  const bodyR =rimRX*0.98;
  const bodyCY=rimY+bodyR*0.04;

  ctx.save();

  // ── Body (clipped below rimY) ──────────────────────────────
  ctx.save();
  ctx.beginPath(); ctx.rect(0,rimY-2,canvas.width,canvas.height); ctx.clip();
  ctx.beginPath(); ctx.arc(cx,bodyCY,bodyR,0,Math.PI*2);
  const bg=ctx.createRadialGradient(cx-bodyR*.28,bodyCY-bodyR*.28,bodyR*.04,cx,bodyCY,bodyR*1.08);
  bg.addColorStop(0,'#5a5a5a'); bg.addColorStop(.3,'#2a2a2a');
  bg.addColorStop(.7,'#131313'); bg.addColorStop(1,'#050505');
  ctx.fillStyle=bg; ctx.fill();
  // Highlight streak
  ctx.beginPath();
  ctx.ellipse(cx-bodyR*.26,bodyCY-bodyR*.12,bodyR*.11,bodyR*.34,-0.22,0,Math.PI*2);
  ctx.fillStyle='rgba(120,120,120,0.16)'; ctx.fill();
  ctx.restore();

  // ── Text on pot body ───────────────────────────────────────
  // Positioned on the visible cauldron face, below the rim
  if (potTextImg.complete && potTextImg.naturalWidth > 0) {
    const txtW = rimRX * 1.60;
    const txtH = txtW * (potTextImg.naturalHeight / potTextImg.naturalWidth);
    const txtX = cx - txtW / 2;
    const txtY = rimY + rimRY * 0.8 + canvas.height * 0.12;  // lower on pot body
    ctx.save();
    // Clip to body so text doesn't spill outside cauldron
    ctx.beginPath(); ctx.rect(0, rimY, canvas.width, canvas.height); ctx.clip();
    ctx.drawImage(potTextImg, txtX, txtY, txtW, txtH);
    ctx.restore();
  }

  // ── Rim shadow ─────────────────────────────────────────────
  ctx.beginPath();
  ctx.ellipse(cx,rimY+rimRY*.6,rimRX*.98,rimRY*.65,0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fill();

  // ── Gold rim ───────────────────────────────────────────────
  ctx.beginPath(); ctx.ellipse(cx,rimY,rimRX,rimRY,0,0,Math.PI*2);
  const rg=ctx.createLinearGradient(cx-rimRX,rimY-rimRY,cx+rimRX,rimY+rimRY);
  rg.addColorStop(0,'#ffe84a'); rg.addColorStop(.20,'#fff276');
  rg.addColorStop(.50,'#c89010'); rg.addColorStop(.78,'#a06808'); rg.addColorStop(1,'#7a4e04');
  ctx.fillStyle=rg; ctx.fill();

  // Inner shadow
  ctx.beginPath();
  ctx.ellipse(cx,rimY+rimRY*.28,rimRX*.82,rimRY*.52,0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.60)'; ctx.fill();

  // Rim shine
  ctx.beginPath();
  ctx.ellipse(cx-rimRX*.23,rimY-rimRY*.28,rimRX*.26,rimRY*.30,-0.14,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,215,0.42)'; ctx.fill();

  ctx.restore();
}

// ─────────────────────────────────────────
// Falling coins
// ─────────────────────────────────────────
let falling=[], lastSpawnMs=0;

function spawnFromSky() {
  const now=performance.now();
  if (now-lastSpawnMs<75) return;
  lastSpawnMs=now;
  for (let i=0;i<3;i++) {
    const isCoin=Math.random()<0.72;
    const base=isCoin?(13+Math.random()*11):(10+Math.random()*9);
    const size=base*window.devicePixelRatio;
    falling.push({
      x:canvas.width*(0.06+Math.random()*0.88), y:-size,
      vx:(Math.random()-.5)*3.5, vy:1.5+Math.random()*2.0,
      ay:0.25+Math.random()*0.10,
      rot:Math.random()*Math.PI*2, spin:(Math.random()-.5)*0.12,
      size, img:isCoin?coinImg:shamrockImg,
    });
  }
  if (falling.length>130) falling.splice(0,falling.length-130);
}

function stepFalling() {
  const {rimY,cx,rimRX}=getPot();
  const toRemove=[];
  for (let i=0;i<falling.length;i++) {
    const p=falling[i];
    p.vy+=p.ay; p.x+=p.vx; p.y+=p.vy; p.rot+=p.spin;
    if (p.x-p.size*.5<0)           {p.x=p.size*.5;             p.vx= Math.abs(p.vx)*.6;}
    if (p.x+p.size*.5>canvas.width){p.x=canvas.width-p.size*.5;p.vx=-Math.abs(p.vx)*.6;}
    if (Math.abs(p.x-cx)>rimRX*0.92 && p.y+p.size*.5>=rimY){toRemove.push(i);continue;}
    const surf=surfaceYAt(p.x);
    if (p.y+p.size*.5>=surf){addCoinToPile(p.x);toRemove.push(i);continue;}
    ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
    ctx.drawImage(p.img,-p.size/2,-p.size/2,p.size,p.size);
    ctx.restore();
  }
  for (let i=toRemove.length-1;i>=0;i--) falling.splice(toRemove[i],1);
}

// ─────────────────────────────────────────
// Ambient shamrocks
// ─────────────────────────────────────────
let ambient=[];
function initAmbient() {
  for (let i=0;i<5;i++) ambient.push({
    x:Math.random()*canvas.width, y:canvas.height+Math.random()*canvas.height,
    size:(10+Math.random()*12)*window.devicePixelRatio,
    vx:(Math.random()-.5)*.5, vy:-(0.28+Math.random()*.38),
    rot:Math.random()*Math.PI*2, spin:(Math.random()-.5)*.015,
    alpha:0.09+Math.random()*.11,
  });
}
function stepAmbient() {
  for (const p of ambient) {
    p.x+=p.vx; p.y+=p.vy; p.rot+=p.spin;
    if (p.y<-50){p.y=canvas.height+30;p.x=Math.random()*canvas.width;}
    ctx.save(); ctx.globalAlpha=p.alpha;
    ctx.translate(p.x,p.y); ctx.rotate(p.rot);
    ctx.drawImage(shamrockImg,-p.size/2,-p.size/2,p.size,p.size);
    ctx.restore();
  }
}

// ─────────────────────────────────────────
// Rainbow
// ─────────────────────────────────────────
let rainbowAlpha=0, rainbowTarget=0;
function drawRainbow(cx,cy,radius) {
  if (rainbowAlpha<0.01) return;
  const bands=[[255,50,50],[255,140,0],[255,230,0],[50,210,50],[50,120,255],[180,50,255]];
  const bw=radius*.07;
  for (let i=0;i<bands.length;i++) {
    const [r,g,b]=bands[i];
    ctx.beginPath(); ctx.arc(cx,cy,radius+i*bw,Math.PI,2*Math.PI);
    ctx.strokeStyle=`rgba(${r},${g},${b},${rainbowAlpha})`;
    ctx.lineWidth=bw*1.15; ctx.stroke();
  }
}

// ─────────────────────────────────────────
// Face tint
// ─────────────────────────────────────────
function drawFaceGrading(lm) {
  const [x234,y234]=lmToCanvas(lm[234]), [x454,y454]=lmToCanvas(lm[454]);
  const [x10,y10]=lmToCanvas(lm[10]),    [x152,y152]=lmToCanvas(lm[152]);
  const fcx=(x234+x454)/2, fcy=(y10+y152)/2;
  const faceW=Math.hypot(x454-x234,y454-y234), faceH=Math.abs(y152-y10)*1.05;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(fcx,fcy,faceW*.52,faceH*.52,0,0,Math.PI*2); ctx.clip();
  const g=ctx.createRadialGradient(fcx,fcy-faceH*.1,0,fcx,fcy,faceW*.55);
  g.addColorStop(0,'rgba(0,200,50,0.00)'); g.addColorStop(.5,'rgba(0,180,40,0.05)');
  g.addColorStop(1,'rgba(0,140,30,0.13)');
  ctx.fillStyle=g; ctx.fillRect(fcx-faceW,fcy-faceH,faceW*2,faceH*2); ctx.restore();
}

// ─────────────────────────────────────────
// Cheek shamrocks
// ─────────────────────────────────────────
function drawCheekStickers(lm) {
  const [x234]=lmToCanvas(lm[234]), [,y234]=lmToCanvas(lm[234]);
  const [x454]=lmToCanvas(lm[454]), [,y454]=lmToCanvas(lm[454]);
  const faceW=Math.hypot(x454-x234,y454-y234), size=faceW*.13;
  for (const idx of [50,280]) {
    const [cx,cy]=lmToCanvas(lm[idx]);
    ctx.save(); ctx.globalAlpha=.75;
    ctx.drawImage(shamrockImg,cx-size/2,cy-size/2,size,size); ctx.restore();
  }
}

// ─────────────────────────────────────────
// Hat
// ─────────────────────────────────────────
const BRIM_BOTTOM_FRAC=855/900, CROWN_TOP_FRAC=80/900;
function drawHat(lm) {
  const [x10,y10]=lmToCanvas(lm[10]),   [x152,y152]=lmToCanvas(lm[152]);
  const [x234,y234]=lmToCanvas(lm[234]),[x454,y454]=lmToCanvas(lm[454]);
  const [xL,yL,xR,yR]=x234<=x454?[x234,y234,x454,y454]:[x454,y454,x234,y234];
  const rollAngle=Math.atan2(yR-yL,xR-xL), faceW=Math.hypot(xR-xL,yR-yL);
  const faceH=Math.abs(y152-y10);
  const pitchScale=Math.max(.40,Math.min(1.0,(faceH/(faceW||1))*.70));

  // Face-up unit vector (chin→forehead direction in canvas space)
  const fUpLen=Math.hypot(x10-x152,y10-y152)||1;
  const uX=(x10-x152)/fUpLen, uY=(y10-y152)/fUpLen;

  const sx=smoothHatX.update(x10), sy=smoothHatY.update(y10);
  const sw=smoothFW.update(faceW),  sa=smoothRoll.update(rollAngle);
  const sp=smoothPitch.update(pitchScale);

  const hatW=sw*1.55;
  // Keep hatH proportional to the UNSCALED hat — pitch only affects vertical draw,
  // not the anchor distance, so the brim stays glued to the forehead when tilting.
  const hatHFull =hatW*(900/800);          // full height (no pitch)
  const hatHDraw =hatHFull*sp;             // compressed height for drawing

  // Anchor: brim bottom of FULL hat — so tilting doesn't change where it sits
  const anchorFull=hatHFull*BRIM_BOTTOM_FRAC;

  // Shift hat DOWN along face axis so brim overlaps forehead correctly.
  // Positive offset moves toward chin (downward along face-up vector reversed).
  const downShift = hatHFull * 0.20;       // push down 28% of full hat height

  const anchorDraw=hatHDraw*BRIM_BOTTOM_FRAC;

  ctx.save();
  // Translate to forehead, rotate for roll, then push down in rotated hat space
  // so the offset follows the head tilt correctly
  ctx.translate(sx, sy);
  ctx.rotate(sa);
  ctx.translate(0, downShift);  // now "down" is along the hat's local Y axis
  ctx.shadowColor='rgba(0,20,0,.5)'; ctx.shadowBlur=14*window.devicePixelRatio;
  ctx.shadowOffsetY=5*window.devicePixelRatio;
  ctx.drawImage(hatImg,-hatW/2,-anchorDraw,hatW,hatHDraw); ctx.restore();
  return {rcx:sx, rcy:sy-anchorFull+hatHFull*CROWN_TOP_FRAC, faceW:sw};
}

// ─────────────────────────────────────────
// Main frame
// ─────────────────────────────────────────
function onResults(results) {
  resizeCanvas();
  const {rW,rH,ox,oy}=coverMap();
  ctx.clearRect(0,0,canvas.width,canvas.height);

  ctx.save();
  if (currentFacingMode==='user'){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
  ctx.drawImage(video,ox,oy,rW,rH);
  ctx.restore();

  if (ambient.length===0) initAmbient();
  stepAmbient();

  updatePileFade();

  // Draw order: pot body → pile on top → pot rim over pile base
  drawPot();
  drawPile();

  let ha=null;
  if (results.multiFaceLandmarks?.length) {
    const lm=results.multiFaceLandmarks[0];
    // drawFaceGrading removed
    ha=drawHat(lm);
    // drawCheekStickers removed
    updateTrigger(lm);
  } else {
    triggerFrames=Math.max(triggerFrames-1,0);
    if (triggered&&triggerFrames<4){triggered=false;startPileFade();}
  }

  rainbowTarget=triggered?.60:0;
  rainbowAlpha+=(rainbowTarget-rainbowAlpha)*.08;
  if (ha) drawRainbow(ha.rcx,ha.rcy,ha.faceW*1.1);

  if (triggered) spawnFromSky();
  stepFalling();
}

// ─────────────────────────────────────────
// Camera / FaceMesh
// ─────────────────────────────────────────
async function start() {
  const fm=new FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});
  fm.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.5,minTrackingConfidence:.5});
  fm.onResults(onResults);
  if (camera) camera.stop();
  camera=new Camera(video,{
    onFrame:async()=>fm.send({image:video}),
    width:1280,height:720,facingMode:currentFacingMode,
  });
  await camera.start();
  resizeCanvas(); initPile();
}

// ─────────────────────────────────────────
// UI
// ─────────────────────────────────────────
flipBtn.addEventListener('click',()=>{
  currentFacingMode=currentFacingMode==='user'?'environment':'user';
  smoothHatX.reset();smoothHatY.reset();smoothFW.reset();
  smoothRoll.reset();smoothPitch.reset();smoothSmile.reset();smoothTeeth.reset();
  triggerFrames=0;triggered=false;
  smileSamples=[];smileBaseline=null;
  initPile();falling=[];
  start();
});

shutterBtn.addEventListener('click',async()=>{
  flash.classList.add('active');
  setTimeout(()=>flash.classList.remove('active'),180);
  try {
    const off=document.createElement('canvas');
    off.width=canvas.width;off.height=canvas.height;
    off.getContext('2d').drawImage(canvas,0,0);
    const blob=await new Promise(r=>off.toBlob(r,'image/png'));
    const file=new File([blob],'stpaddys.png',{type:'image/png'});
    if (navigator.canShare?.({files:[file]})) {
      await navigator.share({files:[file],title:"☘️ Happy St. Patrick's Day!"});
    } else {
      const url=URL.createObjectURL(blob);
      const a=Object.assign(document.createElement('a'),{href:url,download:'stpaddys.png'});
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    }
  } catch(e){console.error(e);}
});

document.addEventListener('DOMContentLoaded',()=>start().catch(console.error));
