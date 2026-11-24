# Rattletrap

**Climb the hills. Don't land on your head.**

![Rattletrap](social.png)

A physics driving game that runs in any browser. Drive a rickety little truck as far as you can
over endless hills:

- Hold **Gas** to drive and **Brake** to slow down or reverse. In the air, Gas tips the truck back and Brake tips it forward.
- Grab **fuel cans** before the tank runs dry. They get further apart the further you go.
- Pick up **coins**, and earn more for **flips** and long **air time**.
- If the driver's head touches the ground, the run is over.
- Spend coins in the **garage** on the engine, suspension, tyres and fuel tank (10 levels each).
- Every 1000 m the land changes: meadow, canyon, snowfield, night road.

The road is the same on every run, so you learn it, and a flag marks your best distance.

Controls: the on-screen pedals (touch or mouse), or the arrow keys / WASD. P or Esc pauses.

## Run it

Serve the folder (`python3 -m http.server`) and open it in a browser.

## How the code is laid out

- `index.html`: the screens (menu, garage, pause, result) and the pedals.
- `style.css`: how they look, on phones and computers.
- `game.js`: everything else, in 9 commented parts: settings, saving and upgrades, the road, the physics world, driving, drawing, screens, sound, start.
- `vendor/planck.min.js`: [planck.js](https://piqnt.com/planck.js/) 1.4.2, a JavaScript copy of the Box2D physics engine (MIT). It handles the wheels, springs and gravity.

`tools/check.js` sends a robot driver up the road at several garage levels in headless Chrome. It
reports how far each level gets, so the hills, fuel and prices stay balanced:

```
cd tools && npm install && node check.js
```

`node tools/build.js itch` makes the zip for itch.io.

## Credits

Physics: planck.js (MIT, `vendor/planck-LICENSE.txt`).
Sounds: [Interface Sounds](https://kenney.nl/assets/interface-sounds) by Kenney (CC0). The engine sound is made in code.
Font: [Nunito](https://fonts.google.com/specimen/Nunito) (SIL Open Font License, `fonts/OFL.txt`).
Code and art: MIT.
