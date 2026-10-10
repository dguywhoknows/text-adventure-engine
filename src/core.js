/* Game data and rules for the text adventure engine (pure, unit-tested). */

/* ---------- world data ---------- */
var THEMES = {
  crypt: {
    name: 'Forgotten Crypt', tone: 'dark fantasy, candle-lit stone, ancient curses',
    rooms: ['ossuary', 'flooded chapel', 'collapsed tomb', 'bone-lined corridor', 'embalming chamber', 'catacomb junction', 'root-choked vault', 'echoing nave'],
    monsters: [[{ n: 'Giant Rat', hp: 6, atk: 3, ac: 9 }, { n: 'Skeleton', hp: 9, atk: 4, ac: 11 }], [{ n: 'Ghoul', hp: 14, atk: 5, ac: 12 }, { n: 'Grave Spider', hp: 12, atk: 6, ac: 12 }], [{ n: 'Wight Knight', hp: 22, atk: 7, ac: 14 }]],
    boss: { n: 'The Lich-Bishop', hp: 34, atk: 8, ac: 14 }, exit: 'a sealed crypt door glowing with runes',
  },
  derelict: {
    name: 'Derelict Starship', tone: 'sci-fi horror, flickering emergency lights, hull groans',
    rooms: ['cryo bay', 'hydroponics deck', 'breached airlock', 'med-lab', 'reactor catwalk', 'crew quarters', 'cargo hold', 'navigation bridge annex'],
    monsters: [[{ n: 'Maintenance Drone', hp: 6, atk: 3, ac: 10 }, { n: 'Spore Crawler', hp: 8, atk: 4, ac: 10 }], [{ n: 'Infected Crewman', hp: 14, atk: 5, ac: 11 }, { n: 'Security Turret', hp: 12, atk: 6, ac: 13 }], [{ n: 'Hive Brute', hp: 22, atk: 7, ac: 13 }]],
    boss: { n: 'The Hive Mind Core', hp: 34, atk: 8, ac: 14 }, exit: 'an escape pod with one seat',
  },
  mansion: {
    name: 'Hollow Mansion', tone: 'gothic mystery, dust, whispering portraits, rain on windows',
    rooms: ['portrait gallery', 'ballroom', 'servants’ stair', 'conservatory', 'library', 'nursery', 'wine cellar', 'locked study'],
    monsters: [[{ n: 'Possessed Doll', hp: 6, atk: 3, ac: 10 }, { n: 'Swarm of Moths', hp: 7, atk: 3, ac: 11 }], [{ n: 'Restless Butler', hp: 14, atk: 5, ac: 12 }, { n: 'Animated Armor', hp: 13, atk: 5, ac: 14 }], [{ n: 'The Weeping Bride', hp: 22, atk: 7, ac: 13 }]],
    boss: { n: 'Lord Hollow’s Shade', hp: 34, atk: 8, ac: 14 }, exit: 'the front doors, finally unlocked',
  },
};
var ITEMS = {
  potion: { name: 'Healing Potion', use: 'heal 10 HP' },
  bomb: { name: 'Firebomb', use: 'deal 10 damage' },
  blade: { name: 'Keen Blade', passive: '+2 attack damage' },
  shield: { name: 'Sturdy Shield', passive: '+2 AC' },
  lantern: { name: 'Lantern', passive: 'reveals what waits in nearby rooms' },
  key: { name: 'Bone Key', passive: 'opens the final door' },
};
var N = 5;
var DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };


/* ---------- seeded RNG (mulberry32) ---------- */
function makeRng(seed) {
  seed = seed | 0;
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function opposite(dir) { return { north: 'south', south: 'north', east: 'west', west: 'east' }[dir]; }

/* ---------- dungeon generation: randomized-DFS maze + loops, BFS difficulty, placed key + boss ---------- */
function generateDungeon(seed, theme) {
  var rand = makeRng(seed);
  var d = function (n) { return 1 + Math.floor(rand() * n); };
  var T = THEMES[theme];
  var rooms = [];
  for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) rooms.push({ x: x, y: y, doors: {}, type: 'empty', seen: false, visited: false, kind: T.rooms[Math.floor(rand() * T.rooms.length)] });
  var stack = [[2, 2]], seenC = { '2,2': 1 };
  while (stack.length) {
    var cur = stack[stack.length - 1], cx = cur[0], cy = cur[1];
    var opts = Object.keys(DIRS).filter(function (dir) { var nx = cx + DIRS[dir][0], ny = cy + DIRS[dir][1]; return nx >= 0 && ny >= 0 && nx < N && ny < N && !seenC[nx + ',' + ny]; });
    if (!opts.length) { stack.pop(); continue; }
    var dir = opts[Math.floor(rand() * opts.length)], nx = cx + DIRS[dir][0], ny = cy + DIRS[dir][1];
    rooms[cy * N + cx].doors[dir] = true;
    rooms[ny * N + nx].doors[opposite(dir)] = true;
    seenC[nx + ',' + ny] = 1;
    stack.push([nx, ny]);
  }
  for (var i = 0; i < 4; i++) { var lx = Math.floor(rand() * (N - 1)), ly = Math.floor(rand() * N); rooms[ly * N + lx].doors.east = true; rooms[ly * N + lx + 1].doors.west = true; }
  var dist = roomDistances(rooms, 2, 2);
  rooms.forEach(function (r) { r.dist = dist[r.y * N + r.x]; });
  var far = rooms.slice().sort(function (p, q) { return q.dist - p.dist; });
  var boss = far[0];
  rooms[2 * N + 2].type = 'start';
  boss.type = 'boss';
  boss.monster = Object.assign({}, T.boss, { max: T.boss.hp, tier: 3, xp: 30, gold: 50 });
  var keyRoom = far.slice(1).find(function (r) { return r.dist >= 3 && rand() < 0.5; }) || far[1];
  keyRoom.type = 'treasure';
  keyRoom.loot = { gold: 15, item: 'key' };
  rooms.forEach(function (r) {
    if (r.type !== 'empty') return;
    var p = rand();
    if (p < 0.38) {
      var tier = Math.min(2, Math.floor(r.dist / 3)), pool = T.monsters[tier], m = pool[Math.floor(rand() * pool.length)];
      r.type = 'monster';
      r.monster = Object.assign({}, m, { max: m.hp, tier: tier + 1, xp: 4 + tier * 5, gold: 3 + d(6) * (tier + 1) });
    } else if (p < 0.55) { r.type = 'treasure'; r.loot = { gold: 5 + d(12), item: ['potion', 'potion', 'bomb', 'blade', 'shield', 'lantern'][Math.floor(rand() * 6)] }; }
    else if (p < 0.67) r.type = 'trap';
    else if (p < 0.75) r.type = 'shrine';
  });
  return rooms;
}
/* BFS step distance from (sx,sy) through doors; unreachable rooms get Infinity. */
function roomDistances(rooms, sx, sy) {
  var dist = rooms.map(function () { return Infinity; }), q = [[sx, sy]];
  dist[sy * N + sx] = 0;
  while (q.length) {
    var c = q.shift(), r = rooms[c[1] * N + c[0]];
    Object.keys(r.doors).forEach(function (dir) {
      var nx = c[0] + DIRS[dir][0], ny = c[1] + DIRS[dir][1], k = ny * N + nx;
      if (dist[k] === Infinity) { dist[k] = dist[c[1] * N + c[0]] + 1; q.push([nx, ny]); }
    });
  }
  return dist;
}

/* ---------- hero classes ---------- */
var CLASSES = {
  warrior: { name: 'Warrior', hp: 30, hpPerLevel: 8, ac: 1, atk: 0, blurb: 'Tough and steady. Shrugs off hits.', ability: { name: 'Second Wind', desc: 'Heal 40% of max HP', cooldown: 6 } },
  rogue: { name: 'Rogue', hp: 22, hpPerLevel: 5, ac: 0, atk: 2, critOn: 19, blurb: 'Hits hard and crits often (19–20).', ability: { name: 'Backstab', desc: 'Guaranteed hit for double damage', cooldown: 5 } },
  mage: { name: 'Mage', hp: 18, hpPerLevel: 4, ac: -1, atk: 1, blurb: 'Fragile, but commands raw arcane power.', ability: { name: 'Fireball', desc: 'Deal 12 + level damage, never misses', cooldown: 4 } },
};
var XP_TABLE = [0, 12, 30, 55, 90, 140, 200];
function xpForNext(lvl) { return XP_TABLE[lvl] || 200 + (lvl - 6) * 80; }
function heroStats(cls, lvl, inv, blessing) {
  var C = CLASSES[cls] || CLASSES.warrior, has = function (i) { return (inv || []).indexOf(i) >= 0; };
  return {
    max: C.hp + (lvl - 1) * C.hpPerLevel,
    ac: 11 + C.ac + (has('shield') ? 2 : 0) + Math.floor(lvl / 2),
    atk: lvl + C.atk + (has('blade') ? 2 : 0) + (blessing || 0),
    critOn: C.critOn || 20,
  };
}
/* Probability that a d20 + bonus meets a target AC (natural 20 always hits). */
function hitChance(bonus, ac) { var need = ac - bonus; return Math.min(1, Math.max(1, 21 - need) / 20); }

/* ---------- runs, scoring, achievements ---------- */
function runScore(r) {
  return (r.won ? 500 : 0) + r.lvl * 60 + r.gold * 2 + (r.rooms || 0) * 10 + Object.values(r.kills || {}).reduce(function (a, b) { return a + b; }, 0) * 15 - (r.won ? Math.max(0, r.steps - 20) * 3 : 0);
}
var ACHIEVEMENTS = [
  { id: 'first-blood', name: 'First Blood', desc: 'Defeat your first monster', test: function (p) { return totalKills(p) >= 1; } },
  { id: 'slayer', name: 'Slayer', desc: 'Defeat 25 monsters across all runs', test: function (p) { return totalKills(p) >= 25; } },
  { id: 'victor', name: 'Victor', desc: 'Win a run', test: function (p) { return p.runs.some(function (r) { return r.won; }); } },
  { id: 'all-worlds', name: 'World Walker', desc: 'Win in all three worlds', test: function (p) { return ['crypt', 'derelict', 'mansion'].every(function (t) { return p.runs.some(function (r) { return r.won && r.theme === t; }); }); } },
  { id: 'all-classes', name: 'Jack of All Trades', desc: 'Win with every class', test: function (p) { return Object.keys(CLASSES).every(function (c) { return p.runs.some(function (r) { return r.won && r.cls === c; }); }); } },
  { id: 'speedrun', name: 'Speedrunner', desc: 'Win in 18 steps or fewer', test: function (p) { return p.runs.some(function (r) { return r.won && r.steps <= 18; }); } },
  { id: 'hoarder', name: 'Hoarder', desc: 'Finish a run with 150+ gold', test: function (p) { return p.runs.some(function (r) { return r.gold >= 150; }); } },
  { id: 'cartographer', name: 'Cartographer', desc: 'Visit all 25 rooms in one run', test: function (p) { return p.runs.some(function (r) { return r.rooms >= 25; }); } },
  { id: 'veteran', name: 'Veteran', desc: 'Reach level 5', test: function (p) { return p.runs.some(function (r) { return r.lvl >= 5; }); } },
  { id: 'persistent', name: 'Persistent', desc: 'Play 10 runs', test: function (p) { return p.runs.length >= 10; } },
];
function totalKills(p) { return p.runs.reduce(function (a, r) { return a + Object.values(r.kills || {}).reduce(function (x, y) { return x + y; }, 0); }, 0); }
/* Returns achievement ids newly satisfied by the profile (not already unlocked). */
function newAchievements(profile) {
  return ACHIEVEMENTS.filter(function (a) { return !profile.achievements[a.id] && a.test(profile); }).map(function (a) { return a.id; });
}
/* All monsters of all worlds, flattened with their world + tier. */
function bestiaryEntries() {
  var out = [];
  Object.keys(THEMES).forEach(function (t) {
    THEMES[t].monsters.forEach(function (tier, i) { tier.forEach(function (m) { out.push(Object.assign({ world: t, tier: i + 1 }, m)); }); });
    out.push(Object.assign({ world: t, tier: 'boss' }, THEMES[t].boss));
  });
  return out;
}
