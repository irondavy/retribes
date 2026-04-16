# retribes

Tribes-inspired FPS movement prototype built with three.js + TypeScript + Vite.

## Architecture

- `src/main.ts` — Entry point, scene setup, game loop, map wiring
- `src/player.ts` — PlayerController: movement physics, skiing, jetpack, gravity, camera, grapple
- `src/terrain.ts` — Terrain generation (heightmap, mirror ceiling, decorations, spawn points)
- `src/constants.ts` — `GameTuning` interface and live `tuning` object (persisted to localStorage)
- `src/tunePanel.ts` — Left sidebar with sliders/dropdowns for all tunable parameters
- `src/hud.ts` — In-game HUD overlay (speed, altitude, energy, crosshair, state badges)
- `src/input.ts` — Keyboard + mouse input state manager

## Key conventions

### Always expose tuning parameters in the sidebar

When adding any new mechanic or tweaking game feel, **add the relevant constants to `GameTuning` in `constants.ts`** with sensible defaults, and **add corresponding sliders/dropdowns in `tunePanel.ts`**. Never hardcode magic numbers for gameplay-affecting values. The whole point of this prototype is rapid feel iteration — if it can't be tuned from the sidebar, it's not useful.

Pattern:
1. Add the field to `GameTuning` interface and `tuningDefaults` in `src/constants.ts`
2. Read it from the `tuning` object in the consuming code (e.g. `player.ts`)
3. Add a slider (numeric) or select (enum) in the `SLIDERS` array or dropdown section of `src/tunePanel.ts`

### Persist UI state to localStorage

Any user-facing preference or UI state (tuning values, section collapsed/expanded, panel visibility, selected options) should be saved to `localStorage` and restored on load. Use a `retribes_` prefix for keys. Always fall back to sensible defaults when no saved value exists.

### Physics are velocity-based, not rigid-body

No physics engine. Gravity, friction, slope forces, and jetpack thrust are applied directly to a velocity vector each frame. Ground detection uses three.js Raycaster against terrain meshes.

### Camera uses quaternion look (no Euler angles)

Mouse look accumulates rotations directly on the camera quaternion — yaw in world space (premultiply), pitch in local space (multiply). No pitch clamp. Gravity camera reorientation modes (none/smooth/snap/spring) handle the "which way is up" problem.

### Terrain and ground detection are separated

The terrain group contains both visual meshes (decorations, orbs, flowers) and ground meshes. Only ground meshes are passed to the player for raycasting. Keep these separate so decorations don't interfere with physics.

### Dual-surface gravity

The flat map has a floor terrain and an inverted mirror ceiling. Gravity direction blends based on distance from the midpoint between them. The player raycasts toward whichever surface gravity is pulling toward. All physics (skiing slope forces, jetpack direction, ground snap) respect the current gravity vector.

## Running

```
npm run dev    # Vite dev server with HMR
npm run build  # TypeScript check + production build
```

## Controls

- WASD — Move
- Space / Right-click — Jetpack
- Shift — Ski (hold)
- Left-click — Grapple
- R — Respawn at random location
- F / Tab — Toggle tune panel
