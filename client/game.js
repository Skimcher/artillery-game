// =====================
// Three.js Artillery Game Client
// =====================

const GRID = 8;
const CELL = 1.2;       // world units per cell
const FIELD_GAP = 1.5;  // gap between my field and enemy field

let ws = null;
let playerIndex = null;
let myTurn = false;
let mode = null; // 'fire' | 'move'
let selectedCannonIdx = null;

// Game state
let myCannons = [];
let enemyCannons = [];
let myAlive = [true, true];
let enemyAlive = [true, true];

// Three.js objects
let scene, camera, renderer, raycaster, mouse;
let myCannonMeshes = [];
let enemyCannonMeshes = [];
let gridCellsMy = [];
let gridCellsEnemy = [];
let explosionParticles = [];
let fireParticles = [];

// UI refs
const statusEl = document.getElementById('status');
const timerFill = document.getElementById('timer-fill');
const hintEl = document.getElementById('hint');
const btnFire = document.getElementById('btn-fire');
const btnMove = document.getElementById('btn-move');
const fieldLabels = document.getElementById('field-labels');

let timerInterval = null;
let turnDuration = 5;
let turnEndTime = 0;

// =====================
// THREE.JS SETUP
// =====================
function initThree() {
  const canvas = document.getElementById('three-canvas');
  const container = document.getElementById('canvas-container');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  resizeRenderer();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 20, 35);

  // Camera: isometric-ish view from above and side
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 12, 10);
  camera.lookAt(0, 0, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0x1a2a40, 2);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0x4488cc, 1.5);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const rimLight = new THREE.DirectionalLight(0xe05050, 0.3);
  rimLight.position.set(-5, 3, -5);
  scene.add(rimLight);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  buildFields();

  canvas.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', resizeRenderer);

  animate();
}

function resizeRenderer() {
  const container = document.getElementById('canvas-container');
  renderer.setSize(container.clientWidth, container.clientHeight);
  if (camera) {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  }
}

// =====================
// FIELD GRID
// =====================
function buildFields() {
  // My field (left) in blue, Enemy field (right) in red
  // Fields are side by side along X axis
  const totalWidth = GRID * CELL;
  const myOffsetX = -(totalWidth + FIELD_GAP / 2);
  const enemyOffsetX = FIELD_GAP / 2;

  // Ground plane for each field
  buildField(myOffsetX, 0x0d1e35, 0x1a3a5c, gridCellsMy, 'my');
  buildField(enemyOffsetX, 0x2a0d0d, 0x3d1010, gridCellsEnemy, 'enemy');

  // Divider line
  const divGeo = new THREE.BoxGeometry(0.08, 0.02, GRID * CELL + 2);
  const divMat = new THREE.MeshBasicMaterial({ color: 0x334455 });
  const divider = new THREE.Mesh(divGeo, divMat);
  divider.position.set(0, 0.01, (GRID / 2 - 0.5) * CELL - GRID * CELL / 2 + CELL / 2);
  scene.add(divider);
}

function buildField(offsetX, colorDark, colorLight, cellsArr, side) {
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const isDark = (x + z) % 2 === 0;
      const geo = new THREE.BoxGeometry(CELL - 0.06, 0.08, CELL - 0.06);
      const mat = new THREE.MeshLambertMaterial({
        color: isDark ? colorDark : colorLight,
        transparent: true,
        opacity: 0.9
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        offsetX + x * CELL + CELL / 2,
        0,
        (z - GRID / 2) * CELL + CELL / 2
      );
      mesh.receiveShadow = true;
      mesh.userData = { side, gridX: x, gridZ: z };
      scene.add(mesh);
      cellsArr.push(mesh);
    }
  }
}

// =====================
// CANNON MESHES
// =====================
function createCannonMesh(isEnemy) {
  const group = new THREE.Group();

  // Base cylinder
  const baseGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.2, 8);
  const baseMat = new THREE.MeshLambertMaterial({
    color: isEnemy ? 0x8b1a1a : 0x1a4a8b
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.castShadow = true;
  group.add(base);

  // Barrel
  const barrelGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.6, 8);
  barrelGeo.rotateX(Math.PI / 2.5);
  const barrelMat = new THREE.MeshLambertMaterial({
    color: isEnemy ? 0xcc2222 : 0x2266cc
  });
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  barrel.position.set(0, 0.25, 0.15);
  barrel.castShadow = true;
  group.add(barrel);

  // Glow ring
  const ringGeo = new THREE.TorusGeometry(0.3, 0.025, 8, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: isEnemy ? 0xff3333 : 0x3399ff,
    transparent: true,
    opacity: 0.4
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);
  group.userData.ring = ring;

  return group;
}

function placeCannons() {
  // Remove old meshes
  [...myCannonMeshes, ...enemyCannonMeshes].forEach(m => scene.remove(m));
  myCannonMeshes = [];
  enemyCannonMeshes = [];

  const totalWidth = GRID * CELL;
  const myOffsetX = -(totalWidth + FIELD_GAP / 2);
  const enemyOffsetX = FIELD_GAP / 2;

  myCannons.forEach((c, i) => {
    if (!myAlive[i]) return;
    const mesh = createCannonMesh(false);
    mesh.position.set(
      myOffsetX + c.x * CELL + CELL / 2,
      0.14,
      (c.y - GRID / 2) * CELL + CELL / 2
    );
    mesh.userData = { type: 'myCannon', index: i };
    scene.add(mesh);
    myCannonMeshes[i] = mesh;
  });

  enemyCannons.forEach((c, i) => {
    if (!enemyAlive[i]) return;
    const mesh = createCannonMesh(true);
    mesh.position.set(
      enemyOffsetX + c.x * CELL + CELL / 2,
      0.14,
      (c.y - GRID / 2) * CELL + CELL / 2
    );
    mesh.userData = { type: 'enemyCannon', index: i };
    scene.add(mesh);
    enemyCannonMeshes[i] = mesh;
  });
}

// =====================
// SELECTION HIGHLIGHT
// =====================
function clearHighlights() {
  gridCellsMy.forEach(c => {
    c.material.emissive = new THREE.Color(0x000000);
    c.material.opacity = 0.9;
  });
  gridCellsEnemy.forEach(c => {
    c.material.emissive = new THREE.Color(0x000000);
    c.material.opacity = 0.9;
  });
  myCannonMeshes.forEach(m => {
    if (m) m.scale.setScalar(1);
  });
}

function highlightEnemyCells() {
  gridCellsEnemy.forEach(c => {
    c.material.emissive = new THREE.Color(0x3a0808);
    c.material.opacity = 1;
  });
}

function highlightMyCannons() {
  myCannonMeshes.forEach((m, i) => {
    if (m && myAlive[i]) {
      m.scale.setScalar(1.15);
    }
  });
}

// =====================
// EXPLOSION & FIRE EFFECTS
// =====================
function spawnExplosion(worldX, worldZ) {
  const count = 18;
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.07 + Math.random() * 0.1, 5, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.05 + Math.random() * 0.08, 1, 0.5 + Math.random() * 0.3)
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.set(worldX, 0.3, worldZ);
    const speed = 0.04 + Math.random() * 0.06;
    const angle = Math.random() * Math.PI * 2;
    const upward = 0.05 + Math.random() * 0.1;
    p.userData = { vx: Math.cos(angle) * speed, vy: upward, vz: Math.sin(angle) * speed, life: 1 };
    scene.add(p);
    explosionParticles.push(p);
  }
}

function spawnFire(worldX, worldZ) {
  // Persistent fire on destroyed cannon
  const count = 8;
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.08, 5, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.9 });
    const p = new THREE.Mesh(geo, mat);
    p.position.set(worldX + (Math.random() - 0.5) * 0.3, 0.2, worldZ + (Math.random() - 0.5) * 0.3);
    p.userData = { baseX: worldX, baseZ: worldZ, phase: Math.random() * Math.PI * 2, fire: true };
    scene.add(p);
    fireParticles.push(p);
  }
}

function spawnMiss(worldX, worldZ) {
  // Small dust puff
  for (let i = 0; i < 6; i++) {
    const geo = new THREE.SphereGeometry(0.05, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x445566, transparent: true, opacity: 0.7 });
    const p = new THREE.Mesh(geo, mat);
    p.position.set(worldX, 0.1, worldZ);
    const angle = Math.random() * Math.PI * 2;
    p.userData = { vx: Math.cos(angle) * 0.02, vy: 0.03, vz: Math.sin(angle) * 0.02, life: 0.8 };
    scene.add(p);
    explosionParticles.push(p);
  }
}

// =====================
// ANIMATION LOOP
// =====================
function animate() {
  requestAnimationFrame(animate);

  // Update explosion particles
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const p = explosionParticles[i];
    p.userData.vy -= 0.003;
    p.position.x += p.userData.vx;
    p.position.y += p.userData.vy;
    p.position.z += p.userData.vz;
    p.userData.life -= 0.025;
    p.material.opacity = p.userData.life;
    if (p.userData.life <= 0) {
      scene.remove(p);
      explosionParticles.splice(i, 1);
    }
  }

  // Animate fire particles
  const t = Date.now() * 0.003;
  fireParticles.forEach(p => {
    p.position.y = 0.2 + Math.sin(t + p.userData.phase) * 0.1;
    p.position.x = p.userData.baseX + Math.sin(t * 1.3 + p.userData.phase) * 0.08;
    const flicker = 0.6 + Math.sin(t * 2 + p.userData.phase) * 0.3;
    p.material.color.setHSL(0.06 * flicker, 1, 0.5);
    p.material.opacity = 0.7 + Math.sin(t + p.userData.phase) * 0.2;
  });

  // Pulse cannon rings
  const pulse = 0.3 + Math.sin(t * 2) * 0.15;
  [...myCannonMeshes, ...enemyCannonMeshes].forEach(m => {
    if (m && m.userData.ring) m.userData.ring.material.opacity = pulse;
  });

  renderer.render(scene, camera);
}

// =====================
// TIMER
// =====================
function startTimer(seconds) {
  clearInterval(timerInterval);
  turnDuration = seconds;
  turnEndTime = Date.now() + seconds * 1000;

  timerInterval = setInterval(() => {
    const left = (turnEndTime - Date.now()) / 1000;
    const pct = Math.max(0, left / turnDuration) * 100;
    timerFill.style.width = pct + '%';
    timerFill.style.background = pct > 40 ? '#4daaff' : pct > 20 ? '#ffaa00' : '#ff4444';
    if (left <= 0) clearInterval(timerInterval);
  }, 80);
}

// =====================
// INPUT
// =====================
function selectMode(m) {
  if (!myTurn) return;
  mode = m;
  selectedCannonIdx = null;
  clearHighlights();

  if (mode === 'fire') {
    btnFire.classList.add('active');
    btnMove.classList.remove('active');
    highlightEnemyCells();
    hintEl.textContent = 'Виберіть клітинку для пострілу';
  } else if (mode === 'move') {
    btnMove.classList.add('active');
    btnFire.classList.remove('active');
    highlightMyCannons();
    hintEl.textContent = 'Виберіть свою гармату';
  }
}

function onCanvasClick(event) {
  if (!myTurn || !mode) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const totalWidth = GRID * CELL;
  const myOffsetX = -(totalWidth + FIELD_GAP / 2);
  const enemyOffsetX = FIELD_GAP / 2;

  if (mode === 'fire') {
    // Raycast against enemy grid cells
    const hits = raycaster.intersectObjects(gridCellsEnemy);
    if (hits.length > 0) {
      const cell = hits[0].object;
      sendAction({ type: 'fire', x: cell.userData.gridX, y: cell.userData.gridZ });
      disableButtons();
      hintEl.textContent = '';
    }
  } else if (mode === 'move') {
    if (selectedCannonIdx === null) {
      // Select a cannon
      const cannonObjs = myCannonMeshes.filter(m => m).flatMap(m => [m, ...m.children]);
      const hits = raycaster.intersectObjects(cannonObjs, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj.parent && !obj.userData.type) obj = obj.parent;
        if (obj.userData.type === 'myCannon') {
          selectedCannonIdx = obj.userData.index;
          clearHighlights();
          // Highlight my grid
          gridCellsMy.forEach(c => {
            c.material.emissive = new THREE.Color(0x002255);
          });
          hintEl.textContent = 'Виберіть нову позицію';
        }
      }
    } else {
      // Select target cell on my field
      const hits = raycaster.intersectObjects(gridCellsMy);
      if (hits.length > 0) {
        const cell = hits[0].object;
        sendAction({ type: 'move', cannonIndex: selectedCannonIdx, x: cell.userData.gridX, y: cell.userData.gridZ });
        disableButtons();
        selectedCannonIdx = null;
        hintEl.textContent = '';
      }
    }
  }
}

// =====================
// WEBSOCKET
// =====================
const SERVER_URL = (() => {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
})();

function findGame() {
  showScreen('screen-waiting');
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'find_game' }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onerror = () => {
    alert('Помилка підключення до сервера');
    resetGame();
  };

  ws.onclose = () => {};
}

function sendAction(action) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'action', action }));
  }
}

function handleMessage(msg) {
  if (msg.type === 'waiting') {
    // Still waiting, nothing to do
  }

  if (msg.type === 'game_start') {
    playerIndex = msg.playerIndex;
    myCannons = msg.myCannons;
    enemyCannons = msg.enemyCannons;
    myAlive = [true, true];
    enemyAlive = [true, true];
    showScreen(null);
    fieldLabels.style.display = 'flex';
    placeCannons();
    setStatus(msg.currentTurn === playerIndex ? 'Ваш хід' : 'Хід суперника');
  }

  if (msg.type === 'turn_start') {
    myTurn = msg.yourTurn;
    mode = null;
    selectedCannonIdx = null;
    clearHighlights();
    startTimer(msg.timeLeft);

    if (myTurn) {
      setStatus('Ваш хід!');
      btnFire.disabled = false;
      btnMove.disabled = false;
      hintEl.textContent = 'Виберіть дію';
      btnFire.classList.remove('active');
      btnMove.classList.remove('active');
    } else {
      setStatus('Хід суперника...');
      disableButtons();
      hintEl.textContent = '';
    }
  }

  if (msg.type === 'turn_result') {
    const action = msg.action;
    myCannons = msg.myCannons;
    myAlive = msg.myAlive || myAlive;
    enemyAlive = msg.enemyAlive;

    if (action && action.type === 'fire') {
      const totalWidth = GRID * CELL;
      const wasMyShot = myTurn; // we just fired
      // Determine world position of the shot
      if (!wasMyShot) {
        // Enemy shot at my field
        const myOffsetX = -(totalWidth + FIELD_GAP / 2);
        const wx = myOffsetX + action.x * CELL + CELL / 2;
        const wz = (action.y - GRID / 2) * CELL + CELL / 2;
        if (msg.hit) {
          spawnExplosion(wx, wz);
          spawnFire(wx, wz);
          myAlive[msg.cannonIndex] = false;
        } else {
          spawnMiss(wx, wz);
        }
      } else {
        // My shot at enemy field
        const enemyOffsetX = FIELD_GAP / 2;
        const wx = enemyOffsetX + action.x * CELL + CELL / 2;
        const wz = (action.y - GRID / 2) * CELL + CELL / 2;
        if (msg.hit) {
          spawnExplosion(wx, wz);
          spawnFire(wx, wz);
          enemyAlive[msg.cannonIndex] = false;
        } else {
          spawnMiss(wx, wz);
        }
      }
    }

    placeCannons();
    myTurn = false;
  }

  if (msg.type === 'game_over') {
    clearInterval(timerInterval);
    fieldLabels.style.display = 'none';
    const icon = document.getElementById('gameover-icon');
    const title = document.getElementById('gameover-title');
    const sub = document.getElementById('gameover-sub');
    if (msg.youWin) {
      icon.textContent = '🏆';
      title.textContent = 'Перемога!';
      sub.textContent = 'Ви знищили всі гармати противника!';
    } else {
      icon.textContent = '💥';
      title.textContent = 'Поразка';
      sub.textContent = 'Ваші гармати знищено.';
    }
    showScreen('screen-gameover');
  }

  if (msg.type === 'opponent_left') {
    clearInterval(timerInterval);
    fieldLabels.style.display = 'none';
    showScreen('screen-left');
  }
}

// =====================
// UI HELPERS
// =====================
function showScreen(id) {
  ['screen-menu', 'screen-waiting', 'screen-gameover', 'screen-left'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'flex' : 'none';
  });
}

function setStatus(text) {
  statusEl.textContent = text;
}

function disableButtons() {
  btnFire.disabled = true;
  btnMove.disabled = true;
  btnFire.classList.remove('active');
  btnMove.classList.remove('active');
}

function resetGame() {
  if (ws) { ws.close(); ws = null; }
  clearInterval(timerInterval);
  disableButtons();
  mode = null;
  selectedCannonIdx = null;
  myTurn = false;
  timerFill.style.width = '100%';
  hintEl.textContent = '';
  fieldLabels.style.display = 'none';
  setStatus('Очікування...');

  // Clear fire effects
  fireParticles.forEach(p => scene.remove(p));
  fireParticles = [];
  explosionParticles.forEach(p => scene.remove(p));
  explosionParticles = [];

  // Remove cannon meshes
  [...myCannonMeshes, ...enemyCannonMeshes].forEach(m => { if (m) scene.remove(m); });
  myCannonMeshes = [];
  enemyCannonMeshes = [];

  showScreen('screen-menu');
}

// =====================
// START
// =====================
window.addEventListener('load', () => {
  initThree();
  showScreen('screen-menu');
});

