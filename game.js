"use strict";
// Rattletrap: a physics driving game.
//
// Drive as far as you can over endless hills. Hold Gas to go, Brake to slow down or reverse.
// In the air, Gas tips you back and Brake tips you forward. Grab fuel cans before the tank runs
// dry, collect coins, flip, jump and wheelie for bonus coins, and don't land on your head.
// Coins unlock new adventures (stages) and vehicles, and upgrade them in the garage.
// The physics (wheels, springs, gravity, rope bridges) is done by planck.js, a JavaScript copy of
// the Box2D engine; this file builds the world, runs the game and draws it.
//
// This file has 11 parts:
//   1. Settings and the platform (web, or a game portal)
//   2. The adventures, the vehicles, the upgrades and the missions
//   3. Saving
//   4. The road: hills, bridges, crates, coins, fuel cans, scenery
//   5. The physics world: the ground and the vehicle
//   6. Driving: pedals, fuel, pickups, stunts, missions, the end of a run
//   7. Drawing the world
//   8. Drawing the vehicles
//   9. Screens: menu, adventures, garage, pause, result, settings, stats
//  10. Sound and music
//  11. Start

// ---------------------------------------------------------------------------------------------
// 1. Settings and the platform
// ---------------------------------------------------------------------------------------------

const pl = window.planck;
const Vec2 = pl.Vec2;
const STEP = 1 / 60;            // the physics moves forward in steps of 1/60 of a second
const CHUNK = 40;               // the ground is built in 40-metre pieces, just ahead of you
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
const fmt = (n) => Math.floor(n).toLocaleString("en");

// ---------------------------------------------------------------------------------------------
// 2. The adventures, the vehicles, the upgrades and the missions
// ---------------------------------------------------------------------------------------------

// Each adventure has its own hills, physics, colours, scenery and surprises.
//   hills: how wild the hills start (wild), how fast they grow (grow) and how wild they get (max),
//          the length of the big and medium waves, the steepest slope, and a slow overall climb
//   canGap: metres between the first fuel cans (later cans are further apart)
//   coinMult: coins are worth this many times more here
const STAGES = [
  {
    id: "countryside", name: "Countryside", about: "Rolling green hills and a few crates in the way. A gentle start.",
    cost: 0, gravity: 10, friction: 0.9, coinMult: 1, canGap: 130, medals: [500, 1500, 3000],
    hills: { wild: 4, grow: 1 / 90, max: 16, big: 32, medium: 11, bumps: 1.2, steep: 0.45, steepGrow: 1 / 4000, steepMax: 0.35, climb: 0.03 },
    crates: true, bridges: null, weather: "leaves", sky: "sun",
    colours: { skyTop: "#5fb8f0", skyBottom: "#d6f0ff", far: "#a9d9a4", near: "#80c47d", grass: "#5bbb4b", grassDark: "#3f9a37", dirt: "#9a6440", dirtDeep: "#6d4329", pebble: "#7d5236" },
    decor: ["tree", "tree", "bush", "rock", "fence"],
  },
  {
    id: "canyon", name: "Canyon", about: "Red rock, big drops and wobbly rope bridges over the river.",
    cost: 2500, gravity: 10, friction: 0.85, coinMult: 2, canGap: 140, medals: [500, 1500, 3000],
    hills: { wild: 5, grow: 1 / 70, max: 18, big: 26, medium: 9, bumps: 1.2, steep: 0.5, steepGrow: 1 / 3500, steepMax: 0.4, climb: 0.02 },
    crates: false, bridges: "water", weather: "dust", sky: "sun",
    colours: { skyTop: "#f29a5b", skyBottom: "#ffe3bd", far: "#e6ab84", near: "#cf8459", grass: "#e0b06a", grassDark: "#c48f4a", dirt: "#b25f35", dirtDeep: "#7f3c1f", pebble: "#96492a" },
    decor: ["cactus", "cactus", "rock", "skull", "rock"],
  },
  {
    id: "arctic", name: "Arctic", about: "Snow, ice and pine trees. Slippery! Tyre upgrades help a lot.",
    cost: 6000, gravity: 10, friction: 0.42, coinMult: 2, canGap: 135, medals: [500, 1500, 3000],
    hills: { wild: 4, grow: 1 / 80, max: 16, big: 30, medium: 10, bumps: 0.8, steep: 0.45, steepGrow: 1 / 3200, steepMax: 0.4, climb: 0.02 },
    crates: false, bridges: null, weather: "snow", sky: "sun",
    colours: { skyTop: "#7fa9d8", skyBottom: "#eef5fc", far: "#cddbeb", near: "#a9c1dc", grass: "#f5f9ff", grassDark: "#c9d8ea", dirt: "#738399", dirtDeep: "#4f5d72", pebble: "#9fb3cf" },
    decor: ["pine", "pine", "snowman", "rock", "pine"],
  },
  {
    id: "woods", name: "Midnight Woods", about: "Pitch dark: only your headlights, lamps and fireflies light the way.",
    cost: 12000, gravity: 10, friction: 0.9, coinMult: 3, canGap: 140, medals: [500, 1500, 3000],
    hills: { wild: 4.5, grow: 1 / 75, max: 17, big: 28, medium: 10, bumps: 1.2, steep: 0.48, steepGrow: 1 / 3500, steepMax: 0.4, climb: 0.025 },
    crates: true, bridges: "water", weather: "fireflies", sky: "moon", night: true,
    colours: { skyTop: "#0f1236", skyBottom: "#2d2a63", far: "#252a5a", near: "#1c2148", grass: "#3fae7c", grassDark: "#2a7d5a", dirt: "#3b3050", dirtDeep: "#221b33", pebble: "#4b3d66" },
    decor: ["pine", "mushroom", "lamp", "pine", "bush"],
  },
  {
    id: "volcano", name: "Volcano", about: "Steep black rock and bridges over lava. Don't fall in.",
    cost: 20000, gravity: 10, friction: 0.95, coinMult: 3, canGap: 150, medals: [500, 1500, 3000],
    hills: { wild: 5.5, grow: 1 / 60, max: 20, big: 24, medium: 8, bumps: 1.4, steep: 0.55, steepGrow: 1 / 3000, steepMax: 0.4, climb: 0.035 },
    crates: false, bridges: "lava", weather: "embers", sky: "sun",
    colours: { skyTop: "#4a1720", skyBottom: "#e2643a", far: "#5a2a2e", near: "#3b1d22", grass: "#5a4a4f", grassDark: "#2e2428", dirt: "#2f2529", dirtDeep: "#1a1316", pebble: "#ff6a2a" },
    decor: ["deadtree", "lavarock", "rock", "deadtree"],
  },
  {
    id: "moon", name: "The Moon", about: "Low gravity: huge jumps and endless flips. Mind your head.",
    cost: 35000, gravity: 2.2, friction: 0.8, coinMult: 4, canGap: 200, medals: [800, 2000, 4000],
    hills: { wild: 5, grow: 1 / 80, max: 18, big: 30, medium: 8, bumps: 2.2, steep: 0.6, steepGrow: 1 / 3000, steepMax: 0.5, climb: 0.01 },
    crates: false, bridges: null, weather: null, sky: "earth",
    colours: { skyTop: "#04050d", skyBottom: "#1a1d33", far: "#3a3d4a", near: "#2c2f3a", grass: "#c9ccd6", grassDark: "#9a9eab", dirt: "#7c808e", dirtDeep: "#4a4d58", pebble: "#5d606c" },
    decor: ["rock", "crater", "flag", "dish", "rock"],
  },
];

// The vehicles. Shapes are in metres, with y pointing up, around the middle of the body.
//   body: the outline the physics uses; head: the driver's head (touching the ground ends a run)
//   wheels: where they sit, how big they are, and whether the engine turns them
//   torque/speed: engine strength and top wheel speed; tank: seconds of full throttle
//   burn: how thirsty it is; tilt: how hard Gas/Brake turn it in the air
//   light: where the headlight is (for the night)
const VEHICLES = [
  {
    id: "rattletrap", name: "Rattletrap", about: "Your trusty old truck. Good at a bit of everything.",
    cost: 0, costMult: 1, style: "truck", paint: "#ff6b3d", engineNote: 1,
    body: [[-1.38, -0.2], [1.34, -0.2], [1.44, 0.04], [1.3, 0.24], [0.5, 0.32], [-0.62, 0.32], [-0.7, 0.18], [-1.36, 0.18]],
    density: 1.7, head: { x: -0.18, y: 0.98, r: 0.24 }, light: { x: 1.4, y: 0.08 },
    wheels: [{ x: -0.98, y: -0.42, r: 0.43, drive: true }, { x: 0.98, y: -0.42, r: 0.43, drive: true }], wheelDensity: 1.6,
    torque: 7, speed: 24, tank: 28, burn: 1, tilt: 12, springHz: 3.4, damping: 0.42, grip: 0.95,
    traits: { Power: 0.45, Speed: 0.5, Grip: 0.5, Fuel: 0.55 },
  },
  {
    id: "bike", name: "Dirt Bike", about: "Light and fast, and it flips like a dream. Also flips by accident.",
    cost: 4000, costMult: 1.3, style: "bike", paint: "#3d9df5", engineNote: 1.5,
    body: [[-0.7, -0.05], [0.55, -0.05], [0.8, 0.2], [0.55, 0.4], [-0.2, 0.44], [-0.72, 0.3]],
    density: 1.5, head: { x: 0.02, y: 1.2, r: 0.22 }, light: { x: 0.8, y: 0.36 },
    wheels: [{ x: -0.72, y: -0.36, r: 0.37, drive: true }, { x: 0.8, y: -0.36, r: 0.37, drive: false }], wheelDensity: 1.4,
    torque: 4.2, speed: 32, tank: 22, burn: 0.75, tilt: 6, spinDamping: 1.4, springHz: 3.8, damping: 0.45, grip: 0.85,
    traits: { Power: 0.35, Speed: 0.9, Grip: 0.5, Fuel: 0.4 },
  },
  {
    id: "tractor", name: "Tractor", about: "Slow, but it climbs almost anything and sips fuel.",
    cost: 6000, costMult: 1.2, style: "tractor", paint: "#2ebf7a", engineNote: 0.7,
    body: [[-1.0, -0.15], [1.3, -0.15], [1.35, 0.35], [0.15, 0.42], [-0.35, 0.42], [-1.0, 0.3]],
    density: 2.1, head: { x: -0.48, y: 1.32, r: 0.24 }, light: { x: 1.35, y: 0.22 },
    wheels: [{ x: -0.62, y: -0.25, r: 0.64, drive: true }, { x: 1.0, y: -0.48, r: 0.36, drive: true }], wheelDensity: 1.3,
    torque: 13, speed: 15, tank: 34, burn: 0.8, tilt: 15, springHz: 3.0, damping: 0.55, grip: 1.0,
    traits: { Power: 0.85, Speed: 0.25, Grip: 0.75, Fuel: 0.9 },
  },
  {
    id: "monster", name: "Monster Truck", about: "Giant wheels roll over anything. Thirsty, and a long way to fall.",
    cost: 12000, costMult: 1.6, style: "monster", paint: "#c06bff", engineNote: 0.8,
    body: [[-1.35, 0.05], [1.35, 0.05], [1.45, 0.3], [1.3, 0.5], [0.4, 0.58], [-1.3, 0.58], [-1.4, 0.35]],
    density: 1.4, head: { x: -0.15, y: 1.27, r: 0.24 }, light: { x: 1.44, y: 0.35 },
    wheels: [{ x: -1.05, y: -0.45, r: 0.72, drive: true }, { x: 1.05, y: -0.45, r: 0.72, drive: true }], wheelDensity: 0.8,
    torque: 15, speed: 21, tank: 28, burn: 1.35, tilt: 20, springHz: 2.6, damping: 0.5, grip: 0.95,
    traits: { Power: 0.8, Speed: 0.65, Grip: 0.8, Fuel: 0.4 },
  },
];

const MAX_LEVEL = 10;
const UPGRADES = [
  { id: "engine", name: "Engine", icon: "i-engine", base: 150, about: "More power for hills, higher top speed" },
  { id: "suspension", name: "Suspension", icon: "i-spring", base: 110, about: "Softer landings, steadier on bumps" },
  { id: "tires", name: "Tyres", icon: "i-tire", base: 110, about: "More grip on slopes and ice" },
  { id: "fuel", name: "Fuel tank", icon: "i-fuel", base: 90, about: "Drive further between fuel cans" },
];
const upgradeCost = (upgrade, level, vehicle) => Math.round((upgrade.base * vehicle.costMult * Math.pow(1.6, level)) / 10) * 10;

const PAINTS = ["#ff6b3d", "#3d9df5", "#2ebf7a", "#c06bff", "#ffc83d", "#ff4d8d", "#2b2d3a", "#f4f1ea", "#00b8c8", "#8a5a3b"];
const PAINT_COST = 400;

// Missions: three at a time. Each kind gets harder (and pays more) every time it comes back.
const MISSION_KINDS = [
  { kind: "distance", text: (t) => `Drive ${fmt(t)} m in one run`, target: (tier) => 400 + 300 * tier, reward: (tier) => 250 + 150 * tier },
  { kind: "flips", text: (t) => `Do ${t} flip${t > 1 ? "s" : ""} in one run`, target: (tier) => 1 + tier, reward: (tier) => 300 + 180 * tier },
  { kind: "coins", text: (t) => `Earn ${fmt(t)} coins in one run`, target: (tier) => 250 + 250 * tier, reward: (tier) => 250 + 150 * tier },
  { kind: "air", text: (t) => `Stay in the air ${t} s in one jump`, target: (tier) => Math.round((1.6 + 0.5 * tier) * 10) / 10, reward: (tier) => 300 + 160 * tier },
  { kind: "cans", text: (t) => `Pick up ${t} fuel cans in one run`, target: (tier) => 2 + tier, reward: (tier) => 250 + 150 * tier },
  { kind: "wheelie", text: (t) => `Wheelie for ${t} s`, target: (tier) => Math.round((1.5 + 0.8 * tier) * 10) / 10, reward: (tier) => 300 + 170 * tier },
  { kind: "total", text: (t) => `Drive ${t} km in total`, target: (tier) => 2 + 3 * tier, reward: (tier) => 400 + 250 * tier },
];

const MEDALS = [["bronze", 300], ["silver", 1000], ["gold", 3000]];

// ---------------------------------------------------------------------------------------------
// 3. Saving
// ---------------------------------------------------------------------------------------------

let store = null;
try { store = platform.storage(); } catch (error) { store = null; }

const save = load();
function load() {
  const fresh = {
    coins: 0,
    stage: "countryside",
    vehicle: "rattletrap",
    stages: {},      // id -> { owned, best, medals }
    vehicles: {},    // id -> { owned, levels: {engine, suspension, tires, fuel}, paint, paints: [] }
    missions: { next: 0, active: [] },
    stats: { runs: 0, distance: 0, coins: 0, flips: 0, bestAir: 0, bestWheelie: 0, crashes: 0 },
    settings: { sound: true, engine: true, music: true, vibrate: true, fuelHint: true, swap: false, light: false },
    gift: "",
  };
  let saved = null;
  try { saved = JSON.parse(store.getItem(SAVE_KEY)); } catch (error) { saved = null; }
  const data = Object.assign(fresh, saved && typeof saved === "object" ? saved : {});
  data.settings = Object.assign(fresh.settings, saved && saved.settings);
  data.stats = Object.assign(fresh.stats, saved && saved.stats);
  // Saves from the first version had one truck: move its upgrades and best distance over.
  if (saved && saved.levels && !saved.vehicles) {
    data.vehicles = { rattletrap: { owned: true, levels: saved.levels, paint: "#ff6b3d", paints: [] } };
    data.stages = { countryside: { owned: true, best: saved.best || 0, medals: 0 } };
    delete data.levels;
    delete data.best;
  }
  for (const stage of STAGES) data.stages[stage.id] = Object.assign({ owned: stage.cost === 0, best: 0, medals: 0 }, data.stages[stage.id]);
  for (const vehicle of VEHICLES) {
    const v = Object.assign({ owned: vehicle.cost === 0, paint: vehicle.paint, paints: [] }, data.vehicles[vehicle.id]);
    v.levels = Object.assign({ engine: 0, suspension: 0, tires: 0, fuel: 0 }, v.levels);
    data.vehicles[vehicle.id] = v;
  }
  if (!STAGES.some((s) => s.id === data.stage) || !data.stages[data.stage].owned) data.stage = "countryside";
  if (!VEHICLES.some((v) => v.id === data.vehicle) || !data.vehicles[data.vehicle].owned) data.vehicle = "rattletrap";
  return data;
}
function persist() {
  try { store.setItem(SAVE_KEY, JSON.stringify(save)); } catch (error) { /* private mode */ }
}

const stageNow = () => STAGES.find((s) => s.id === save.stage);
const vehicleNow = () => VEHICLES.find((v) => v.id === save.vehicle);

// What the garage levels mean for a vehicle.
function vehicleStats(vehicle) {
  const L = save.vehicles[vehicle.id].levels;
  return {
    torque: vehicle.torque * (1 + 0.16 * L.engine),
    speed: vehicle.speed * (1 + 0.1 * L.engine),
    springHz: vehicle.springHz * (1 + 0.06 * L.suspension),
    damping: vehicle.damping + 0.045 * L.suspension,
    grip: vehicle.grip + 0.11 * L.tires,
    tank: vehicle.tank * (1 + 0.22 * L.fuel),
    tilt: vehicle.tilt,
    burn: vehicle.burn,
  };
}

// Missions
function makeMission(n) {
  const kind = MISSION_KINDS[n % MISSION_KINDS.length];
  const tier = Math.floor(n / MISSION_KINDS.length);
  const target = kind.target(tier);
  return { n, kind: kind.kind, target, reward: kind.reward(tier), text: kind.text(target), start: save.stats.distance };
}
function fillMissions() {
  save.missions.active = save.missions.active.filter((m) => !m.done);
  while (save.missions.active.length < 3) {
    let n = save.missions.next++;
    // never two of the same kind at once
    while (save.missions.active.some((m) => m.kind === MISSION_KINDS[n % MISSION_KINDS.length].kind)) n = save.missions.next++;
    save.missions.active.push(makeMission(n));
  }
}
fillMissions();

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const giftAmount = () => 250 + 150 * STAGES.filter((s) => save.stages[s.id].owned).length;

// ---------------------------------------------------------------------------------------------
// 4. The road
// ---------------------------------------------------------------------------------------------
// Each adventure's road is the same on every run, so you learn it, and your best means something.
// heights[i] is the ground height (in metres) at x = i metres. The road is made a bit at a time,
// ahead of you, from smooth random "noise" that gets wilder the further you go.

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

const roads = {}; // one road per adventure, kept while the page is open
let road = null;

function roadFor(stage) {
  if (!roads[stage.id]) {
    roads[stage.id] = {
      stage, salt: STAGES.indexOf(stage) * 10 + 1,
      heights: [], coins: [], cans: [], decor: [], bridges: [], crates: [],
      nextCoins: 45, nextCan: 110, canCount: 0, nextDecor: 6, nextBridge: 170, nextCrate: 70,
    };
  }
  return roads[stage.id];
}

function targetHeight(r, x) {
  const h = r.stage.hills;
  const wild = h.wild + Math.min(x * h.grow, h.max);           // hills grow with distance
  const easeIn = smoothstep(12, 70, x);                         // a flat start
  const big = (noise(x / h.big, r.salt) - 0.5) * 2 * wild;
  const medium = (noise(x / h.medium, r.salt + 1) - 0.5) * wild * 0.6;
  const bumps = (noise(x / 4.5, r.salt + 2) - 0.5) * Math.min(h.bumps, x / 600);
  return (big + medium + bumps) * easeIn + x * h.climb;
}

// Is x over a ravine? Returns the bridge, or null.
function bridgeAt(x) {
  for (const b of road.bridges) if (x > b.a - 0.5 && x < b.b + 0.5) return b;
  return null;
}

// Makes sure the road exists up to x metres.
function buildRoad(toX) {
  const r = road;
  const h = r.heights;
  const stage = r.stage;
  while (h.length <= toX + 2) {
    const x = h.length;
    if (x === 0) { h.push(0); continue; }
    // A ravine with a rope bridge: flat ground, a drop, a river (or lava) and the far side.
    if (stage.bridges && x >= r.nextBridge) {
      const rim = h[x - 1];
      const span = 10 + Math.floor(hash01(x * 41) * 6);
      for (let k = 0; k < 4; k++) h.push(rim);                  // flat run-up
      const a = h.length - 1;
      for (let k = 1; k < span; k++) h.push(rim - 7);            // the ravine
      h.push(rim - 0.45);                                        // the far rim, with a rounded edge
      h.push(rim - 0.1);                                         // so wheels roll up off the bridge
      for (let k = 0; k < 3; k++) h.push(rim);
      r.bridges.push({ a, b: a + span, rim, floor: rim - 7 });
      r.nextBridge = h.length + 200 + hash01(x * 43) * 200;
      continue;
    }
    const hills = stage.hills;
    const steep = hills.steep + Math.min(x * hills.steepGrow, hills.steepMax); // the steepest rise per metre
    h.push(clamp(targetHeight(r, x), h[x - 1] - steep, h[x - 1] + steep));
  }
  const ready = h.length - 22;
  // Coins come in rows that follow the ground. Further out, they're worth more.
  while (r.nextCoins < ready) {
    const start = r.nextCoins;
    const n = 5 + Math.floor(hash01(start * 13 + r.salt) * 6);
    const tier = start < 500 ? 5 : start < 1500 ? 10 : start < 3000 ? 25 : 50;
    const nearCan = r.cans.some((can) => Math.abs(can.x - start) < 16) || Math.abs(r.nextCan - start) < 16;
    if (!nearCan) {
      for (let k = 0; k < n; k++) {
        const x = start + k * 1.1;
        const over = bridgeAt(x);
        r.coins.push({ x, y: (over ? over.rim : groundAt(x)) + (stage.gravity < 5 ? 1.5 : 1.05), tier, value: tier * stage.coinMult, taken: false });
      }
    }
    r.nextCoins += 40 + hash01(start * 31 + r.salt) * 55;
  }
  // Fuel cans: close together at first, then further and further apart.
  while (r.nextCan < ready) {
    let x = r.nextCan;
    const over = bridgeAt(x);
    if (over) x = over.b + 3;
    r.cans.push({ x, y: groundAt(x) + 0.9, taken: false });
    r.canCount++;
    r.nextCan = x + Math.min(stage.canGap + r.canCount * 8, stage.canGap * 2);
  }
  // Scenery, and crates to push around.
  while (r.nextDecor < ready) {
    const x = r.nextDecor;
    if (!bridgeAt(x)) r.decor.push({ x, pick: hash01(x * 97 + r.salt), size: 0.8 + hash01(x * 53) * 0.6 });
    r.nextDecor += 6 + hash01(x * 71 + r.salt) * 16;
  }
  while (stage.crates && r.nextCrate < ready) {
    const x = r.nextCrate;
    if (!bridgeAt(x) && !r.cans.some((can) => Math.abs(can.x - x) < 6)) r.crates.push({ x, stack: 1 + Math.floor(hash01(x * 17) * 2) });
    r.nextCrate += 90 + hash01(x * 19) * 90;
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
// 5. The physics world
// ---------------------------------------------------------------------------------------------
// y points up here (like in maths), and lengths are in metres.

let world = null;
let car = null;                   // { spec, body, wheels: [], joints: [] }
let chunks = new Map();           // chunk number -> { ground, things: [{ kind, body }] }
const contacts = { wheel: [0, 0], head: false, smashed: [] }; // smashed: crates you just hit

function makeWorld() {
  const stage = stageNow();
  const spec = vehicleNow();
  road = roadFor(stage);
  world = new pl.World({ gravity: Vec2(0, -stage.gravity) });
  chunks = new Map();
  contacts.wheel = [0, 0];
  contacts.head = false;
  contacts.smashed = [];

  buildRoad(200);
  // A wall behind the start, so you can't reverse off the edge of the world.
  const start = world.createBody();
  start.createFixture(pl.Edge(Vec2(-8, -50), Vec2(-8, 80)), { friction: 0.5, userData: "ground" });
  start.createFixture(pl.Edge(Vec2(-8, road.heights[0]), Vec2(0, road.heights[0])), { friction: stage.friction, userData: "ground" });

  const stats = vehicleStats(spec);
  const lowest = Math.min(...spec.wheels.map((w) => w.y - w.r));
  const at = Vec2(1.5, groundAt(1.5) - lowest + 0.15);
  const body = world.createDynamicBody({ position: at, angularDamping: spec.spinDamping || 0.6 });
  body.createFixture(pl.Polygon(spec.body.map(([x, y]) => Vec2(x, y))), { density: spec.density, friction: 0.5, userData: "body" });
  body.createFixture(pl.Circle(Vec2(spec.head.x, spec.head.y), spec.head.r), { density: 0.4, friction: 0.5, userData: "head" });

  const wheels = spec.wheels.map((w, k) => {
    const wheel = world.createDynamicBody({ position: Vec2(at.x + w.x, at.y + w.y) });
    wheel.createFixture(pl.Circle(w.r), { density: spec.wheelDensity, friction: stats.grip, userData: `wheel${k}` });
    return wheel;
  });
  const joints = wheels.map((wheel) => world.createJoint(pl.WheelJoint({
    enableMotor: true,
    motorSpeed: 0,
    maxMotorTorque: stats.torque,
    frequencyHz: stats.springHz,
    dampingRatio: stats.damping,
  }, body, wheel, wheel.getPosition(), Vec2(0, 1))));
  car = { spec, stats, body, wheels, joints };

  // Keep count of which parts touch the ground.
  const solid = (fixture) => fixture.getUserData() === "ground" || fixture.getUserData() === "crate";
  const watch = (contact, delta) => {
    const a = contact.getFixtureA();
    const b = contact.getFixtureB();
    const other = solid(a) ? b : solid(b) ? a : null;
    const surface = other === b ? a : b;
    if (!other) return;
    const part = other.getUserData();
    // Crates burst when you drive into them (they can't be removed during the physics step, so
    // they're noted here and smashed just after it).
    if (delta > 0 && surface.getUserData() === "crate" && part !== "crate" && part !== "ground") contacts.smashed.push(surface.getBody());
    if (part === "wheel0") contacts.wheel[0] = Math.max(0, contacts.wheel[0] + delta);
    if (part === "wheel1") contacts.wheel[1] = Math.max(0, contacts.wheel[1] + delta);
    if (part === "head" && delta > 0 && surface.getUserData() === "ground") contacts.head = true;
  };
  world.on("begin-contact", (contact) => watch(contact, 1));
  world.on("end-contact", (contact) => watch(contact, -1));
  updateGround();
}

// Builds the ground pieces (with their bridges and crates) near you, and removes far ones.
function updateGround() {
  const x = car.body.getPosition().x;
  const stage = road.stage;
  const first = Math.max(0, Math.floor((x - 50) / CHUNK));
  const last = Math.floor((x + 90) / CHUNK);
  buildRoad((last + 1) * CHUNK + 300); // well ahead, so the next fuel can is always known
  for (let k = first; k <= last; k++) {
    if (chunks.has(k)) continue;
    const points = [];
    for (let i = k * CHUNK; i <= (k + 1) * CHUNK; i++) points.push(Vec2(i, road.heights[i]));
    const ground = world.createBody();
    const chain = pl.Chain(points, false);
    // Tell each piece about its neighbours' points, so wheels roll smoothly over the joins.
    if (chain.setPrevVertex && k > 0) chain.setPrevVertex(Vec2(k * CHUNK - 1, road.heights[k * CHUNK - 1]));
    if (chain.setNextVertex) chain.setNextVertex(Vec2((k + 1) * CHUNK + 1, road.heights[(k + 1) * CHUNK + 1]));
    ground.createFixture(chain, { friction: stage.friction, userData: "ground" });
    const things = [];
    for (const bridge of road.bridges) if (Math.floor(bridge.a / CHUNK) === k) things.push(...makeBridge(bridge, ground));
    for (const crate of road.crates) {
      if (Math.floor(crate.x / CHUNK) !== k) continue;
      for (let s = 0; s < crate.stack; s++) {
        const box = world.createDynamicBody({ position: Vec2(crate.x + s * 0.12, groundAt(crate.x) + 0.45 + s * 0.9), angularDamping: 0.3 });
        box.createFixture(pl.Box(0.42, 0.42), { density: 0.22, friction: 0.5, userData: "crate" });
        things.push({ kind: "crate", body: box });
      }
    }
    chunks.set(k, { ground, things });
  }
  for (const [k, chunk] of chunks) {
    if (k < first - 1) {
      for (const thing of chunk.things) world.destroyBody(thing.body);
      world.destroyBody(chunk.ground);
      chunks.delete(k);
    }
  }
}

// A rope bridge: wooden planks joined end to end, tied to both rims. It sags and wobbles.
function makeBridge(bridge, ground) {
  const planks = [];
  const n = bridge.b - bridge.a;
  let previous = ground;
  for (let k = 0; k < n; k++) {
    const plank = world.createDynamicBody({ position: Vec2(bridge.a + k + 0.5, bridge.rim - 0.12), linearDamping: 0.1, angularDamping: 0.2 });
    plank.createFixture(pl.Box(0.5, 0.11), { density: 1.2, friction: 0.9, userData: "ground" });
    world.createJoint(pl.RevoluteJoint({}, previous, plank, Vec2(bridge.a + k, bridge.rim - 0.05)));
    planks.push({ kind: "plank", body: plank });
    previous = plank;
  }
  world.createJoint(pl.RevoluteJoint({}, previous, ground, Vec2(bridge.b, bridge.rim - 0.5)));
  return planks;
}

// ---------------------------------------------------------------------------------------------
// 6. Driving
// ---------------------------------------------------------------------------------------------

const input = { gas: false, brake: false };
let screen = "menu";
let run = null;
let particles = [];
let popups = [];
let shake = 0;

function newRun() {
  road = roadFor(stageNow());
  for (const item of road.coins) item.taken = false; // the road is the same every run
  for (const item of road.cans) item.taken = false;
  makeWorld();
  run = {
    time: 0,
    fuel: car.stats.tank,
    distance: 0,
    coins: 0, flipCoins: 0, airCoins: 0, wheelieCoins: 0,
    flips: 0, cans: 0,
    bestAir: 0, bestWheelie: 0,
    spin: 0, lastAngle: car.body.getAngle(), airTime: 0, wheelie: 0,
    stopped: 0, ending: 0, reason: null, over: false,
    milestone: 500,
    passedBest: save.stages[road.stage.id].best < 50,
    progressAt: 0, progressMark: 0,
    rewards: [],      // missions finished and medals won: { text, coins }
  };
  particles = [];
  popups = [];
  const p = car.body.getPosition();
  camera.x = p.x;
  camera.y = p.y;
  $("stuck").hidden = true;
}

const runCoins = () => run.coins + run.flipCoins + run.airCoins + run.wheelieCoins;

// One physics step (1/60 s).
function update(dt) {
  if (!run) return;
  run.time += dt;
  const { body, joints, spec, stats } = car;
  const stage = road.stage;
  const speed = body.getLinearVelocity().x;
  const driving = screen === "drive" && !run.reason;
  const hasFuel = run.fuel > 0;
  const airborne = contacts.wheel[0] === 0 && contacts.wheel[1] === 0;

  // The pedals.
  const gas = driving && hasFuel && input.gas && !input.brake;
  const brake = driving && hasFuel && input.brake && !input.gas;
  joints.forEach((joint, k) => {
    const driven = spec.wheels[k].drive;
    joint.enableMotor(true);
    if (gas && driven) {
      joint.setMotorSpeed(-stats.speed);          // minus = clockwise = forwards
      joint.setMaxMotorTorque(stats.torque);
    } else if (brake) {
      joint.setMotorSpeed(speed > 1 ? 0 : (driven ? stats.speed * 0.45 : 0)); // brake, then reverse
      joint.setMaxMotorTorque(stats.torque * (speed > 1 ? 1.4 : driven ? 1 : 0));
    } else {
      joint.setMotorSpeed(0);                      // rolling freely, with a little drag
      joint.setMaxMotorTorque(0.3);
    }
  });
  // Gas tips you back, Brake tips you forward (a lot in the air, a little on the ground).
  if (gas || brake) body.applyTorque((gas ? 1 : -1) * stats.tilt * (airborne ? 1 : 0.25), true);

  world.step(dt, 10, 6);
  smashCrates(stage);
  updateGround();

  // Fuel burns faster with your foot down.
  if (driving) run.fuel = Math.max(0, run.fuel - dt * stats.burn * (gas ? 1 : 0.25));

  const pos = body.getPosition();
  run.distance = Math.max(run.distance, pos.x - 1.5);
  if (run.distance > run.progressMark + 2) { run.progressMark = run.distance; run.progressAt = run.time; }
  $("stuck").hidden = !(driving && hasFuel && run.time - run.progressAt > 9);

  // Coins and fuel cans: picked up when any part of the vehicle comes close.
  const parts = [pos, ...car.wheels.map((w) => w.getPosition()), body.getWorldPoint(Vec2(spec.head.x, spec.head.y))];
  const near = (item, reach) => parts.some((p) => Math.abs(p.x - item.x) < reach + 1 && Math.hypot(p.x - item.x, p.y - item.y) < reach);
  if (!run.reason) {
    for (const coin of road.coins) {
      if (coin.taken || Math.abs(coin.x - pos.x) > 5) continue;
      if (near(coin, 0.9)) {
        coin.taken = true;
        run.coins += coin.value;
        burst(coin.x, coin.y, "#ffc83d", 6);
        play("star", { volume: 0.32, rate: 1 + Math.min(coin.tier, 50) / 100 });
        bumpCoins();
      }
    }
    for (const can of road.cans) {
      if (can.taken || Math.abs(can.x - pos.x) > 5) continue;
      if (near(can, 1.05)) {
        can.taken = true;
        run.fuel = stats.tank;
        run.cans++;
        popup("Fuel!", "#2ebf7a");
        burst(can.x, can.y, "#2ebf7a", 10);
        play("mission", { volume: 0.5 });
      }
    }
  }

  // Stunts. Flips: while both wheels are off the ground, add up how far you turn.
  const angle = body.getAngle();
  const mult = stage.coinMult;
  if (airborne && !run.reason) {
    run.airTime += dt;
    run.spin += angle - run.lastAngle;
    if (Math.abs(run.spin) >= Math.PI * 2 - 0.35) {
      run.spin -= Math.sign(run.spin) * Math.PI * 2;
      run.flips++;
      const reward = (50 + 25 * Math.min(run.flips - 1, 6)) * mult;
      run.flipCoins += reward;
      popup(`${run.spin > 0 ? "Front" : "Back"} flip! +${fmt(reward)}`, "#ff6b3d");
      play("best", { volume: 0.5 });
      vibrate(25);
      platform.happytime();
      bumpCoins();
    }
  } else if (!airborne) {
    if (run.airTime >= 1.2 && !run.reason) {
      const reward = Math.round(run.airTime * 12) * mult;
      run.airCoins += reward;
      popup(`Air time ${run.airTime.toFixed(1)} s +${fmt(reward)}`, "#3d9df5");
      bumpCoins();
    }
    if (run.airTime > 0.5) vibrate(12);
    run.bestAir = Math.max(run.bestAir, run.airTime);
    run.airTime = 0;
    run.spin = 0;
  }
  run.lastAngle = angle;
  // Wheelies: only the back wheel on the ground, moving forwards.
  if (contacts.wheel[0] > 0 && contacts.wheel[1] === 0 && speed > 1.5 && !run.reason) {
    run.wheelie += dt;
  } else if (run.wheelie > 0) {
    if (run.wheelie >= 1.5) {
      const reward = Math.round(run.wheelie * 15) * mult;
      run.wheelieCoins += reward;
      popup(`Wheelie ${run.wheelie.toFixed(1)} s +${fmt(reward)}`, "#c06bff");
      bumpCoins();
    }
    run.bestWheelie = Math.max(run.bestWheelie, run.wheelie);
    run.wheelie = 0;
  }

  // Milestones, medals, passing your best, and missions.
  const best = save.stages[stage.id];
  if (run.distance >= run.milestone) {
    popup(`${fmt(run.milestone)} m!`, "#23263a");
    run.milestone += 500;
  }
  stage.medals.forEach((metres, k) => {
    if (run.distance >= metres && best.medals <= k && !run.rewards.some((r) => r.medal === k)) {
      const [name, coins] = MEDALS[k];
      run.rewards.push({ medal: k, text: `${name[0].toUpperCase() + name.slice(1)} medal (${fmt(metres)} m)`, coins });
      popup(`${name[0].toUpperCase() + name.slice(1)} medal! +${fmt(coins)}`, "#e69f00");
      play("fanfare", { volume: 0.5 });
    }
  });
  if (!run.passedBest && run.distance > best.best) {
    run.passedBest = true;
    popup("New best!", "#ff6b3d");
    play("fanfare", { volume: 0.5 });
  }
  if (!run.reason) checkMissions();

  // Dust from spinning wheels, smoke from the exhaust.
  const lightFx = save.settings.light;
  car.wheels.forEach((wheel, k) => {
    const p = wheel.getPosition();
    if (contacts.wheel[k] > 0 && Math.abs(wheel.getAngularVelocity()) > 8 && Math.random() < (lightFx ? 0.05 : 0.12)) {
      particles.push({ x: p.x - 0.3, y: p.y - spec.wheels[k].r + 0.1, vx: -1 - Math.random() * 2 + speed * 0.3, vy: 1 + Math.random() * 1.5, life: 0.6, age: 0, size: 0.07 + Math.random() * 0.1, colour: "dust" });
    }
  });
  if (gas && Math.random() < (lightFx ? 0.06 : 0.15)) {
    const p = body.getWorldPoint(Vec2(spec.body[0][0] - 0.1, spec.body[0][1] + 0.12));
    particles.push({ x: p.x, y: p.y, vx: -1.5 + speed * 0.5, vy: 0.6 + Math.random() * 0.5, life: 0.6, age: 0, size: 0.12 + Math.random() * 0.1, colour: "smoke" });
  }

  // The end of a run: your head touched the ground, you fell into a ravine, or the tank is
  // empty and you've stopped.
  if (!run.reason && contacts.head) {
    run.reason = "crash";
    shake = 0.5;
    vibrate([40, 30, 60]);
    play("crash", { volume: 0.7 });
    const head = body.getWorldPoint(Vec2(spec.head.x, spec.head.y));
    burst(head.x, head.y, "#ffffff", 14);
  }
  const ravine = bridgeAt(pos.x);
  if (!run.reason && ravine && pos.y < ravine.rim - 3) {
    run.reason = stage.bridges === "lava" ? "lava" : "river";
    shake = 0.4;
    vibrate([40, 30, 60]);
    play("crash", { volume: 0.6, rate: 0.8 });
    burst(pos.x, ravine.floor + 1.5, stage.bridges === "lava" ? "#ff7a1f" : "#8fd3ff", 24);
  }
  if (!run.reason && !hasFuel) {
    run.stopped = Math.abs(speed) < 0.3 ? run.stopped + dt : 0;
    if (run.stopped > 1.5) run.reason = "fuel";
  }
  if (run.reason && !run.over) {
    run.ending += dt;
    if (run.ending > (run.reason === "fuel" ? 0.4 : 1.6)) endRun();
  }
}

function smashCrates(stage) {
  for (const box of contacts.smashed) {
    for (const chunk of chunks.values()) {
      const index = chunk.things.findIndex((thing) => thing.body === box);
      if (index < 0) continue;
      chunk.things.splice(index, 1);
      const p = box.getPosition();
      world.destroyBody(box);
      if (run && !run.reason) {
        const reward = 10 * stage.coinMult;
        run.coins += reward;
        popup(`Smash! +${reward}`, "#a0703f");
        bumpCoins();
      }
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * Math.PI * 2;
        particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4 + 3, life: 0.8, age: 0, size: 0.12, colour: "#c98b4f" });
      }
      play("crash", { volume: 0.35, rate: 1.6 });
    }
  }
  contacts.smashed = [];
}

function missionValue(m) {
  switch (m.kind) {
    case "distance": return run.distance;
    case "flips": return run.flips;
    case "coins": return runCoins();
    case "air": return Math.max(run.bestAir, run.airTime);
    case "cans": return run.cans;
    case "wheelie": return Math.max(run.bestWheelie, run.wheelie);
    case "total": return (save.stats.distance + run.distance - m.start) / 1000;
    default: return 0;
  }
}

function checkMissions() {
  for (const m of save.missions.active) {
    if (m.done || missionValue(m) < m.target) continue;
    m.done = true;
    run.rewards.push({ text: m.text, coins: m.reward });
    popup(`Mission done! +${fmt(m.reward)}`, "#2ebf7a");
    play("fanfare", { volume: 0.5 });
    vibrate(30);
  }
}

function endRun(byPlayer = false) {
  if (run.over) return;
  run.over = true;
  if (byPlayer) run.reason = run.reason || "ended";
  const stage = road.stage;
  const record = save.stages[stage.id];
  const bonus = run.rewards.reduce((sum, r) => sum + r.coins, 0);
  const earned = runCoins() + bonus;
  const metres = Math.floor(run.distance);
  const oldBest = record.best;
  for (const r of run.rewards) if (r.medal !== undefined) record.medals = Math.max(record.medals, r.medal + 1);
  record.best = Math.max(record.best, metres);
  save.coins += earned;
  const stats = save.stats;
  stats.runs++;
  stats.distance += run.distance;
  stats.coins += earned;
  stats.flips += run.flips;
  stats.bestAir = Math.max(stats.bestAir, run.bestAir);
  stats.bestWheelie = Math.max(stats.bestWheelie, run.bestWheelie);
  if (run.reason === "crash") stats.crashes++;
  fillMissions();
  persist();
  platform.gameplayStop();
  input.gas = input.brake = false;
  showResult(earned, metres, metres > oldBest, oldBest);
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

function vibrate(pattern) {
  if (save.settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
}

// ---------------------------------------------------------------------------------------------
// 7. Drawing the world
// ---------------------------------------------------------------------------------------------

const canvas = $("stage");
let ctx = canvas.getContext("2d"); // "let": the garage borrows the drawing code for its picture
const shade = document.createElement("canvas"); // the darkness at night, with holes for the lights
const shadeCtx = shade.getContext("2d");
const view = { w: 0, h: 0, dpr: 1, scale: 30 };
const camera = { x: 0, y: 0, zoom: 1, anchor: 0.36, anchorY: 0.56 }; // anchors: where you sit on screen
let lights = [];   // glowing things this frame (for the night)
let weather = [];  // snowflakes, embers, fireflies...

function layout() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = innerWidth;
  view.h = innerHeight;
  canvas.width = shade.width = Math.round(view.w * view.dpr);
  canvas.height = shade.height = Math.round(view.h * view.dpr);
  // Show about 30 m across on a wide screen, and at least 13 m top to bottom on a tall one.
  view.scale = Math.min(Math.max(view.w, view.h) / 30, view.h / 13);
}

// World (metres, y up) to screen (pixels, y down).
function toScreen(x, y) {
  const s = view.scale * camera.zoom;
  return { x: view.w * camera.anchor + (x - camera.x) * s, y: view.h * camera.anchorY - (y - camera.y) * s };
}

function updateCamera(dt) {
  if (!car) return;
  const p = car.body.getPosition();
  const v = car.body.getLinearVelocity();
  const k = 1 - Math.pow(0.002, dt);
  // High in the air, look down towards the ground and zoom out, so you can see where you'll land.
  const above = Math.max(0, p.y - groundAt(p.x) - 1.5);
  camera.x = lerp(camera.x, p.x + clamp(v.x * 0.25, -3, 5), k);
  camera.y = lerp(camera.y, p.y + 0.5 - clamp(above * 0.5, 0, 10), 1 - Math.pow(0.02, dt));
  const lowGravity = road && road.stage.gravity < 5 ? 0.1 : 0;
  camera.zoom = lerp(camera.zoom, 1 - lowGravity - clamp(Math.abs(v.x) / 60, 0, 0.18) - clamp(above / 30, 0, 0.35), k * 0.3);
  const still = screen !== "drive" && screen !== "paused" && screen !== "result";
  const wide = view.w > view.h * 1.1;
  camera.anchor = lerp(camera.anchor, still ? (wide ? 0.17 : 0.5) : 0.36, 1 - Math.pow(0.01, dt));
  camera.anchorY = lerp(camera.anchorY, still && !wide ? 0.17 : 0.56, 1 - Math.pow(0.01, dt));
}

function draw(now) {
  const { w, h } = view;
  const stage = road.stage;
  const c = stage.colours;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 18, (Math.random() - 0.5) * shake * 18);
  const s = view.scale * camera.zoom;
  const x0 = camera.x - (w * camera.anchor) / s - 1;
  const x1 = camera.x + (w * (1 - camera.anchor)) / s + 1;
  lights = [];

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, c.skyTop);
  sky.addColorStop(1, c.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, w + 40, h + 40);
  if (stage.sky !== "sun") {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let k = 0; k < 90; k++) {
      const span = w + 200;
      const sx = (((hash01(k * 3) * span - camera.x * s * 0.02) % span) + span) % span - 100;
      const twinkle = 0.5 + 0.5 * Math.sin(now / 500 + k);
      ctx.globalAlpha = 0.4 + 0.6 * twinkle;
      ctx.fillRect(sx, hash01(k * 5) * h * 0.6, k % 7 === 0 ? 2.5 : 1.5, k % 7 === 0 ? 2.5 : 1.5);
    }
    ctx.globalAlpha = 1;
  }
  const r0 = Math.min(w, h) * 0.06;
  if (stage.sky === "earth") {
    ctx.fillStyle = "#3d7fd9";
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.2, r0 * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4fbf6a";
    ctx.beginPath();
    ctx.ellipse(w * 0.77, h * 0.19, r0 * 0.5, r0 * 0.35, 0.6, 0, Math.PI * 2);
    ctx.ellipse(w * 0.8, h * 0.23, r0 * 0.3, r0 * 0.45, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(w * 0.79, h * 0.15, r0 * 0.6, r0 * 0.12, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = stage.sky === "moon" ? "#f4f1d0" : stage.id === "volcano" ? "rgba(255, 210, 150, 0.9)" : "rgba(255, 244, 196, 0.95)";
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.18, r0, 0, Math.PI * 2);
    ctx.fill();
    if (stage.sky === "moon") lights.push({ x: w * 0.8, y: h * 0.18, r: r0 * 2.2, a: 0.5 });
  }
  if (stage.sky === "sun" && stage.id !== "volcano") {
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
  if (stage.id === "volcano") drawVolcanoPeak(w, h, now);

  // two rows of faraway hills, moving slower than the road (that's what makes it look deep)
  drawHills(0.15, h * 0.58, h * 0.22, c.far, 5);
  drawHills(0.35, h * 0.7, h * 0.18, c.near, 6);

  for (const item of road.decor) {
    if (item.x > x0 - 4 && item.x < x1 + 4) drawDecor(item, s, now);
  }

  drawGround(x0, x1, s);
  for (const bridge of road.bridges) {
    if (bridge.b > x0 && bridge.a < x1) drawRavine(bridge, s, now);
  }
  for (const chunk of chunks.values()) {
    for (const thing of chunk.things) drawThing(thing, s);
  }

  // distance signs every 100 m, and a flag at your best
  for (let m = Math.ceil(x0 / 100) * 100; m <= x1; m += 100) {
    if (m > 0 && !bridgeAt(m + 1.5)) drawSign(m + 1.5, `${fmt(m)} m`, s);
  }
  const best = save.stages[stage.id].best;
  if (best > 20 && best + 1.5 > x0 && best + 1.5 < x1) drawFlag(best + 1.5, s);

  for (const can of road.cans) {
    if (!can.taken && can.x > x0 && can.x < x1) drawCan(can, s, now);
  }
  for (const coin of road.coins) {
    if (!coin.taken && coin.x > x0 && coin.x < x1) drawCoin(coin, s, now);
  }

  if (car) drawCar(s);

  for (const p of particles) {
    const q = toScreen(p.x, p.y);
    const k = p.age / p.life;
    ctx.globalAlpha = (1 - k) * (p.colour === "dust" ? 0.7 : 1);
    ctx.fillStyle = p.colour === "dust" ? c.dirt : p.colour === "smoke" ? "rgba(90,90,100,0.6)" : p.colour;
    ctx.beginPath();
    ctx.arc(q.x, q.y, p.size * s * (p.colour === "smoke" ? 1 + k * 2 : 1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawWeather(now);
  if (stage.night) drawNight(s);
  if (stage.id === "volcano") {
    const heat = ctx.createLinearGradient(0, h * 0.5, 0, h);
    heat.addColorStop(0, "rgba(255,90,30,0)");
    heat.addColorStop(1, "rgba(255,90,30,0.12)");
    ctx.fillStyle = heat;
    ctx.fillRect(0, 0, w, h);
  }

  // words that float up from the vehicle
  if (car) {
    const p = toScreen(car.body.getPosition().x, car.body.getPosition().y);
    popups.forEach((item, k) => {
      const t = item.age / 1.5;
      ctx.globalAlpha = 1 - smoothstep(0.65, 1, t);
      ctx.font = `900 ${Math.round(clamp(s * 0.75, 18, 30) * (1 + 0.25 * (1 - smoothstep(0, 0.12, t))))}px Nunito, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      const y = p.y - s * 2.8 - t * s * 1.6 - k * s * 0.9;
      ctx.strokeText(item.text, p.x, y);
      ctx.fillStyle = item.colour;
      ctx.fillText(item.text, p.x, y);
    });
    ctx.globalAlpha = 1;
  }
}

function drawVolcanoPeak(w, h, now) {
  const base = h * 0.6;
  const cx = w * 0.55 - (camera.x * view.scale * 0.03) % (w * 1.5);
  const glow = ctx.createRadialGradient(cx, base - h * 0.32, 0, cx, base - h * 0.32, h * 0.3);
  glow.addColorStop(0, "rgba(255,140,60,0.55)");
  glow.addColorStop(1, "rgba(255,140,60,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2a1418";
  ctx.beginPath();
  ctx.moveTo(cx - h * 0.6, base);
  ctx.lineTo(cx - h * 0.08, base - h * 0.32);
  ctx.lineTo(cx + h * 0.08, base - h * 0.32);
  ctx.lineTo(cx + h * 0.6, base);
  ctx.fill();
  ctx.fillStyle = "#ff6a2a";
  ctx.beginPath();
  ctx.moveTo(cx - h * 0.08, base - h * 0.32);
  ctx.lineTo(cx + h * 0.08, base - h * 0.32);
  ctx.lineTo(cx + h * 0.03, base - h * 0.2 + Math.sin(now / 400) * 4);
  ctx.lineTo(cx - h * 0.05, base - h * 0.24);
  ctx.fill();
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
    const y = base + shiftY - (noise(wx / 18, salt + road.salt) * 0.75 + noise(wx / 6, salt + 1) * 0.25) * height;
    ctx.lineTo(sx, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function drawGround(x0, x1, s) {
  const { h } = view;
  const c = road.stage.colours;
  const from = Math.max(-8, Math.floor(x0));
  const to = Math.ceil(x1);
  buildRoad(to + 2);
  const top = (x) => toScreen(x, x < 0 ? road.heights[0] : road.heights[x]);

  ctx.beginPath();
  ctx.moveTo(top(from).x, h + 40);
  for (let x = from; x <= to; x++) { const p = top(x); ctx.lineTo(p.x, p.y); }
  ctx.lineTo(top(to).x, h + 40);
  ctx.closePath();
  const earth = ctx.createLinearGradient(0, toScreen(0, camera.y).y - s * 2, 0, h);
  earth.addColorStop(0, c.dirt);
  earth.addColorStop(1, c.dirtDeep);
  ctx.fillStyle = earth;
  ctx.fill();

  // pebbles (glowing cracks on the volcano, craters on the Moon)
  if (!save.settings.light) {
    ctx.fillStyle = c.pebble;
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
  }

  // the grass (or sand, or snow) on top: a dark edge, then a lighter strip
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [width, colour] of [[0.62, c.grassDark], [0.36, c.grass]]) {
    ctx.beginPath();
    let drawing = false;
    for (let x = from; x <= to; x++) {
      const over = bridgeAt(x - 0.5) && bridgeAt(x + 0.5);
      if (over && x > 0) { drawing = false; continue; }
      const p = top(x);
      if (!drawing) ctx.moveTo(p.x, p.y + width * s * 0.3);
      else ctx.lineTo(p.x, p.y + width * s * 0.3);
      drawing = true;
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * s;
    ctx.stroke();
  }
}

// The river (or lava) at the bottom of a ravine, and the bridge's posts.
function drawRavine(bridge, s, now) {
  const lava = road.stage.bridges === "lava";
  const left = toScreen(bridge.a + 0.05, bridge.floor + 2);
  const right = toScreen(bridge.b - 0.05, bridge.floor);
  ctx.fillStyle = lava ? "#ff5a1f" : "rgba(61, 157, 245, 0.9)";
  ctx.fillRect(left.x, left.y, right.x - left.x, right.y - left.y + 2);
  ctx.strokeStyle = lava ? "#ffd23d" : "rgba(255,255,255,0.7)";
  ctx.lineWidth = Math.max(2, s * 0.08);
  ctx.beginPath();
  for (let x = left.x; x <= right.x; x += 6) {
    const y = left.y + Math.sin(x / 14 + now / (lava ? 500 : 300)) * s * 0.06;
    if (x === left.x) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (lava) lights.push({ x: (left.x + right.x) / 2, y: left.y, r: s * 5, a: 0.6 });
  for (const x of [bridge.a, bridge.b]) {
    const p = toScreen(x, bridge.rim);
    ctx.fillStyle = "#6b4a32";
    ctx.fillRect(p.x - 0.07 * s, p.y - 1.3 * s, 0.14 * s, 1.3 * s);
    ctx.fillStyle = "#4e3423";
    ctx.beginPath();
    ctx.arc(p.x, p.y - 1.3 * s, 0.11 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawThing(thing, s) {
  const p = thing.body.getPosition();
  const q = toScreen(p.x, p.y);
  ctx.save();
  ctx.translate(q.x, q.y);
  ctx.rotate(-thing.body.getAngle());
  if (thing.kind === "plank") {
    ctx.fillStyle = "#a0703f";
    ctx.fillRect(-0.5 * s, -0.11 * s, 0.98 * s, 0.22 * s);
    ctx.fillStyle = "#7a5230";
    ctx.fillRect(-0.5 * s, 0.04 * s, 0.98 * s, 0.07 * s);
    ctx.strokeStyle = "#d8c49a";
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(-0.5 * s, -0.11 * s);
    ctx.lineTo(0.5 * s, -0.11 * s);
    ctx.stroke();
  } else {
    const r = 0.42 * s;
    ctx.fillStyle = "#c98b4f";
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.strokeStyle = "#8a5a30";
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    ctx.beginPath();
    ctx.moveTo(-r, -r);
    ctx.lineTo(r, r);
    ctx.moveTo(r, -r);
    ctx.lineTo(-r, r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDecor(item, s, now) {
  const kinds = road.stage.decor;
  const kind = kinds[Math.floor(item.pick * kinds.length)];
  const base = toScreen(item.x, groundAt(item.x) - 0.2);
  const u = s * item.size;
  ctx.save();
  ctx.translate(base.x, base.y);
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
    ctx.fillStyle = road.stage.night ? "#2c7a57" : "#5fb553";
    for (const [dx, r] of [[-0.35, 0.4], [0.3, 0.45], [0, 0.55]]) {
      ctx.beginPath();
      ctx.arc(dx * u, -0.35 * u, r * u, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "rock") {
    ctx.fillStyle = road.stage.id === "moon" ? "#8d909c" : "rgba(110,105,110,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, -0.25 * u, 0.6 * u, 0.42 * u, 0, Math.PI, 0);
    ctx.fill();
  } else if (kind === "fence") {
    ctx.fillStyle = "#c9a172";
    for (const dx of [-0.8, 0, 0.8]) ctx.fillRect((dx - 0.06) * u, -0.9 * u, 0.12 * u, 0.9 * u);
    ctx.fillRect(-0.9 * u, -0.75 * u, 1.8 * u, 0.1 * u);
    ctx.fillRect(-0.9 * u, -0.4 * u, 1.8 * u, 0.1 * u);
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
  } else if (kind === "skull") {
    ctx.fillStyle = "#f3e6cf";
    ctx.beginPath();
    ctx.ellipse(0, -0.25 * u, 0.3 * u, 0.22 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f3e6cf";
    ctx.lineWidth = 0.08 * u;
    ctx.beginPath();
    ctx.moveTo(-0.25 * u, -0.35 * u);
    ctx.quadraticCurveTo(-0.7 * u, -0.7 * u, -0.6 * u, -0.25 * u);
    ctx.moveTo(0.25 * u, -0.35 * u);
    ctx.quadraticCurveTo(0.7 * u, -0.7 * u, 0.6 * u, -0.25 * u);
    ctx.stroke();
  } else if (kind === "pine") {
    ctx.fillStyle = road.stage.night ? "#1d4a4a" : "#3f7f6a";
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(0, (-3 + k * 0.75) * u);
      ctx.lineTo(0.75 * u * (1 + k * 0.25), (-1.6 + k * 0.6) * u);
      ctx.lineTo(-0.75 * u * (1 + k * 0.25), (-1.6 + k * 0.6) * u);
      ctx.fill();
    }
    if (road.stage.id === "arctic") {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(0, (-3 + k * 0.75) * u);
        ctx.lineTo(0.35 * u, (-2.5 + k * 0.75) * u);
        ctx.lineTo(-0.35 * u, (-2.5 + k * 0.75) * u);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#5a4030";
    ctx.fillRect(-0.1 * u, -0.5 * u, 0.2 * u, 0.6 * u);
  } else if (kind === "snowman") {
    ctx.fillStyle = "#ffffff";
    for (const [y, r] of [[-0.45, 0.45], [-1.15, 0.33], [-1.65, 0.24]]) {
      ctx.beginPath();
      ctx.arc(0, y * u, r * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ff8a3d";
    ctx.beginPath();
    ctx.moveTo(0.1 * u, -1.65 * u);
    ctx.lineTo(0.45 * u, -1.6 * u);
    ctx.lineTo(0.1 * u, -1.56 * u);
    ctx.fill();
    ctx.fillStyle = "#23263a";
    ctx.fillRect(-0.24 * u, -2.0 * u, 0.48 * u, 0.12 * u);
    ctx.fillRect(-0.16 * u, -2.35 * u, 0.32 * u, 0.36 * u);
  } else if (kind === "mushroom") {
    ctx.fillStyle = "#e9e2d0";
    ctx.fillRect(-0.08 * u, -0.5 * u, 0.16 * u, 0.5 * u);
    ctx.fillStyle = "#62f0d0";
    ctx.beginPath();
    ctx.ellipse(0, -0.5 * u, 0.38 * u, 0.24 * u, 0, Math.PI, 0);
    ctx.fill();
    lights.push({ x: base.x, y: base.y - 0.5 * u, r: 1.2 * u, a: 0.55 });
  } else if (kind === "lamp") {
    ctx.fillStyle = "#1f2140";
    ctx.fillRect(-0.06 * u, -2.6 * u, 0.12 * u, 2.6 * u);
    ctx.fillStyle = "#ffe8a0";
    ctx.beginPath();
    ctx.arc(0, -2.6 * u, 0.16 * u, 0, Math.PI * 2);
    ctx.fill();
    lights.push({ x: base.x, y: base.y - 2.6 * u, r: 2.6 * u, a: 0.9 });
  } else if (kind === "deadtree") {
    ctx.strokeStyle = "#1a1012";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.16 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0.1 * u, -2 * u);
    ctx.moveTo(0.05 * u, -1.2 * u);
    ctx.lineTo(0.6 * u, -1.7 * u);
    ctx.moveTo(0.08 * u, -1.6 * u);
    ctx.lineTo(-0.5 * u, -2.1 * u);
    ctx.stroke();
  } else if (kind === "lavarock") {
    ctx.fillStyle = "#24191c";
    ctx.beginPath();
    ctx.ellipse(0, -0.3 * u, 0.7 * u, 0.5 * u, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,${120 + Math.round(60 * Math.sin(now / 300 + item.x))},40,0.9)`;
    ctx.lineWidth = 0.06 * u;
    ctx.beginPath();
    ctx.moveTo(-0.4 * u, -0.3 * u);
    ctx.lineTo(-0.1 * u, -0.55 * u);
    ctx.lineTo(0.2 * u, -0.35 * u);
    ctx.lineTo(0.45 * u, -0.5 * u);
    ctx.stroke();
  } else if (kind === "crater") {
    ctx.fillStyle = "rgba(60,62,72,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, 0.05 * u, 0.9 * u, 0.18 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "flag") {
    ctx.strokeStyle = "#d8dbe2";
    ctx.lineWidth = 0.06 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -2 * u);
    ctx.stroke();
    ctx.fillStyle = "#ff6b3d";
    ctx.fillRect(0, -2 * u, 0.9 * u, 0.55 * u);
    ctx.fillStyle = "#ffc83d";
    ctx.beginPath();
    ctx.arc(0.45 * u, -1.72 * u, 0.13 * u, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "dish") {
    ctx.strokeStyle = "#b9bdc8";
    ctx.lineWidth = 0.08 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -1.1 * u);
    ctx.stroke();
    ctx.fillStyle = "#e4e7ee";
    ctx.beginPath();
    ctx.ellipse(0.1 * u, -1.3 * u, 0.6 * u, 0.25 * u, -0.6, 0, Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

function drawSign(x, text, s) {
  const base = toScreen(x, groundAt(x));
  ctx.fillStyle = "#6b4a32";
  ctx.fillRect(base.x - 0.05 * s, base.y - 1.7 * s, 0.1 * s, 1.7 * s);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(base.x - 0.85 * s, base.y - 2.3 * s, 1.7 * s, 0.75 * s, 0.15 * s);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#23263a";
  ctx.font = `900 ${Math.round(0.4 * s)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, base.x, base.y - 1.92 * s);
  ctx.textBaseline = "alphabetic";
}

function drawFlag(x, s) {
  const base = toScreen(x, groundAt(x));
  ctx.strokeStyle = road.stage.night || road.stage.id === "moon" ? "#ffffff" : "#23263a";
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
  ctx.fillStyle = ctx.strokeStyle;
  ctx.font = `900 ${Math.round(0.36 * s)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("BEST", base.x + 0.15 * s, base.y - 3.15 * s);
  lights.push({ x: base.x, y: base.y - 2.6 * s, r: 1.4 * s, a: 0.5 });
}

const COIN_COLOURS = { 5: ["#ffc83d", "#d08a00"], 10: ["#dfe6ee", "#8a99ab"], 25: ["#ff9b5e", "#c9561f"], 50: ["#c08bff", "#7a45c8"] };

function drawCoin(coin, s, now) {
  const p = toScreen(coin.x, coin.y + Math.sin(now / 300 + coin.x) * 0.06);
  const [fill, edge] = COIN_COLOURS[coin.tier];
  const r = (coin.tier >= 25 ? 0.36 : 0.3) * s;
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
    ctx.font = `900 ${Math.round(r * (coin.value >= 100 ? 0.7 : 0.9))}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(coin.value, p.x, p.y + 1);
    ctx.textBaseline = "alphabetic";
  }
  if (road.stage.night) lights.push({ x: p.x, y: p.y, r: r * 2.2, a: 0.5 });
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
  lights.push({ x: p.x, y: p.y, r: u * 3, a: 0.8 });
}

// Snow, embers, fireflies, falling leaves and dust, drifting across the screen.
function drawWeather(now) {
  const kind = road.stage.weather;
  if (!kind || save.settings.light) { weather = []; return; }
  const { w, h } = view;
  const count = { snow: 90, embers: 45, fireflies: 30, leaves: 14, dust: 40 }[kind];
  while (weather.length < count) {
    weather.push({ x: Math.random() * w, y: Math.random() * h, seed: Math.random() * 1000, size: 0.6 + Math.random() * 0.8 });
  }
  const dt = 1 / 60;
  const drift = screen === "drive" && car ? clamp(car.body.getLinearVelocity().x, -20, 20) * 2 : 0;
  for (const p of weather) {
    const t = now / 1000 + p.seed;
    if (kind === "snow") { p.y += (30 + p.size * 30) * dt; p.x += (Math.sin(t) * 20 - drift) * dt; }
    else if (kind === "embers") { p.y -= (25 + p.size * 30) * dt; p.x += (Math.sin(t * 2) * 25 - drift) * dt; }
    else if (kind === "fireflies") { p.x += (Math.sin(t * 0.7) * 25 - drift * 0.5) * dt; p.y += Math.cos(t * 0.9) * 18 * dt; }
    else if (kind === "leaves") { p.y += (25 + p.size * 15) * dt; p.x += (Math.sin(t) * 40 - drift - 20) * dt; }
    else { p.x -= (60 + p.size * 60 + drift) * dt; p.y += Math.sin(t) * 6 * dt; }
    if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
    if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;
    if (kind === "snow") ctx.fillStyle = "rgba(255,255,255,0.85)";
    else if (kind === "embers") ctx.fillStyle = `rgba(255,${130 + Math.round(80 * Math.sin(t * 5))},40,0.9)`;
    else if (kind === "fireflies") ctx.fillStyle = `rgba(220,255,120,${0.4 + 0.6 * Math.max(0, Math.sin(t * 3))})`;
    else if (kind === "leaves") ctx.fillStyle = "rgba(120,180,70,0.8)";
    else ctx.fillStyle = "rgba(255,230,190,0.45)";
    ctx.beginPath();
    if (kind === "leaves") ctx.ellipse(p.x, p.y, 5 * p.size, 2.5 * p.size, t, 0, Math.PI * 2);
    else ctx.arc(p.x, p.y, (kind === "dust" ? 1.2 : 2.2) * p.size, 0, Math.PI * 2);
    ctx.fill();
    if (kind === "fireflies") lights.push({ x: p.x, y: p.y, r: 14 * p.size, a: 0.6 });
  }
}

// Night: cover the screen in darkness, then cut out the headlight beam and every glowing thing.
function drawNight(s) {
  const { w, h } = view;
  const g = shadeCtx;
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgba(3, 5, 22, 0.8)";
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-out";
  if (car) {
    const { body, spec } = car;
    const lamp = body.getWorldPoint(Vec2(spec.light.x, spec.light.y));
    const ahead = body.getWorldVector(Vec2(1, -0.15));
    const p = toScreen(lamp.x, lamp.y);
    const angle = Math.atan2(-ahead.y, ahead.x);
    const reach = s * 12;
    const beam = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, reach);
    beam.addColorStop(0, "rgba(0,0,0,1)");
    beam.addColorStop(0.6, "rgba(0,0,0,0.7)");
    beam.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.arc(p.x, p.y, reach, angle - 0.42, angle + 0.42);
    g.closePath();
    g.fill();
    const centre = body.getPosition();
    lights.push({ x: toScreen(centre.x, centre.y).x, y: toScreen(centre.x, centre.y).y, r: s * 3.4, a: 0.85 });
  }
  for (const light of lights) {
    const glow = g.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.r);
    glow.addColorStop(0, `rgba(0,0,0,${light.a})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow;
    g.fillRect(light.x - light.r, light.y - light.r, light.r * 2, light.r * 2);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(shade, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// 8. Drawing the vehicles
// ---------------------------------------------------------------------------------------------
// Everything here is drawn in metres with y pointing up: the caller moves and scales the canvas.

function shadeOf(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(clamp(v * (1 - amount), 0, 255));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawCar(s) {
  const { body, wheels, spec } = car;
  const paint = save.vehicles[spec.id].paint;
  // springs between the body and the wheels
  ctx.strokeStyle = "#3a3d52";
  ctx.lineWidth = 0.12 * s;
  ctx.lineCap = "round";
  wheels.forEach((wheel, k) => {
    const anchor = body.getWorldPoint(Vec2(spec.wheels[k].x, spec.wheels[k].y + 0.35));
    const a = toScreen(anchor.x, anchor.y);
    const b = toScreen(wheel.getPosition().x, wheel.getPosition().y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  wheels.forEach((wheel, k) => {
    const c = wheel.getPosition();
    const p = toScreen(c.x, c.y);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, -s);
    ctx.rotate(wheel.getAngle());
    drawWheel(spec.wheels[k].r, spec.style);
    ctx.restore();
  });
  const centre = body.getPosition();
  const p = toScreen(centre.x, centre.y);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(s, -s);
  ctx.rotate(body.getAngle());
  drawBody(spec, paint, run && (run.reason === "crash"));
  ctx.restore();
}

function drawWheel(r, style) {
  ctx.fillStyle = "#2b2d3a";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  const knobs = style === "monster" || style === "tractor" ? 12 : 10;
  ctx.strokeStyle = "#454858";
  ctx.lineWidth = r * (style === "monster" || style === "tractor" ? 0.2 : 0.12);
  for (let k = 0; k < knobs; k++) {
    const a = (k / knobs) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
    ctx.lineTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96);
    ctx.stroke();
  }
  const rim = style === "bike" ? 0.72 : style === "monster" ? 0.45 : 0.52;
  ctx.fillStyle = style === "tractor" ? "#ffc83d" : style === "bike" ? "#3a3d52" : "#e4e7ee";
  ctx.beginPath();
  ctx.arc(0, 0, r * rim, 0, Math.PI * 2);
  ctx.fill();
  if (style === "bike") {
    ctx.fillStyle = "#e4e7ee";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.64, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#9aa1b2";
  ctx.lineWidth = r * (style === "bike" ? 0.04 : 0.1);
  const spokes = style === "bike" ? 12 : 5;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * rim * 0.88, Math.sin(a) * r * rim * 0.88);
    ctx.stroke();
  }
  ctx.fillStyle = "#ff6b3d";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

// The driver: a round little person in a big teal helmet.
function drawDriver(head, hands, seat, crashed) {
  ctx.strokeStyle = "#3d6fd1";
  ctx.lineCap = "round";
  ctx.lineWidth = 0.3;                                   // body
  ctx.beginPath();
  ctx.moveTo(seat.x, seat.y);
  ctx.lineTo(head.x - 0.02, head.y - 0.32);
  ctx.stroke();
  ctx.lineWidth = 0.12;                                  // arm
  ctx.beginPath();
  ctx.moveTo(head.x, head.y - 0.38);
  ctx.lineTo(hands.x, hands.y);
  ctx.stroke();
  ctx.fillStyle = "#ffd3a8";                             // face
  ctx.beginPath();
  ctx.arc(head.x, head.y, head.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#24b3a4";                             // helmet
  ctx.beginPath();
  ctx.arc(head.x, head.y + 0.02, head.r + 0.03, Math.PI * 0.05, Math.PI * 1.08);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(head.x - 0.04, head.y + 0.1, 0.08, 0.17);
  ctx.fillStyle = "#23263a";                             // goggles
  ctx.beginPath();
  ctx.roundRect(head.x + 0.04, head.y - 0.06, 0.22, 0.12, 0.05);
  ctx.fill();
  ctx.fillStyle = "#8fe3ff";
  ctx.beginPath();
  ctx.arc(head.x + 0.16, head.y, 0.04, 0, Math.PI * 2);
  ctx.fill();
  if (crashed) {
    ctx.strokeStyle = "#ffc83d";
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(head.x, head.y + 0.42, 0.16, 0, Math.PI * 1.6);
    ctx.stroke();
  }
}

function outline(points) {
  ctx.beginPath();
  points.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function drawBody(spec, paint, crashed) {
  const dark = shadeOf(paint, 0.3);
  const head = spec.head;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (spec.style === "truck") {
    drawDriver(head, { x: 0.42, y: 0.52 }, { x: head.x, y: 0.3 }, crashed);
    ctx.strokeStyle = "#23263a";
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(0.36, 0.32);
    ctx.lineTo(0.46, 0.6);
    ctx.stroke();
    ctx.fillStyle = "rgba(170, 225, 255, 0.55)";
    outline([[0.55, 0.3], [0.7, 0.86], [0.8, 0.86], [0.72, 0.3]]);
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.stroke();
    outline(spec.body);
    ctx.fillStyle = paint;
    ctx.fill();
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.fillStyle = dark;
    ctx.fillRect(-1.36, -0.2, 2.72, 0.12);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(-1.25, 0.12, 0.5, 0.06);
    ctx.fillRect(0.1, 0.2, 0.9, 0.06);
    ctx.fillStyle = "#c9c2b0";                           // a patch: it's a rattletrap after all
    ctx.fillRect(-1.05, -0.02, 0.26, 0.16);
    ctx.strokeStyle = "#8b8474";
    ctx.lineWidth = 0.02;
    ctx.strokeRect(-1.05, -0.02, 0.26, 0.16);
  } else if (spec.style === "bike") {
    ctx.strokeStyle = "#3a3d52";                         // frame and forks
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-0.72, -0.36);
    ctx.lineTo(-0.15, 0.15);
    ctx.lineTo(0.55, 0.3);
    ctx.lineTo(0.8, -0.36);
    ctx.moveTo(0.55, 0.3);
    ctx.lineTo(0.5, 0.62);
    ctx.stroke();
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(0.38, 0.66);
    ctx.lineTo(0.62, 0.6);
    ctx.stroke();
    // rider: body leaning forward, leg down to the footpeg
    ctx.strokeStyle = "#2f4f9e";
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(-0.22, 0.48);
    ctx.lineTo(0.05, 0.12);
    ctx.lineTo(0.0, -0.05);
    ctx.stroke();
    drawDriver(head, { x: 0.5, y: 0.62 }, { x: -0.22, y: 0.48 }, crashed);
    ctx.fillStyle = paint;                               // tank and side panel
    outline([[-0.1, 0.32], [0.45, 0.36], [0.52, 0.18], [0.05, 0.1]]);
    ctx.fill();
    outline([[-0.72, 0.28], [-0.25, 0.42], [-0.05, 0.38], [-0.3, 0.12]]);
    ctx.fill();
    ctx.fillStyle = "#23263a";                           // seat
    outline([[-0.6, 0.42], [-0.05, 0.47], [-0.05, 0.4], [-0.55, 0.34]]);
    ctx.fill();
    ctx.fillStyle = dark;                                // engine
    ctx.fillRect(-0.18, -0.1, 0.4, 0.26);
    ctx.fillStyle = "#c9ccd6";                           // exhaust
    ctx.fillRect(-0.75, 0.05, 0.4, 0.07);
  } else if (spec.style === "tractor") {
    ctx.fillStyle = "#23263a";                           // exhaust stack
    ctx.fillRect(0.82, 0.35, 0.09, 0.62);
    ctx.fillRect(0.78, 0.95, 0.17, 0.06);
    drawDriver(head, { x: 0.18, y: 0.78 }, { x: head.x, y: 0.5 }, crashed);
    ctx.strokeStyle = "#23263a";
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(0.0, 0.42);
    ctx.lineTo(0.18, 0.82);
    ctx.stroke();
    ctx.fillStyle = dark;                                // seat
    ctx.fillRect(-0.75, 0.42, 0.45, 0.1);
    ctx.fillRect(-0.8, 0.42, 0.08, 0.45);
    outline(spec.body);
    ctx.fillStyle = paint;
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.fillStyle = dark;                                // grille
    for (let k = 0; k < 4; k++) ctx.fillRect(1.15, -0.08 + k * 0.1, 0.16, 0.05);
    ctx.fillStyle = paint;                               // big rear mudguard
    ctx.beginPath();
    ctx.arc(-0.62, -0.25, 0.78, Math.PI * 0.05, Math.PI * 0.95);
    ctx.lineTo(-1.36, -0.15);
    ctx.lineTo(0.14, -0.15);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(0.3, 0.25, 0.8, 0.05);
  } else if (spec.style === "monster") {
    drawDriver(head, { x: 0.45, y: 0.82 }, { x: head.x, y: 0.55 }, crashed);
    ctx.strokeStyle = "#23263a";
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(0.4, 0.58);
    ctx.lineTo(0.5, 0.86);
    ctx.stroke();
    ctx.fillStyle = "rgba(170, 225, 255, 0.55)";
    outline([[0.6, 0.56], [0.78, 1.1], [0.9, 1.1], [0.78, 0.56]]);
    ctx.fill();
    outline(spec.body);
    ctx.fillStyle = paint;
    ctx.fill();
    ctx.lineWidth = 0.06;
    ctx.strokeStyle = dark;
    ctx.stroke();
    ctx.fillStyle = "#ffc83d";                           // flames
    outline([[-1.2, 0.18], [-0.5, 0.22], [-0.75, 0.32], [-0.2, 0.3], [-0.55, 0.42], [-1.2, 0.42]]);
    ctx.fill();
    ctx.fillStyle = "#ff6b3d";
    outline([[-1.2, 0.24], [-0.75, 0.27], [-0.9, 0.34], [-0.55, 0.34], [-0.85, 0.39], [-1.2, 0.39]]);
    ctx.fill();
    ctx.fillStyle = "#3a3d52";                           // chassis
    ctx.fillRect(-1.2, -0.12, 2.4, 0.17);
  }
  ctx.fillStyle = "#ffe66b";                             // headlight
  ctx.beginPath();
  ctx.arc(spec.light.x - 0.03, spec.light.y, 0.07, 0, Math.PI * 2);
  ctx.fill();
}

// A still picture of a vehicle, for the garage.
function drawPreview(canvasEl, spec, paint) {
  const g = canvasEl.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvasEl.clientWidth || 170;
  const h = canvasEl.clientHeight || 100;
  canvasEl.width = w * dpr;
  canvasEl.height = h * dpr;
  const s = h / 2.9;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgba(91, 187, 75, 0.9)";
  g.fillRect(0, h * 0.86, w, h * 0.14);
  const lowest = Math.min(...spec.wheels.map((wh) => wh.y - wh.r));
  g.translate(w / 2, h * 0.86 + lowest * s);
  g.scale(s, -s);
  swapContext(g, () => {
    g.strokeStyle = "#3a3d52";
    g.lineWidth = 0.12;
    for (const wheel of spec.wheels) {
      g.beginPath();
      g.moveTo(wheel.x, wheel.y + 0.35);
      g.lineTo(wheel.x, wheel.y);
      g.stroke();
    }
    for (const wheel of spec.wheels) {
      g.save();
      g.translate(wheel.x, wheel.y);
      drawWheel(wheel.r, spec.style);
      g.restore();
    }
    drawBody(spec, paint, false);
  });
}
// Runs fn with the drawing code pointed at another canvas, then points it back.
function swapContext(g, fn) {
  const main = ctx;
  ctx = g;
  try { fn(); } finally { ctx = main; }
}

// ---------------------------------------------------------------------------------------------
// 9. Screens
// ---------------------------------------------------------------------------------------------

function show(name) {
  screen = name;
  document.body.dataset.screen = name;
  if (name !== "drive") input.gas = input.brake = false;
  document.querySelectorAll(".pedal").forEach((pedal) => pedal.classList.remove("down"));
  updateMusic();
}

const stageArt = (stage) => `linear-gradient(180deg, ${stage.colours.skyTop} 0%, ${stage.colours.skyBottom} 55%, ${stage.colours.grass} 56%, ${stage.colours.grass} 64%, ${stage.colours.dirt} 65%, ${stage.colours.dirtDeep} 100%)`;

function renderMenu() {
  const stage = stageNow();
  const vehicle = vehicleNow();
  $("menu-coins").textContent = fmt(save.coins);
  const pickStage = $("pick-stage");
  pickStage.style.setProperty("--art", stageArt(stage));
  pickStage.classList.toggle("light", true);
  $("pick-stage-name").textContent = stage.name;
  $("pick-stage-best").textContent = `best ${fmt(save.stages[stage.id].best)} m`;
  $("pick-vehicle-name").textContent = vehicle.name;
  const L = save.vehicles[vehicle.id].levels;
  $("pick-vehicle-note").textContent = `upgrades ${L.engine + L.suspension + L.tires + L.fuel} / 40`;
  const affordable = VEHICLES.some((v) => save.vehicles[v.id].owned && UPGRADES.some((u) => save.vehicles[v.id].levels[u.id] < MAX_LEVEL && save.coins >= upgradeCost(u, save.vehicles[v.id].levels[u.id], v)));
  $("garage-dot").hidden = !affordable;
  $("gift").hidden = save.gift === todayKey();
  $("mission-list").innerHTML = save.missions.active.map((m) => {
    const value = Math.min(m.target, m.kind === "total" ? (save.stats.distance - m.start) / 1000 : 0);
    const share = m.kind === "total" ? clamp(value / m.target, 0, 1) : 0;
    return `<div class="mission"><span>${m.text}</span><span class="reward"><svg class="icon"><use href="#i-coin"/></svg>${fmt(m.reward)}</span>
      ${m.kind === "total" ? `<div class="bar"><i style="width:${Math.round(share * 100)}%"></i></div>` : ""}</div>`;
  }).join("");
  document.querySelectorAll(".coins-now").forEach((el) => { el.textContent = fmt(save.coins); });
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

// ----- adventures -----

function renderStages() {
  document.querySelectorAll(".coins-now").forEach((el) => { el.textContent = fmt(save.coins); });
  $("stage-list").innerHTML = STAGES.map((stage) => {
    const record = save.stages[stage.id];
    const medals = MEDALS.map(([name], k) => `<svg class="icon ${record.medals > k ? name : ""}"><use href="#i-medal"/></svg>`).join("");
    const state = record.owned
      ? `<span class="state">best <b>${fmt(record.best)} m</b> <span class="medals">${medals}</span></span>`
      : `<span class="state buy ${save.coins >= stage.cost ? "" : "poor"}"><svg class="icon"><use href="#i-lock"/></svg> Unlock <svg class="icon"><use href="#i-coin"/></svg> ${fmt(stage.cost)}</span>`;
    const tags = [stage.gravity < 5 ? "low gravity" : "", stage.friction < 0.6 ? "icy" : "", stage.bridges ? "bridges" : "", stage.night ? "night" : "", stage.coinMult > 1 ? `coins ×${stage.coinMult}` : ""].filter(Boolean).join(" · ");
    return `<button class="card ${record.owned ? "" : "locked"} ${stage.id === save.stage ? "chosen" : ""}" data-stage="${stage.id}">
      <div class="art" style="background:${stageArt(stage)}">${tags ? `<span>${tags}</span>` : ""}</div>
      <div class="body"><h3>${stage.name}</h3><p>${stage.about}</p>${state}</div>
    </button>`;
  }).join("");
}

$("stage-list").addEventListener("click", (event) => {
  const card = event.target.closest("[data-stage]");
  if (!card) return;
  const stage = STAGES.find((s) => s.id === card.dataset.stage);
  const record = save.stages[stage.id];
  if (!record.owned) {
    if (save.coins < stage.cost) {
      toast(`You need ${fmt(stage.cost - save.coins)} more coins for ${stage.name}`);
      play("tick", { volume: 0.4 });
      return;
    }
    save.coins -= stage.cost;
    record.owned = true;
    toast(`${stage.name} unlocked!`);
    play("fanfare", { volume: 0.5 });
  }
  save.stage = stage.id;
  persist();
  newRun();
  renderStages();
  play("tick", { volume: 0.3 });
});

// ----- garage -----

let garageVehicle = save.vehicle;

function renderGarage() {
  document.querySelectorAll(".coins-now").forEach((el) => { el.textContent = fmt(save.coins); });
  $("vehicle-tabs").innerHTML = VEHICLES.map((v) => `<button class="tab" role="tab" data-tab="${v.id}" aria-selected="${v.id === garageVehicle}">${save.vehicles[v.id].owned ? "" : '<svg class="icon"><use href="#i-lock"/></svg>'}${v.name}</button>`).join("");
  const spec = VEHICLES.find((v) => v.id === garageVehicle);
  const mine = save.vehicles[spec.id];
  const traits = Object.entries(spec.traits).map(([name, value]) => `<span>${name}</span><i style="--v:${Math.round(value * 100)}%"></i>`).join("");
  let html = `<div class="vehicle-hero"><canvas id="preview"></canvas><div><h3>${spec.name}</h3><p>${spec.about}</p><div class="traits">${traits}</div></div></div>`;
  if (!mine.owned) {
    html += `<button class="button big buy-vehicle ${save.coins >= spec.cost ? "primary" : ""}" data-buy-vehicle="${spec.id}">Buy for <svg class="icon"><use href="#i-coin"/></svg> ${fmt(spec.cost)}</button>`;
  } else {
    html += `<div class="upgrades">${UPGRADES.map((u) => {
      const level = mine.levels[u.id];
      const cost = upgradeCost(u, level, spec);
      const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < level ? "on" : ""}"></i>`).join("");
      const button = level >= MAX_LEVEL
        ? `<button class="button" disabled>Maxed out</button>`
        : `<button class="button ${save.coins >= cost ? "primary" : ""}" data-buy="${u.id}" ${save.coins >= cost ? "" : "disabled"}>Upgrade <svg class="icon"><use href="#i-coin"/></svg> ${fmt(cost)}</button>`;
      return `<div class="upgrade" id="up-${u.id}">
        <div class="upgrade-top"><svg class="icon"><use href="#${u.icon}"/></svg><div><h3>${u.name}</h3><p>Level ${level} of ${MAX_LEVEL}</p></div></div>
        <p class="about">${u.about}</p><div class="pips">${pips}</div>${button}</div>`;
    }).join("")}</div>`;
    html += `<div class="paints"><span>Paint:</span>${PAINTS.map((colour) => {
      const owned = colour === spec.paint || mine.paints.includes(colour);
      return `<button class="paint ${colour === mine.paint ? "on" : ""} ${owned ? "" : "locked"}" style="background:${colour}" data-paint="${colour}" aria-label="${owned ? "Paint" : `Buy paint for ${PAINT_COST} coins`}" title="${owned ? "" : `${PAINT_COST} coins`}"></button>`;
    }).join("")}</div>`;
    if (save.vehicle !== spec.id) html += `<button class="button big" data-use="${spec.id}">Drive the ${spec.name}</button>`;
  }
  $("vehicle-detail").innerHTML = html;
  drawPreview($("preview"), spec, mine.paint);
}

$("vehicle-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (!tab) return;
  garageVehicle = tab.dataset.tab;
  if (save.vehicles[garageVehicle].owned && save.vehicle !== garageVehicle) {
    save.vehicle = garageVehicle;
    persist();
    newRun();
  }
  renderGarage();
  play("tick", { volume: 0.3 });
});

$("vehicle-detail").addEventListener("click", (event) => {
  const spec = VEHICLES.find((v) => v.id === garageVehicle);
  const mine = save.vehicles[spec.id];
  const buyVehicle = event.target.closest("[data-buy-vehicle]");
  const buy = event.target.closest("[data-buy]");
  const paint = event.target.closest("[data-paint]");
  const use = event.target.closest("[data-use]");
  if (buyVehicle) {
    if (save.coins < spec.cost) { toast(`You need ${fmt(spec.cost - save.coins)} more coins`); play("tick", { volume: 0.4 }); return; }
    save.coins -= spec.cost;
    mine.owned = true;
    save.vehicle = spec.id;
    toast(`The ${spec.name} is yours!`);
    play("fanfare", { volume: 0.5 });
  } else if (buy) {
    const upgrade = UPGRADES.find((u) => u.id === buy.dataset.buy);
    const cost = upgradeCost(upgrade, mine.levels[upgrade.id], spec);
    if (save.coins < cost || mine.levels[upgrade.id] >= MAX_LEVEL) return;
    save.coins -= cost;
    mine.levels[upgrade.id]++;
    play("mission", { volume: 0.5 });
  } else if (paint) {
    const colour = paint.dataset.paint;
    const owned = colour === spec.paint || mine.paints.includes(colour);
    if (!owned) {
      if (save.coins < PAINT_COST) { toast(`A new paint costs ${PAINT_COST} coins`); play("tick", { volume: 0.4 }); return; }
      save.coins -= PAINT_COST;
      mine.paints.push(colour);
      play("mission", { volume: 0.5 });
    } else {
      play("tick", { volume: 0.3 });
    }
    mine.paint = colour;
  } else if (use) {
    save.vehicle = spec.id;
    play("tick", { volume: 0.3 });
  } else {
    return;
  }
  wakeAudio();
  persist();
  newRun(); // the vehicle on screen gets the new parts straight away
  renderGarage();
  if (buy) $(`up-${buy.dataset.buy}`).classList.add("bought");
});

function openGarage() {
  wakeAudio();
  garageVehicle = save.vehicle;
  show("garage");
  renderGarage();
}
function openStages() {
  wakeAudio();
  show("stages");
  renderStages();
}

// ----- result -----

function showResult(earned, metres, newBest, oldBest) {
  const reasons = { crash: "Ouch! Landed on your head", fuel: "Out of fuel", river: "Splash! Fell into the river", lava: "Too hot! Fell into the lava", ended: "Run ended" };
  $("result-reason").textContent = reasons[run.reason] || "Run over";
  $("result-distance").textContent = `${fmt(metres)} m`;
  const best = $("result-best");
  best.textContent = newBest ? (oldBest > 0 ? `New best! (was ${fmt(oldBest)} m)` : `Your first drive in ${road.stage.name}!`) : `Best: ${fmt(save.stages[road.stage.id].best)} m`;
  best.className = newBest ? "new" : "";
  const lines = [["Coins picked up", run.coins]];
  if (run.flipCoins) lines.push([`Flips (${run.flips})`, run.flipCoins]);
  if (run.airCoins) lines.push([`Air time (best ${run.bestAir.toFixed(1)} s)`, run.airCoins]);
  if (run.wheelieCoins) lines.push([`Wheelies (best ${run.bestWheelie.toFixed(1)} s)`, run.wheelieCoins]);
  for (const r of run.rewards) lines.push([r.medal !== undefined ? r.text : `Mission: ${r.text}`, r.coins]);
  $("result-lines").innerHTML = lines.map(([label, value]) => `<div><span>${label}</span><b>+${fmt(value)}</b></div>`).join("");
  $("result-coins").textContent = fmt(earned);
  const canUpgrade = UPGRADES.filter((u) => save.vehicles[save.vehicle].levels[u.id] < MAX_LEVEL && save.coins >= upgradeCost(u, save.vehicles[save.vehicle].levels[u.id], vehicleNow()));
  const nextStage = STAGES.find((s) => !save.stages[s.id].owned);
  const tips = {
    crash: "Tip: in the air, Gas tips you back and Brake tips you forward.",
    fuel: "Tip: let go of Gas on the way down to save fuel. A bigger tank helps too.",
    river: "Tip: cross bridges steadily. Too fast and you'll bounce off!",
    lava: "Tip: cross bridges steadily. Too fast and you'll bounce off!",
  };
  $("result-tip").textContent = canUpgrade.length
    ? `You can upgrade: ${canUpgrade.map((u) => u.name.toLowerCase()).join(", ")}.`
    : nextStage && save.coins >= nextStage.cost ? `You can unlock ${nextStage.name} in Adventures!`
    : tips[run.reason] || "";
  $("result-garage").classList.toggle("primary", canUpgrade.length > 0);
  $("again").classList.toggle("primary", canUpgrade.length === 0);
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
$("pick-vehicle").addEventListener("click", openGarage);
$("open-stages").addEventListener("click", openStages);
$("pick-stage").addEventListener("click", openStages);
$("result-garage").addEventListener("click", openGarage);
document.querySelectorAll(".to-menu").forEach((button) => button.addEventListener("click", toMenu));
$("pause").addEventListener("click", pauseGame);
$("resume").addEventListener("click", resumeGame);
$("end-run").addEventListener("click", () => { show("drive"); endRun(true); });
$("stuck").addEventListener("click", () => endRun(true));
$("restart").addEventListener("click", () => { newRun(); startDriving(); });
$("result-menu").addEventListener("click", toMenu);
$("again").addEventListener("click", () => {
  // Portals may show an ad here, between two runs.
  platform.breakAd(() => { newRun(); startDriving(); }, pauseAudio);
});
$("gift").addEventListener("click", () => {
  if (save.gift === todayKey()) return;
  const amount = giftAmount();
  save.gift = todayKey();
  save.coins += amount;
  persist();
  wakeAudio();
  play("fanfare", { volume: 0.5 });
  toast(`Daily gift: +${fmt(amount)} coins! Come back tomorrow for another.`);
  renderMenu();
});

// ----- settings and stats -----

function openSheet(id) {
  $(id).classList.add("open");
  $("scrim").classList.add("open");
}
function closeSheets() {
  document.querySelectorAll(".sheet.open").forEach((sheet) => sheet.classList.remove("open"));
  $("scrim").classList.remove("open");
}
$("scrim").addEventListener("click", closeSheets);
document.querySelectorAll(".sheet .close").forEach((button) => button.addEventListener("click", closeSheets));

$("open-settings").addEventListener("click", () => {
  document.querySelectorAll("[data-setting]").forEach((input) => { input.checked = save.settings[input.dataset.setting]; });
  openSheet("settings");
});
document.querySelectorAll("[data-setting]").forEach((box) => box.addEventListener("change", () => {
  save.settings[box.dataset.setting] = box.checked;
  persist();
  applySettings();
}));
function applySettings() {
  document.body.classList.toggle("swap", save.settings.swap);
  updateMusic();
}

$("open-stats").addEventListener("click", () => {
  const st = save.stats;
  const tiles = [
    [fmt(st.runs), "Runs"],
    [`${(st.distance / 1000).toFixed(1)} km`, "Driven"],
    [fmt(st.coins), "Coins earned"],
    [fmt(st.flips), "Flips"],
    [`${st.bestAir.toFixed(1)} s`, "Longest jump"],
    [`${st.bestWheelie.toFixed(1)} s`, "Longest wheelie"],
  ];
  $("stats-grid").innerHTML = tiles.map(([value, label]) => `<div><b>${value}</b><span>${label}</span></div>`).join("");
  $("stats-bests").innerHTML = STAGES.map((s) => `<div><span>${s.name}</span><b>${save.stages[s.id].owned ? `${fmt(save.stages[s.id].best)} m` : "locked"}</b></div>`).join("");
  openSheet("stats");
});

function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 2600);
}

// ----- controls -----

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
    if (document.querySelector(".sheet.open")) closeSheets();
    else if (screen === "drive") pauseGame();
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
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); updateMusic(); });
addEventListener("blur", pauseGame);

// The bar at the top.
let shownCoins = -1;
let shownMetres = -1;
function updateHud() {
  if (!run || !car) return;
  const fraction = clamp(run.fuel / car.stats.tank, 0, 1);
  $("fuel-bar").style.transform = `scaleX(${fraction})`;
  document.querySelector(".fuel").classList.toggle("low", fraction < 0.22);
  const coins = runCoins();
  if (coins !== shownCoins) { shownCoins = coins; $("run-coins").textContent = fmt(coins); }
  const metres = Math.floor(run.distance);
  if (metres !== shownMetres) {
    shownMetres = metres;
    const best = save.stages[road.stage.id].best;
    $("distance").textContent = `${fmt(metres)} m`;
    $("best-line").textContent = best > 0 ? (metres > best ? "new best!" : `best ${fmt(best)} m`) : road.stage.name;
    const x = car.body.getPosition().x;
    const next = road.cans.find((can) => !can.taken && can.x > x);
    $("next-fuel").textContent = save.settings.fuelHint && next ? `next fuel in ${fmt(next.x - x)} m` : "";
  }
}
function bumpCoins() {
  const box = document.querySelector(".coins");
  box.classList.remove("bump");
  void box.offsetWidth;
  box.classList.add("bump");
}

// ---------------------------------------------------------------------------------------------
// 10. Sound and music
// ---------------------------------------------------------------------------------------------
// Short recorded clips (Kenney's "Interface Sounds", CC0), music ("Exploration Theme" by Cleyton
// Kauffman, CC0), and an engine made on the fly: two buzzing tones through a soft filter, higher
// as the wheels spin faster.

const CLIPS = ["star", "crash", "mission", "best", "fanfare", "tick"];
const audio = { context: null, clips: {}, engine: null, music: null };

function wakeAudio() {
  if (audio.context) {
    if (audio.context.state === "suspended") audio.context.resume().catch(() => {});
    updateMusic();
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
  audio.music = new Audio("sounds/music.mp3");
  audio.music.loop = true;
  audio.music.volume = 0.22;
  updateMusic();
}

function play(name, { volume = 0.6, rate = 1 } = {}) {
  if (!save.settings.sound || platform.muted() || !audio.context || !audio.clips[name]) return;
  const source = audio.context.createBufferSource();
  source.buffer = audio.clips[name];
  source.playbackRate.value = rate;
  const gain = audio.context.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(audio.context.destination);
  source.start();
}

function updateMusic() {
  if (!audio.music) return;
  const want = save.settings.music && !platform.muted() && !document.hidden && screen !== "paused" && !audio.held;
  if (want && audio.music.paused) audio.music.play().catch(() => {});
  else if (!want && !audio.music.paused) audio.music.pause();
}

function updateEngineSound() {
  if (!audio.engine) return;
  const on = save.settings.engine && !platform.muted() && screen === "drive" && run && !run.reason && run.fuel > 0 && !audio.held;
  const spin = car ? Math.abs(car.wheels[0].getAngularVelocity()) * car.spec.wheels[0].r / 0.43 : 0;
  const rev = clamp(spin / 40, 0, 1);
  const note = car ? car.spec.engineNote : 1;
  const t = audio.context.currentTime;
  const { low, high, filter, gain } = audio.engine;
  low.frequency.setTargetAtTime((38 + rev * 70 + (input.gas ? 8 : 0)) * note, t, 0.08);
  high.frequency.setTargetAtTime((76 + rev * 140) * note, t, 0.08);
  filter.frequency.setTargetAtTime(300 + rev * 900 + (input.gas ? 300 : 0), t, 0.1);
  gain.gain.setTargetAtTime(on ? (input.gas ? 0.09 : 0.05) : 0, t, 0.12);
}

// Ads (on portals) ask for silence while they play.
function pauseAudio(paused) {
  audio.held = paused;
  if (audio.context) {
    if (paused) audio.context.suspend().catch(() => {});
    else audio.context.resume().catch(() => {});
  }
  updateMusic();
}

// ---------------------------------------------------------------------------------------------
// 11. Start
// ---------------------------------------------------------------------------------------------

applySettings();
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
  } else if (screen !== "paused" && screen !== "result") {
    // On the menus the vehicle just sits there, idling.
    spare += dt;
    while (spare >= STEP) { world.step(STEP, 10, 6); spare -= STEP; }
  }
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy -= 4 * dt;
  }
  particles = particles.filter((p) => p.age < p.life);
  popups.forEach((item) => { item.age += dt; });
  popups = popups.filter((item) => item.age < 1.5);
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
  get car() { return car; },
  get road() { return road; },
  get screen() { return screen; },
  save, input, contacts, update, newRun, startDriving, endRun, groundAt, STEP, STAGES, VEHICLES,
};
