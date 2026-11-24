// Test drives Rattletrap in headless Chrome. A simple robot driver holds the gas, and eases off
// or brakes when the nose points too high, at a few garage levels. It checks:
//   1. the page loads and drives with no errors;
//   2. how far the robot gets, and how many coins it earns, at each level, so the hills, fuel
//      cans and upgrade prices stay balanced (a fresh truck should get a few hundred metres,
//      and every upgrade should take it further).
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

const LEVELS = (process.env.LEVELS || "0,2,4,7,10").split(",").map(Number);

(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => window.rattle && window.rattle.truck);

  for (const level of LEVELS) {
    const result = await page.evaluate((level) => {
      const r = window.rattle;
      for (const key of Object.keys(r.save.levels)) r.save.levels[key] = level;
      r.newRun();
      r.startDriving();
      let steps = 0;
      while (!r.run.over && steps < 60 * 600) {
        const body = r.truck.body;
        const x = body.getPosition().x;
        const slope = Math.atan2(r.groundAt(x + 1.5) - r.groundAt(x - 1.5), 3);
        const nose = body.getAngle() - slope; // how far the nose points up from the road
        const airborne = r.contacts.wheels === 0;
        // the robot: gas, unless the nose is too high (then brake to tip it forward)
        r.input.gas = airborne ? nose < 0.1 : nose < 0.35;
        r.input.brake = airborne ? nose > 0.45 : nose > 0.6;
        r.update(r.STEP);
        steps++;
      }
      return {
        level,
        metres: Math.floor(r.run.distance),
        seconds: Math.round(steps / 60),
        reason: r.run.reason || "time limit",
        coins: r.run.coins + r.run.flipCoins + r.run.airCoins,
        flips: r.run.flips,
      };
    }, level);
    console.log(`all upgrades at level ${String(result.level).padStart(2)}: ${String(result.metres).padStart(5)} m in ${result.seconds} s, ended by ${result.reason}, ${result.coins} coins, ${result.flips} flips`);
  }

  console.log(errors.length ? `\nERRORS:\n${errors.join("\n")}` : "\nNo page errors.");
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})();
