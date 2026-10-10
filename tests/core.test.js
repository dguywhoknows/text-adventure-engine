test('makeRng is deterministic per seed and in [0,1)', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const xs = [a(), a(), a()];
  assert.deepEq(xs, [b(), b(), b()]);
  assert.ok(xs[0] !== c());
  for (let i = 0; i < 1000; i++) { const v = a(); assert.ok(v >= 0 && v < 1); }
});

test('generateDungeon: every room is reachable from the start', () => {
  for (const seed of [1, 7, 99, 12345, 777777]) {
    for (const theme of Object.keys(THEMES)) {
      const rooms = generateDungeon(seed, theme);
      assert.eq(rooms.length, N * N);
      const dist = roomDistances(rooms, 2, 2);
      assert.ok(dist.every((d) => Number.isFinite(d)), `unreachable room for seed ${seed} ${theme}`);
    }
  }
});

test('generateDungeon: doors are symmetric', () => {
  const rooms = generateDungeon(2024, 'crypt');
  rooms.forEach((r) => Object.keys(r.doors).forEach((dir) => {
    const n = rooms[(r.y + DIRS[dir][1]) * N + r.x + DIRS[dir][0]];
    assert.ok(n && n.doors[opposite(dir)], `door ${dir} from ${r.x},${r.y} has no way back`);
  }));
});

test('generateDungeon: exactly one boss at maximum distance, one key, start in the center', () => {
  const rooms = generateDungeon(55, 'derelict');
  const bosses = rooms.filter((r) => r.type === 'boss');
  assert.eq(bosses.length, 1);
  assert.eq(bosses[0].dist, Math.max(...rooms.map((r) => r.dist)));
  assert.eq(rooms.filter((r) => r.loot && r.loot.item === 'key').length, 1);
  assert.eq(rooms[2 * N + 2].type, 'start');
});

test('generateDungeon: same seed, same dungeon; harder monsters further away', () => {
  assert.eq(JSON.stringify(generateDungeon(9, 'mansion')), JSON.stringify(generateDungeon(9, 'mansion')));
  const rooms = generateDungeon(9, 'mansion').filter((r) => r.type === 'monster');
  rooms.forEach((r) => assert.eq(r.monster.tier, Math.min(2, Math.floor(r.dist / 3)) + 1));
});

test('heroStats: classes trade health, armor and attack; items and levels apply', () => {
  const w = heroStats('warrior', 1, [], 0), r = heroStats('rogue', 1, [], 0), m = heroStats('mage', 1, [], 0);
  assert.ok(w.max > r.max && r.max > m.max);
  assert.ok(w.ac > m.ac);
  assert.ok(r.atk > w.atk);
  assert.eq(r.critOn, 19);
  const geared = heroStats('warrior', 3, ['shield', 'blade'], 1);
  assert.eq(geared.ac, 11 + 1 + 2 + 1);
  assert.eq(geared.atk, 3 + 0 + 2 + 1);
  assert.eq(heroStats('warrior', 4, [], 0).max, 30 + 3 * 8);
});

test('xpForNext follows the table then grows linearly', () => {
  assert.eq(xpForNext(1), 12);
  assert.eq(xpForNext(5), 140);
  assert.eq(xpForNext(8), 360);
});

test('hitChance: d20 math with natural-20 floor', () => {
  assert.near(hitChance(0, 11), 0.5, 1e-9);
  assert.near(hitChance(5, 11), 0.75, 1e-9);
  assert.near(hitChance(0, 40), 0.05, 1e-9, 'always 5% on a natural 20');
  assert.eq(hitChance(30, 10), 1);
});

test('runScore rewards wins, levels, gold, exploration and kills; penalizes slow wins', () => {
  const base = { won: false, lvl: 2, gold: 10, rooms: 5, kills: { Rat: 2 }, steps: 30 };
  assert.eq(runScore(base), 120 + 20 + 50 + 30);
  const fast = runScore({ ...base, won: true, steps: 18 }), slow = runScore({ ...base, won: true, steps: 40 });
  assert.ok(fast > slow && slow > runScore(base));
});

test('newAchievements only returns unmet, newly satisfied achievements', () => {
  const p = { runs: [{ won: true, theme: 'crypt', cls: 'rogue', steps: 15, gold: 160, rooms: 25, lvl: 5, kills: { Rat: 3 } }], achievements: { 'first-blood': 1 } };
  const got = newAchievements(p);
  ['victor', 'speedrun', 'hoarder', 'cartographer', 'veteran'].forEach((id) => assert.ok(got.includes(id), id));
  assert.ok(!got.includes('first-blood'), 'already unlocked');
  assert.ok(!got.includes('all-worlds') && !got.includes('persistent'));
  assert.eq(totalKills(p), 3);
});

test('bestiaryEntries lists every monster and boss once with its world', () => {
  const b = bestiaryEntries();
  assert.eq(b.length, 3 * (2 + 2 + 1 + 1));
  assert.eq(b.filter((m) => m.tier === 'boss').length, 3);
  assert.ok(b.every((m) => THEMES[m.world]));
});
