// Rattletrap on Y8.
// The Y8 version loads Y8's SDK (the code that shows their ads), then this file, then game.js.
// This file starts the SDK and tells the game how to use it, through window.GAME_PLATFORM
// (see "platform" in game.js).
//
// What changes on Y8:
//   - between runs (always right after a tap, never while driving) an ad may play; the game waits,
//     silent, until it's over
//   - no Y8 login: Rattletrap has no accounts, so everyone plays as a guest
//   - with an ad blocker, or when there's no ad to show, the game simply carries on
// (Y8 also asks games to pause when they lose focus; game.js does that everywhere.)
//
// Docs: https://docs.y8.com/sdk/intro/ and https://docs.y8.com/sdk/advertising/

(() => {
  const APP_ID = "__APP_ID__";   // both IDs are on the "SDK Initialization" page of the Y8 developer
  const GAME_ID = "__GAME_ID__"; // portal (tools/build.js fills them in)

  let y8Sdk = null;

  addEventListener("y8sdk.ready", () => {
    try {
      y8Sdk = window.y8.sdk();
      y8Sdk.init({ appId: APP_ID, autoLogin: false }, { gameId: GAME_ID });
    } catch (error) {
      y8Sdk = null;
      console.warn("Rattletrap: the Y8 SDK didn't start, so the game runs without it.", error);
    }
  }, { once: true });
  // The SDK loads on its own (async). If it finished before the line above, ask it to say so again.
  if (window.y8 && typeof window.y8.emitReadyEvent === "function") window.y8.emitReadyEvent();

  let pauseRun = () => {}; // the game's "pause the run" (it hands this over through onPause)

  window.GAME_PLATFORM = {
    name: "y8",
    onPause: (pause) => { pauseRun = pause; },
    breakAd(done, pauseAudio) {
      if (!y8Sdk) return done(); // ad blocker, or the SDK isn't ready
      let started = false;
      let over = false;
      const finish = () => {
        if (over) return;
        over = true;
        pauseAudio(false);
        done();
      };
      // When no ad plays (none ready, too soon, or the game isn't on y8.com) the SDK can finish
      // without calling any of the hooks below, so carry on unless an ad has really started.
      const noAd = () => { if (!started) finish(); };
      try {
        const call = y8Sdk.showAd({
          type: "next",                         // a break between two runs
          name: "next-run",
          beforeAd: () => {                     // an ad really plays: silence (and pause, if a run began)
            started = true;
            pauseAudio(true);
            pauseRun();
          },
          afterAd: () => {
            pauseAudio(false);
            finish();
          },
          adBreakDone: finish,
        });
        if (call && typeof call.then === "function") call.then(() => setTimeout(noAd, 300), finish);
        setTimeout(noAd, 2500);                 // never keep the player waiting for an ad that doesn't come
      } catch (error) {
        finish();
      }
    },
  };
})();
