// Rattletrap inside a plain Android Studio app (a WebView, no Capacitor).
// The app's MainActivity.kt adds `window.RattleNative` (ads, closing the app) and calls back into
// `window.rattleNative` (ad closed, Back button, app paused). This file turns that into
// window.GAME_PLATFORM (see part 1 of game.js), before game.js loads.
//
// Ads, kept fair (the same rules as portal/android.js):
//   - a short full-screen ad at most every 3rd "Drive again", and never twice within 2 minutes
//   - an optional ad after a run that doubles the coins you earned (only if you choose to watch)
//   - never while you drive; with no internet (or no ad to show) the game simply carries on
// The ad unit IDs live in the app (AdIds.kt), not here.
//
//   node tools/build.js android-native   ->  dist/android-native/ (copy it to app/src/main/assets/game/)

(() => {
  const native = window.RattleNative; // missing when the page is opened in a normal browser
  let runsSinceAd = 0;
  let lastAdAt = Date.now(); // no full-screen ad in the first 2 minutes either
  let whenAdCloses = null;
  let backHandler = () => false;
  let pauseHandler = () => {};

  // MainActivity.kt calls these.
  window.rattleNative = {
    adClosed(rewarded) {
      const callback = whenAdCloses;
      whenAdCloses = null;
      if (callback) callback(Boolean(rewarded));
    },
    back: () => Boolean(backHandler()), // false means "we're on the menu, close the app"
    pause: () => pauseHandler(),
  };

  function showFullScreen(show, pauseAudio, onClosed) {
    pauseAudio(true);
    whenAdCloses = (rewarded) => {
      pauseAudio(false);
      onClosed(rewarded);
    };
    show();
  }

  window.GAME_PLATFORM = {
    name: "android",
    breakAd(done, pauseAudio) {
      runsSinceAd++;
      const due = runsSinceAd >= 3 && Date.now() - lastAdAt > 120000;
      if (!native || !due || !native.interstitialReady()) return done();
      showFullScreen(() => native.showInterstitial(), pauseAudio, () => {
        runsSinceAd = 0;
        lastAdAt = Date.now();
        done();
      });
    },
    // Only offered when an ad is actually ready to show.
    get rewardedAd() {
      if (!native || !native.rewardedReady()) return null;
      return (onReward, pauseAudio, onCancel) => {
        showFullScreen(() => native.showRewarded(), pauseAudio, (rewarded) => {
          lastAdAt = Date.now(); // a chosen ad also counts, so a forced one doesn't follow it
          if (rewarded) onReward();
          else if (onCancel) onCancel();
        });
      };
    },
    onBack(handler) { backHandler = handler; },
    onPause(pause) { pauseHandler = pause; },
  };
})();
