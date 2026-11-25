// Rattletrap on GameMonetize.
// The GameMonetize version loads this file just before game.js. It starts the GameMonetize SDK
// (the code that shows their ads) and tells the game how to use it, through
// window.GAME_PLATFORM (see "platform" in game.js).
//
// What changes on GameMonetize (the same as on GameDistribution, whose SDK works the same way):
//   - when Drive is first pressed, and between runs, an ad may play (always right after a tap, never
//     during a run); the game waits, silent, until it's over
//   - if an ad ever starts at another moment, the run pauses and the sound stops
//   - with an ad blocker, or when there's no ad to show, the game simply carries on
//
// Docs: https://github.com/MonetizeGame/GameMonetize.com-SDK

(() => {
  const GAME_ID = "__GAME_ID__"; // from your GameMonetize dashboard, My games (tools/build.js fills it in)

  let pauseRun = () => {};  // the game's "pause the run" (it hands this over through onPause)
  let silence = () => {};   // the game's pauseAudio (it hands this over with each ad break)
  let adPlaying = false;
  let next = null;          // what to do once the ad is over (start the next run)

  function adOver() {
    adPlaying = false;
    silence(false);
    if (next) {
      const carryOn = next;
      next = null;
      carryOn();
    }
  }

  window.SDK_OPTIONS = {
    gameId: GAME_ID,
    onEvent(event) {
      if (event.name === "SDK_GAME_PAUSE") {        // an ad is about to play
        adPlaying = true;
        silence(true);
        pauseRun();
      } else if (event.name === "SDK_GAME_START") { // the ad is done: back to the game
        adOver();
      }
    },
  };

  const script = document.createElement("script");
  script.id = "gamemonetize-sdk";
  script.src = "https://api.gamemonetize.com/sdk.js";
  document.head.appendChild(script);

  window.GAME_PLATFORM = {
    name: "gamemonetize",
    adBeforeFirstRun: true, // GameDistribution and GameMonetize ask for an ad when play starts
    onPause: (pause) => { pauseRun = pause; },
    breakAd(done, pauseAudio) {
      silence = pauseAudio;
      const sdk = window.sdk;
      if (!sdk || typeof sdk.showBanner !== "function") return done(); // ad blocker, or the SDK isn't there
      next = done;
      // If no ad has started shortly after asking, there isn't one: carry on.
      // While an ad plays we wait for SDK_GAME_START instead.
      const settled = () => { if (!adPlaying) adOver(); };
      const call = sdk.showBanner();
      if (call && typeof call.then === "function") call.then(settled, settled);
      else setTimeout(settled, 1000);
    },
  };
})();
