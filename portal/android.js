// Rattletrap as an Android app (built with Capacitor, see android-app/).
// The app shows the game in a web view, and Capacitor lets this file talk to Android:
// Google's AdMob ads, and the phone's Back button. It tells the game how to use them through
// window.GAME_PLATFORM (see part 1 of game.js), before game.js loads.
//
// Ads, kept fair:
//   - a short full-screen ad at most every 3rd "Drive again", and never twice within 2 minutes
//   - an optional ad after a run that doubles the coins you earned (only if you choose to watch)
//   - never while you drive; with no internet (or no ad to show) the game simply carries on
//
// Until you have your own AdMob ad units, Google's test ads are used (they pay nothing, but
// they're safe to click while testing). tools/build.js fills in the real IDs:
//   node tools/build.js android INTERSTITIAL_ID=ca-app-pub-.../... REWARDED_ID=ca-app-pub-.../...

(() => {
  const TEST_INTERSTITIAL = "ca-app-pub-3940256099942544/1033173712"; // Google's public test units
  const TEST_REWARDED = "ca-app-pub-3940256099942544/5224354917";
  const fill = (value, fallback) => (value.startsWith("__") ? fallback : value);
  const INTERSTITIAL = fill("__INTERSTITIAL_ID__", TEST_INTERSTITIAL);
  const REWARDED = fill("__REWARDED_ID__", TEST_REWARDED);
  const testing = INTERSTITIAL === TEST_INTERSTITIAL;

  const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const AdMob = plugins.AdMob;
  const App = plugins.App;

  let ready = false;          // AdMob has started (and asked for consent where the law needs it)
  let interstitialLoaded = false;
  let rewardedLoaded = false;
  let runsSinceAd = 0;
  let lastAdAt = Date.now();  // no full-screen ad in the first 2 minutes either

  const loadInterstitial = () => {
    if (!ready) return;
    AdMob.prepareInterstitial({ adId: INTERSTITIAL, isTesting: testing })
      .then(() => { interstitialLoaded = true; })
      .catch(() => { interstitialLoaded = false; setTimeout(loadInterstitial, 60000); });
  };
  const loadRewarded = () => {
    if (!ready) return;
    AdMob.prepareRewardVideoAd({ adId: REWARDED, isTesting: testing })
      .then(() => { rewardedLoaded = true; })
      .catch(() => { rewardedLoaded = false; setTimeout(loadRewarded, 60000); });
  };

  async function start() {
    if (!AdMob) return;
    try {
      await AdMob.initialize({ initializeForTesting: testing });
      // In Europe and a few other places, the law says people must agree to personalised ads.
      // Google's own consent form handles that (it only appears where it's needed).
      const consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === "REQUIRED") await AdMob.showConsentForm();
    } catch (error) {
      console.warn("Rattletrap: AdMob didn't start; playing without ads.", error);
    }
    ready = true;
    loadInterstitial();
    loadRewarded();
  }

  // Runs `done` exactly once, when the ad closes (or right away if it never shows).
  function showFullScreen(show, events, pauseAudio, onClosed) {
    let over = false;
    const handles = [];
    const finish = (rewarded) => {
      if (over) return;
      over = true;
      // (addListener gives back a handle, or a promise of one, depending on the Capacitor version)
      handles.forEach((h) => Promise.resolve(h).then((handle) => handle && handle.remove && handle.remove()).catch(() => {}));
      pauseAudio(false);
      onClosed(rewarded);
    };
    let rewarded = false;
    pauseAudio(true);
    handles.push(AdMob.addListener(events.dismissed, () => finish(rewarded)));
    handles.push(AdMob.addListener(events.failed, () => finish(false)));
    if (events.reward) handles.push(AdMob.addListener(events.reward, () => { rewarded = true; }));
    show().then((result) => { if (result && events.reward) rewarded = true; }).catch(() => finish(false));
  }

  window.GAME_PLATFORM = {
    name: "android",
    breakAd(done, pauseAudio) {
      runsSinceAd++;
      const due = runsSinceAd >= 3 && Date.now() - lastAdAt > 120000;
      if (!AdMob || !ready || !interstitialLoaded || !due) return done();
      interstitialLoaded = false;
      showFullScreen(() => AdMob.showInterstitial(),
        { dismissed: "interstitialAdDismissed", failed: "interstitialAdFailedToShow" },
        pauseAudio, () => {
          runsSinceAd = 0;
          lastAdAt = Date.now();
          loadInterstitial();
          done();
        });
    },
    // Only offered when an ad is actually ready to show.
    get rewardedAd() {
      if (!AdMob || !ready || !rewardedLoaded) return null;
      return (onReward, pauseAudio, onCancel) => {
        rewardedLoaded = false;
        showFullScreen(() => AdMob.showRewardVideoAd(),
          { dismissed: "onRewardedVideoAdDismissed", failed: "onRewardedVideoAdFailedToShow", reward: "onRewardedVideoAdReward" },
          pauseAudio, (rewarded) => {
            lastAdAt = Date.now(); // a chosen ad also counts, so a forced one doesn't follow it
            loadRewarded();
            if (rewarded) onReward();
            else if (onCancel) onCancel();
          });
      };
    },
    onBack(handler) {
      if (!App) return;
      App.addListener("backButton", () => {
        if (!handler()) App.exitApp(); // on the main menu, Back closes the app
      });
    },
    onPause(pause) {
      if (App) App.addListener("pause", pause); // leaving the app pauses the drive
    },
  };

  start();
})();
