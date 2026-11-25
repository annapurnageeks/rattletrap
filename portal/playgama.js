// Rattletrap on Playgama.
// The Playgama version loads Playgama Bridge (their SDK) first thing in <head>, then this file
// instead of game.js. This file starts Bridge, loads the save from it, tells the game how to use it
// (through window.GAME_PLATFORM, see "platform" in game.js), then loads game.js.
//
// What changes on Playgama:
//   - progress is saved through Bridge (Playgama doesn't allow localStorage)
//   - between runs (always right after a tap, never while driving) an ad may play; the game waits,
//     silent, until it's over
//   - when Playgama pauses the game or turns the sound off (for an ad, a hidden tab...), Rattletrap follows
//   - with an ad blocker, or when there's no ad to show, the game simply carries on
//
// Docs: https://wiki.playgama.com/playgama/bridge-sdk/getting-started

(async () => {
  const SAVE_KEY = "rattletrap.v1"; // the same key game.js uses
  const bridge = window.bridge;

  try {
    await bridge.initialize();
    // Rattletrap is English only for now; Playgama asks every game to read the player's language here.
    const language = bridge.platform.language;
    if (language && language !== "en") console.info(`Rattletrap: no ${language} translation yet, playing in English`);

    // game.js reads and writes its save synchronously, so we keep a copy in memory and
    // write every change through to Bridge in the background.
    const [saved] = await bridge.storage.get([SAVE_KEY]);
    const values = {};
    if (saved !== null && saved !== undefined) {
      values[SAVE_KEY] = typeof saved === "string" ? saved : JSON.stringify(saved);
    }
    const store = {
      getItem: (key) => (key in values ? values[key] : null),
      setItem(key, value) {
        values[key] = value;
        bridge.storage.set([key], [value]).catch((error) => console.warn("Rattletrap: saving failed", error));
      },
    };

    let pauseRun = () => {};
    let adOver = null; // set while the game waits for an ad

    bridge.platform.on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, (isPaused) => { if (isPaused) pauseRun(); });
    bridge.advertisement.on(bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED, (state) => {
      if ((state === "closed" || state === "failed") && adOver) adOver();
    });

    window.GAME_PLATFORM = {
      name: "playgama",
      storage: () => store,
      muted: () => bridge.platform.isAudioEnabled === false, // always up to date
      escapePauses: false,  // Playgama keeps Esc for itself (P still pauses)
      synthSound: false,    // Playgama only allows recorded sounds, so no made-up engine noise
      onPause: (pause) => { pauseRun = pause; },
      breakAd(done, pauseAudio) {
        if (!bridge.advertisement.isInterstitialSupported) return done();
        let over = false;
        adOver = () => {
          if (over) return;
          over = true;
          adOver = null;
          pauseAudio(false);
          done();
        };
        pauseAudio(true);
        bridge.advertisement.showInterstitial("run_end");
        // Bridge decides whether an ad really plays (not too often, for example). If none has
        // started shortly after asking, carry on; and never wait forever for one to load.
        const state = () => bridge.advertisement.interstitialState;
        const finish = adOver;
        setTimeout(() => { if (state() !== "loading" && state() !== "opened") finish(); }, 800);
        setTimeout(() => { if (state() === "loading") finish(); }, 10000);
      },
    };
  } catch (error) {
    console.warn("Rattletrap: Playgama Bridge didn't start, so the game runs without it.", error);
    // Playgama doesn't allow saving outside Bridge, so this run simply isn't saved.
    const values = {};
    const memory = { getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
    window.GAME_PLATFORM = { name: "playgama", storage: () => memory, escapePauses: false, synthSound: false };
  }

  const game = document.createElement("script");
  game.src = "game.js";
  game.onload = () => {
    if (bridge && bridge.platform) bridge.platform.sendMessage("game_ready"); // the menu is up and playable
  };
  document.body.appendChild(game);
})();
