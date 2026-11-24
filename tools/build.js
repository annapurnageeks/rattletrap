// Builds Rattletrap for a game site: the same game, packed the way that site wants it.
//
//   node tools/build.js itch    ->  dist/rattletrap-itch.zip  (upload as an HTML game)
//
// Compared with the web version, a portal build:
//   - leaves out the "web-only" block in index.html (app manifest and icons) and the service worker
//   - loads a small portal file before game.js (portal/<name>.js), which fills in
//     window.GAME_PLATFORM (see part 1 of game.js)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PORTALS = {
  itch: { body: ['<script src="itch.js"></script>', '<script src="game.js"></script>'] },
};

const name = process.argv[2];
const portal = PORTALS[name];
if (!portal) {
  console.error(`usage: node tools/build.js ${Object.keys(PORTALS).join("|")}`);
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
fs.copyFileSync(path.join(root, "portal", `${name}.js`), path.join(out, `${name}.js`));

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const webOnly = /\n\s*<!-- web-only:[\s\S]*?<!-- \/web-only -->/;
if (!webOnly.test(html)) throw new Error("index.html has no web-only block");
const gameScript = '<script src="game.js"></script>';
if (!html.includes(gameScript)) throw new Error("index.html doesn't load game.js the usual way");
html = html.replace(webOnly, "").replace(gameScript, portal.body.join("\n  "));
fs.writeFileSync(path.join(out, "index.html"), html);

execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: out });
console.log(`Built ${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
