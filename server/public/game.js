// Three.js Artillery Game — vertical portrait layout
const GRID = 8;
const CELL = 1.0;
const FIELD_GAP = 1.8;

let ws = null, playerIndex = null, myTurn = false, mode = null, selectedCannonIdx = null;
let myCannons = [], enemyCannons = [], myAlive = [true,true], enemyAlive = [true,true];
let scene, camera, renderer, raycaster, mouse;
let myCannonMeshes = [], enemyCannonMeshes = [];
let gridCellsMy = [], gridCellsEnemy = [];
let explosionParticles = [], fireParticles = [];

const statusEl = document.getElementById('status');
const timerFill = document.getElementById('timer-fill');
const hintEl = document.getElementById('hint');
const btnFire = document.getElementById('btn-fire');
const btnMove = document.getElementById('btn-move');
const fieldLabels = document.getElementById('field-labels');
let timerInterval = null, turnDuration = 5, turnEndTime = 0;

const HALF = GRID * CELL / 2;
const MY_Z_CENTER = HALF + FIELD_GAP / 2;
const EN_Z_CENTER = -(HALF + FIELD_GAP / 2);

function initThree() {
  const canvas = document.getElementById('three-canvas');
  const container = document.getElementById('canvas-container');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 22, 36);
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  resizeRenderer();
  scene.add(new THREE.AmbientLight(0x1a2a40, 2.5));
  const dir = new THREE.DirectionalLight(0x4488cc, 1.5);
  dir.position.set(2, 12, 2); dir.castShadow = true; scene.add(dir);
  scene.add(Object.assign(new THREE.DirectionalLight(0xe05050, 0.4), {position: new THREE.Vector3(-4,4,-8)}));
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  buildFields();
  canvas.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', resizeRenderer);
  animate();
}

function resizeRenderer() {
  const container = document.getElementById('canvas-container');
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Adjust camera height based on aspect ratio
    const dist = w < h ? 18 : 13;
    const totalZ = GRID * CELL + FIELD_GAP;
    camera.position.set(0, dist, totalZ * 0.3);
    camera.lookAt(0, 0, 0);
  }
}

function buildFields() {
  buildField(MY_Z_CENTER, 1, 0x0d1e35, 0x1a3a5c, gridCellsMy, 'my');
  buildField(EN_Z_CENTER, -1, 0x2a0d0d, 0x3d1010, gridCellsEnemy, 'enemy');
  const div = new THREE.Mesh(
    new THREE.BoxGeometry(GRID * CELL + 2, 0.02, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x334455 })
  );
  div.position.set(0, 0.01, 0);
  scene.add(div);
}

function buildField(zCenter, dir, colorDark, colorLight, cellsArr, side) {
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const geo = new THREE.BoxGeometry(CELL-0.05, 0.08, CELL-0.05);
      const mat = new THREE.MeshLambertMaterial({
        color: (x+z)%2===0 ? colorDark : colorLight,
        transparent: true, opacity: 0.92
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (x - GRID/2 + 0.5) * CELL,
        0,
        zCenter + dir * (z - GRID/2 + 0.5) * CELL
      );
      mesh.receiveShadow = true;
      mesh.userData = { side, gridX: x, gridZ: z };
      scene.add(mesh);
      cellsArr.push(mesh);
    }
  }
}

function createCannonMesh(isEnemy) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.30, 0.18, 8),
    new THREE.MeshLambertMaterial({ color: isEnemy ? 0x8b1a1a : 0x1a4a8b })
  );
  base.castShadow = true; g.add(base);
  const bGeo = new THREE.CylinderGeometry(0.065, 0.085, 0.55, 8);
  bGeo.rotateX(Math.PI/2.5);
  const barrel = new THREE.Mesh(bGeo, new THREE.MeshLambertMaterial({ color: isEnemy ? 0xcc2222 : 0x2266cc }));
  barrel.position.set(0, 0.22, 0.12); barrel.castShadow = true; g.add(barrel);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.022, 8, 24),
    new THREE.MeshBasicMaterial({ color: isEnemy ? 0xff3333 : 0x3399ff, transparent: true, opacity: 0.4 })
  );
  ring.rotation.x = Math.PI/2; ring.position.y = 0.05; g.add(ring);
  g.userData.ring = ring;
  return g;
}

function cellPos(cells, gx, gz) {
  const c = cells.find(c => c.userData.gridX===gx && c.userData.gridZ===gz);
  return c ? c.position.clone() : new THREE.Vector3();
}

function placeCannons() {
  [...myCannonMeshes, ...enemyCannonMeshes].forEach(m => { if(m) scene.remove(m); });
  myCannonMeshes = []; enemyCannonMeshes = [];
  myCannons.forEach((c,i) => {
    if (!myAlive[i]) return;
    const mesh = createCannonMesh(false);
    const pos = cellPos(gridCellsMy, c.x, c.y);
    mesh.position.set(pos.x, 0.13, pos.z);
    mesh.userData = { type:'myCannon', index:i };
    scene.add(mesh); myCannonMeshes[i] = mesh;
  });
  enemyCannons.forEach((c,i) => {
    if (!enemyAlive[i]) return;
    const mesh = createCannonMesh(true);
    const pos = cellPos(gridCellsEnemy, c.x, c.y);
    mesh.position.set(pos.x, 0.13, pos.z);
    mesh.userData = { type:'enemyCannon', index:i };
    scene.add(mesh); enemyCannonMeshes[i] = mesh;
  });
}

function clearHighlights() {
  [...gridCellsMy, ...gridCellsEnemy].forEach(c => {
    c.material.emissive = new THREE.Color(0); c.material.opacity = 0.92;
  });
  myCannonMeshes.forEach(m => { if(m) m.scale.setScalar(1); });
}
function highlightEnemyCells() {
  gridCellsEnemy.forEach(c => { c.material.emissive = new THREE.Color(0x3a0808); c.material.opacity = 1; });
}
function highlightMyCannons() {
  myCannonMeshes.forEach((m,i) => { if(m && myAlive[i]) m.scale.setScalar(1.15); });
}

function spawnExplosion(pos) {
  for (let i=0; i<18; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.06+Math.random()*0.1,5,5),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.05+Math.random()*0.08,1,0.5+Math.random()*0.3) })
    );
    p.position.copy(pos).add(new THREE.Vector3(0,0.3,0));
    const a = Math.random()*Math.PI*2, sp = 0.04+Math.random()*0.06;
    p.userData = { vx:Math.cos(a)*sp, vy:0.05+Math.random()*0.1, vz:Math.sin(a)*sp, life:1 };
    scene.add(p); explosionParticles.push(p);
  }
}
function spawnFire(pos) {
  for (let i=0; i<8; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.06+Math.random()*0.07,5,5),
      new THREE.MeshBasicMaterial({ color:0xff4400, transparent:true, opacity:0.9 })
    );
    p.position.copy(pos);
    p.userData = { baseX:pos.x, baseZ:pos.z, phase:Math.random()*Math.PI*2 };
    scene.add(p); fireParticles.push(p);
  }
}
function spawnMiss(pos) {
  for (let i=0; i<6; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.05,4,4),
      new THREE.MeshBasicMaterial({ color:0x445566, transparent:true, opacity:0.7 })
    );
    p.position.copy(pos).add(new THREE.Vector3(0,0.1,0));
    const a = Math.random()*Math.PI*2;
    p.userData = { vx:Math.cos(a)*0.02, vy:0.03, vz:Math.sin(a)*0.02, life:0.8 };
    scene.add(p); explosionParticles.push(p);
  }
}

function animate() {
  requestAnimationFrame(animate);
  for (let i=explosionParticles.length-1; i>=0; i--) {
    const p = explosionParticles[i];
    p.userData.vy -= 0.003;
    p.position.x += p.userData.vx; p.position.y += p.userData.vy; p.position.z += p.userData.vz;
    p.userData.life -= 0.025; p.material.opacity = p.userData.life;
    if (p.userData.life<=0) { scene.remove(p); explosionParticles.splice(i,1); }
  }
  const t = Date.now()*0.003;
  fireParticles.forEach(p => {
    p.position.y = 0.2 + Math.sin(t+p.userData.phase)*0.1;
    p.position.x = p.userData.baseX + Math.sin(t*1.3+p.userData.phase)*0.07;
    p.material.color.setHSL(0.06*(0.6+Math.sin(t*2+p.userData.phase)*0.3),1,0.5);
    p.material.opacity = 0.7+Math.sin(t+p.userData.phase)*0.2;
  });
  const pulse = 0.3+Math.sin(t*2)*0.15;
  [...myCannonMeshes,...enemyCannonMeshes].forEach(m => { if(m&&m.userData.ring) m.userData.ring.material.opacity=pulse; });
  renderer.render(scene, camera);
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  turnDuration = seconds; turnEndTime = Date.now()+seconds*1000;
  timerInterval = setInterval(() => {
    const left = (turnEndTime-Date.now())/1000;
    const pct = Math.max(0,left/turnDuration)*100;
    timerFill.style.width = pct+'%';
    timerFill.style.background = pct>40?'#4daaff':pct>20?'#ffaa00':'#ff4444';
    if (left<=0) clearInterval(timerInterval);
  }, 80);
}

function selectMode(m) {
  if (!myTurn) return;
  mode = m; selectedCannonIdx = null; clearHighlights();
  if (mode==='fire') {
    btnFire.classList.add('active'); btnMove.classList.remove('active');
    highlightEnemyCells(); hintEl.textContent = 'Виберіть клітинку для пострілу';
  } else {
    btnMove.classList.add('active'); btnFire.classList.remove('active');
    highlightMyCannons(); hintEl.textContent = 'Виберіть свою гармату';
  }
}

function onCanvasClick(event) {
  if (!myTurn||!mode) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((event.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  if (mode==='fire') {
    const hits = raycaster.intersectObjects(gridCellsEnemy);
    if (hits.length>0) {
      const c = hits[0].object;
      sendAction({type:'fire', x:c.userData.gridX, y:c.userData.gridZ});
      disableButtons(); hintEl.textContent='';
    }
  } else {
    if (selectedCannonIdx===null) {
      const objs = myCannonMeshes.filter(m=>m).flatMap(m=>[m,...m.children]);
      const hits = raycaster.intersectObjects(objs, true);
      if (hits.length>0) {
        let obj = hits[0].object;
        while (obj.parent && !obj.userData.type) obj=obj.parent;
        if (obj.userData.type==='myCannon') {
          selectedCannonIdx = obj.userData.index; clearHighlights();
          gridCellsMy.forEach(c=>{c.material.emissive=new THREE.Color(0x002255);});
          hintEl.textContent='Виберіть нову позицію';
        }
      }
    } else {
      const hits = raycaster.intersectObjects(gridCellsMy);
      if (hits.length>0) {
        const c = hits[0].object;
        sendAction({type:'move', cannonIndex:selectedCannonIdx, x:c.userData.gridX, y:c.userData.gridZ});
        disableButtons(); selectedCannonIdx=null; hintEl.textContent='';
      }
    }
  }
}

const SERVER_URL = (()=>{ const p=location.protocol==='https:'?'wss:':'ws:'; return `${p}//${location.host}`; })();

function findGame() {
  showScreen('screen-waiting');
  ws = new WebSocket(SERVER_URL);
  ws.onopen = ()=>ws.send(JSON.stringify({type:'find_game'}));
  ws.onmessage = (e)=>handleMessage(JSON.parse(e.data));
  ws.onerror = ()=>{ alert('Помилка підключення'); resetGame(); };
}
function sendAction(action) { if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'action',action})); }

function handleMessage(msg) {
  if (msg.type==='game_start') {
    playerIndex=msg.playerIndex; myCannons=msg.myCannons; enemyCannons=msg.enemyCannons;
    myAlive=[true,true]; enemyAlive=[true,true];
    showScreen(null); fieldLabels.style.display='flex'; placeCannons();
    setStatus(msg.currentTurn===playerIndex?'Ваш хід':'Хід суперника');
  }
  if (msg.type==='turn_start') {
    myTurn=msg.yourTurn; mode=null; selectedCannonIdx=null; clearHighlights(); startTimer(msg.timeLeft);
    if (myTurn) {
      setStatus('Ваш хід!'); btnFire.disabled=false; btnMove.disabled=false;
      hintEl.textContent='Виберіть дію'; btnFire.classList.remove('active'); btnMove.classList.remove('active');
    } else { setStatus('Хід суперника...'); disableButtons(); hintEl.textContent=''; }
  }
  if (msg.type==='turn_result') {
    const action=msg.action; myCannons=msg.myCannons; enemyAlive=msg.enemyAlive;
    if (action&&action.type==='fire') {
      if (!myTurn) {
        const pos=cellPos(gridCellsMy,action.x,action.y);
        if(msg.hit){spawnExplosion(pos);spawnFire(pos);myAlive[msg.cannonIndex]=false;}else spawnMiss(pos);
      } else {
        const pos=cellPos(gridCellsEnemy,action.x,action.y);
        if(msg.hit){spawnExplosion(pos);spawnFire(pos);enemyAlive[msg.cannonIndex]=false;}else spawnMiss(pos);
      }
    }
    placeCannons(); myTurn=false;
  }
  if (msg.type==='game_over') {
    clearInterval(timerInterval); fieldLabels.style.display='none';
    document.getElementById('gameover-icon').textContent=msg.youWin?'🏆':'💥';
    document.getElementById('gameover-title').textContent=msg.youWin?'Перемога!':'Поразка';
    document.getElementById('gameover-sub').textContent=msg.youWin?'Ви знищили всі гармати противника!':'Ваші гармати знищено.';
    showScreen('screen-gameover');
  }
  if (msg.type==='opponent_left') { clearInterval(timerInterval); fieldLabels.style.display='none'; showScreen('screen-left'); }
}

function showScreen(id) {
  ['screen-menu','screen-waiting','screen-gameover','screen-left'].forEach(s=>{
    document.getElementById(s).style.display=s===id?'flex':'none';
  });
}
function setStatus(t){statusEl.textContent=t;}
function disableButtons(){btnFire.disabled=true;btnMove.disabled=true;btnFire.classList.remove('active');btnMove.classList.remove('active');}
function resetGame(){
  if(ws){ws.close();ws=null;} clearInterval(timerInterval); disableButtons();
  mode=null;selectedCannonIdx=null;myTurn=false;timerFill.style.width='100%';
  hintEl.textContent='';fieldLabels.style.display='none';setStatus('Очікування...');
  fireParticles.forEach(p=>scene.remove(p));fireParticles=[];
  explosionParticles.forEach(p=>scene.remove(p));explosionParticles=[];
  [...myCannonMeshes,...enemyCannonMeshes].forEach(m=>{if(m)scene.remove(m);});
  myCannonMeshes=[];enemyCannonMeshes=[];
  showScreen('screen-menu');
}
window.addEventListener('load',()=>{initThree();showScreen('screen-menu');});
