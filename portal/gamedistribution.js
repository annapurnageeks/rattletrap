// Rattletrap on GameDistribution.
// The GameDistribution version loads this file just before game.js. It starts the GameDistribution
// SDK (the code that shows their ads) and tells the game how to use it, through
// window.GAME_PLATFORM (see "platform" in game.js).
//
// What changes on GameDistribution:
//   - when Drive is first pressed, and between runs, an ad may play (always right after a tap, never
//     during a run); the game waits, silent, until it's over
//   - if an ad ever starts at another moment, the run pauses and the sound stops
//   - with an ad blocker, or when there's no ad to show, the game simply carries on
//
// Docs: https://github.com/GameDistribution/GD-HTML5/wiki/SDK-Implementation

(() => {
  const GAME_ID = "__GAME_ID__"; // the "game hash" from the GameDistribution control panel (tools/build.js fills it in)

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

  window.GD_OPTIONS = {
    gameId: GAME_ID,
    onEvent(event) {
      if (event.name === "SDK_GAME_PAUSE") {        // an ad is about to play
        adPlaying = true;
        silence(true);
        pauseRun();
      } else if (event.name === "SDK_GAME_START" || event.name === "SDK_ERROR") {
        adOver();                                    // the ad is done (or broke): back to the game
      }
    },
  };

  const script = document.createElement("script");
  script.id = "gamedistribution-jssdk";
  script.src = "https://html5.api.gamedistribution.com/main.min.js";
  document.head.appendChild(script);

  window.GAME_PLATFORM = {
    name: "gamedistribution",
    adBeforeFirstRun: true, // GameDistribution and GameMonetize ask for an ad when play starts
    onPause: (pause) => { pauseRun = pause; },
    breakAd(done, pauseAudio) {
      silence = pauseAudio;
      const sdk = window.gdsdk;
      if (!sdk || typeof sdk.showAd !== "function") return done(); // ad blocker, or the SDK isn't there
      next = done;
      // showAd() settles once the ad is over, or right away when there's no ad to show.
      // While an ad plays we wait for SDK_GAME_START instead.
      const settled = () => { if (!adPlaying) adOver(); };
      const call = sdk.showAd();
      if (call && typeof call.then === "function") call.then(settled, settled);
      else setTimeout(settled, 1500);
    },
  };
})();
