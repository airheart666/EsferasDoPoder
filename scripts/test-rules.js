#!/usr/bin/env node
/* scripts/test-rules.js — smoke test for src/rules.js against the REAL data.
 * Not a full unit suite; asserts the load-bearing rules behave. Run: node scripts/test-rules.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Rules = require('../src/rules.js');

const ROOT = path.resolve(__dirname, '..');
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// Load the same structured data the browser uses (data/*): spheres + migrated
// classes/class-features (grants carry resolved talent ids, which computeGrants needs).
const spheres = fs.readdirSync(path.join(ROOT, 'data', 'spheres'))
  .filter(f => f.endsWith('.json'))
  .map(f => load(path.join('data', 'spheres', f)));
const classes = load(path.join('data', 'classes.json'));
const classFeatures = load(path.join('data', 'class-features.json'));
const idx = Rules.indexData(spheres, classes, classFeatures);

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓ ' + name); pass++; };

// --- Derived stats: Feiticeiro lvl 5 ---
/** @type {any} */
const feit = { id: 'x', name: 'Test', className: 'Feiticeiro', subclass: '', level: 5, keyMod: 3, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [] };
const stats = Rules.derivedStats(feit, idx);
ok('Feiticeiro lvl5 has derived stats', stats && stats.type === 'magic');
ok('DC = 8 + prof + keyMod', stats.cd === 8 + stats.prof + 3);
ok('has a PM pool (resource)', stats.resourceName === 'PM' && typeof stats.resource === 'number');

// --- Budget = slots + tradition(+2). Metamágica is a RESTRICTED allowance (Universal
//     metaesfera), so it must NOT inflate the general magic budget (KG-5). ---
const budget = Rules.talentBudget(feit, idx);
const cfb = Rules.classFeatureBonus(feit, idx);
ok('Metamágica does NOT add to general magic budget', cfb.magic === 0);
ok('magic budget = slots + 2 tradition (no restricted feature)', budget.magic === stats.magicTalents + 2);
const allow = Rules.restrictedAllowances(feit, idx);
const meta = allow.find(a => a.feature === 'Metamágica');
ok('Metamágica surfaces as a restricted allowance', !!meta && meta.sphere === 'Universal' && meta.tag === 'metaesfera');
ok('Metamágica allowance count = 2 at lvl5 (cumulative bonusByLevel)', meta && meta.count === 2);

// --- Pick a real advanced talent and prove prereq blocking ---
const mente = idx.sphereById.get('mente');
const advanced = mente.talents.find(t => t.advanced && t.prerequisites.some(p => p.type === 'talent' || p.type === 'sphere' || p.type === 'level'));
ok('found an advanced Mente talent with structured prereqs', !!advanced);

// Character with NO spheres: advanced talent must be blocked (missing sphere/talent/level).
const blocked = Rules.canAddTalent(feit, advanced, idx);
ok('advanced talent blocked for empty character', blocked.ok === false && blocked.prereq.missing.length > 0);

// Now give access to Mente + own the prereq talents + enough level, and it should pass prereqs.
const prereqTalentIds = advanced.prerequisites.filter(p => p.type === 'talent').map(p => p.id);
const prereqLevel = Math.max(1, ...advanced.prerequisites.filter(p => p.type === 'level').map(p => p.min));
/** @type {any} */
const ready = {
  ...feit, level: Math.max(feit.level, prereqLevel),
  spheres: [{ sphere: 'mente', section: 'magic', choices: {}, freePicks: [], talents: prereqTalentIds }],
};
const pre2 = Rules.prereqCheck(ready, advanced, idx);
ok('prereqs satisfied once sphere+talents+level are met', pre2.ok === true);

// --- Budget blocking: exhaust slots ---
/** @type {any} */
const broke = { ...feit, level: 1, spheres: [] };
const b1 = Rules.talentBudget(broke, idx);
// fill martial? Feiticeiro is magic; fill magic slots with dummy extra talents
const fill = [];
for (let i = 0; i < b1.magic + 1; i++) fill.push('dummy-' + i);
/** @type {any} */
const over = { ...broke, spheres: [{ sphere: 'mente', section: 'magic', choices: {}, freePicks: [], talents: fill }] };
const spent = Rules.slotsSpent(over, idx);
ok('over-budget detected (spent > budget)', spent.magic > b1.magic);
const any = mente.talents.find(t => t.kind === 'talent' && (!t.prerequisites || t.prerequisites.length === 0));
const cantAfford = Rules.canAddTalent(over, any, idx);
ok('cannot add talent when budget exhausted', cantAfford.budgetOk === false && cantAfford.ok === false);

// --- Granted sphere access is free ---
/** @type {any} */
const feiSangue = { ...feit, subclass: 'Sangue Feérico', level: 5 };
const grantedIds = Rules.grantedSphereIds(feiSangue, idx);
ok('Sangue Feérico grants sphere access (e.g. mente/luz/ilusao)', grantedIds.size > 0);
const gsid = [...grantedIds][0];
const access = Rules.canAccessSphere(feiSangue, gsid, idx);
ok('granted sphere access costs 0 slots', access.granted === true && access.ok === true);

// --- Feature A: conditional grants (Sangue Feérico grants Cativar(Mente)@L1, Delírio(Mente)@L3) ---
const gNoAccess = Rules.computeGrants(feiSangue, idx);
ok('no prior Mente access → Mente base granted, Cativar NOT', gNoAccess.accessSpheres.has('mente') && !gNoAccess.specificTalents.has('mente-cativar'));
ok('later same-sphere grant → Delírio granted specifically', gNoAccess.specificTalents.has('mente-delirio'));
ok('granted specific talent is owned (KG-2 closed)', Rules.ownedTalentIds(feiSangue, idx).has('mente-delirio') && !Rules.ownedTalentIds(feiSangue, idx).has('mente-cativar'));
/** @type {any} */
const feiSangueMente = { ...feiSangue, spheres: [{ sphere: 'mente', section: 'magic', choices: {}, freePicks: [], talents: [] }] };
const gWithAccess = Rules.computeGrants(feiSangueMente, idx);
ok('prior Mente access (slot) → Cativar IS granted', gWithAccess.specificTalents.has('mente-cativar'));

// --- P1: a GRANTED-access entry (granted:true, e.g. holding a free pick) must NOT
//     seed prior access (else it would flip Mente access→Cativar) and costs 0. ---
/** @type {any} */
const feiGrantedEntry = { ...feiSangue, spheres: [{ sphere: 'mente', section: 'magic', granted: true, choices: {}, freePicks: [], talents: [] }] };
const gGE = Rules.computeGrants(feiGrantedEntry, idx);
ok('granted:true entry does NOT seed prior access (Mente stays access-granted, not Cativar)', gGE.accessSpheres.has('mente') && !gGE.specificTalents.has('mente-cativar'));
ok('granted:true sphere entry costs 0 slots', Rules.slotsSpent(feiGrantedEntry, idx).magic === 0);
ok('slot (granted:false) sphere entry costs 1 slot', Rules.slotsSpent(feiSangueMente, idx).magic === 1);

// --- Feature B: cross-section (Artífice → Engenhosidade with magic budget) ---
/** @type {any} */
const artifice = { id: 'a', name: 'Art', className: 'Artífice', subclass: '', level: 5, keyMod: 3, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [] };
ok('Artífice: Engenhosidade counts as magic section', Rules.effectiveSection(artifice, 'engenhosidade', idx) === 'magic');
ok('Artífice: a normal martial sphere stays martial', Rules.effectiveSection(artifice, 'atletismo', idx) === 'martial');
ok('Artífice can access Engenhosidade (magic budget)', Rules.canAccessSphere(artifice, 'engenhosidade', idx).ok === true && Rules.canAccessSphere(artifice, 'engenhosidade', idx).section === 'magic');
const engTalent = idx.sphereById.get('engenhosidade').talents.find(t => t.kind === 'talent' && (!t.prerequisites || t.prerequisites.length === 0));
ok('Artífice can add an Engenhosidade talent vs magic budget', Rules.canAddTalent(artifice, engTalent, idx).section === 'magic');
/** @type {any} */
const artAlq = { ...artifice, subclass: 'Alquimista' };
ok('Alquimista subclass adds Alquimia as magic', Rules.effectiveSection(artAlq, 'alquimia', idx) === 'magic');
ok('non-Artífice magic class cannot cross to Engenhosidade', Rules.effectiveSection(feit, 'engenhosidade', idx) === 'martial');

// --- P2: Universal package grants its base ability (owned, free) ---
/** @type {any} */
const univ = { id: 'u2', name: 'U', className: 'Feiticeiro', subclass: '', level: 5, keyMod: 0, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [{ sphere: 'universal', section: 'magic', choices: { pkg: 'dissipar' }, freePicks: [], talents: [] }] };
ok('Universal "dissipar" package → Dissipar is owned', Rules.ownedTalentIds(univ, idx).has('universal-dissipar'));
ok('Universal access costs 1 slot; package base ability is free', Rules.slotsSpent(univ, idx).magic === 1);
/** @type {any} */
const univMana = { ...univ, spheres: [{ sphere: 'universal', section: 'magic', choices: { pkg: 'mana' }, freePicks: [], talents: [] }] };
ok('Universal "mana" package → Vínculo de Mana owned', Rules.ownedTalentIds(univMana, idx).has('universal-vinculo-de-mana'));

console.log(`\n${pass} assertions passed.`);
