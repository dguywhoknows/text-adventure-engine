# text-adventure-engine

[![tests](https://github.com/dguywhoknows/text-adventure-engine/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/text-adventure-engine/actions/workflows/tests.yml)

A roguelike where a real game engine owns the rules and an AI Dungeon Master narrates every moment.

Live: https://dguywhoknows.github.io/text-adventure-engine/

## Overview

Most AI text adventures let the model make up the rules, so stats drift and loot appears from nowhere. Dungeon Narrator splits the work: a deterministic engine generates a seeded maze dungeon and resolves all combat and traps with d20 dice, HP, AC, XP and inventory. The AI only narrates the facts it is handed. Free-form actions ("throw my torch at the cobwebs") are adjudicated by the AI as structured JSON, which the engine then clamps to fair bounds.

## Pages

- **Play**
- **Heroes**
- **Bestiary**
- **Chronicle**
- **Achievements**
- **Settings**

## Features

- Seeded procedural dungeons: randomized-DFS maze with extra loops, BFS-based difficulty scaling
- Three worlds: Forgotten Crypt, Derelict Starship, Hollow Mansion
- d20 combat with crits, AC, flee checks, traps, shrines, ambushes, leveling
- Inventory with consumables (potions, firebombs) and passives (blade, shield, lantern, key)
- Fog-of-war SVG minimap
- Free-form actions: AI adjudicates as JSON, engine clamps HP/gold/damage to keep the game fair
- Streaming narration with rolling story memory; autosave and resume
- Three hero classes (Warrior, Rogue, Mage) with distinct health, armor, attack, crit range and a cooldown-based ability (Second Wind, Backstab, Fireball)
- Heroes page comparing class stats at level 1 and 5, including computed hit chances
- Bestiary page that fills in as you defeat monsters, with kill counts and optional AI-written lore
- Chronicle page: every run is recorded with a score; leaderboard, win rate and a 'replay seed' button to retry the same dungeon
- Achievements page with 10 achievements evaluated after each run

## How it works

LLM calls are used for:

- Streaming narrator constrained to engine-provided facts (no invented loot or numbers)
- JSON adjudicator for free-form actions, sandboxed by engine-side clamping

Everything else (dungeon generation, dice, combat, inventory, leveling, map, saves) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/text-adventure-engine.git
cd text-adventure-engine
python -m http.server 8000
```

Then open http://localhost:8000.

### Configuration

Without an API key the app runs in demo mode with sample model output. To use a live model, open
**Settings → Configure provider** and paste a key for [Groq](https://console.groq.com/keys) or
[OpenRouter](https://openrouter.ai/keys). The key is stored in this browser's `localStorage` (namespaced to
this app) and is sent only to the selected provider.

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 11 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/text-adventure-engine/tests/)).

## Project structure

```
index.html           markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- Seeded mulberry32 RNG for reproducible worlds
- Engine/narrator separation pattern for trustworthy LLM games
- SVG minimap with fog of war
- Dungeon generation, seeded RNG, class stats, d20 probabilities, scoring and achievements in src/core.js with unit tests (reachability, door symmetry, determinism)
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
