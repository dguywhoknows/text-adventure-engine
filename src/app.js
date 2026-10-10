const { $, $$, h, esc, toast, rng, busy, store, md } = Kit;

/* ================= state ================= */
let G = null;
let rand = Math.random;
const d = (n) => 1 + Math.floor(rand() * n);
const roomAt = (x, y) => G.rooms[y * N + x];
const here = () => roomAt(G.x, G.y);


function newGame() {
  const theme = $('#theme').value;
  const seed = parseInt($('#seed').value, 36) || Date.now() % 1e9;
  const cls = $('#heroClass').value;
  const base = heroStats(cls, 1, [], 0);
  rand = rng(seed * 31 + 7);
  G = {
    theme, seed, cls, name: $('#heroName').value.trim() || 'Hero',
    hp: base.max, max: base.max, lvl: 1, xp: 0, gold: 0, steps: 0, inv: ['potion', 'potion'], blessing: 0, cd: 0, kills: {},
    x: 2, y: 2, prev: null, rooms: generateDungeon(seed, theme), over: false, history: [], started: Date.now(),
  };
  $('#setup').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#log').innerHTML = '';
  enterRoom(true);
}

/* ================= derived stats ================= */
const has = (it) => G.inv.includes(it);
const stats = () => heroStats(G.cls || 'warrior', G.lvl, G.inv, G.blessing);
const AC = () => stats().ac;
const ATK = () => stats().atk;
const XP_NEXT = () => xpForNext(G.lvl);

/* ================= log + narration ================= */
function log(text, cls = 'mech') {
  const el = h('div', { class: 'entry ' + cls }, text);
  $('#log').append(el);
  $('#log').scrollTop = 1e9;
  return el;
}

let narrating = Promise.resolve();
function narrate(event, facts) {
  const T = THEMES[G.theme];
  const el = log('', 'story typing');
  const task = narrating.then(() => AI.chat([
    { role: 'system', content: `You are the narrator of a ${T.tone} roguelike called "${T.name}". Second person, present tense, vivid but tight: 2-4 sentences. Narrate ONLY the facts provided. Never invent new items, enemies, exits or numbers, and never decide outcomes; the game engine already did. No lists, no markdown, no questions to the player.` },
    ...G.history.slice(-6),
    { role: 'user', content: `EVENT: ${event}\nFACTS: ${JSON.stringify(facts)}` },
  ], { temperature: 0.9, maxTokens: 220, onToken: (_, acc) => { el.textContent = acc; $('#log').scrollTop = 1e9; }, demo: () => demoNarration(event, facts) })
    .then((text) => {
      el.textContent = text;
      G.history.push({ role: 'user', content: `EVENT: ${event}` }, { role: 'assistant', content: text });
      if (G.history.length > 12) G.history.splice(0, 2);
      return text;
    })
    .catch((e) => { el.textContent = '(The narrator falls silent: ' + e.message + ')'; })
    .finally(() => el.classList.remove('typing')));
  narrating = task;
  return task;
}

/* ================= core loop ================= */
function enterRoom(first = false) {
  const r = here();
  const T = THEMES[G.theme];
  r.visited = true; r.seen = true;
  neighbours(r).forEach((n) => { n.seen = true; });
  log(cap(r.type === 'boss' ? 'The final chamber' : r.kind), 'room');
  const exits = Object.keys(r.doors);
  const facts = { room: r.kind, exits, hero: G.name, first_visit: !r.described };
  if (first) facts.intro = `Hero ${G.name} arrives at the entrance of ${T.name}. Goal: find the key and defeat ${T.boss.n}.`;
  if (r.type === 'monster' && r.monster.hp > 0) facts.enemy = r.monster.n;
  if (r.type === 'boss' && r.monster.hp > 0) facts.boss = r.monster.n + (has('key') ? ' (the hero holds the key)' : ' (a locked seal blocks the way; the hero needs the key)');
  if (r.type === 'treasure' && r.loot) facts.notice = 'a glint of treasure';
  if (r.type === 'shrine' && !r.used) facts.notice = 'a strange shrine humming with power';
  if (r.type === 'trap' && !r.sprung) {
    r.sprung = true;
    const roll = d(20) + G.lvl;
    if (roll >= 13) { facts.trap = `a hidden trap triggers but the hero dodges (roll ${roll} vs 13)`; log(`Trap! Dodge roll ${roll} vs 13 → dodged`); }
    else { const dmg = d(6); G.hp -= dmg; facts.trap = `a hidden trap hits the hero for ${dmg} damage (roll ${roll} vs 13)`; log(`Trap! Dodge roll ${roll} vs 13 → hit for ${dmg}`); }
  }
  r.described = true;
  narrate(first ? 'arrive' : 'enter_room', facts).then(() => { if (G.hp <= 0) die('a trap'); });
  render();
}

function neighbours(r) { return Object.keys(r.doors).map((dir) => roomAt(r.x + DIRS[dir][0], r.y + DIRS[dir][1])); }
function inCombat() { const r = here(); return (r.type === 'monster' || (r.type === 'boss' && has('key'))) && r.monster && r.monster.hp > 0; }
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function move(dir) {
  if (inCombat()) return toast('You cannot slip past. Fight or flee!', 'err');
  G.prev = [G.x, G.y];
  G.x += DIRS[dir][0]; G.y += DIRS[dir][1];
  G.steps++;
  G.cd = Math.max(0, (G.cd || 0) - 1);
  log('You go ' + dir + '.', 'you');
  enterRoom();
}

function attack(bonusDmg = 0, label = 'attack') {
  const m = here().monster;
  const roll = d(20), total = roll + ATK();
  const facts = { enemy: m.n, action: label };
  const crit = roll >= stats().critOn;
  if (bonusDmg || crit || total >= m.ac) {
    const dmg = bonusDmg || d(6) + ATK() + (crit ? d(6) : 0);
    m.hp = Math.max(0, m.hp - dmg);
    facts.hero_hits = `${dmg} damage${crit && !bonusDmg ? ' (critical!)' : ''}`;
    log(`${bonusDmg ? label : `Attack ${roll}+${ATK()}=${total} vs AC ${m.ac}`} → hit for ${dmg} (${m.n} ${m.hp}/${m.max})`);
  } else { facts.hero_misses = true; log(`Attack ${roll}+${ATK()}=${total} vs AC ${m.ac} → miss`); }
  if (m.hp <= 0) return victory(m, facts);
  enemyTurn(facts);
  narrate('combat_round', facts).then(() => { if (G.hp <= 0) die(m.n); });
  render();
}

function enemyTurn(facts) {
  const m = here().monster;
  const roll = d(20) + m.tier + 1;
  if (roll >= AC()) { const dmg = d(m.atk); G.hp -= dmg; facts.enemy_hits = `${dmg} damage`; log(`${m.n} attacks ${roll} vs AC ${AC()} → you take ${dmg}`); }
  else { facts.enemy_misses = true; log(`${m.n} attacks ${roll} vs AC ${AC()} → miss`); }
  facts.hero_hp = `${Math.max(0, G.hp)}/${G.max}`;
}

function victory(m, facts) {
  G.xp += m.xp; G.gold += m.gold;
  G.kills = G.kills || {};
  G.kills[m.n] = (G.kills[m.n] || 0) + 1;
  P.seen[m.n] = P.seen[m.n] || Date.now();
  saveProfile();
  facts.enemy_defeated = true; facts.loot_gold = m.gold;
  log(`${m.n} defeated · +${m.xp} XP · +${m.gold} gold`);
  const won = here().type === 'boss';
  levelCheck(facts);
  narrate(won ? 'final_victory' : 'enemy_defeated', facts).then(() => { if (won) end(true); });
  render();
}

function levelCheck(facts) {
  while (G.xp >= XP_NEXT()) {
    G.lvl++; G.max = heroStats(G.cls || 'warrior', G.lvl, G.inv, G.blessing).max; G.hp = G.max;
    facts.level_up = G.lvl;
    log(`Level ${G.lvl}! Max HP ${G.max}, fully healed.`);
  }
}

function flee() {
  const roll = d(20) + G.lvl;
  const facts = { enemy: here().monster.n, action: 'flee' };
  if (roll >= 11 && G.prev) {
    log(`Flee ${roll} vs 11 → escaped`);
    facts.fled = true;
    [G.x, G.y] = G.prev;
    narrate('fled', facts);
    render();
  } else {
    log(`Flee ${roll} vs 11 → caught!`);
    facts.flee_failed = true;
    enemyTurn(facts);
    narrate('flee_failed', facts).then(() => { if (G.hp <= 0) die(here().monster.n); });
    render();
  }
}

function useItem(it) {
  if (it === 'potion') {
    const heal = Math.min(10, G.max - G.hp);
    G.hp += heal; G.inv.splice(G.inv.indexOf('potion'), 1);
    log(`You drink a potion: +${heal} HP`, 'you');
    const facts = { action: 'drinks a healing potion', healed: heal };
    if (inCombat()) enemyTurn(facts);
    narrate('use_item', facts).then(() => { if (G.hp <= 0) die(here().monster?.n || 'wounds'); });
  } else if (it === 'bomb') {
    if (!inCombat()) return toast('Save the firebomb for a fight', 'err');
    G.inv.splice(G.inv.indexOf('bomb'), 1);
    log('You hurl a firebomb!', 'you');
    attack(10, 'Firebomb');
    return;
  }
  render();
}

function loot() {
  const r = here();
  const { gold, item } = r.loot;
  G.gold += gold;
  if (item) G.inv.push(item);
  r.loot = null;
  log(`+${gold} gold${item ? ', found ' + ITEMS[item].name : ''}`, 'you');
  narrate('loot', { gold, item: item ? ITEMS[item].name : null, item_effect: item ? ITEMS[item].use || ITEMS[item].passive : null });
  render();
}

function pray() {
  const r = here();
  r.used = true;
  const facts = { action: 'touches the shrine' };
  if (G.hp < G.max * 0.6) { const heal = G.max - G.hp; G.hp = G.max; facts.result = `restores ${heal} HP`; log(`Shrine heals you to full (+${heal})`); }
  else { G.blessing++; facts.result = 'blesses the hero: +1 attack permanently'; log('Shrine blessing: +1 attack'); }
  narrate('shrine', facts);
  render();
}

function search() {
  const r = here();
  const facts = { action: 'searches the room carefully' };
  if (!r.searched && d(20) + G.lvl >= 12) { const g = d(8); G.gold += g; facts.found = `${g} hidden gold`; log(`Found ${g} hidden gold`); }
  else facts.found = 'nothing of value';
  r.searched = true;
  narrate('search', facts);
  render();
}

function rest() {
  if (G.restUsed === G.steps) return;
  G.restUsed = G.steps;
  const facts = { action: 'rests for a moment' };
  if (d(6) <= 2) {
    const T = THEMES[G.theme], m = T.monsters[0][Math.floor(rand() * T.monsters[0].length)];
    const r = here();
    r.type = 'monster'; r.monster = { ...m, max: m.hp, tier: 1, xp: 4, gold: 3 };
    facts.ambush = m.n;
    log(`Ambushed by a ${m.n} while resting!`);
  } else { const heal = Math.min(G.max - G.hp, 4 + G.lvl); G.hp += heal; facts.healed = heal; log(`Rested: +${heal} HP`); }
  narrate('rest', facts);
  render();
}

/* Free-form actions: AI adjudicates, engine clamps */
async function freeAction(text) {
  log(text, 'you');
  const combat = inCombat();
  const m = here().monster;
  const r = here();
  const out = await AI.chat([
    { role: 'system', content: `You are the rules adjudicator for a ${THEMES[G.theme].tone} roguelike. The player attempts a free-form action. Decide a FAIR, modest outcome given the situation. Return JSON:
{"success":true|false,"narration":"2-3 sentences, second person","hp_change":-6..4,"gold_change":0..10,"enemy_damage":0..8,"item_gained":null|"potion"|"bomb","item_used":null|<an item the hero actually has>}
Rules: no item unless clearly plausible; enemy_damage only if in combat; failures can cost HP; creativity may earn a small reward.` },
    { role: 'user', content: JSON.stringify({ action: text, room: r.kind, in_combat: combat, enemy: combat ? `${m.n} (${m.hp}/${m.max} HP)` : null, hero: { hp: G.hp, max: G.max, inventory: G.inv.map((i) => ITEMS[i].name), level: G.lvl } }) },
  ], { json: true, temperature: 0.8, demo: () => demoFree(text, combat) });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
  const hp = clamp(out.hp_change, -6, 4), gold = clamp(out.gold_change, 0, 10), dmg = combat ? clamp(out.enemy_damage, 0, 8) : 0;
  G.hp = Math.min(G.max, G.hp + hp); G.gold += gold;
  if (out.item_used) { const k = Object.keys(ITEMS).find((k) => ITEMS[k].name.toLowerCase() === String(out.item_used).toLowerCase() || k === out.item_used); if (k && has(k) && k !== 'key') G.inv.splice(G.inv.indexOf(k), 1); }
  if (out.item_gained && ['potion', 'bomb'].includes(out.item_gained) && !G.freebie) { G.inv.push(out.item_gained); G.freebie = true; }
  log(`${out.success ? 'Success' : 'Failure'} · HP ${hp >= 0 ? '+' : ''}${hp}${gold ? ' · +' + gold + ' gold' : ''}${dmg ? ' · enemy −' + dmg : ''}`);
  const el = log(out.narration || '', 'story');
  G.history.push({ role: 'user', content: 'Player: ' + text }, { role: 'assistant', content: el.textContent });
  if (combat && dmg) { m.hp = Math.max(0, m.hp - dmg); if (m.hp <= 0) return victory(m, { enemy: m.n, action: text }); }
  if (combat) { const f = {}; enemyTurn(f); narrate('combat_round', { enemy: m.n, ...f }); }
  if (G.hp <= 0) die('recklessness');
  render();
}

function die(cause) {
  if (G.over) return;
  G.over = true;
  log(`${G.name} has fallen to ${cause}.`, 'room');
  recordRun(false, cause);
  narrate('death', { cause, level: G.lvl, gold: G.gold, rooms_explored: G.rooms.filter((r) => r.visited).length });
  render();
}
function end(won) {
  G.over = true;
  log(won ? `Victory! ${G.name} escapes with ${G.gold} gold in ${G.steps} steps.` : 'Game over.', 'room');
  recordRun(won, won ? null : 'gave up');
  render();
}

/* ================= UI ================= */
function btn(label, fn, cls = '') { return h('button', { class: 'btn sm ' + cls, onclick: fn }, label); }

function render() {
  if (!G) return;
  const r = here();
  $('#heroTitle').textContent = G.name;
  $('#lvl').textContent = 'Lv ' + G.lvl;
  $('#hpBar').style.width = Math.max(0, (100 * G.hp) / G.max) + '%';
  $('#hpText').textContent = `${Math.max(0, G.hp)}/${G.max}`;
  $('#xpBar').style.width = Math.min(100, (100 * G.xp) / XP_NEXT()) + '%';
  $('#xpText').textContent = `${G.xp}/${XP_NEXT()}`;
  $('#gold').textContent = G.gold; $('#ac').textContent = AC(); $('#atk').textContent = ATK(); $('#steps').textContent = G.steps;
  $('#heroCls').textContent = `${CLASSES[G.cls || 'warrior'].name}`;

  const combat = inCombat();
  $('#enemyCard').classList.toggle('hidden', !combat);
  if (combat) {
    $('#enemyName').textContent = r.monster.n;
    $('#enemyTier').textContent = r.type === 'boss' ? 'BOSS' : 'Tier ' + r.monster.tier;
    $('#ehpBar').style.width = (100 * r.monster.hp) / r.monster.max + '%';
    $('#ehpText').textContent = `${r.monster.hp}/${r.monster.max}`;
  }

  const counts = G.inv.reduce((a, i) => ((a[i] = (a[i] || 0) + 1), a), {});
  $('#inv').innerHTML = '';
  Object.entries(counts).forEach(([k, n]) => {
    const it = ITEMS[k];
    $('#inv').append(h('button', { class: 'btn', title: it.use || it.passive, disabled: G.over || !it.use, onclick: () => useItem(k) }, `${it.name}${n > 1 ? ' ×' + n : ''}`));
  });
  if (!G.inv.length) $('#inv').append(h('span', { class: 'muted small' }, 'Empty'));

  const acts = $('#actions');
  acts.innerHTML = '';
  if (G.over) { acts.append(btn('▶ New adventure', () => { $('#game').classList.add('hidden'); $('#setup').classList.remove('hidden'); $('#seed').value = Math.floor(Math.random() * 1e9).toString(36); }, 'primary')); }
  else if (combat) {
    const A = CLASSES[G.cls || 'warrior'].ability;
    acts.append(btn('Attack', () => attack(), 'primary'), btn(`${A.name}${G.cd ? ` (${G.cd})` : ''}`, ability, G.cd ? 'ghost' : ''), btn('Flee', flee));
    acts.lastChild.previousSibling.disabled = !!G.cd;
    acts.lastChild.previousSibling.title = A.desc + (G.cd ? ` · ready in ${G.cd} moves` : '');
  }
  else {
    Object.keys(r.doors).forEach((dir) => acts.append(btn({ north: 'North', south: 'South', west: 'West', east: 'East' }[dir], () => move(dir))));
    if (r.type === 'treasure' && r.loot) acts.append(btn('Take treasure', loot, 'primary'));
    if (r.type === 'shrine' && !r.used) acts.append(btn('Touch shrine', pray, 'primary'));
    if (r.type === 'boss' && !has('key') && r.monster.hp > 0) acts.append(h('span', { class: 'tag warn' }, 'Find the key to face the boss'));
    acts.append(btn('Search', search, 'ghost'), btn('Rest', rest, 'ghost'));
  }
  $('#freeForm').classList.toggle('hidden', G.over);
  drawMap();
  Kit.store.set('save', G);
}

function drawMap() {
  const S = 44, P = 6, W = N * S + P * 2;
  let s = `<svg viewBox="0 0 ${W} ${W}" role="img" aria-label="Dungeon map">`;
  G.rooms.forEach((r) => {
    if (!r.seen) return;
    const x = P + r.x * S, y = P + r.y * S;
    const fill = r.visited ? 'var(--panel-2)' : 'transparent';
    s += `<rect x="${x + 6}" y="${y + 6}" width="${S - 12}" height="${S - 12}" rx="5" fill="${fill}" stroke="var(--line)" stroke-dasharray="${r.visited ? '' : '3 3'}"/>`;
    if (r.doors.east) s += `<rect x="${x + S - 7}" y="${y + S / 2 - 3}" width="14" height="6" fill="var(--line)"/>`;
    if (r.doors.south) s += `<rect x="${x + S / 2 - 3}" y="${y + S - 7}" width="6" height="14" fill="var(--line)"/>`;
    const icon = r.type === 'boss' ? 'B' : r.type === 'start' ? 'S' : !r.visited && !has('lantern') ? '' : r.type === 'monster' && r.monster.hp > 0 ? 'M' : r.type === 'treasure' && r.loot ? '$' : r.type === 'shrine' && !r.used ? '+' : '';
    if (icon) s += `<text x="${x + S / 2}" y="${y + S / 2 + 6}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--muted)">${icon}</text>`;
  });
  s += `<circle cx="${P + G.x * S + S / 2}" cy="${P + G.y * S + S / 2}" r="9" fill="var(--accent)" stroke="#fff" stroke-width="2"><animate attributeName="r" values="8;10;8" dur="1.6s" repeatCount="indefinite"/></circle></svg>`;
  $('#map').innerHTML = s;
}

/* ================= demo narrator (no key) ================= */
function demoNarration(event, f) {
  const T = THEMES[G.theme], pick = (a) => a[Math.floor(Math.random() * a.length)];
  const air = { crypt: ['Cold air smells of wax and dust.', 'Bones crunch softly underfoot.', 'Somewhere, water drips onto stone.'], derelict: ['Emergency lights stutter red.', 'The hull groans like something alive.', 'Frost creeps across a cracked viewport.'], mansion: ['Rain needles the tall windows.', 'A portrait’s eyes seem to follow you.', 'Dust swirls in a shaft of grey light.'] }[G.theme];
  switch (event) {
    case 'arrive': return `You stand at the threshold of the ${T.name}, ${G.name}. ${pick(air)} Somewhere deep within waits ${T.boss.n}, and you will need a key to reach it. Exits lead ${f.exits.join(' and ')}.`;
    case 'enter_room': return `You step into the ${f.room}. ${pick(air)} ${f.trap ? 'Click. ' + cap(f.trap) + '. ' : ''}${f.enemy ? `A ${f.enemy} turns toward you, hungry. ` : ''}${f.boss ? `${f.boss}. ` : ''}${f.notice ? `You notice ${f.notice}. ` : ''}Exits: ${f.exits.join(', ')}.`;
    case 'combat_round': return `${f.hero_hits ? `Your strike lands for ${f.hero_hits}, and the ${f.enemy} reels.` : f.hero_misses ? `Your blow glances off the ${f.enemy}.` : ''} ${f.enemy_hits ? `It answers with a vicious hit: ${f.enemy_hits}.` : f.enemy_misses ? 'It lunges, but you twist away just in time.' : ''}`.trim();
    case 'enemy_defeated': return `The ${f.enemy} collapses and is still. Among the remains you find ${f.loot_gold} gold.${f.level_up ? ` Power surges through you. You are now level ${f.level_up}.` : ''}`;
    case 'final_victory': return `With a last terrible cry, ${f.enemy} unravels into nothing. The way out opens: ${T.exit}. You made it, ${G.name}.`;
    case 'loot': return `You claim ${f.gold} gold${f.item ? ` and a ${f.item} (${f.item_effect})` : ''}. It feels heavier than it should.`;
    case 'shrine': return `As your palm meets the shrine, warmth floods your veins. The shrine ${f.result}.`;
    case 'search': return `You comb every corner. You find ${f.found}.`;
    case 'rest': return f.ambush ? `Your eyes barely close before a ${f.ambush} lunges from the shadows!` : `You catch your breath. (+${f.healed} HP)`;
    case 'fled': return `You break away and scramble back the way you came, heart pounding.`;
    case 'flee_failed': return `You turn to run, but the ${f.enemy} is faster. ${f.enemy_hits ? 'It rakes you for ' + f.enemy_hits + '.' : 'Its blow just misses.'}`;
    case 'use_item': return `You down the potion in one gulp and feel ${f.healed} HP knit back together.${f.enemy_hits ? ' The enemy seizes the moment: ' + f.enemy_hits + '.' : ''}`;
    case 'death': return `Your vision narrows to a single flickering point of light. The ${T.name} claims another soul. Explored ${f.rooms_explored} rooms; reached level ${f.level}.`;
    default: return pick(air);
  }
}
function demoFree(text, combat) {
  const ok = Math.random() < 0.6;
  return { success: ok, narration: ok ? `You try to ${text.replace(/^i\s+/i, '')}, and against the odds it works. ${combat ? 'Your foe staggers.' : 'You feel a little luckier.'} (demo adjudication)` : `You try to ${text.replace(/^i\s+/i, '')}, but it goes badly wrong and you scrape yourself in the attempt. (demo adjudication)`, hp_change: ok ? 0 : -2, gold_change: ok && !combat ? 2 : 0, enemy_damage: ok && combat ? 4 : 0, item_gained: null, item_used: null };
}

/* ================= boot ================= */
$('#seed').value = Math.floor(Math.random() * 1e9).toString(36);
$('#begin').onclick = newGame;
$('#freeForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('#free').value.trim();
  if (!t || G.over) return;
  $('#free').value = '';
  const b = e.submitter || $('#freeForm button');
  Kit.busy(b, () => freeAction(t));
};
try {
  const saved = Kit.store.get('save', null);
  if (saved && !saved.over) {
    const resume = h('button', { class: 'btn' }, `Continue ${saved.name}'s run (Lv ${saved.lvl})`);
    resume.onclick = () => { G = saved; G.cls = G.cls || 'warrior'; rand = rng(G.seed + G.steps); $('#setup').classList.add('hidden'); $('#game').classList.remove('hidden'); log('— Run restored —'); render(); };
    $('#setup').append(resume);
  }
} catch {}

/* ================= class abilities ================= */
function ability() {
  const m = here().monster, A = CLASSES[G.cls].ability;
  if (G.cd) return;
  G.cd = A.cooldown;
  log(`${A.name}!`, 'you');
  if (G.cls === 'warrior') {
    const heal = Math.min(G.max - G.hp, Math.round(G.max * 0.4));
    G.hp += heal;
    const facts = { action: 'uses Second Wind', healed: heal };
    log(`+${heal} HP`);
    enemyTurn(facts);
    narrate('use_item', facts).then(() => { if (G.hp <= 0) die(m.n); });
    render();
  } else if (G.cls === 'rogue') attack((d(6) + ATK()) * 2, 'Backstab');
  else attack(12 + G.lvl, 'Fireball');
}

/* ================= profile: runs, bestiary, achievements ================= */
let P = store.get('profile', null) || { runs: [], seen: {}, achievements: {}, lore: {} };
const saveProfile = () => store.set('profile', P);
function recordRun(won, cause) {
  if (G.recorded) return;
  G.recorded = true;
  const run = { id: Date.now(), date: Date.now(), name: G.name, cls: G.cls || 'warrior', theme: G.theme, seed: G.seed, won, cause, lvl: G.lvl, gold: G.gold, steps: G.steps, rooms: G.rooms.filter((r) => r.visited).length, kills: G.kills || {}, minutes: Math.round((Date.now() - (G.started || Date.now())) / 60000) };
  run.score = runScore(run);
  P.runs.unshift(run);
  P.runs = P.runs.slice(0, 200);
  newAchievements(P).forEach((id) => { P.achievements[id] = Date.now(); const a = ACHIEVEMENTS.find((x) => x.id === id); toast(`Achievement unlocked: ${a.name}`); });
  saveProfile();
  store.remove('save');
}

/* ---------- Heroes page ---------- */
function renderHeroes() {
  const box = $('#heroCards');
  box.innerHTML = '';
  Object.entries(CLASSES).forEach(([k, C]) => {
    const runs = P.runs.filter((r) => r.cls === k), wins = runs.filter((r) => r.won).length;
    const st = heroStats(k, 1, [], 0), st5 = heroStats(k, 5, [], 0);
    box.append(h('div', { class: 'card stack hero' + ($('#heroClass').value === k ? ' picked' : '') },
      h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, `${C.name}`), h('span', { class: 'tag' }, `${wins}/${runs.length} wins`)),
      h('p', { class: 'muted', style: 'margin:0' }, C.blurb),
      h('table', { class: 'mini' }, h('tr', {}, h('th', {}, ''), h('th', {}, 'Lv 1'), h('th', {}, 'Lv 5')),
        h('tr', {}, h('td', {}, 'Max HP'), h('td', {}, st.max), h('td', {}, st5.max)),
        h('tr', {}, h('td', {}, 'Armor class'), h('td', {}, st.ac), h('td', {}, st5.ac)),
        h('tr', {}, h('td', {}, 'Attack bonus'), h('td', {}, '+' + st.atk), h('td', {}, '+' + st5.atk)),
        h('tr', {}, h('td', {}, 'Hit chance vs AC 12'), h('td', {}, Math.round(hitChance(st.atk, 12) * 100) + '%'), h('td', {}, Math.round(hitChance(st5.atk, 12) * 100) + '%'))),
      h('div', { class: 'small' }, h('b', {}, C.ability.name), ` · ${C.ability.desc} · cooldown ${C.ability.cooldown} moves`),
      h('button', { class: 'btn primary sm', onclick: () => { $('#heroClass').value = k; Router.go('play'); toast(`${C.name} selected`); } }, 'Play as ' + C.name)));
  });
}

/* ---------- Bestiary page ---------- */
function renderBestiary() {
  const world = $('#bWorld').value;
  const kills = {};
  P.runs.forEach((r) => Object.entries(r.kills || {}).forEach(([n, c]) => { kills[n] = (kills[n] || 0) + c; }));
  if (G && G.kills) Object.entries(G.kills).forEach(([n, c]) => { if (!G.recorded) kills[n] = (kills[n] || 0) + c; });
  const all = bestiaryEntries().filter((m) => world === '*' || m.world === world);
  const found = all.filter((m) => P.seen[m.n]).length;
  $('#bProgress').textContent = `${found}/${all.length} discovered`;
  const box = $('#bestiary');
  box.innerHTML = '';
  all.forEach((m) => {
    const known = !!P.seen[m.n];
    const lore = h('div', { class: 'small prose', html: P.lore[m.n] ? md(P.lore[m.n]) : '' });
    box.append(h('div', { class: 'card stack beast' + (known ? '' : ' unknown') },
      h('div', { class: 'row between' }, h('h3', {}, known ? m.n : '???'), h('span', { class: 'tag ' + (m.tier === 'boss' ? 'bad' : '') }, m.tier === 'boss' ? 'boss' : 'tier ' + m.tier)),
      h('div', { class: 'small muted' }, THEMES[m.world].name),
      known ? h('div', { class: 'row small' }, h('span', {}, `HP ${m.hp}`), h('span', {}, `AC ${m.ac}`), h('span', {}, `ATK d${m.atk}`), h('span', {}, `${kills[m.n] || 0} slain`)) : h('div', { class: 'small muted' }, 'Defeat one to reveal its stats.'),
      lore,
      known && !P.lore[m.n] ? h('button', { class: 'btn ghost sm', onclick: (e) => busy(e.currentTarget, async () => {
        P.lore[m.n] = await AI.chat([{ role: 'system', content: `Write a 2-3 sentence in-world bestiary entry in the tone of ${THEMES[m.world].tone}. Mention one tactical weakness. No markdown headings.` }, { role: 'user', content: `${m.n} (HP ${m.hp}, AC ${m.ac}, attack d${m.atk}) from ${THEMES[m.world].name}` }], { temperature: 0.9, demo: `Scholars of ${THEMES[m.world].name} whisper that the ${m.n} never strays far from where it fell. Its guard drops after it lunges, so strike right after it misses. *(demo lore)*` });
        saveProfile(); renderBestiary();
      }) }, 'Write lore') : null));
  });
}

/* ---------- Chronicle page ---------- */
function renderChronicle() {
  const f = $('#cFilter').value;
  const runs = P.runs.filter((r) => f === '*' || (f === 'won' ? r.won : f === 'lost' ? !r.won : r.theme === f));
  const wins = P.runs.filter((r) => r.won).length;
  $('#cKpis').innerHTML = [['Runs', P.runs.length], ['Wins', wins], ['Win rate', P.runs.length ? Math.round((100 * wins) / P.runs.length) + '%' : '—'], ['Best score', P.runs.length ? Math.max(...P.runs.map((r) => r.score)) : '—'], ['Monsters slain', totalKills(P)]].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const top = P.runs.slice().sort((a, b) => b.score - a.score).slice(0, 5);
  $('#leaderboard').innerHTML = top.length ? top.map((r, i) => `<div class="list-item"><b class="mono">#${i + 1}</b><span class="grow">${esc(r.name)} · ${CLASSES[r.cls].name} · ${THEMES[r.theme].name}</span><span class="tag ${r.won ? 'good' : 'bad'}">${r.won ? 'won' : 'fell'}</span><b>${r.score}</b></div>`).join('') : '<div class="empty">No runs yet. Your best runs will appear here.</div>';
  const tb = $('#runs');
  tb.innerHTML = '<tr><th>Date</th><th>Hero</th><th>World</th><th>Result</th><th>Lv</th><th>Gold</th><th>Steps</th><th>Rooms</th><th>Score</th><th></th></tr>';
  runs.forEach((r) => tb.append(h('tr', {},
    h('td', { class: 'small' }, new Date(r.date).toLocaleString()), h('td', {}, `${r.name}`), h('td', {}, THEMES[r.theme].name),
    h('td', {}, h('span', { class: 'tag ' + (r.won ? 'good' : 'bad') }, r.won ? 'Victory' : 'Fell to ' + (r.cause || '?'))),
    h('td', {}, r.lvl), h('td', {}, r.gold), h('td', {}, r.steps), h('td', {}, r.rooms), h('td', {}, h('b', {}, r.score)),
    h('td', {}, h('button', { class: 'btn ghost sm', title: 'Play the same dungeon again', onclick: () => { $('#seed').value = r.seed.toString(36); $('#theme').value = r.theme; $('#heroClass').value = r.cls; Router.go('play'); if (!G || G.over) { $('#game').classList.add('hidden'); $('#setup').classList.remove('hidden'); } toast('Seed loaded: same dungeon layout'); } }, '↻ Replay seed')))));
  if (!runs.length) tb.append(h('tr', {}, h('td', { colspan: 10, class: 'muted' }, 'No runs match.')));
}

/* ---------- Achievements page ---------- */
function renderAchievements() {
  const got = Object.keys(P.achievements).length;
  $('#achProgress').innerHTML = `<div class="bar"><span style="width:${(100 * got) / ACHIEVEMENTS.length}%"></span></div><p class="small muted" style="margin-top:6px">${got} of ${ACHIEVEMENTS.length} unlocked</p>`;
  $('#achGrid').innerHTML = ACHIEVEMENTS.map((a) => `<div class="card ach ${P.achievements[a.id] ? 'got' : ''}"><div class="medal">${P.achievements[a.id] ? 'Earned' : 'Locked'}</div><div><b>${esc(a.name)}</b><div class="small muted">${esc(a.desc)}</div>${P.achievements[a.id] ? `<div class="small">Unlocked ${new Date(P.achievements[a.id]).toLocaleDateString()}</div>` : ''}</div></div>`).join('');
}

Router.on('heroes', renderHeroes);
Router.on('bestiary', renderBestiary);
Router.on('chronicle', renderChronicle);
Router.on('achievements', renderAchievements);
$('#bWorld').onchange = renderBestiary;
$('#cFilter').onchange = renderChronicle;

/* ================= AI command box ================= */
const MOVES = { attack: () => attack(), ability: () => ability(), flee: () => flee(), search: () => search(), rest: () => rest(), loot: () => loot(), take: () => loot(), pray: () => pray(), shrine: () => pray() };
Copilot.register({
  context: () => { if (!G || $('#game').classList.contains('hidden')) return `No run in progress. Classes: ${Object.keys(CLASSES).join(', ')}. Worlds: ${Object.entries(THEMES).map(([k, t]) => `${k}=${t.name}`).join(', ')}.`; const r = here(), m = r.monster; return `${G.name} the ${CLASSES[G.cls].name}, level ${G.lvl}, HP ${G.hp}/${G.max}, gold ${G.gold}, inventory: ${G.inv.join(', ')}. Room: ${r.kind || r.type}, exits: ${Object.keys(r.doors).join(', ')}${inCombat() ? `. In combat with ${m.n} (${m.hp}/${m.max} HP)` : ''}${r.type === 'treasure' && r.loot ? '. Treasure here' : ''}${r.type === 'shrine' && !r.used ? '. Shrine here' : ''}.${G.over ? ' The run is over.' : ''}`; },
  actions: [
    { name: 'new_run', description: 'Create a hero and start a new run', params: { name: 'hero name', class: Object.keys(CLASSES).join(' | '), world: Object.keys(THEMES).join(' | '), seed: 'optional seed for a repeatable dungeon' },
      run: ({ name, class: cls, world, seed }) => { Router.go('play'); if (name) $('#heroName').value = name; if (CLASSES[cls]) $('#heroClass').value = cls; if (THEMES[world]) $('#theme').value = world; if (seed) $('#seed').value = seed; $('#setup').classList.remove('hidden'); newGame(); return `${G.name} the ${CLASSES[G.cls].name} enters ${THEMES[G.theme].name}`; } },
    { name: 'act', description: 'Take game moves in order. Each move is a direction (north/south/east/west), attack, ability, flee, search, rest, loot, pray, "use potion", "use bomb", or any free-form action in quotes-free words', params: { moves: 'array of moves, e.g. ["search", "north"]' },
      run: async ({ moves }) => { if (!G || G.over) throw new Error('Start a run first'); Router.go('play'); const done = []; for (const raw of (Array.isArray(moves) ? moves : [moves]).slice(0, 8)) { if (G.over) break; const mv = String(raw).trim().toLowerCase().replace(/^(go|move|walk|head)\s+/, ''); if (DIRS[mv]) { if (!here().doors[mv]) { done.push(`no exit ${mv}`); continue; } if (inCombat()) { done.push('blocked: in combat'); continue; } move(mv); } else if (MOVES[mv]) MOVES[mv](); else if (/^(use|drink|throw)\s+(a\s+)?(potion|bomb|firebomb)/.test(mv)) { const k = /bomb/.test(mv) ? 'bomb' : 'potion'; if (!has(k)) { done.push(`no ${k}`); continue; } useItem(k); } else await freeAction(String(raw)); await narrating; done.push(mv); } render(); return `Did: ${done.join(', ')}. HP ${G.hp}/${G.max}${G.over ? '. The run ended.' : ''}`; } },
    { name: 'run_history', query: true, description: 'Look up past runs, achievements and monsters met', params: {}, run: () => JSON.stringify({ runs: P.runs.slice(0, 15), achievements: Object.keys(P.achievements), monstersSeen: Object.keys(P.seen).length }) },
  ],
});
