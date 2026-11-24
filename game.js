"use strict";
// Rattletrap: a physics driving game.
//
// A little truck drives over endless hills. Hold Gas to go, Brake to slow down or reverse.
// In the air, Gas tips the truck back and Brake tips it forward. Grab coins and fuel cans, flip
// for bonus coins, and don't land on the driver's head. Coins buy upgrades in the garage, and
// upgrades take you further. The physics (wheels, springs, gravity) is done by planck.js, a
// JavaScript copy of the Box2D engine; this file builds the world and draws it.
//
// This file has 9 parts:
//   1. Settings and the platform (web, or a game portal)
//   2. Saving, and the garage upgrades
//   3. The road: hills, coins, fuel cans, scenery
//   4. The physics world: the ground and the truck
//   5. Driving: pedals, fuel, pickups, flips, the end of a run
//   6. Drawing: sky, hills, road, truck, effects
//   7. Screens: menu, garage, pause, result, and the bar at the top
//   8. Sound
//   9. Start

// ---------------------------------------------------------------------------------------------
// 1. Settings and the platform
// ---------------------------------------------------------------------------------------------

const pl = window.planck;
const Vec2 = pl.Vec2;
const STEP = 1 / 60;            // the physics moves forward in steps of 1/60 of a second
const CHUNK = 40;               // the ground is built in 40-metre pieces, just ahead of the truck
const SAVE_KEY = "rattletrap.v1";

// A game portal can replace these by setting window.GAME_PLATFORM before this file loads.
const platform = Object.assign({
  name: "web",
  storage: () => window.localStorage,
  gameplayStart() {},             // a run starts (or resumes)
  gameplayStop() {},              // a run ends (or pauses)
  happytime() {},                 // something great just happened
  breakAd(done, pauseAudio) { done(); }, // between runs; call done() when it's over
  muted: () => false,
}, window.GAME_PLATFORM || {});

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------
// 2. Saving, and the garage upgrades
// ---------------------------------------------------------------------------------------------

let store = null;
try { store = platform.storage(); } catch (error) { store = null; }

const save = load();
function load() {
  const fresh = { coins: 0, best: 0, runs: 0, sound: true, levels: { engine: 0, suspension: 0, tires: 0, fuel: 0 } };
  try {
    const saved = JSON.parse(store.getItem(SAVE_KEY));
    if (saved && typeof saved === "object") {
      return Object.assign(fresh, saved, { levels: Object.assign(fresh.levels, saved.levels) });
    }
  } catch (error) { /* first time, or storage is blocked */ }
  return fresh;
}
function persist() {
  try { store.setItem(SAVE_KEY, JSON.stringify(save)); } catch (error) { /* private mode */ }
}

const MAX_LEVEL = 10;
const UPGRADES = [
  { id: "engine", name: "Engine", icon: "i-engine", base: 150, about: "More power for steep hills, and a higher top speed" },
  { id: "suspension", name: "Suspension", icon: "i-spring", base: 110, about: "Softer landings, and the truck stays steadier on bumps" },
  { id: "tires", name: "Tyres", icon: "i-tire", base: 110, about: "More grip, so the wheels don't spin on slopes" },
  { id: "fuel", name: "Fuel tank", icon: "i-fuel", base: 90, about: "A bigger tank: drive further between fuel cans" },
];

const upgradeCost = (upgrade, level) => Math.round((upgrade.base * Math.pow(1.6, level)) / 10) * 10;

// What the levels mean for the truck.
function truckStats() {
  const L = save.levels;
  return {
    torque: 7 * (1 + 0.16 * L.engine),           // how hard the wheels can push (newton-metres)
    speed: 24 + 2.4 * L.engine,                   // top wheel speed (radians per second)
    springHz: 3.4 + 0.22 * L.suspension,          // how stiff the springs are
    damping: 0.42 + 0.045 * L.suspension,         // how quickly bounces die down
    grip: 0.8 + 0.12 * L.tires,                   // tyre friction
    tank: 16 + 5 * L.fuel,                        // seconds of full throttle on a full tank
    tilt: 5.5,                                    // how hard Gas/Brake turn the truck in the air
  };
}

// ---------------------------------------------------------------------------------------------
// 3. The road
// ---------------------------------------------------------------------------------------------
// The hills are the same on every run, so you learn them and your best distance means something.
// heights[i] is the ground height (in metres) at x = i metres. It's made a bit at a time, ahead
// of the truck, from smooth random "noise" that gets wilder the further you go.

// A random number between 0 and 1 for any whole number: always the same for the same number.
function hash01(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth noise: random values at whole numbers, blended smoothly in between.
function noise(x, salt) {
  const i = Math.floor(x);
  const t = x - i;
  const a = hash01(i * 7919 + salt * 104729);
  const b = hash01((i + 1) * 7919 + salt * 104729);
  return lerp(a, b, t * t * (3 - 2 * t));
}

function targetHeight(x) {
  const wild = 4 + Math.min(x / 90, 16);                  // hills grow with distance
  const easeIn = smoothstep(12, 70, x);                    // a flat start
  const big = (noise(x / 32, 1) - 0.5) * 2 * wild;
  const medium = (noise(x / 11, 2) - 0.5) * wild * 0.6;
  const bumps = (noise(x / 4.5, 3) - 0.5) * Math.min(1.3, x / 700);
  return (big + medium + bumps) * easeIn + x * 0.03;       // and the road climbs slowly overall
}

const road = {
  heights: [],
  coins: [],         // { x, y, value, taken }
  cans: [],          // { x, y, taken }
  decor: [],         // { x, kind, size }
  nextCoins: 45,
  nextCan: 130,
  canCount: 0,
  nextDecor: 6,
};

// Makes sure the road exists up to x metres.
function buildRoad(toX) {
  const h = road.heights;
  while (h.length <= toX + 2) {
    const x = h.length;
    if (x === 0) { h.push(0); continue; }
    const steep = 0.5 + Math.min(x / 3000, 0.45);           // the steepest rise per metre
    h.push(clamp(targetHeight(x), h[x - 1] - steep, h[x - 1] + steep));
  }
  // Coins come in rows that follow the ground. Each row is worth more the further out it is.
  while (road.nextCoins < h.length - 20) {
    const start = road.nextCoins;
    const n = 5 + Math.floor(hash01(start * 13) * 6);
    const value = start < 600 ? 5 : start < 1500 ? 10 : start < 3000 ? 25 : 50;
    const nearCan = road.cans.some((can) => Math.abs(can.x - start) < 18) || Math.abs(road.nextCan - start) < 18;
    if (!nearCan) {
      for (let k = 0; k < n; k++) {
        const x = start + k * 1.1;
        road.coins.push({ x, y: groundAt(x) + 1.05, value, taken: false });
      }
    }
    road.nextCoins += 40 + hash01(start * 31) * 55;
  }
  // Fuel cans: further and further apart.
  while (road.nextCan < h.length - 20) {
    road.cans.push({ x: road.nextCan, y: groundAt(road.nextCan) + 0.9, taken: false });
    road.canCount++;
    road.nextCan += Math.min(150 + road.canCount * 30, 450);
  }
  // Scenery: trees, rocks and so on (what kind depends on the land, see LANDS in part 6).
  while (road.nextDecor < h.length - 4) {
    road.decor.push({ x: road.nextDecor, pick: hash01(road.nextDecor * 97), size: 0.8 + hash01(road.nextDecor * 53) * 0.6 });
    road.nextDecor += 7 + hash01(road.nextDecor * 71) * 18;
  }
}

// The ground height at any x (between two points, it's a straight line).
function groundAt(x) {
  if (x <= 0) return road.heights[0] || 0;
  const i = Math.floor(x);
  if (i + 1 >= road.heights.length) buildRoad(i + 1);
  return lerp(road.heights[i], road.heights[i + 1], x - i);
}

// ---------------------------------------------------------------------------------------------
// 4. The physics world
// ---------------------------------------------------------------------------------------------
// y points up here (like in maths), and lengths are in metres. The truck is about 2.8 m long.

let world = null;
let truck = null;    // { body, back, front, backJoint, frontJoint }
let chunks = new Map();
const contacts = { wheels: 0, head: false };

// The truck's outline (its lower body), the driver's head, and where the wheels go.
const BODY_SHAPE = [[-1.38, -0.2], [1.34, -0.2], [1.44, 0.04], [1.3, 0.24], [0.5, 0.32], [-0.62, 0.32], [-0.7, 0.18], [-1.36, 0.18]];
const HEAD = { x: -0.18, y: 0.98, r: 0.24 };
const WHEEL_R = 0.43;
const WHEEL_AT = [[-0.98, -0.42], [0.98, -0.42]];

function makeWorld() {
  world = new pl.World({ gravity: Vec2(0, -10) });
  chunks = new Map();
  contacts.wheels = 0;
  contacts.head = false;

  // A wall behind the start, so you can't reverse off the edge of the world.
  buildRoad(200);
  const wall = world.createBody();
  wall.createFixture(pl.Edge(Vec2(-8, -50), Vec2(-8, 80)), { friction: 0.5, userData: "ground" });
  const flat = world.createBody();
  flat.createFixture(pl.Edge(Vec2(-8, road.heights[0]), Vec2(0, road.heights[0])), { friction: 0.9, userData: "ground" });

  const stats = truckStats();
  const start = Vec2(1.5, groundAt(1.5) + 1.0);
  const body = world.createDynamicBody({ position: start, angularDamping: 0.6 });
  body.createFixture(pl.Polygon(BODY_SHAPE.map(([x, y]) => Vec2(x, y))), { density: 1.7, friction: 0.5, userData: "body" });
  body.createFixture(pl.Circle(Vec2(HEAD.x, HEAD.y), HEAD.r), { density: 0.4, friction: 0.5, userData: "head" });

  const wheels = WHEEL_AT.map(([x, y]) => {
    const wheel = world.createDynamicBody({ position: Vec2(start.x + x, start.y + y) });
    wheel.createFixture(pl.Circle(WHEEL_R), { density: 1.6, friction: stats.grip, userData: "wheel" });
    return wheel;
  });
  const joints = wheels.map((wheel) => world.createJoint(pl.WheelJoint({
    enableMotor: true,
    motorSpeed: 0,
    maxMotorTorque: stats.torque,
    frequencyHz: stats.springHz,
    dampingRatio: stats.damping,
  }, body, wheel, wheel.getPosition(), Vec2(0, 1))));
  truck = { body, back: wheels[0], front: wheels[1], backJoint: joints[0], frontJoint: joints[1] };

  // Keep count of which parts touch the ground.
  const isGround = (fixture) => fixture.getUserData() === "ground";
  const watch = (contact, delta) => {
    const a = contact.getFixtureA();
    const b = contact.getFixtureB();
    const other = isGround(a) ? b : isGround(b) ? a : null;
    if (!other) return;
    if (other.getUserData() === "wheel") contacts.wheels = Math.max(0, contacts.wheels + delta);
    if (other.getUserData() === "head" && delta > 0) contacts.head = true;
  };
  world.on("begin-contact", (contact) => watch(contact, 1));
  world.on("end-contact", (contact) => watch(contact, -1));
  updateGround();
}

// Builds the ground pieces near the truck and removes the ones far behind it.
function updateGround() {
  const x = truck.body.getPosition().x;
  const first = Math.max(0, Math.floor((x - 50) / CHUNK));
  const last = Math.floor((x + 90) / CHUNK);
  buildRoad((last + 1) * CHUNK + 2);
  for (let k = first; k <= last; k++) {
    if (chunks.has(k)) continue;
    const points = [];
    for (let i = k * CHUNK; i <= (k + 1) * CHUNK; i++) points.push(Vec2(i, road.heights[i]));
    const ground = world.createBody();
    const chain = pl.Chain(points, false);
    // Tell each piece about its neighbours' points, so wheels roll smoothly over the joins.
    if (chain.setPrevVertex && k > 0) chain.setPrevVertex(Vec2(k * CHUNK - 1, road.heights[k * CHUNK - 1]));
    if (chain.setNextVertex) chain.setNextVertex(Vec2((k + 1) * CHUNK + 1, road.heights[(k + 1) * CHUNK + 1]));
    ground.createFixture(chain, { friction: 0.9, userData: "ground" });
    chunks.set(k, ground);
  }
  for (const [k, ground] of chunks) {
    if (k < first - 1) {
      world.destroyBody(ground);
      chunks.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Driving
// ---------------------------------------------------------------------------------------------

const input = { gas: false, brake: false };
let screen = "menu";
let run = null;
let particles = [];
let popups = [];
let shake = 0;

function newRun() {
  for (const item of road.coins) item.taken = false; // the road is the same every run
  for (const item of road.cans) item.taken = false;
  makeWorld();
  const stats = truckStats();
  run = {
    stats,
    time: 0,
    fuel: stats.tank,
    distance: 0,
    coins: 0,          // picked up from the road
    flipCoins: 0,      // from flips
    airCoins: 0,       // from big jumps
    flips: 0,
    bestAir: 0,
    spin: 0,           // how far the truck has turned in this jump
    lastAngle: truck.body.getAngle(),
    airTime: 0,
    stopped: 0,        // seconds spent stopped with an empty tank
    ending: 0,         // seconds since the crash or empty tank
    reason: null,      // "crash" | "fuel"
    over: false,
    milestone: 500,
    passedBest: save.best < 50,
  };
  particles = [];
  popups = [];
  camera.x = truck.body.getPosition().x;
  camera.y = truck.body.getPosition().y;
}

// One physics step (1/60 s).
function update(dt) {
  if (!run) return;
  run.time += dt;
  const { body, backJoint, frontJoint } = truck;
  const stats = run.stats;
  const speed = body.getLinearVelocity().x;
  const driving = screen === "drive" && !run.reason;
  const hasFuel = run.fuel > 0;
  const airborne = contacts.wheels === 0;

  // The pedals.
  const gas = driving && hasFuel && input.gas && !input.brake;
  const brake = driving && hasFuel && input.brake && !input.gas;
  for (const joint of [backJoint, frontJoint]) {
    if (gas) {
      joint.enableMotor(true);
      joint.setMotorSpeed(-stats.speed);          // minus = clockwise = forwards
      joint.setMaxMotorTorque(stats.torque);
    } else if (brake) {
      joint.enableMotor(true);
      joint.setMotorSpeed(speed > 1 ? 0 : stats.speed * 0.45); // brake, then reverse
      joint.setMaxMotorTorque(stats.torque * 1.4);
    } else {
      joint.enableMotor(true);                     // rolling freely, with a little drag
      joint.setMotorSpeed(0);
      joint.setMaxMotorTorque(0.35);
    }
  }
  // Gas tips the truck back, Brake tips it forward (a lot in the air, a little on the ground).
  if (gas || brake) body.applyTorque((gas ? 1 : -1) * stats.tilt * (airborne ? 1 : 0.3), true);

  world.step(dt, 8, 3);
  updateGround();

  // Fuel burns faster with your foot down.
  if (driving) run.fuel = Math.max(0, run.fuel - dt * (gas ? 1 : 0.3));

  const pos = body.getPosition();
  run.distance = Math.max(run.distance, pos.x - 1.5);

  // Coins and fuel cans: picked up when any part of the truck comes close.
  const parts = [pos, truck.back.getPosition(), truck.front.getPosition(), body.getWorldPoint(Vec2(HEAD.x, HEAD.y))];
  const near = (item, reach) => parts.some((p) => Math.hypot(p.x - item.x, p.y - item.y) < reach);
  if (!run.reason) {
    for (const coin of road.coins) {
      if (coin.taken || Math.abs(coin.x - pos.x) > 4) continue;
      if (near(coin, 0.85)) {
        coin.taken = true;
        run.coins += coin.value;
        burst(coin.x, coin.y, "#ffc83d", 6);
        play("star", { volume: 0.35, rate: 1 + Math.min(coin.value, 50) / 100 });
        bumpCoins();
      }
    }
    for (const can of road.cans) {
      if (can.taken || Math.abs(can.x - pos.x) > 4) continue;
      if (near(can, 1.0)) {
        can.taken = true;
        run.fuel = stats.tank;
        popup("Fuel!", "#2ebf7a");
        burst(can.x, can.y, "#2ebf7a", 10);
        play("mission", { volume: 0.5 });
      }
    }
  }

  // Jumps and flips. While both wheels are off the ground, add up how far the truck turns.
  const angle = body.getAngle();
  if (airborne && !run.reason) {
    run.airTime += dt;
    run.spin += angle - run.lastAngle;
    if (Math.abs(run.spin) >= Math.PI * 2 - 0.35) {
      run.spin -= Math.sign(run.spin) * Math.PI * 2;
      run.flips++;
      const reward = 50 + 25 * Math.min(run.flips - 1, 6);
      run.flipCoins += reward;
      popup(`${run.spin > 0 ? "Front" : "Back"} flip! +${reward}`, "#ff6b3d");
      play("best", { volume: 0.5 });
      platform.happytime();
      bumpCoins();
    }
  } else if (!airborne) {
    if (run.airTime >= 1.2 && !run.reason) {
      const reward = Math.round(run.airTime * 12);
      run.airCoins += reward;
      run.bestAir = Math.max(run.bestAir, run.airTime);
      popup(`Air time ${run.airTime.toFixed(1)} s +${reward}`, "#3d9df5");
      bumpCoins();
    }
    run.airTime = 0;
    run.spin = 0;
  }
  run.lastAngle = angle;

  // Milestones, and passing your best.
  if (run.distance >= run.milestone) {
    popup(`${run.milestone} m!`, "#23263a");
    run.milestone += 500;
  }
  if (!run.passedBest && run.distance > save.best) {
    run.passedBest = true;
    popup("New best!", "#ff6b3d");
    play("fanfare", { volume: 0.5 });
  }

  // Dust from spinning wheels, smoke from the exhaust.
  for (const wheel of [truck.back, truck.front]) {
    const p = wheel.getPosition();
    const spinSpeed = Math.abs(wheel.getAngularVelocity());
    if (spinSpeed > 8 && groundAt(p.x) > p.y - WHEEL_R - 0.15 && Math.random() < 0.12) {
      particles.push({ x: p.x - 0.3, y: p.y - WHEEL_R + 0.1, vx: -1 - Math.random() * 2 + speed * 0.3, vy: 1 + Math.random() * 1.5, life: 0.6, age: 0, size: 0.07 + Math.random() * 0.1, colour: "dust" });
    }
  }
  if (gas && Math.random() < 0.15) {
    const p = body.getWorldPoint(Vec2(-1.42, -0.05));
    particles.push({ x: p.x, y: p.y, vx: -1.5 + speed * 0.5, vy: 0.6 + Math.random() * 0.5, life: 0.6, age: 0, size: 0.12 + Math.random() * 0.1, colour: "smoke" });
  }

  // The end of a run: the driver's head touched the ground, or the tank is empty and the
  // truck has stopped.
  if (!run.reason && contacts.head) {
    run.reason = "crash";
    shake = 0.5;
    play("crash", { volume: 0.7 });
    const head = body.getWorldPoint(Vec2(HEAD.x, HEAD.y));
    burst(head.x, head.y, "#ffffff", 14);
  }
  if (!run.reason && !hasFuel) {
    run.stopped = Math.abs(speed) < 0.3 ? run.stopped + dt : 0;
    if (run.stopped > 1.5) run.reason = "fuel";
  }
  if (run.reason && !run.over) {
    run.ending += dt;
    if (run.ending > (run.reason === "crash" ? 1.6 : 0.4)) endRun();
  }
}

function endRun() {
  run.over = true;
  const earned = run.coins + run.flipCoins + run.airCoins;
  const meters = Math.floor(run.distance);
  const newBest = meters > save.best;
  const oldBest = save.best;
  save.coins += earned;
  save.best = Math.max(save.best, meters);
  save.runs++;
  persist();
  platform.gameplayStop();
  input.gas = input.brake = false;
  showResult(earned, meters, newBest, oldBest);
}

function popup(text, colour) {
  popups.push({ text, colour, age: 0 });
}

function burst(x, y, colour, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1.5 + Math.random() * 3;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1.5, life: 0.6, age: 0, size: 0.1 + Math.random() * 0.1, colour });
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Drawing
// ---------------------------------------------------------------------------------------------

const canvas = $("stage");
const ctx = canvas.getContext("2d");
const view = { w: 0, h: 0, dpr: 1, scale: 30 };
const camera = { x: 0, y: 0, zoom: 1, anchor: 0.36, anchorY: 0.56 }; // anchors: where the truck sits on screen

// The lands you drive through, every 1000 m, round and round. Colours blend near the borders.
const LANDS = [
  { name: "Meadow", skyTop: "#5fb8f0", skyBottom: "#d6f0ff", far: "#a9d9a4", near: "#80c47d", grass: "#5bbb4b", grassDark: "#3f9a37", dirt: "#9a6440", dirtDeep: "#6d4329", pebble: "#7d5236", decor: ["tree", "tree", "bush", "rock"] },
  { name: "Canyon", skyTop: "#f29a5b", skyBottom: "#ffe3bd", far: "#e6ab84", near: "#cf8459", grass: "#e0b06a", grassDark: "#c48f4a", dirt: "#b25f35", dirtDeep: "#7f3c1f", pebble: "#96492a", decor: ["cactus", "cactus", "rock", "rock"] },
  { name: "Snowfield", skyTop: "#7fa9d8", skyBottom: "#eef5fc", far: "#cddbeb", near: "#a9c1dc", grass: "#f5f9ff", grassDark: "#c9d8ea", dirt: "#738399", dirtDeep: "#4f5d72", pebble: "#5e6d82", decor: ["pine", "pine", "pine", "rock"] },
  { name: "Night road", skyTop: "#151a45", skyBottom: "#4d4488", far: "#3b3a78", near: "#2b2b5e", grass: "#4cc38a", grassDark: "#2f8c62", dirt: "#3d3155", dirtDeep: "#271f3a", pebble: "#4b3d66", decor: ["lamp", "pine", "rock", "bush"] },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixColour(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(",")})`;
}
function landAt(x) {
  const index = Math.floor(Math.max(0, x) / 1000);
  return { land: LANDS[index % LANDS.length], next: LANDS[(index + 1) % LANDS.length], t: smoothstep(880, 1000, Math.max(0, x) % 1000) };
}
function colourAt(x, key) {
  const { land, next, t } = landAt(x);
  return t <= 0 ? land[key] : mixColour(land[key], next[key], t);
}

function layout() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = innerWidth;
  view.h = innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  // Show about 30 m across on a wide screen, and at least 13 m top to bottom on a tall one.
  view.scale = Math.min(Math.max(view.w, view.h) / 30, view.h / 13);
}

// World (metres, y up) to screen (pixels, y down).
function toScreen(x, y) {
  const s = view.scale * camera.zoom;
  return { x: view.w * camera.anchor + (x - camera.x) * s, y: view.h * camera.anchorY - (y - camera.y) * s };
}

function updateCamera(dt) {
  if (!truck) return;
  const p = truck.body.getPosition();
  const v = truck.body.getLinearVelocity();
  const k = 1 - Math.pow(0.002, dt);
  camera.x = lerp(camera.x, p.x + clamp(v.x * 0.25, -3, 5), k);
  camera.y = lerp(camera.y, p.y + 0.5, 1 - Math.pow(0.02, dt));
  camera.zoom = lerp(camera.zoom, 1 - clamp(Math.abs(v.x) / 60, 0, 0.18), k * 0.3);
  const menuLike = screen === "menu" || screen === "garage";
  const wide = view.w > view.h * 1.1;
  camera.anchor = lerp(camera.anchor, menuLike ? (wide ? 0.17 : 0.5) : 0.36, 1 - Math.pow(0.01, dt));
  camera.anchorY = lerp(camera.anchorY, menuLike && !wide ? 0.3 : 0.56, 1 - Math.pow(0.01, dt));
}

function draw(now) {
  const { w, h } = view;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 18, (Math.random() - 0.5) * shake * 18);
  const s = view.scale * camera.zoom;
  const x0 = camera.x - (w * camera.anchor) / s - 1;
  const x1 = camera.x + (w * (1 - camera.anchor)) / s + 1;

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, colourAt(camera.x, "skyTop"));
  sky.addColorStop(1, colourAt(camera.x, "skyBottom"));
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, w + 40, h + 40);

  const { land } = landAt(camera.x);
  const night = land.name === "Night road";
  if (night) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let k = 0; k < 60; k++) {
      const sx = ((hash01(k * 3) * (w + 200) - camera.x * 2) % (w + 200) + w + 200) % (w + 200) - 100;
      ctx.fillRect(sx, hash01(k * 5) * h * 0.55, 2, 2);
    }
  }
  // the sun (or the moon)
  ctx.fillStyle = night ? "#f4f1d0" : "rgba(255, 244, 196, 0.95)";
  ctx.beginPath();
  ctx.arc(w * 0.8, h * 0.18, Math.min(w, h) * 0.06, 0, Math.PI * 2);
  ctx.fill();
  // clouds
  if (!night) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let k = 0; k < 6; k++) {
      const span = w + 300;
      const cx = (((hash01(k * 11) * span - camera.x * s * 0.06) % span) + span) % span - 150;
      const cy = h * (0.08 + hash01(k * 13) * 0.3);
      const r = 18 + hash01(k * 17) * 22;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.9, cy + r * 0.25, r * 0.75, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.9, cy + r * 0.3, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // two rows of faraway hills, moving slower than the road (that's what makes it look deep)
  drawHills(0.15, h * 0.58, h * 0.22, colourAt(camera.x, "far"), 5);
  drawHills(0.35, h * 0.7, h * 0.18, colourAt(camera.x, "near"), 6);

  // scenery behind the road
  for (const item of road.decor) {
    if (item.x < x0 - 3 || item.x > x1 + 3) continue;
    drawDecor(item, s);
  }

  drawGround(x0, x1, s);

  // distance signs every 100 m, and a flag at your best
  for (let m = Math.ceil(x0 / 100) * 100; m <= x1; m += 100) {
    if (m > 0) drawSign(m + 1.5, `${m} m`, "#ffffff", s);
  }
  if (save.best > 20 && save.best + 1.5 > x0 && save.best + 1.5 < x1) drawFlag(save.best + 1.5, s);

  // fuel cans and coins
  for (const can of road.cans) {
    if (!can.taken && can.x > x0 && can.x < x1) drawCan(can, s, now);
  }
  for (const coin of road.coins) {
    if (!coin.taken && coin.x > x0 && coin.x < x1) drawCoin(coin, s, now);
  }

  if (truck) drawTruck(s);

  // dust, smoke and sparkles
  for (const p of particles) {
    const q = toScreen(p.x, p.y);
    const k = p.age / p.life;
    ctx.globalAlpha = (1 - k) * (p.colour === "dust" ? 0.7 : 1);
    ctx.fillStyle = p.colour === "dust" ? colourAt(p.x, "dirt") : p.colour === "smoke" ? "rgba(90,90,100,0.6)" : p.colour;
    ctx.beginPath();
    ctx.arc(q.x, q.y, p.size * s * (p.colour === "smoke" ? 1 + k * 2 : 1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // words that float up from the truck
  if (truck) {
    const p = toScreen(truck.body.getPosition().x, truck.body.getPosition().y);
    popups.forEach((item, k) => {
      const t = item.age / 1.4;
      ctx.globalAlpha = 1 - smoothstep(0.65, 1, t);
      ctx.font = `900 ${Math.round(clamp(s * 0.75, 18, 30) * (1 + 0.25 * (1 - smoothstep(0, 0.12, t))))}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      const y = p.y - s * 2.6 - t * s * 1.6 - k * s * 0.9;
      ctx.strokeText(item.text, p.x, y);
      ctx.fillStyle = item.colour;
      ctx.fillText(item.text, p.x, y);
    });
    ctx.globalAlpha = 1;
  }
}

function drawHills(parallax, base, height, colour, salt) {
  const { w, h } = view;
  const s = view.scale * camera.zoom;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const shiftY = clamp(camera.y * s * parallax * 0.4, -h * 0.2, h * 0.2);
  for (let sx = 0; sx <= w + 8; sx += 8) {
    const wx = camera.x * parallax + sx / s;
    const y = base + shiftY - (noise(wx / 18, salt) * 0.75 + noise(wx / 6, salt + 1) * 0.25) * height;
    ctx.lineTo(sx, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function drawGround(x0, x1, s) {
  const { h } = view;
  const from = Math.max(-8, Math.floor(x0));
  const to = Math.ceil(x1);
  const top = (x) => toScreen(x, x < 0 ? road.heights[0] : groundAt(x));
  buildRoad(to + 2);

  // the earth
  ctx.beginPath();
  const first = top(from);
  ctx.moveTo(first.x, h + 40);
  for (let x = from; x <= to; x++) { const p = top(x); ctx.lineTo(p.x, p.y); }
  ctx.lineTo(top(to).x, h + 40);
  ctx.closePath();
  const earth = ctx.createLinearGradient(0, toScreen(0, camera.y).y - s * 2, 0, h);
  earth.addColorStop(0, colourAt(camera.x, "dirt"));
  earth.addColorStop(1, colourAt(camera.x, "dirtDeep"));
  ctx.fillStyle = earth;
  ctx.fill();

  // pebbles in the earth
  ctx.fillStyle = colourAt(camera.x, "pebble");
  for (let x = from; x <= to; x++) {
    for (let k = 0; k < 3; k++) {
      const r = hash01(x * 17 + k * 3);
      if (r > 0.55) continue;
      const px = x + hash01(x * 23 + k);
      const depth = 0.7 + hash01(x * 29 + k * 7) * 4;
      const p = toScreen(px, groundAt(px) - depth);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s * (0.08 + r * 0.2), s * (0.06 + r * 0.12), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // the grass (or sand, or snow) on top: a dark edge, then a lighter strip
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [width, key] of [[0.62, "grassDark"], [0.36, "grass"]]) {
    ctx.beginPath();
    for (let x = from; x <= to; x++) {
      const p = top(x);
      if (x === from) ctx.moveTo(p.x, p.y + width * s * 0.3);
      else ctx.lineTo(p.x, p.y + width * s * 0.3);
    }
    ctx.strokeStyle = colourAt(camera.x, key);
    ctx.lineWidth = width * s;
    ctx.stroke();
  }
}

function drawDecor(item, s) {
  const { land } = landAt(item.x);
  const kind = land.decor[Math.floor(item.pick * land.decor.length)];
  const base = toScreen(item.x, groundAt(item.x) - 0.2);
  const u = s * item.size;
  ctx.save();
  ctx.translate(base.x, base.y);
  ctx.globalAlpha = 0.92;
  if (kind === "tree") {
    ctx.fillStyle = "#7a5233";
    ctx.fillRect(-0.12 * u, -1.6 * u, 0.24 * u, 1.6 * u);
    ctx.fillStyle = "#4aa847";
    for (const [dx, dy, r] of [[0, -2.2, 0.95], [-0.6, -1.7, 0.7], [0.6, -1.75, 0.72]]) {
      ctx.beginPath();
      ctx.arc(dx * u, dy * u, r * u, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "bush") {
    ctx.fillStyle = landAt(item.x).land.name === "Night road" ? "#2c7a57" : "#5fb553";
    for (const [dx, r] of [[-0.35, 0.4], [0.3, 0.45], [0, 0.55]]) {
      ctx.beginPath();
      ctx.arc(dx * u, -0.35 * u, r * u, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "rock") {
    ctx.fillStyle = "rgba(110,105,110,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, -0.25 * u, 0.6 * u, 0.42 * u, 0, Math.PI, 0);
    ctx.fill();
  } else if (kind === "cactus") {
    ctx.strokeStyle = "#4f9a4a";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.32 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -2 * u);
    ctx.moveTo(0, -1 * u);
    ctx.lineTo(0.5 * u, -1 * u);
    ctx.lineTo(0.5 * u, -1.5 * u);
    ctx.moveTo(0, -1.3 * u);
    ctx.lineTo(-0.45 * u, -1.3 * u);
    ctx.lineTo(-0.45 * u, -1.7 * u);
    ctx.stroke();
  } else if (kind === "pine") {
    ctx.fillStyle = landAt(item.x).land.name === "Night road" ? "#24555a" : "#3f7f6a";
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(0, (-3 + k * 0.75) * u);
      ctx.lineTo(0.75 * u * (1 + k * 0.25), (-1.6 + k * 0.6) * u);
      ctx.lineTo(-0.75 * u * (1 + k * 0.25), (-1.6 + k * 0.6) * u);
      ctx.fill();
    }
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(-0.1 * u, -0.5 * u, 0.2 * u, 0.6 * u);
  } else if (kind === "lamp") {
    ctx.fillStyle = "#1f2140";
    ctx.fillRect(-0.06 * u, -2.6 * u, 0.12 * u, 2.6 * u);
    const glow = ctx.createRadialGradient(0, -2.6 * u, 0, 0, -2.6 * u, 1.6 * u);
    glow.addColorStop(0, "rgba(255,230,150,0.9)");
    glow.addColorStop(1, "rgba(255,230,150,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -2.6 * u, 1.6 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSign(x, text, colour, s) {
  const base = toScreen(x, groundAt(x));
  ctx.fillStyle = "#6b4a32";
  ctx.fillRect(base.x - 0.05 * s, base.y - 1.7 * s, 0.1 * s, 1.7 * s);
  ctx.fillStyle = colour;
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(base.x - 0.8 * s, base.y - 2.3 * s, 1.6 * s, 0.75 * s, 0.15 * s);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#23263a";
  ctx.font = `900 ${Math.round(0.42 * s)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, base.x, base.y - 1.92 * s);
  ctx.textBaseline = "alphabetic";
}

function drawFlag(x, s) {
  const base = toScreen(x, groundAt(x));
  ctx.strokeStyle = "#23263a";
  ctx.lineWidth = 0.08 * s;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, base.y - 3 * s);
  ctx.stroke();
  ctx.fillStyle = "#ff6b3d";
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - 3 * s);
  ctx.lineTo(base.x + 1.3 * s, base.y - 2.65 * s);
  ctx.lineTo(base.x, base.y - 2.3 * s);
  ctx.fill();
  ctx.fillStyle = "#23263a";
  ctx.font = `900 ${Math.round(0.36 * s)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("BEST", base.x + 0.15 * s, base.y - 3.15 * s);
}

const COIN_COLOURS = { 5: ["#ffc83d", "#d08a00"], 10: ["#dfe6ee", "#8a99ab"], 25: ["#ff9b5e", "#c9561f"], 50: ["#c08bff", "#7a45c8"] };

function drawCoin(coin, s, now) {
  const p = toScreen(coin.x, coin.y + Math.sin(now / 300 + coin.x) * 0.06);
  const [fill, edge] = COIN_COLOURS[coin.value];
  const r = (coin.value >= 25 ? 0.36 : 0.3) * s;
  const squash = Math.abs(Math.cos(now / 420 + coin.x * 0.7)) * 0.75 + 0.25;
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * squash, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * squash * 0.78, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  if (coin.value > 5 && squash > 0.6) {
    ctx.fillStyle = edge;
    ctx.font = `900 ${Math.round(r * 0.9)}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(coin.value, p.x, p.y + 1);
    ctx.textBaseline = "alphabetic";
  }
}

function drawCan(can, s, now) {
  const p = toScreen(can.x, can.y + Math.sin(now / 350) * 0.08);
  const u = s * 0.5;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.sin(now / 500) * 0.08);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, u * 2.2);
  glow.addColorStop(0, "rgba(255,255,255,0.55)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, u * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8413c";
  ctx.beginPath();
  ctx.roundRect(-0.7 * u, -0.85 * u, 1.4 * u, 1.75 * u, 0.25 * u);
  ctx.fill();
  ctx.fillStyle = "#b52c28";
  ctx.fillRect(-0.15 * u, -1.15 * u, 0.5 * u, 0.35 * u);
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${Math.round(u * 0.95)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("F", 0, 0.08 * u);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

// The truck, drawn in its own metres (y up), turned and moved to where the physics put it.
function drawTruck(s) {
  const { body, back, front } = truck;
  const centre = body.getPosition();
  const p = toScreen(centre.x, centre.y);

  // springs between the body and the wheels
  ctx.strokeStyle = "#3a3d52";
  ctx.lineWidth = 0.12 * s;
  ctx.lineCap = "round";
  for (const [wheel, [ax, ay]] of [[back, WHEEL_AT[0]], [front, WHEEL_AT[1]]]) {
    const a = toScreen(body.getWorldPoint(Vec2(ax, ay + 0.35)).x, body.getWorldPoint(Vec2(ax, ay + 0.35)).y);
    const b = toScreen(wheel.getPosition().x, wheel.getPosition().y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const wheel of [back, front]) drawWheel(wheel, s);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(s, -s);                 // from here on, 1 unit = 1 metre and y points up
  ctx.rotate(body.getAngle());
  ctx.lineJoin = "round";

  // the driver (behind the body): a round little person in a big teal helmet
  ctx.fillStyle = "#3d6fd1";        // jacket
  ctx.beginPath();
  ctx.roundRect(HEAD.x - 0.26, 0.2, 0.5, 0.62, 0.18);
  ctx.fill();
  ctx.strokeStyle = "#3d6fd1";
  ctx.lineWidth = 0.13;
  ctx.beginPath();                  // arm to the steering wheel
  ctx.moveTo(HEAD.x + 0.1, 0.62);
  ctx.lineTo(0.42, 0.52);
  ctx.stroke();
  ctx.fillStyle = "#ffd3a8";        // face
  ctx.beginPath();
  ctx.arc(HEAD.x, HEAD.y, HEAD.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#24b3a4";        // helmet
  ctx.beginPath();
  ctx.arc(HEAD.x, HEAD.y + 0.02, HEAD.r + 0.03, Math.PI * 0.05, Math.PI * 1.08);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";        // helmet stripe
  ctx.fillRect(HEAD.x - 0.04, HEAD.y + 0.1, 0.08, 0.17);
  ctx.fillStyle = "#23263a";        // goggles
  ctx.beginPath();
  ctx.roundRect(HEAD.x + 0.04, HEAD.y - 0.06, 0.22, 0.12, 0.05);
  ctx.fill();
  ctx.fillStyle = "#8fe3ff";
  ctx.beginPath();
  ctx.arc(HEAD.x + 0.16, HEAD.y, 0.04, 0, Math.PI * 2);
  ctx.fill();
  if (run && run.reason === "crash") { // dizzy
    ctx.strokeStyle = "#ffc83d";
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y + 0.42, 0.16, 0, Math.PI * 1.6);
    ctx.stroke();
  }

  // steering wheel and windscreen
  ctx.strokeStyle = "#23263a";
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(0.36, 0.32);
  ctx.lineTo(0.46, 0.6);
  ctx.stroke();
  ctx.fillStyle = "rgba(170, 225, 255, 0.55)";
  ctx.beginPath();
  ctx.moveTo(0.55, 0.3);
  ctx.lineTo(0.7, 0.86);
  ctx.lineTo(0.8, 0.86);
  ctx.lineTo(0.72, 0.3);
  ctx.fill();
  ctx.strokeStyle = "#23263a";
  ctx.lineWidth = 0.05;
  ctx.stroke();

  // the body
  ctx.beginPath();
  BODY_SHAPE.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = "#ff6b3d";
  ctx.fill();
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = "#a83a17";
  ctx.stroke();
  ctx.fillStyle = "#d94a1e";        // lower trim
  ctx.fillRect(-1.36, -0.2, 2.72, 0.12);
  ctx.fillStyle = "rgba(255,255,255,0.28)"; // shine
  ctx.fillRect(-1.25, 0.12, 0.5, 0.06);
  ctx.fillRect(0.1, 0.2, 0.9, 0.06);
  ctx.fillStyle = "#ffe66b";        // headlight
  ctx.beginPath();
  ctx.arc(1.37, 0.08, 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a3d52";        // exhaust pipe
  ctx.fillRect(-1.5, -0.12, 0.16, 0.08);
  // a dent and a patch: it's a rattletrap after all
  ctx.fillStyle = "#c9c2b0";
  ctx.fillRect(-1.05, -0.02, 0.26, 0.16);
  ctx.strokeStyle = "#8b8474";
  ctx.lineWidth = 0.02;
  ctx.strokeRect(-1.05, -0.02, 0.26, 0.16);

  ctx.restore();
}

function drawWheel(wheel, s) {
  const c = wheel.getPosition();
  const p = toScreen(c.x, c.y);
  const r = WHEEL_R * s;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-wheel.getAngle());
  ctx.fillStyle = "#2b2d3a";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#454858";       // tread
  ctx.lineWidth = r * 0.12;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
    ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    ctx.stroke();
  }
  ctx.fillStyle = "#e4e7ee";         // rim
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#9aa1b2";
  ctx.lineWidth = r * 0.1;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
    ctx.stroke();
  }
  ctx.fillStyle = "#ff6b3d";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// 7. Screens
// ---------------------------------------------------------------------------------------------

function show(name) {
  screen = name;
  document.body.dataset.screen = name;
  if (name !== "drive") input.gas = input.brake = false;
  document.querySelectorAll(".pedal").forEach((pedal) => pedal.classList.remove("down"));
}

function renderMenu() {
  $("menu-coins").textContent = save.coins.toLocaleString();
  $("menu-best").textContent = `${save.best.toLocaleString()} m`;
  $("toggle-sound").checked = save.sound;
  $("garage-dot").hidden = !UPGRADES.some((u) => save.levels[u.id] < MAX_LEVEL && save.coins >= upgradeCost(u, save.levels[u.id]));
}

function toMenu() {
  newRun();
  show("menu");
  renderMenu();
}

function startDriving() {
  wakeAudio();
  if (!run || run.time > 0 || run.over) newRun();
  show("drive");
  platform.gameplayStart();
}

function renderGarage() {
  $("garage-coins").textContent = save.coins.toLocaleString();
  $("upgrades").innerHTML = UPGRADES.map((u) => {
    const level = save.levels[u.id];
    const maxed = level >= MAX_LEVEL;
    const cost = upgradeCost(u, level);
    const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < level ? "on" : ""}"></i>`).join("");
    const button = maxed
      ? `<button class="button" disabled>Fully upgraded</button>`
      : `<button class="button ${save.coins >= cost ? "primary" : ""}" data-buy="${u.id}" ${save.coins >= cost ? "" : "disabled"}>Upgrade <svg class="icon"><use href="#i-coin"/></svg> ${cost.toLocaleString()}</button>`;
    return `<div class="upgrade" id="up-${u.id}">
      <div class="upgrade-top"><svg class="icon"><use href="#${u.icon}"/></svg><div><h3>${u.name}</h3><p>Level ${level} of ${MAX_LEVEL}</p></div></div>
      <p class="about">${u.about}</p>
      <div class="pips">${pips}</div>
      ${button}
    </div>`;
  }).join("");
}

$("upgrades").addEventListener("click", (event) => {
  const button = event.target.closest("[data-buy]");
  if (!button) return;
  const upgrade = UPGRADES.find((u) => u.id === button.dataset.buy);
  const cost = upgradeCost(upgrade, save.levels[upgrade.id]);
  if (save.coins < cost || save.levels[upgrade.id] >= MAX_LEVEL) return;
  save.coins -= cost;
  save.levels[upgrade.id]++;
  persist();
  wakeAudio();
  play("mission", { volume: 0.5 });
  renderGarage();
  $(`up-${upgrade.id}`).classList.add("bought");
  newRun(); // the truck on screen gets the new parts straight away
});

function openGarage() {
  wakeAudio();
  renderGarage();
  show("garage");
}

function showResult(earned, meters, newBest, oldBest) {
  $("result-reason").textContent = run.reason === "crash" ? "Ouch! Landed on your head" : "Out of fuel";
  $("result-distance").textContent = `${meters.toLocaleString()} m`;
  const best = $("result-best");
  best.textContent = newBest ? (oldBest > 0 ? `New best! (was ${oldBest.toLocaleString()} m)` : "Your first drive!") : `Best: ${save.best.toLocaleString()} m`;
  best.className = newBest ? "new" : "";
  const lines = [["Coins picked up", run.coins]];
  if (run.flipCoins) lines.push([`Flips (${run.flips})`, run.flipCoins]);
  if (run.airCoins) lines.push([`Air time (best ${run.bestAir.toFixed(1)} s)`, run.airCoins]);
  $("result-lines").innerHTML = lines.map(([label, value]) => `<div><span>${label}</span><b>+${value.toLocaleString()}</b></div>`).join("");
  $("result-coins").textContent = earned.toLocaleString();
  const affordable = UPGRADES.filter((u) => save.levels[u.id] < MAX_LEVEL && save.coins >= upgradeCost(u, save.levels[u.id]));
  $("result-tip").textContent = affordable.length
    ? `You can afford: ${affordable.map((u) => u.name.toLowerCase()).join(", ")}. Visit the garage!`
    : run.reason === "crash" ? "Tip: in the air, Gas tips you back and Brake tips you forward."
    : "Tip: ease off the gas to save fuel between cans.";
  $("result-garage").classList.toggle("primary", affordable.length > 0);
  $("again").classList.toggle("primary", affordable.length === 0);
  show("result");
}

function pauseGame() {
  if (screen !== "drive") return;
  show("paused");
  platform.gameplayStop();
}
function resumeGame() {
  if (screen !== "paused") return;
  show("drive");
  platform.gameplayStart();
}

$("drive").addEventListener("click", startDriving);
$("garage-drive").addEventListener("click", startDriving);
$("open-garage").addEventListener("click", openGarage);
$("result-garage").addEventListener("click", openGarage);
$("close-garage").addEventListener("click", toMenu);
$("pause").addEventListener("click", pauseGame);
$("resume").addEventListener("click", resumeGame);
$("restart").addEventListener("click", () => { newRun(); startDriving(); });
$("quit").addEventListener("click", () => { platform.gameplayStop(); toMenu(); });
$("result-menu").addEventListener("click", toMenu);
$("again").addEventListener("click", () => {
  // Portals may show an ad here, between two runs.
  platform.breakAd(() => { newRun(); startDriving(); }, pauseAudio);
});
$("toggle-sound").addEventListener("change", (event) => { save.sound = event.target.checked; persist(); });

// The pedals: hold to press. Several fingers at once work, and sliding off lets go.
function bindPedal(id, key) {
  const pedal = $(id);
  const press = (down) => (event) => {
    event.preventDefault();
    wakeAudio();
    input[key] = down;
    pedal.classList.toggle("down", down);
  };
  pedal.addEventListener("pointerdown", press(true));
  pedal.addEventListener("pointerup", press(false));
  pedal.addEventListener("pointercancel", press(false));
  pedal.addEventListener("pointerleave", press(false));
  pedal.addEventListener("contextmenu", (event) => event.preventDefault());
}
bindPedal("gas", "gas");
bindPedal("brake", "brake");

const KEYS = { ArrowRight: "gas", KeyD: "gas", ArrowUp: "gas", KeyW: "gas", ArrowLeft: "brake", KeyA: "brake", ArrowDown: "brake", KeyS: "brake" };
addEventListener("keydown", (event) => {
  if (KEYS[event.code] && screen === "drive") {
    event.preventDefault();
    wakeAudio();
    input[KEYS[event.code]] = true;
    $(KEYS[event.code]).classList.add("down");
  } else if (event.code === "KeyP" || event.code === "Escape") {
    if (screen === "drive") pauseGame();
    else if (screen === "paused") resumeGame();
  } else if ((event.code === "Space" || event.code === "Enter") && (screen === "menu" || screen === "result") && document.activeElement === document.body) {
    event.preventDefault();
    startDriving();
  }
});
addEventListener("keyup", (event) => {
  if (!KEYS[event.code]) return;
  input[KEYS[event.code]] = false;
  $(KEYS[event.code]).classList.remove("down");
});
// Leaving the tab (or the window) pauses the drive.
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });
addEventListener("blur", pauseGame);

// The bar at the top.
let shownCoins = -1;
let shownMeters = -1;
function updateHud() {
  if (!run) return;
  const fraction = clamp(run.fuel / run.stats.tank, 0, 1);
  $("fuel-bar").style.transform = `scaleX(${fraction})`;
  document.querySelector(".fuel").classList.toggle("low", fraction < 0.22);
  const coins = run.coins + run.flipCoins + run.airCoins;
  if (coins !== shownCoins) { shownCoins = coins; $("run-coins").textContent = coins.toLocaleString(); }
  const meters = Math.floor(run.distance);
  if (meters !== shownMeters) {
    shownMeters = meters;
    $("distance").textContent = `${meters.toLocaleString()} m`;
    $("best-line").textContent = save.best > 0 ? (meters > save.best ? "new best!" : `best ${save.best.toLocaleString()} m`) : "";
  }
}
function bumpCoins() {
  const box = document.querySelector(".coins");
  box.classList.remove("bump");
  void box.offsetWidth;
  box.classList.add("bump");
}

// ---------------------------------------------------------------------------------------------
// 8. Sound
// ---------------------------------------------------------------------------------------------
// Short recorded clips (Kenney's "Interface Sounds", CC0) for coins, fuel and crashes, and an
// engine made on the fly: two buzzing tones through a soft filter, higher as the wheels spin faster.

const CLIPS = ["star", "crash", "mission", "best", "fanfare", "tick"];
const audio = { context: null, clips: {}, engine: null };

function wakeAudio() {
  if (audio.context) {
    if (audio.context.state === "suspended") audio.context.resume().catch(() => {});
    return;
  }
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  audio.context = new Context();
  for (const name of CLIPS) {
    fetch(`sounds/${name}.mp3`)
      .then((response) => response.arrayBuffer())
      .then((data) => audio.context.decodeAudioData(data))
      .then((buffer) => { audio.clips[name] = buffer; })
      .catch(() => {});
  }
  const ac = audio.context;
  const low = ac.createOscillator();
  const high = ac.createOscillator();
  low.type = "sawtooth";
  high.type = "square";
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 400;
  const gain = ac.createGain();
  gain.gain.value = 0;
  const highGain = ac.createGain();
  highGain.gain.value = 0.25;
  low.connect(filter);
  high.connect(highGain).connect(filter);
  filter.connect(gain).connect(ac.destination);
  low.start();
  high.start();
  audio.engine = { low, high, filter, gain };
}

function play(name, { volume = 0.6, rate = 1 } = {}) {
  if (!save.sound || platform.muted() || !audio.context || !audio.clips[name]) return;
  const source = audio.context.createBufferSource();
  source.buffer = audio.clips[name];
  source.playbackRate.value = rate;
  const gain = audio.context.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(audio.context.destination);
  source.start();
}

function updateEngineSound() {
  if (!audio.engine) return;
  const on = save.sound && !platform.muted() && screen === "drive" && run && !run.reason && run.fuel > 0;
  const spin = truck ? Math.abs(truck.back.getAngularVelocity()) : 0;
  const rev = clamp(spin / 40, 0, 1);
  const t = audio.context.currentTime;
  const { low, high, filter, gain } = audio.engine;
  low.frequency.setTargetAtTime(38 + rev * 70 + (input.gas ? 8 : 0), t, 0.08);
  high.frequency.setTargetAtTime(76 + rev * 140, t, 0.08);
  filter.frequency.setTargetAtTime(300 + rev * 900 + (input.gas ? 300 : 0), t, 0.1);
  gain.gain.setTargetAtTime(on ? (input.gas ? 0.09 : 0.05) : 0, t, 0.12);
}

// Ads (on portals) ask for silence while they play.
function pauseAudio(paused) {
  if (!audio.context) return;
  if (paused) audio.context.suspend().catch(() => {});
  else audio.context.resume().catch(() => {});
}

// ---------------------------------------------------------------------------------------------
// 9. Start
// ---------------------------------------------------------------------------------------------

layout();
addEventListener("resize", layout);
if (document.fonts) document.fonts.ready.then(layout);
toMenu();

let last = performance.now();
let spare = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen === "drive" || (run && run.reason && !run.over)) {
    spare += dt;
    while (spare >= STEP) {
      update(STEP);
      spare -= STEP;
    }
  } else if (screen === "menu" || screen === "garage") {
    // On the menu the truck just sits there, idling.
    spare += dt;
    while (spare >= STEP) { world.step(STEP, 8, 3); spare -= STEP; }
  }
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy -= 4 * dt;
  }
  particles = particles.filter((p) => p.age < p.life);
  popups.forEach((item) => { item.age += dt; });
  popups = popups.filter((item) => item.age < 1.4);
  shake = Math.max(0, shake - dt);
  updateCamera(dt);
  draw(now);
  updateHud();
  updateEngineSound();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if ("serviceWorker" in navigator && location.protocol === "https:" && platform.name === "web") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// For the test driver in tools/ (and curious players in the console).
window.rattle = {
  get run() { return run; },
  get truck() { return truck; },
  get screen() { return screen; },
  save, input, road, contacts, update, newRun, startDriving, truckStats, groundAt, STEP,
};
