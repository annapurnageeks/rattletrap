// Builds Rattletrap for a game site: the same game, packed the way that site wants it.
//
//   node tools/build.js itch                            ->  dist/rattletrap-itch.zip
//   node tools/build.js gamedistribution GAME_ID=...    ->  dist/rattletrap-gamedistribution.zip
//   node tools/build.js gamemonetize GAME_ID=...        ->  dist/rattletrap-gamemonetize.zip
//   node tools/build.js y8 APP_ID=... GAME_ID=...       ->  dist/rattletrap-y8.zip
//   node tools/build.js playgama                        ->  dist/rattletrap-playgama.zip
//   node tools/build.js android [INTERSTITIAL_ID=... REWARDED_ID=...]  (used by android-app/)
//   node tools/build.js android-native                  (for a plain Android Studio WebView app)
//
// Compared with the web version, a portal build:
//   - leaves out the "web-only" block in index.html (app manifest and icons) and the service worker
//   - loads a small portal file before game.js (portal/<name>.js), which fills in
//     window.GAME_PLATFORM (see part 1 of game.js)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// For each portal: scripts that go first in <head>, the scripts that replace game.js at the end
// of <body>, the IDs it needs, and extra files that ship with it.
const PORTALS = {
  itch: { body: ['<script src="itch.js"></script>', '<script src="game.js"></script>'] },
  gamedistribution: { body: ['<script src="gamedistribution.js"></script>', '<script src="game.js"></script>'], ids: ["GAME_ID"] },
  gamemonetize: { body: ['<script src="gamemonetize.js"></script>', '<script src="game.js"></script>'], ids: ["GAME_ID"] },
  y8: {
    head: ['<script async src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js"></script>'],
    body: ['<script src="y8.js"></script>', '<script src="game.js"></script>'],
    ids: ["APP_ID", "GAME_ID"],
  },
  android: { body: ['<script src="android.js"></script>', '<script src="game.js"></script>'], ids: ["INTERSTITIAL_ID", "REWARDED_ID"] },
  "android-native": { body: ['<script src="android-native.js"></script>', '<script src="game.js"></script>'] },
  playgama: {
    head: ['<script src="https://bridge.playgama.com/v2/stable/playgama-bridge.js"></script>'], // must come first
    body: ['<script src="playgama.js"></script>'], // playgama.js loads game.js once Bridge is ready
    files: ["portal/playgama-bridge-config.json"],
  },
};

const [name, ...args] = process.argv.slice(2);
const ids = Object.fromEntries(args.map((arg) => arg.split("=")));
const portal = PORTALS[name];
if (!portal) {
  console.error(`usage: node tools/build.js ${Object.keys(PORTALS).join("|")} [ID=value ...]`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist", name);
const zip = path.join(root, "dist", `rattletrap-${name}.zip`);
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of ["game.js", "style.css", "LICENSE"]) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const folder of ["fonts", "sounds", "vendor"]) fs.cpSync(path.join(root, folder), path.join(out, folder), { recursive: true });
for (const file of portal.files || []) fs.copyFileSync(path.join(root, file), path.join(out, path.basename(file)));
// The portal file, with its IDs filled in (each portal's dashboard gives you them).
let portalJs = fs.readFileSync(path.join(root, "portal", `${name}.js`), "utf8");
for (const id of portal.ids || []) {
  if (ids[id]) portalJs = portalJs.replaceAll(`__${id}__`, ids[id]);
  else console.warn(`warning: no ${id} given, so this build can't earn on ${name}. Add ${id}=... when you have it.`);
}
fs.writeFileSync(path.join(out, `${name}.js`), portalJs);

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const webOnly = /\n\s*<!-- web-only:[\s\S]*?<!-- \/web-only -->/;
if (!webOnly.test(html)) throw new Error("index.html has no web-only block");
const gameScript = '<script src="game.js"></script>';
if (!html.includes(gameScript)) throw new Error("index.html doesn't load game.js the usual way");
html = html.replace(webOnly, "").replace(gameScript, portal.body.join("\n  "));
if (portal.head) html = html.replace('<meta charset="utf-8">', ['<meta charset="utf-8">', ...portal.head].join("\n  "));
fs.writeFileSync(path.join(out, "index.html"), html);

execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: out });
console.log(`Built ${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
