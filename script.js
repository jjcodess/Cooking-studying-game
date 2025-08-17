/* =========================
   Study Chef — core logic
   Saves to localStorage
   ========================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  xp: 0,
  coins: 0,
  streak: 0,
  bestStreak: 0,
  totalMinutes: 0,
  sessionsDone: 0,
  recipesCooked: 0,
  inventory: {}, // { ingredientName: qty }
  tasks: [],     // [{id, title, tag, done}]
  owned: {},     // shop items
  lastOpenDate: null,
  timer: {
    mode: 'idle', // idle | focus | break
    remaining: 25 * 60,
    focusLen: 25,
    breakLen: 5,
    scheme: 'pomodoro',
    tickHandle: null,
    paused: false
  },
  achievements: {}
};

const INGREDIENTS = ["Tomato","Basil","Egg","Flour","Milk","Sugar","Butter","Berry","Cocoa","Cheese","Noodle","Mushroom"];
const RECIPES = [
  { id:"pancakes",   name:"Fluffy Pancakes", needs:{Flour:2, Egg:1, Milk:1, Sugar:1}, reward:{xp:15, coins:10} },
  { id:"omelette",   name:"Garden Omelette", needs:{Egg:2, Cheese:1, Mushroom:1},     reward:{xp:18, coins:12} },
  { id:"spaghetti",  name:"Creamy Spaghetti", needs:{Noodle:2, Cheese:1, Butter:1},   reward:{xp:22, coins:14} },
  { id:"tiramisu",   name:"Baby Tiramisu",    needs:{Cocoa:1, Milk:1, Sugar:2},       reward:{xp:28, coins:18} },
  { id:"caprese",    name:"Caprese Salad",    needs:{Tomato:2, Basil:1, Cheese:1},    reward:{xp:12, coins:8} },
];
const SHOP = [
  { id:"skin-sakura",  name:"Sakura Apron", desc:"+5% coin bonus", cost:60, type:"buff", bonus:{coins:1.05} },
  { id:"skin-mint",    name:"Mint Mixer",   desc:"+5% XP bonus",   cost:60, type:"buff", bonus:{xp:1.05} },
  { id:"bg-pastel",    name:"Pastel Wallpaper", desc:"Cute pastel backdrop", cost:30, type:"cosmetic" },
  { id:"timer-quick",  name:"Quick Chef",   desc:"Focus gives +1 ingredient per 5 min", cost:80, type:"buff", bonus:{extraIngredient:true} }
];

// === Persistence ===
const SAVE_KEY = "study-chef-save-v1";
function save(){ localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
function load(){
  const s = localStorage.getItem(SAVE_KEY);
  if(!s){ initFirstOpen(); return; }
  try{
    const data = JSON.parse(s);
    Object.assign(state, data);
  }catch(e){ console.warn("Bad save; starting fresh."); initFirstOpen(); }
}
function initFirstOpen(){
  // first-time defaults
  addToast("Welcome, Chef! 🍓");
  state.lastOpenDate = todayStr();
  save();
}
function todayStr(){ return new Date().toISOString().slice(0,10); }

// === UI binds ===
const xpEl = $("#xp"), coinsEl = $("#coins"), streakEl = $("#streak");
const bestStreakEl = $("#bestStreak");
const totalMinutesEl = $("#totalMinutes");
const sessionsDoneEl = $("#sessionsDone");
const recipesCookedEl = $("#recipesCooked");
const inventoryEl = $("#inventory");
const recipesEl = $("#recipes");
const taskListEl = $("#taskList");
const timerEl = $("#timer");
const sessionStateEl = $("#sessionState");
const dotEl = $("#stateDot");
const startFocusBtn = $("#startFocus");
const pauseBtn = $("#pause");
const breakBtn = $("#breakBtn");
const focusLenSel = $("#focusLen");
const breakLenSel = $("#breakLen");
const modeSel = $("#mode");
const soundToggle = $("#soundToggle");
const resetBtn = $("#resetBtn");
const exportBtn = $("#exportBtn");
const importFile = $("#importFile");

// Sound (simple oscillator chime)
let audioCtx = null;
let soundOn = true;
soundToggle.addEventListener('click',()=>{
  soundOn = !soundOn;
  soundToggle.textContent = soundOn ? "🔈" : "🔇";
});

function ding(){
  if(!soundOn) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.6);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.6);
  }catch(e){}
}

// Toast
const toast = $("#toast");
function addToast(msg){
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(()=>toast.classList.remove("show"), 1600);
}

// Tabs
$$(".tab").forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $$(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const id = btn.dataset.tab;
    $$(".panel").forEach(p=>p.classList.remove("show"));
    if(id==="inventory") $("#inventoryPanel").classList.add("show");
    if(id==="shop") $("#shopPanel").classList.add("show");
    if(id==="achievements") $("#achievementsPanel").classList.add("show");
    if(id==="stats") $("#statsPanel").classList.add("show");
  });
});

// Timer formatting
function fmt(sec){
  const m = Math.floor(sec/60), s = sec%60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

// Ingredient generation while focusing
function grantIngredient(minutesWorked){
  // base chance: 1 guaranteed ingredient every 5 min; random bonus
  const base = Math.floor(minutesWorked / 5);
  let count = base;
  if(Math.random() < 0.25) count += 1;
  if(state.owned["timer-quick"]) count += 1;
  for(let i=0;i<count;i++){
    const ing = INGREDIENTS[Math.floor(Math.random()*INGREDIENTS.length)];
    state.inventory[ing] = (state.inventory[ing]||0)+1;
  }
}

// XP/Coins with shop buffs
function addReward({xp=0, coins=0}={}){
  const xpMul = state.owned["skin-mint"] ? 1.05 : 1;
  const coinMul = state.owned["skin-sakura"] ? 1.05 : 1;
  state.xp += Math.round(xp * xpMul);
  state.coins += Math.round(coins * coinMul);
}

// Session controls
let lastTick = null;
function startTimer(kind){
  if(kind==="focus"){
    state.timer.mode = "focus";
    state.timer.remaining = Number(focusLenSel.value)*60;
    sessionStateEl.textContent = "Focusing… your chef is cooking! 🍲";
    dotEl.className = "dot focus";
  }else{
    state.timer.mode = "break";
    state.timer.remaining = Number(breakLenSel.value)*60;
    sessionStateEl.textContent = "Break time — plate your dishes or stretch! 🍵";
    dotEl.className = "dot break";
  }
  state.timer.scheme = modeSel.value;
  state.timer.paused = false;
  clearInterval(state.timer.tickHandle);
  lastTick = Date.now();
  state.timer.tickHandle = setInterval(tick, 250);
  render();
}

function tick(){
  const now = Date.now();
  const dt = Math.floor((now - lastTick)/1000);
  if(dt>0){
    lastTick = now;
    if(!state.timer.paused && state.timer.remaining>0){
      state.timer.remaining -= dt;
      timerEl.textContent = fmt(Math.max(0, state.timer.remaining));
      // Every full minute passed while focusing: rewards + ingredient drip
      if(state.timer.mode==="focus"){
        state.totalMinutes += dt/60; // fractional; rounded in render
      }
      // End condition
      if(state.timer.remaining<=0){
        clearInterval(state.timer.tickHandle);
        onTimerEnd();
      }
    }
  }
}

function onTimerEnd(){
  if(state.timer.mode==="focus"){
    // grant minute-based rewards
    const minutes = Number(focusLenSel.value);
    addReward({ xp: minutes, coins: Math.round(minutes/3) });
    grantIngredient(minutes);
    state.sessionsDone += 1;
    bumpStreak();
    addToast(`Focus done! +${minutes} XP, +${Math.round(minutes/3)} coins, ingredients added 🧺`);
    ding();
    // auto-start break if Pomodoro
    if(state.timer.scheme==="pomodoro"){
      startTimer("break");
      return;
    }else{
      setIdle();
    }
  }else{
    addToast("Break finished — ready to cook up more focus! 🔥");
    ding();
    if(state.timer.scheme==="pomodoro"){
      startTimer("focus");
      return;
    }else{
      setIdle();
    }
  }
  render();
}

function setIdle(){
  state.timer.mode = "idle";
  dotEl.className = "dot idle";
  sessionStateEl.textContent = "Idle — set a timer and cook up some focus!";
}

startFocusBtn.addEventListener('click', ()=> startTimer("focus"));
breakBtn.addEventListener('click', ()=> startTimer("break"));
pauseBtn.addEventListener('click', ()=>{
  state.timer.paused = !state.timer.paused;
  pauseBtn.textContent = state.timer.paused ? "▶️ Resume" : "⏸ Pause";
});

focusLenSel.addEventListener('change', ()=> {
  if(state.timer.mode==="idle") { timerEl.textContent = fmt(Number(focusLenSel.value)*60); }
});
breakLenSel.addEventListener('change', ()=> { if(state.timer.mode==="idle"){ /* noop */ }});

// Streaks
function bumpStreak(){
  const today = todayStr();
  if(state.lastOpenDate !== today){
    // If lastOpen was yesterday, continue; else reset
    const last = state.lastOpenDate ? new Date(state.lastOpenDate) : null;
    const y = new Date(); y.setDate(y.getDate()-1);
    if(last && last.toISOString().slice(0,10) === y.toISOString().slice(0,10)){
      state.streak += 1;
    }else{
      state.streak = 1;
    }
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.lastOpenDate = today;
  }else{
    // same day session — keep streak but update lastOpenDate
    state.lastOpenDate = today;
  }
}

// Tasks
$("#addTask").addEventListener('click', ()=>{
  const title = $("#taskTitle").value.trim();
  if(!title) return;
  const tag = $("#taskTag").value;
  state.tasks.push({ id:crypto.randomUUID(), title, tag, done:false });
  $("#taskTitle").value = "";
  renderTasks();
  save();
});

function toggleTask(id){
  const t = state.tasks.find(t=>t.id===id);
  if(!t) return;
  t.done = !t.done;
  // small reward for finishing
  if(t.done) addReward({xp:5, coins:3});
  renderTasks();
  renderStats();
  save();
}
function delTask(id){
  state.tasks = state.tasks.filter(t=>t.id!==id);
  renderTasks(); save();
}

function renderTasks(){
  taskListEl.innerHTML = "";
  state.tasks.forEach(t=>{
    const li = document.createElement("li");
    li.className = "task";
    li.innerHTML = `
      <input type="checkbox" ${t.done?"checked":""} aria-label="Done">
      <div class="title ${t.done?"done":""}">${escapeHtml(t.title)}</div>
      <div class="tag">${t.tag}</div>
      <button class="del">🗑</button>
    `;
    const [chk,, , del] = li.children;
    chk.addEventListener('change', ()=> toggleTask(t.id));
    del.addEventListener('click', ()=> delTask(t.id));
    taskListEl.appendChild(li);
  });
}

// Inventory
function renderInventory(){
  inventoryEl.innerHTML = "";
  const names = Object.keys(state.inventory).sort();
  if(names.length===0){
    inventoryEl.innerHTML = `<li class="tiny">No ingredients yet — start a focus session to simmer some! 🍅</li>`;
    return;
  }
  names.forEach(name=>{
    const qty = state.inventory[name];
    const li = document.createElement("li");
    li.textContent = `${name} × ${qty}`;
    inventoryEl.appendChild(li);
  });
}

// Recipes
function renderRecipes(){
  recipesEl.innerHTML = "";
  RECIPES.forEach(r=>{
    const canCook = Object.entries(r.needs).every(([k,v]) => (state.inventory[k]||0) >= v);
    const wrap = document.createElement("div");
    wrap.className = "recipe";
    wrap.innerHTML = `
      <h3>${r.name}</h3>
      <small>Needs: ${Object.entries(r.needs).map(([k,v])=>`${k}×${v}`).join(", ")}</small>
      <div><small>Reward: ⭐ ${r.reward.xp} · 🪙 ${r.reward.coins}</small></div>
      <button class="cook ${canCook?"primary":"ghost"}" ${canCook?"":"disabled"}>Cook</button>
    `;
    wrap.querySelector(".cook").addEventListener('click', ()=>{
      if(!canCook) return;
      // consume
      Object.entries(r.needs).forEach(([k,v])=>{
        state.inventory[k] -= v;
      });
      addReward(r.reward);
      state.recipesCooked += 1;
      addToast(`Cooked ${r.name}! ⭐+${r.reward.xp} 🪙+${r.reward.coins}`);
      renderInventory(); renderHeader(); renderStats();
      save();
    });
    recipesEl.appendChild(wrap);
  });
}

// Shop
function renderShop(){
  const cont = $("#shopItems");
  cont.innerHTML = "";
  SHOP.forEach(it=>{
    const owned = !!state.owned[it.id];
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = `
      <h4>${it.name}</h4>
      <div class="tiny">${it.desc}</div>
      <div>Cost: 🪙 ${it.cost}</div>
      <button class="buy ${owned?'ghost':''}" ${owned?'disabled':''}>${owned?'Owned':'Buy'}</button>
    `;
    card.querySelector(".buy").addEventListener('click', ()=>{
      if(owned) return;
      if(state.coins < it.cost){ addToast("Not enough coins!"); return; }
      state.coins -= it.cost;
      state.owned[it.id] = true;
      addToast(`Purchased ${it.name}!`);
      // apply cosmetics
      if(it.id==="bg-pastel") document.body.style.background = `
        radial-gradient(1200px 600px at -10% -10%, var(--pastel-1), transparent 60%),
        radial-gradient(900px 500px at 110% -20%, var(--pastel-4), transparent 60%),
        linear-gradient(180deg, var(--bg), var(--bg))`;
      renderHeader(); renderShop(); save();
    });
    cont.appendChild(card);
  });
}

// Achievements (simple examples)
const ACH_LIST = [
  {id:"first-session", name:"First Boil", cond: s=>s.sessionsDone>=1, desc:"Complete your first focus session"},
  {id:"fifth-session", name:"Rapid Chef", cond: s=>s.sessionsDone>=5, desc:"Complete 5 focus sessions"},
  {id:"ten-recipes",   name:"Sous‑Chef",  cond: s=>s.recipesCooked>=10, desc:"Cook 10 recipes"},
  {id:"100-mins",      name:"Simmer Pro", cond: s=>s.totalMinutes>=100, desc:"Reach 100 total minutes"},
];
function renderAchievements(){
  const ul = $("#achievements"); ul.innerHTML = "";
  ACH_LIST.forEach(a=>{
    const earned = a.cond(state);
    state.achievements[a.id] = !!state.achievements[a.id] || earned;
    const li = document.createElement("li");
    li.innerHTML = `<strong>${a.name}</strong> — ${a.desc} ${earned?"✅":""}`;
    ul.appendChild(li);
  });
}

// Stats
function renderStats(){
  totalMinutesEl.textContent = Math.floor(state.totalMinutes);
  sessionsDoneEl.textContent = state.sessionsDone;
  bestStreakEl.textContent = state.bestStreak;
  recipesCookedEl.textContent = state.recipesCooked;
}

// Header
function renderHeader(){
  xpEl.textContent = state.xp;
  coinsEl.textContent = state.coins;
  streakEl.textContent = state.streak;
}

// Export/Import
exportBtn.addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "study-chef-save.json";
  a.click();
});

importFile.addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const text = await file.text();
  try{
    const data = JSON.parse(text);
    Object.assign(state, data);
    addToast("Save imported! ✅");
    renderAll(); save();
  }catch(err){ addToast("Import failed ❌"); }
});

// Reset
resetBtn.addEventListener('click', ()=>{
  if(confirm("Reset your save? This cannot be undone.")){
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
});

// Security helper
function escapeHtml(str){
  return str.replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[m]));
}

// Init
function renderAll(){
  renderHeader();
  renderInventory();
  renderTasks();
  renderRecipes();
  renderShop();
  renderAchievements();
  renderStats();
  // Timer face
  if(state.timer.mode==="idle"){
    timerEl.textContent = fmt(Number(focusLenSel.value)*60);
  }
}

function dailyCheck(){
  const t = todayStr();
  if(state.lastOpenDate !== t){
    // open app on new day -> maintain streak only if yesterday had activity
    // (we set streak on session completion; here we just ensure lastOpenDate updates)
    state.lastOpenDate = t;
  }
}

load();
dailyCheck();
renderAll();
setIdle();
save();

// Persist periodically
setInterval(save, 5000);

// Accessibility: keyboard shortcuts
document.addEventListener('keydown', (e)=>{
  if(e.key.toLowerCase()==='s') startTimer("focus");
  if(e.key.toLowerCase()==='b') startTimer("break");
  if(e.key.toLowerCase()==='p') pauseBtn.click();
});
