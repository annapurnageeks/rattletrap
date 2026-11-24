// Test drives Rattletrap in headless Chrome. A simple robot driver holds the gas, and eases off
// or brakes when the nose points too high, at a few garage levels. It checks:
//   1. the page loads and drives with no errors;
//   2. how far the robot gets in each adventure and vehicle, and how many coins it earns, so the
//      hills, fuel cans and prices stay balanced. When it runs out of fuel, it says how far the
//      next can was: a fresh truck should reach several cans before that happens.
//
// usage:  cd tools && npm install && node check.js
// Set CHROME_PATH if Chrome isn't in the usual place.

const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  linux: "/usr/bin/google-chrome",
}[process.platform];
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mp3": "audio/mpeg",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// A tiny web server for the game folder.
const server = http.createServer((request, response) => {
  let file = path.join(ROOT, decodeURIComponent(new URL(request.url, "http://x").pathname));
  if (file.endsWith(path.sep)) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.statusCode = 404;
    return response.end();
  }
  response.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  response.end(fs.readFileSync(file));
});

// Which test drives to do: adventure, vehicle, garage level.
const DRIVES = process.env.QUICK ? [["countryside", "rattletrap", 0]] : [
  ["countryside", "rattletrap", 0], ["countryside", "rattletrap", 3], ["countryside", "rattletrap", 6], ["countryside", "rattletrap", 10],
  ["countryside", "bike", 0], ["countryside", "tractor", 0], ["countryside", "monster", 0],
  ["canyon", "rattletrap", 3], ["arctic", "rattletrap", 3], ["woods", "rattletrap", 3], ["volcano", "rattletrap", 5], ["moon", "rattletrap", 5],
];

(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/404|manifest/i.test(message.text())) errors.push(message.text()); });
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => window.rattle && window.rattle.car);

  for (const [stage, vehicle, level] of DRIVES) {
    const result = await page.evaluate((stage, vehicle, level) => {
      const r = window.rattle;
      r.save.stage = stage;
      r.save.vehicle = vehicle;
      r.save.stages[stage].owned = true;
      r.save.vehicles[vehicle].owned = true;
      for (const key of Object.keys(r.save.vehicles[vehicle].levels)) r.save.vehicles[vehicle].levels[key] = level;
      r.newRun();
      r.startDriving();
      let steps = 0;
      while (!r.run.over && steps < 60 * 600) {
        const body = r.car.body;
        const x = body.getPosition().x;
        const slope = Math.atan2(r.groundAt(x + 1.5) - r.groundAt(x - 1.5), 3);
        const turn = body.getAngle() - slope;
        const nose = Math.atan2(Math.sin(turn), Math.cos(turn)); // how far the nose points up from the road
        const airborne = r.contacts.wheel[0] === 0 && r.contacts.wheel[1] === 0;
        // the robot: gas, unless the nose is too high (then brake to tip it forward)
        const stopped = Math.abs(body.getLinearVelocity().x) < 0.5;
        r.input.gas = airborne ? nose < 0.1 : nose < 0.35 || (stopped && nose < 0.9);
        r.input.brake = airborne ? nose > 0.45 : nose > 0.6;
        r.update(r.STEP);
        steps++;
      }
      const x = r.run.distance + 1.5;
      r.groundAt(x + 700); // make sure the road (and its fuel cans) exists well ahead
      const next = r.road.cans.find((can) => can.x > x);
      const before = r.road.cans.filter((can) => can.x < x).pop();
      return {
        metres: Math.floor(r.run.distance),
        seconds: Math.round(steps / 60),
        reason: r.run.reason || "time limit",
        coins: r.run.coins + r.run.flipCoins + r.run.airCoins + r.run.wheelieCoins,
        cans: r.run.cans,
        gap: next && before ? Math.round(next.x - before.x) : 0,
        short: next ? Math.round(next.x - x) : 0,
      };
    }, stage, vehicle, level);
    const fuelNote = result.reason === "fuel" ? ` (${result.short} m short of a can; that gap is ${result.gap} m)` : "";
    console.log(`${stage.padEnd(12)} ${vehicle.padEnd(10)} level ${String(level).padStart(2)}: ${String(result.metres).padStart(5)} m in ${String(result.seconds).padStart(3)} s, ${result.cans} cans, ${String(result.coins).padStart(5)} coins, ended by ${result.reason}${fuelNote}`);
  }

  console.log(errors.length ? `\nERRORS:\n${errors.join("\n")}` : "\nNo page errors.");
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})();
