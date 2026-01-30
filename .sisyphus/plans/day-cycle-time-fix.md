# Day-Night Cycle Time Mapping Fix

## Context

### Original Request
1. 时间映射和真实世界上对不上，需要按照用户提供的数值重新整理 `phaseRanges`
2. morning 时段虽然正常加载，但 `day-cycle.js` 中没有 morning 贴图的 skybox 过渡效果

### Research Findings
- **Time Mapping**: Current `phaseRanges` uses incorrect time boundaries (e.g., midnight ends at 0.06 ≈ 01:26, but should end at 0.22 ≈ 05:15)
- **Morning Texture**: `sky_morningTexture` exists in `sources.js` (line 299) and is defined in `phaseConfig.morning`, but is NOT included in the `_loadSkyTextures()` phases array (line 162)
- **Duplicate Definition**: `DAY_PHASES` in `hudStore.js` (lines 139-148) duplicates `phaseRanges` and must be kept in sync
- **Hardcoded Constants**: Sun trajectory uses `0.08` and `0.71` for sunrise/sunset (lines 248-261), which must match new time scale

### Target Time Mappings (User Provided)
| Phase | Start | End | Real Time |
|-------|-------|-----|-----------|
| midnight | 0.00 | 0.22 | 00:00–05:15 |
| sunrise | 0.22 | 0.28 | 05:15–06:40 |
| morning | 0.28 | 0.40 | 06:40–09:40 |
| noon | 0.40 | 0.55 | 09:40–13:15 |
| afternoon | 0.55 | 0.70 | 13:15–16:45 |
| sunset | 0.70 | 0.78 | 16:45–18:45 |
| dusk | 0.78 | 0.85 | 18:45–20:20 |
| midnight | 0.85 | 1.00 | 20:20–24:00 |

---

## Work Objectives

### Core Objective
Fix the day-night cycle system to use correct real-world time mappings and enable morning skybox transitions.

### Concrete Deliverables
1. Updated `phaseRanges` array in `src/js/world/day-cycle.js`
2. Updated `DAY_PHASES` array in `src/pinia/hudStore.js`
3. Added `'morning'` to sky texture loading in `day-cycle.js`
4. Updated sun trajectory constants to match new sunrise/sunset boundaries
5. Updated debug preset buttons to reflect new time scale

### Definition of Done
- [ ] `pnpm lint` passes with no errors
- [ ] Time display in HUD shows correct 24-hour times for each phase
- [ ] Morning skybox texture fades in/out smoothly during morning phase
- [ ] Sun position matches expected arc (rises at sunrise, peaks at noon, sets at sunset)
- [ ] Debug preset buttons jump to correct times

### Must Have
- All 7 time phases map correctly to 24-hour clock (matching user's image)
- Morning skybox texture included in blend transitions
- Consistent values between `phaseRanges` (day-cycle.js) and `DAY_PHASES` (hudStore.js)

### Must NOT Have (Guardrails)
- DO NOT modify any other phase configuration (colors, fog, sun intensity, etc.)
- DO NOT change the skybox blending algorithm logic
- DO NOT alter the HUD time formatting formula (`time * 24 * 60`)
- DO NOT add new textures or remove existing ones
- DO NOT modify scene rendering or camera behavior

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO (no automated test suite for day-cycle)
- **User wants tests**: Manual-only
- **Framework**: N/A

### Manual Verification
Each task will be verified using the debug panel (Tweakpane) to set `timeOfDay` and visually confirm behavior.

---

## Task Flow

```
Task 1 (phaseRanges update)
    ↓
Task 2 (DAY_PHASES sync) ← parallel with Task 3
Task 3 (morning texture loading)
    ↓
Task 4 (sun trajectory constants)
    ↓
Task 5 (debug preset buttons)
    ↓
Task 6 (lint & visual verification)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 2, 3 | Independent file changes after Task 1 |

| Task | Depends On | Reason |
|------|------------|--------|
| 2, 3 | 1 | Need new boundary values from Task 1 |
| 4 | 1 | Uses sunrise/sunset boundaries |
| 5 | 1 | Uses all phase boundary values |
| 6 | 1-5 | Final verification after all changes |

---

## TODOs

- [ ] 1. Update `phaseRanges` in `day-cycle.js` with correct time mappings

  **What to do**:
  - Edit `src/js/world/day-cycle.js` lines 123-132
  - Replace current `phaseRanges` array with new time boundaries
  - Update the JSDoc comment block above (lines 102-121) to reflect new mappings

  **New Values**:
  ```javascript
  this.phaseRanges = [
    { name: 'midnight', start: 0.00, end: 0.22 },   // 00:00–05:15
    { name: 'sunrise', start: 0.22, end: 0.28 },    // 05:15–06:40
    { name: 'morning', start: 0.28, end: 0.40 },    // 06:40–09:40
    { name: 'noon', start: 0.40, end: 0.55 },       // 09:40–13:15
    { name: 'afternoon', start: 0.55, end: 0.70 },  // 13:15–16:45
    { name: 'sunset', start: 0.70, end: 0.78 },     // 16:45–18:45
    { name: 'dusk', start: 0.78, end: 0.85 },       // 18:45–20:20
    { name: 'midnight', start: 0.85, end: 1.00 },   // 20:20–24:00
  ]
  ```

  **Must NOT do**:
  - Do not change `phaseConfig` (colors, intensity, fog settings)
  - Do not modify `_getPhaseInfo()` logic

  **Parallelizable**: NO (foundation for all other tasks)

  **References**:
  - `src/js/world/day-cycle.js:123-132` - Current `phaseRanges` definition to replace
  - `src/js/world/day-cycle.js:102-121` - JSDoc comment block with time mappings to update
  - User's image - Source of truth for new time values

  **Acceptance Criteria**:
  - [ ] `phaseRanges` array has 8 entries with new boundary values
  - [ ] JSDoc comment block reflects new 24-hour time mappings
  - [ ] File saves without syntax errors

  **Commit**: NO (groups with Tasks 2-5)

---

- [ ] 2. Sync `DAY_PHASES` in `hudStore.js` with new time mappings

  **What to do**:
  - Edit `src/pinia/hudStore.js` lines 139-148
  - Replace `DAY_PHASES` array with identical values to new `phaseRanges`
  - Update the JSDoc comment block above (lines 127-138) to match

  **Must NOT do**:
  - Do not change `updateGameTime()` formula
  - Do not modify any other HUD state or functions

  **Parallelizable**: YES (with Task 3, after Task 1)

  **References**:
  - `src/pinia/hudStore.js:139-148` - Current `DAY_PHASES` definition
  - `src/pinia/hudStore.js:127-138` - JSDoc comment to update
  - Task 1 output - New values to copy

  **Acceptance Criteria**:
  - [ ] `DAY_PHASES` exactly matches `phaseRanges` from Task 1
  - [ ] JSDoc comment reflects new time mappings
  - [ ] File saves without syntax errors

  **Commit**: NO (groups with Tasks 1, 3-5)

---

- [ ] 3. Add `'morning'` to sky texture loading phases

  **What to do**:
  - Edit `src/js/world/day-cycle.js` line 162
  - Add `'morning'` to the `phases` array in `_loadSkyTextures()`
  
  **Current**:
  ```javascript
  const phases = ['sunrise', 'noon', 'afternoon', 'sunset', 'dusk', 'midnight']
  ```
  
  **New**:
  ```javascript
  const phases = ['sunrise', 'morning', 'noon', 'afternoon', 'sunset', 'dusk', 'midnight']
  ```

  **Must NOT do**:
  - Do not modify texture mapping or colorSpace settings
  - Do not add any other phases

  **Parallelizable**: YES (with Task 2, after Task 1)

  **References**:
  - `src/js/world/day-cycle.js:162` - Phases array to modify
  - `src/js/world/day-cycle.js:51-58` - `phaseConfig.morning` confirming texture name `sky_morningTexture`
  - `src/js/sources.js:299` - Confirms `sky_morningTexture` exists and points to `textures/background/morning.png`

  **Acceptance Criteria**:
  - [ ] `phases` array includes `'morning'` in correct order (after sunrise, before noon)
  - [ ] No console warnings about missing morning texture
  - [ ] Using debug panel, set `timeOfDay` to 0.35 → observe morning skybox visible

  **Commit**: NO (groups with Tasks 1-2, 4-5)

---

- [ ] 4. Update sun trajectory constants for new sunrise/sunset times

  **What to do**:
  - Edit `src/js/world/day-cycle.js` lines 248-261
  - Replace sunrise constant `0.08` with `0.22` (new sunrise start)
  - Replace sunset constant `0.71` with `0.78` (new sunset end)
  - Update the comment describing the sun arc

  **Current Logic** (line 255-258):
  ```javascript
  if (t >= 0.08 && t <= 0.71) {
    sunAngle = ((t - 0.08) / (0.71 - 0.08)) * Math.PI
  }
  ```
  
  **New Logic**:
  ```javascript
  if (t >= 0.22 && t <= 0.78) {
    sunAngle = ((t - 0.22) / (0.78 - 0.22)) * Math.PI
  }
  ```

  **Must NOT do**:
  - Do not change orbit radius or height parameters
  - Do not modify moon light behavior

  **Parallelizable**: NO (depends on Task 1 values)

  **References**:
  - `src/js/world/day-cycle.js:247-262` - `_updateSunPosition()` method with hardcoded constants
  - Task 1 output - Sunrise starts at 0.22, sunset ends at 0.78

  **Acceptance Criteria**:
  - [ ] Sun rises at timeOfDay = 0.22 (not before)
  - [ ] Sun sets at timeOfDay = 0.78 (not after)
  - [ ] Sun reaches zenith around timeOfDay ≈ 0.50 (midpoint)
  - [ ] Using debug panel, verify sun arc matches expectations at key times

  **Commit**: NO (groups with Tasks 1-3, 5)

---

- [ ] 5. Update debug preset buttons to new time scale

  **What to do**:
  - Edit `src/js/world/day-cycle.js` lines 551-571
  - Update each button's `timeOfDay` value to match new phase centers

  **New Preset Values** (center of each phase):
  | Preset | Old Value | New Value | Calculation |
  |--------|-----------|-----------|-------------|
  | Sunrise (6:00) | 0.09 | 0.25 | 6:00 = 0.25 (linear) |
  | Morning (9:00) | 0.18 | 0.375 | 9:00 = 0.375 |
  | Noon (12:00) | 0.33 | 0.50 | 12:00 = 0.50 |
  | Afternoon (15:00) | 0.50 | 0.625 | 15:00 = 0.625 |
  | Sunset (18:00) | 0.65 | 0.75 | 18:00 = 0.75 |
  | Dusk (20:00) | 0.77 | 0.833 | 20:00 = 0.833 |
  | Midnight (00:00) | 0.0 | 0.0 | 00:00 = 0.0 |

  **Must NOT do**:
  - Do not add or remove preset buttons
  - Do not change button labels/titles

  **Parallelizable**: NO (depends on Task 1 values)

  **References**:
  - `src/js/world/day-cycle.js:551-571` - Debug preset button definitions
  - HUD time formula: `time * 24 * 60` gives total minutes, confirms linear mapping

  **Acceptance Criteria**:
  - [ ] Each preset button jumps to correct in-game time
  - [ ] Clicking "Noon (12:00)" sets timeOfDay to 0.50
  - [ ] HUD displays matching time after clicking preset

  **Commit**: NO (groups with Tasks 1-4)

---

- [ ] 6. Run lint and perform visual verification

  **What to do**:
  - Run `pnpm lint` to ensure no syntax errors
  - Start dev server with `pnpm dev`
  - Open debug panel (`#debug` hash)
  - Manually test each time phase

  **Must NOT do**:
  - Do not make any code changes unless lint fails

  **Parallelizable**: NO (final step)

  **References**:
  - All modified files from Tasks 1-5
  - Debug panel at `http://localhost:5173/#debug`

  **Acceptance Criteria**:

  **Lint Check:**
  - [ ] `pnpm lint` → 0 errors, 0 warnings (or only pre-existing warnings)

  **Visual Verification (using debug panel):**
  - [ ] Set `timeOfDay = 0.10` → HUD shows ~02:24 AM, sky is midnight/dark
  - [ ] Set `timeOfDay = 0.25` → HUD shows ~06:00 AM, sunrise sky visible
  - [ ] Set `timeOfDay = 0.35` → HUD shows ~08:24 AM, **morning skybox visible** (not skipping from sunrise to noon)
  - [ ] Set `timeOfDay = 0.50` → HUD shows ~12:00 PM, noon sky, sun at zenith
  - [ ] Set `timeOfDay = 0.625` → HUD shows ~03:00 PM, afternoon sky
  - [ ] Set `timeOfDay = 0.75` → HUD shows ~06:00 PM, sunset sky
  - [ ] Set `timeOfDay = 0.82` → HUD shows ~07:40 PM, dusk sky
  - [ ] Set `timeOfDay = 0.95` → HUD shows ~10:48 PM, midnight sky

  **Commit**: YES
  - Message: `fix(day-cycle): correct time mappings and add morning skybox transition`
  - Files: `src/js/world/day-cycle.js`, `src/pinia/hudStore.js`
  - Pre-commit: `pnpm lint`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 6 | `fix(day-cycle): correct time mappings and add morning skybox transition` | `src/js/world/day-cycle.js`, `src/pinia/hudStore.js` | `pnpm lint` |

---

## Success Criteria

### Verification Commands
```bash
pnpm lint           # Expected: 0 errors
pnpm dev            # Start dev server for visual testing
```

### Final Checklist
- [ ] All "Must Have" requirements present
- [ ] All "Must NOT Have" guardrails respected
- [ ] Morning skybox transitions work
- [ ] Time display matches 24-hour expectations
- [ ] Sun arc matches sunrise/sunset boundaries
