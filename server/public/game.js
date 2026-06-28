// Artillery Game — orthographic top-down camera
const GRID = 6;
const CELL = 1.2;
const MY_Z = 5;   // center Z of my field
const EN_Z = -5;  // center Z of enemy field

let ws=null,playerIndex=null,myTurn=false,mode=null,selectedCannonIdx=null;
let myCannons=[],enemyCannons=[],myAlive=[true,true],enemyAlive=[true,true];
let scene,camera,renderer,raycaster,mouse;
let myCannonMeshes=[],enemyCannonMeshes=[];
let gridCellsMy=[],gridCellsEnemy=[];
let explosionParticles=[];

const statusEl=document.getElementById('status');
const timerFill=document.getElementById('timer-fill');
const hintEl=document.getElementById('hint');
const btnFire=document.getElementById('btn-fire');
const btnMove=document.getElementById('btn-move');
const fieldLabels=document.getElementById('field-labels');
let timerInterval=null,turnDuration=5,turnEndTime=0;

function initThree(){
  const canvas=document.getElementById('three-canvas');
  const container=document.getElementById('canvas-container');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0a0e1a);
  scene.add(new THREE.AmbientLight(0xffffff,1.5));
  const dir=new THREE.DirectionalLight(0x8899ff,1.0);
  dir.position.set(0,10,0);
  scene.add(dir);
  raycaster=new THREE.Raycaster();
  mouse=new THREE.Vector2();
  setupCamera(container);
  buildFields();
  canvas.addEventListener('click',onCanvasClick);
  window.addEventListener('resize',()=>setupCamera(container));
  animate();
}

function setupCamera(container){
  const w=container.clientWidth,h=container.clientHeight;
  renderer.setSize(w,h);
  // Orthographic: show world from -viewW/2 to +viewW/2 horizontally
  // and -viewH/2 to +viewH/2 vertically
  const viewW=GRID*CELL*1.3; // a bit wider than one field
  const viewH=viewW*(h/w);
  if(camera){
    camera.left=-viewW/2; camera.right=viewW/2;
    camera.top=viewH/2; camera.bottom=-viewH/2;
    camera.updateProjectionMatrix();
  } else {
    camera=new THREE.OrthographicCamera(-viewW/2,viewW/2,viewH/2,-viewH/2,0.1,100);
    camera.position.set(0,20,0);
    camera.lookAt(0,0,0);
  }
}

function buildFields(){
  const half=GRID/2;
  for(let x=0;x<GRID;x++){
    for(let z=0;z<GRID;z++){
      const dark=(x+z)%2===0;
      // My field
      {
        const geo=new THREE.PlaneGeometry(CELL-0.07,CELL-0.07);
        const mat=new THREE.MeshLambertMaterial({color:dark?0x0d1e35:0x1a3a5c});
        const m=new THREE.Mesh(geo,mat);
        m.rotation.x=-Math.PI/2;
        m.position.set((x-half+0.5)*CELL,0,MY_Z+(z-half+0.5)*CELL);
        m.userData={side:'my',gridX:x,gridZ:z};
        scene.add(m); gridCellsMy.push(m);
      }
      // Enemy field
      {
        const geo=new THREE.PlaneGeometry(CELL-0.07,CELL-0.07);
        const mat=new THREE.MeshLambertMaterial({color:dark?0x2a0d0d:0x3d1010});
        const m=new THREE.Mesh(geo,mat);
        m.rotation.x=-Math.PI/2;
        m.position.set((x-half+0.5)*CELL,0,EN_Z+(z-half+0.5)*CELL);
        m.userData={side:'enemy',gridX:x,gridZ:z};
        scene.add(m); gridCellsEnemy.push(m);
      }
    }
  }
  // Label planes
  addBorder(MY_Z,0x2255aa);
  addBorder(EN_Z,0xaa2222);
}

function addBorder(centerZ,color){
  const s=GRID*CELL;
  const mat=new THREE.LineBasicMaterial({color,linewidth:2});
  const half=s/2;
  const pts=[
    new THREE.Vector3(-half,0.01,centerZ-half),
    new THREE.Vector3(half,0.01,centerZ-half),
    new THREE.Vector3(half,0.01,centerZ+half),
    new THREE.Vector3(-half,0.01,centerZ+half),
    new THREE.Vector3(-half,0.01,centerZ-half)
  ];
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat));
}

function createCannon(isEnemy){
  const g=new THREE.Group();
  // Body (seen from top = circle)
  const body=new THREE.Mesh(
    new THREE.CylinderGeometry(0.35,0.35,0.3,12),
    new THREE.MeshLambertMaterial({color:isEnemy?0xcc2222:0x2266cc})
  );
  g.add(body);
  // Barrel (pointing up = visible from top as rectangle)
  const bar=new THREE.Mesh(
    new THREE.BoxGeometry(0.15,0.15,0.55),
    new THREE.MeshLambertMaterial({color:isEnemy?0xff6666:0x66aaff})
  );
  bar.position.set(0,0.25,0.28);
  g.add(bar);
  // Highlight ring
  const ring=new THREE.Mesh(
    new THREE.TorusGeometry(0.38,0.04,6,20),
    new THREE.MeshBasicMaterial({color:isEnemy?0xff3333:0x3399ff,transparent:true,opacity:0.5})
  );
  ring.rotation.x=Math.PI/2;
  ring.position.y=0.05;
  g.add(ring);
  g.userData.ring=ring;
  return g;
}

function cellPos(cells,gx,gz){
  const c=cells.find(c=>c.userData.gridX===gx&&c.userData.gridZ===gz);
  return c?c.position.clone():new THREE.Vector3();
}

function placeCannons(){
  [...myCannonMeshes,...enemyCannonMeshes].forEach(m=>{if(m)scene.remove(m);});
  myCannonMeshes=[];enemyCannonMeshes=[];
  myCannons.forEach((c,i)=>{
    if(!myAlive[i])return;
    const m=createCannon(false);
    const p=cellPos(gridCellsMy,c.x,c.y);
    m.position.set(p.x,0.15,p.z);
    m.userData={type:'myCannon',index:i};
    scene.add(m);myCannonMeshes[i]=m;
  });
  enemyCannons.forEach((c,i)=>{
    if(!enemyAlive[i])return;
    const m=createCannon(true);
    const p=cellPos(gridCellsEnemy,c.x,c.y);
    m.position.set(p.x,0.15,p.z);
    m.userData={type:'enemyCannon',index:i};
    scene.add(m);enemyCannonMeshes[i]=m;
  });
}

function clearHighlights(){
  [...gridCellsMy,...gridCellsEnemy].forEach(c=>{c.material.emissive=new THREE.Color(0);c.material.opacity=1;});
  myCannonMeshes.forEach(m=>{if(m)m.scale.setScalar(1);});
}
function highlightEnemyCells(){gridCellsEnemy.forEach(c=>{c.material.emissive=new THREE.Color(0x440000);});}
function highlightMyCannons(){myCannonMeshes.forEach((m,i)=>{if(m&&myAlive[i])m.scale.setScalar(1.2);});}

function spawnExplosion(pos){
  for(let i=0;i<14;i++){
    const p=new THREE.Mesh(
      new THREE.SphereGeometry(0.1+Math.random()*0.12,5,5),
      new THREE.MeshBasicMaterial({color:new THREE.Color().setHSL(0.04+Math.random()*0.1,1,0.55+Math.random()*0.3),transparent:true,opacity:1})
    );
    p.position.copy(pos).add(new THREE.Vector3(0,0.3,0));
    const a=Math.random()*Math.PI*2,sp=0.05+Math.random()*0.08;
    p.userData={vx:Math.cos(a)*sp,vy:0.07+Math.random()*0.09,vz:Math.sin(a)*sp,life:1};
    scene.add(p);explosionParticles.push(p);
  }
}
function spawnMiss(pos){
  for(let i=0;i<5;i++){
    const p=new THREE.Mesh(
      new THREE.SphereGeometry(0.06,4,4),
      new THREE.MeshBasicMaterial({color:0x8899aa,transparent:true,opacity:0.8})
    );
    p.position.copy(pos).add(new THREE.Vector3(0,0.1,0));
    const a=Math.random()*Math.PI*2;
    p.userData={vx:Math.cos(a)*0.025,vy:0.04,vz:Math.sin(a)*0.025,life:0.7};
    scene.add(p);explosionParticles.push(p);
  }
}

function animate(){
  requestAnimationFrame(animate);
  for(let i=explosionParticles.length-1;i>=0;i--){
    const p=explosionParticles[i];
    p.userData.vy-=0.004;
    p.position.x+=p.userData.vx;p.position.y+=p.userData.vy;p.position.z+=p.userData.vz;
    p.userData.life-=0.028;p.material.opacity=p.userData.life;
    if(p.userData.life<=0){scene.remove(p);explosionParticles.splice(i,1);}
  }
  const t=Date.now()*0.003;
  const pulse=0.4+Math.sin(t*2)*0.2;
  [...myCannonMeshes,...enemyCannonMeshes].forEach(m=>{if(m&&m.userData.ring)m.userData.ring.material.opacity=pulse;});
  renderer.render(scene,camera);
}

function startTimer(s){
  clearInterval(timerInterval);turnDuration=s;turnEndTime=Date.now()+s*1000;
  timerInterval=setInterval(()=>{
    const left=(turnEndTime-Date.now())/1000,pct=Math.max(0,left/turnDuration)*100;
    timerFill.style.width=pct+'%';
    timerFill.style.background=pct>40?'#4daaff':pct>20?'#ffaa00':'#ff4444';
    if(left<=0)clearInterval(timerInterval);
  },80);
}

function selectMode(m){
  if(!myTurn)return;mode=m;selectedCannonIdx=null;clearHighlights();
  if(mode==='fire'){btnFire.classList.add('active');btnMove.classList.remove('active');highlightEnemyCells();hintEl.textContent='Виберіть клітинку для пострілу';}
  else{btnMove.classList.add('active');btnFire.classList.remove('active');highlightMyCannons();hintEl.textContent='Виберіть свою гармату';}
}

function onCanvasClick(e){
  if(!myTurn||!mode)return;
  const rect=renderer.domElement.getBoundingClientRect();
  mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse,camera);
  if(mode==='fire'){
    const hits=raycaster.intersectObjects(gridCellsEnemy);
    if(hits.length>0){const c=hits[0].object;sendAction({type:'fire',x:c.userData.gridX,y:c.userData.gridZ});disableButtons();hintEl.textContent='';}
  } else {
    if(selectedCannonIdx===null){
      const objs=myCannonMeshes.filter(m=>m).flatMap(m=>[m,...m.children]);
      const hits=raycaster.intersectObjects(objs,true);
      if(hits.length>0){
        let obj=hits[0].object;while(obj.parent&&!obj.userData.type)obj=obj.parent;
        if(obj.userData.type==='myCannon'){selectedCannonIdx=obj.userData.index;clearHighlights();gridCellsMy.forEach(c=>{c.material.emissive=new THREE.Color(0x002255);});hintEl.textContent='Виберіть нову позицію';}
      }
    } else {
      const hits=raycaster.intersectObjects(gridCellsMy);
      if(hits.length>0){const c=hits[0].object;sendAction({type:'move',cannonIndex:selectedCannonIdx,x:c.userData.gridX,y:c.userData.gridZ});disableButtons();selectedCannonIdx=null;hintEl.textContent='';}
    }
  }
}

const SERVER_URL=(()=>{const p=location.protocol==='https:'?'wss:':'ws:';return `${p}//${location.host}`;})();
function findGame(){showScreen('screen-waiting');ws=new WebSocket(SERVER_URL);ws.onopen=()=>ws.send(JSON.stringify({type:'find_game'}));ws.onmessage=(e)=>handleMessage(JSON.parse(e.data));ws.onerror=()=>{alert('Помилка підключення');resetGame();};}
function sendAction(a){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'action',action:a}));}

function handleMessage(msg){
  if(msg.type==='game_start'){playerIndex=msg.playerIndex;myCannons=msg.myCannons;enemyCannons=msg.enemyCannons;myAlive=[true,true];enemyAlive=[true,true];showScreen(null);fieldLabels.style.display='flex';placeCannons();setStatus(msg.currentTurn===playerIndex?'Ваш хід':'Хід суперника');}
  if(msg.type==='turn_start'){myTurn=msg.yourTurn;mode=null;selectedCannonIdx=null;clearHighlights();startTimer(msg.timeLeft);if(myTurn){setStatus('Ваш хід!');btnFire.disabled=false;btnMove.disabled=false;hintEl.textContent='Виберіть дію';btnFire.classList.remove('active');btnMove.classList.remove('active');}else{setStatus('Хід суперника...');disableButtons();hintEl.textContent='';}}
  if(msg.type==='turn_result'){
    const action=msg.action;myCannons=msg.myCannons;enemyAlive=msg.enemyAlive;
    if(action&&action.type==='fire'){
      if(!myTurn){const pos=cellPos(gridCellsMy,action.x,action.y);if(msg.hit){spawnExplosion(pos);myAlive[msg.cannonIndex]=false;}else spawnMiss(pos);}
      else{const pos=cellPos(gridCellsEnemy,action.x,action.y);if(msg.hit){spawnExplosion(pos);enemyAlive[msg.cannonIndex]=false;}else spawnMiss(pos);}
    }
    placeCannons();myTurn=false;
  }
  if(msg.type==='game_over'){clearInterval(timerInterval);fieldLabels.style.display='none';document.getElementById('gameover-icon').textContent=msg.youWin?'🏆':'💥';document.getElementById('gameover-title').textContent=msg.youWin?'Перемога!':'Поразка';document.getElementById('gameover-sub').textContent=msg.youWin?'Ви знищили всі гармати противника!':'Ваші гармати знищено.';showScreen('screen-gameover');}
  if(msg.type==='opponent_left'){clearInterval(timerInterval);fieldLabels.style.display='none';showScreen('screen-left');}
}

function showScreen(id){['screen-menu','screen-waiting','screen-gameover','screen-left'].forEach(s=>{document.getElementById(s).style.display=s===id?'flex':'none';});}
function setStatus(t){statusEl.textContent=t;}
function disableButtons(){btnFire.disabled=true;btnMove.disabled=true;btnFire.classList.remove('active');btnMove.classList.remove('active');}
function resetGame(){
  if(ws){ws.close();ws=null;}clearInterval(timerInterval);disableButtons();
  mode=null;selectedCannonIdx=null;myTurn=false;timerFill.style.width='100%';hintEl.textContent='';fieldLabels.style.display='none';setStatus('Очікування...');
  explosionParticles.forEach(p=>scene.remove(p));explosionParticles=[];
  [...myCannonMeshes,...enemyCannonMeshes].forEach(m=>{if(m)scene.remove(m);});
  myCannonMeshes=[];enemyCannonMeshes=[];
  showScreen('screen-menu');
}
window.addEventListener('load',()=>{initThree();showScreen('screen-menu');});
