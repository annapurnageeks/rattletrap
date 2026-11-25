# Rattletrap for Android

The same game as the web version, packed as an Android app with
[Capacitor](https://capacitorjs.com) (it shows the game in a full-screen web view), plus:

- **AdMob ads**, kept fair: an optional "watch an ad, double your coins" button after a run, and a
  short full-screen ad at most every 3rd "Drive again" (never twice within 2 minutes, never while
  driving). With no internet the game just carries on. The code is in `../portal/android.js`.
- Google's **consent form** for personalised ads, shown only where the law needs it (EU, UK...).
- The phone's **Back button** pauses the drive, steps back a screen, and closes the app on the menu.
- **Landscape**, **full screen**, and the screen doesn't sleep while you play.

Until you add your own AdMob IDs, the app shows Google's **test ads** (they pay nothing, and are
safe to tap while testing).

## Build and run

Needs Node, Android Studio (its SDK) and Java 21 (`brew install openjdk@21`; `android/gradle.properties`
points Gradle at it).

```
npm install
npm run debug        # builds android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android # or open the android/ folder in Android Studio and press Run
```

`npm run sync` copies the latest game files into the app. Run it (or `debug`/`release`) after any
change to the game.

## 1. Create your AdMob app and ad units

1. Sign in at [admob.google.com](https://admob.google.com) with your Google account and add your
   payment details there yourself (Payments → add a bank account that accepts SWIFT transfers; Google
   asks for your PAN as the Nepal tax ID).
2. **Apps → Add app** → Android → "No, not listed yet" → name *Rattletrap*.
   You get an **App ID** like `ca-app-pub-1234567890123456~1234567890`.
3. **Ad units → Add ad unit**, twice:
   - **Interstitial**, named *Between runs*
   - **Rewarded**, named *Double coins* (reward: 1 coins, it doesn't matter, the game doubles the run)
   Each has an ID like `ca-app-pub-1234567890123456/1234567890`.
4. Put them in the app:
   - the App ID in `android/gradle.properties` as `admobAppId=ca-app-pub-...~...`
   - the two ad unit IDs in `package.json`'s `web` script:
     `node ../tools/build.js android INTERSTITIAL_ID=ca-app-pub-.../... REWARDED_ID=ca-app-pub-.../...`

Never tap your own real ads: AdMob can close accounts for that. Keep testing with test ads, or add
your phone as a test device in AdMob (Settings → Test devices).

## 2. Make your upload key (once, and keep it safe)

Google Play needs every release signed with your *upload key*. Create it in a terminal (you choose
the password; keep it somewhere safe, like a password manager):

```
/opt/homebrew/opt/openjdk@21/bin/keytool -genkeypair -v -keystore ~/rattletrap-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android/keystore.properties` (it is git-ignored, never commit it):

```
storeFile=/Users/YOUR_NAME/rattletrap-upload.jks
storePassword=your-password
keyAlias=upload
keyPassword=your-password
```

Back up `rattletrap-upload.jks` (and the password) outside this computer. With Play App Signing,
Google keeps the real app-signing key; if you lose the upload key, Google support can reset it,
but it takes days.

## 3. Build the release

```
npm run release      # android/app/build/outputs/bundle/release/app-release.aab
```

For every update, raise `versionCode` (1, 2, 3...) and `versionName` ("1.0", "1.1"...) in
`android/app/build.gradle` first.

## 4. Google Play Console

**Create app**: name *Rattletrap*, Game, Free, then fill in:

- **Store listing** (graphics are in `store/`):
  - App icon: `store/icon-512.png`; feature graphic: `store/feature-graphic-1024x500.png`
  - Phone screenshots: `store/screen-*.png` (landscape)
  - Short description: *Climb hills, cross rope bridges, reach the Moon. Don't land on your head!*
  - Full description: see below
  - Category: Game → Racing. Tags: Racing, Physics, Offline
- **Privacy policy**: https://annapurnageeks.github.io/rattletrap/privacy.html
- **Ads**: Yes, the app contains ads.
- **App access**: all functionality is available without special access.
- **Content rating** questionnaire: Game; no violence beyond cartoon crashes (the driver bumps his
  head), no blood, no gambling, no user chat, no purchases. Expect *Everyone / PEGI 3*.
- **Target audience**: 13+ (13–15, 16–17, 18+). Don't pick under-13 age groups: then the
  Families policy applies and the ads would need special child-safe settings.
- **Data safety**:
  - Data collected: *Device or other IDs* (advertising ID), *App interactions*, *Approximate location*
    (from the IP address), *Diagnostics*, all **collected by the AdMob SDK**, for *Advertising or
    marketing* and *Analytics*; not shared beyond the ad provider's processing; data is encrypted in
    transit; users can't request deletion from you (the game stores nothing on a server).
  - The game's own progress stays on the phone and is not collected.
- **Testing → Closed testing**: create a track, upload `app-release.aab`, add your 12 testers' Gmail
  addresses (or a Google Group), share the opt-in link, and keep them opted in for 14 days.
  Then apply for production access.

### Full description

> **Climb the hills. Don't land on your head.**
>
> Drive a rickety little truck as far as you can over endless hills. Hold GAS to go and BRAKE to slow
> down or reverse. In the air, Gas tips you back and Brake tips you forward. Grab fuel cans before the
> tank runs dry, collect coins, and earn bonus coins for flips, big jumps and wheelies.
>
> **6 adventures:** Countryside with crates to smash · Canyon with wobbly rope bridges · slippery Arctic
> ice · pitch-dark Midnight Woods lit by your headlights · Volcano bridges over lava · The Moon with
> low gravity and endless flips.
>
> **4 vehicles:** the Rattletrap truck, a Dirt Bike, a Tractor and a Monster Truck, each with its own
> handling, 40 garage upgrades and paint jobs.
>
> Missions, medals, a daily gift, stats and music. Plays offline. No sign-up. Ads only between runs,
> never while you drive.

## After launch: app-ads.txt

AdMob asks for an `app-ads.txt` file on the website listed in your Play Store listing, at the root
of the domain. Once you have your publisher ID (`pub-...`), it goes in a repository named
`annapurnageeks.github.io` (so it is served at `annapurnageeks.github.io/app-ads.txt`), with the line
AdMob shows you, for example:

```
google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
```
