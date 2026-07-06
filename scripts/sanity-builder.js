#!/usr/bin/env node
/* scripts/sanity-builder.js — Node-level sanity check for the character builder's
 * wiring to the structured rules engine (Phase 3 Step 4). NOT a substitute for
 * manual browser testing (see handoff/REVIEW-REQUEST.md for what still needs a
 * real browser) — this exercises the REAL app.js/src/rules.js functions (loaded
 * as actual scripts into a jsdom context, not re-implemented here) against the
 * REAL data, without a full page boot (no search/sidebar/observer wiring — this
 * step didn't touch those). Run: node scripts/sanity-builder.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ✓ ' + name); pass++; };

async function main() {
  // Minimal jsdom document (localStorage needs an origin) — no full index.html
  // boot: this step doesn't touch search/sidebar/observer wiring, so we don't
  // exercise init()/setupFavorites()/setupCharacter()'s DOM-listener side, only
  // the underlying state/rule functions they call.
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const ctx = dom.getInternalVMContext();

  // fetch stub for DataLoader.loadData() — serves the real data/ files off disk.
  dom.window.fetch = async (url) => {
    const abs = path.join(ROOT, String(url));
    if (!fs.existsSync(abs)) return { ok: false, status: 404, json: async () => { throw new Error('404'); }, text: async () => '' };
    const body = fs.readFileSync(abs, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  };

  for (const file of ['parser.js', 'chapters.js', 'src/rules.js', 'src/data.js', 'app.js']) {
    vm.runInContext(read(file), ctx, { filename: file });
  }

  // Populate the same module state init() would (chapters/allPages via the real
  // parse pipeline; dataIndex via the real DataLoader+Rules — no re-implementation).
  const manifest = JSON.parse(read('manifest.json'));
  const text = manifest.map(p => read(p)).join('');
  const setState = vm.runInContext(
    '(function(txt){ const { pages, tocTrees } = HBParser.parse(txt); allPages = pages; tocTreesGlobal = tocTrees; chapters = Chapters.buildChapters(pages, tocTrees); })',
    ctx
  );
  setState(text);

  const loadDataIndex = vm.runInContext(
    `(async function(){
       const { spheres, classes, classFeatures } = await DataLoader.loadData();
       dataIndex = Rules.indexData(spheres, classes, classFeatures);
       for (const sph of dataIndex.sphereById.values()) { sphereIdByTitle.set(sph.name, sph.id); sphereTitleById.set(sph.id, sph.name); }
     })`,
    ctx
  );
  await loadDataIndex();

  // Expose exactly what the test drives — real function objects from the real
  // app.js script scope (not copies).
  const t = vm.runInContext(
    `({
       Rules, dataIndex, sphereIdByTitle, sphereTitleById, chapters,
       createCharacter, updateCharacter, getCharacters, saveCharacters,
       sphereEntry, acquireSphere, tryAcquireSphere, isGrantedSphere, grantedSpheresMap,
       addFreePickChecked, addExtraTalentChecked, toggleExtraTalent,
       migrateCharacters, characterStats, getSphereModel, resolveTalentIdLoose,
     })`,
    ctx
  );

  ok('dataIndex loaded (42 spheres)', t.dataIndex.sphereById.size === 42);
  ok('chapters parsed from real content', t.chapters.length > 40);

  /* ---------------------------------------------------------------------
   * 1) Prereq enforcement: advanced Mente talent blocked, then allowed once
   *    prereqs are met (mirrors scripts/test-rules.js's own case, but through
   *    the app.js pick-action wrapper, not Rules directly).
   * --------------------------------------------------------------------- */
  const feit = t.createCharacter({ name: 'Sanity Feiticeiro', className: 'Feiticeiro', level: 5, keyMod: 3 });
  const acq1 = t.tryAcquireSphere(feit, 'Mente');
  ok('acquire Mente succeeds (budget available)', acq1.ok === true);
  ok('sphereEntry resolves by title after acquire', !!t.sphereEntry(feit, 'Mente'));

  const mente = t.dataIndex.sphereById.get('mente');
  const advanced = mente.talents.find(tl => tl.advanced && tl.prerequisites.some(p => p.type === 'talent' || p.type === 'sphere' || p.type === 'level'));
  ok('found an advanced Mente talent with structured prereqs', !!advanced);

  const before = t.addExtraTalentChecked(feit, 'Mente', advanced, null);
  ok('advanced talent BLOCKED (prereq not met)', before === false);
  ok('blocked talent not stored on character', !t.sphereEntry(feit, 'Mente').talents.includes(advanced.id));

  // Satisfy prereqs directly on the stored character, then retry.
  const prereqTalentIds = advanced.prerequisites.filter(p => p.type === 'talent').map(p => p.id);
  const prereqLevel = Math.max(1, ...advanced.prerequisites.filter(p => p.type === 'level').map(p => p.min));
  const entry = t.sphereEntry(feit, 'Mente');
  entry.talents.push(...prereqTalentIds);
  feit.level = Math.max(feit.level, prereqLevel);
  t.updateCharacter(feit.id, { level: feit.level, spheres: feit.spheres });

  const after = t.addExtraTalentChecked(feit, 'Mente', advanced, null);
  ok('advanced talent ALLOWED once prereqs are met', after === true);
  ok('talent id now stored on character', t.sphereEntry(feit, 'Mente').talents.includes(advanced.id));

  /* ---------------------------------------------------------------------
   * 2) Budget enforcement: exhaust magic slots, next pick is BLOCKED.
   * --------------------------------------------------------------------- */
  const broke = t.createCharacter({ name: 'Sanity Broke', className: 'Feiticeiro', level: 1 });
  t.tryAcquireSphere(broke, 'Mente'); // costs 1 magic slot (access)
  const budget = t.Rules.talentBudget(broke, t.dataIndex);
  const remaining = budget.magic - t.Rules.slotsSpent(broke, t.dataIndex).magic; // slots left after access cost
  ok('level-1 Feiticeiro has at least one remaining magic slot after acquiring a sphere', remaining > 0);
  const cheapTalents = mente.talents.filter(tl => tl.kind === 'talent' && (!tl.prerequisites || tl.prerequisites.length === 0));
  let added = 0;
  for (const tl of cheapTalents) {
    if (added >= remaining) break;
    if (t.addExtraTalentChecked(broke, 'Mente', tl, null)) added++;
  }
  ok('filled the remaining magic budget with legal picks', added === remaining && added > 0);
  const overflow = cheapTalents.find(tl => !t.sphereEntry(broke, 'Mente').talents.includes(tl.id));
  ok('found a not-yet-taken cheap talent to test overflow', !!overflow);
  const overflowResult = t.addExtraTalentChecked(broke, 'Mente', overflow, null);
  ok('extra pick BLOCKED once budget is exhausted', overflowResult === false);

  /* ---------------------------------------------------------------------
   * 3) Sphere-access budget enforcement via tryAcquireSphere.
   * --------------------------------------------------------------------- */
  const poorAcolyte = t.createCharacter({ name: 'Sanity Poor', className: 'Feiticeiro', level: 1 });
  const b2 = t.Rules.talentBudget(poorAcolyte, t.dataIndex);
  const allMagicSphereNames = [...t.dataIndex.sphereById.values()].filter(s => s.section === 'magic').map(s => s.name);
  let acquired = 0;
  for (const name of allMagicSphereNames) {
    if (acquired >= b2.magic) break;
    const r = t.tryAcquireSphere(poorAcolyte, name);
    if (r.ok) acquired++;
  }
  ok('acquired exactly the magic-sphere budget', acquired === b2.magic);
  const nextSphereName = allMagicSphereNames.find(name => !t.sphereEntry(poorAcolyte, name));
  const blockedAcquire = t.tryAcquireSphere(poorAcolyte, nextSphereName);
  ok('acquiring one more sphere is BLOCKED once budget is exhausted', blockedAcquire.ok === false && !!blockedAcquire.message);

  /* ---------------------------------------------------------------------
   * 4) Granted sphere access costs 0 and stacks with paid spheres.
   * --------------------------------------------------------------------- */
  const sangue = t.createCharacter({ name: 'Sanity Sangue', className: 'Feiticeiro', level: 5, subclass: 'Sangue Feérico' });
  ok('Sangue Feérico grants Mente for free', t.isGrantedSphere(sangue, 'Mente'));
  const grantedAcquire = t.tryAcquireSphere(sangue, 'Mente');
  ok('acquiring an already-granted sphere is a no-op ok', grantedAcquire.ok === true);
  // Feature A (conditional grants): Mente is access-granted at L1 (base only, no Cativar);
  // later same-sphere grants (Delírio@L3) ARE granted specifically.
  const menteGrantedIds = (t.grantedSpheresMap(sangue).get('Mente') || []).map(x => x.id);
  ok('conditional grant: Delírio granted specifically, Cativar not (access-only)',
     menteGrantedIds.includes('mente-delirio') && !menteGrantedIds.includes('mente-cativar'));

  /* ---------------------------------------------------------------------
   * 4b) Cross-section: Artífice buys the martial Engenhosidade sphere with
   *     its magic budget (Feature B).
   * --------------------------------------------------------------------- */
  const artif = t.createCharacter({ name: 'Sanity Artífice', className: 'Artífice', level: 5 });
  ok('Artífice acquires martial Engenhosidade via magic budget', t.tryAcquireSphere(artif, 'Engenhosidade').ok === true);

  /* ---------------------------------------------------------------------
   * 5) Migration: legacy {name,sphere,anchor,slug} item shape -> talent ids,
   *    non-destructively (unresolvable items are kept, flagged, not dropped).
   * --------------------------------------------------------------------- */
  const cura = mente.talents.find(tl => tl.kind === 'base') || mente.talents[0];
  const realExtra = mente.talents.find(tl => tl.kind === 'talent' && (!tl.prerequisites || tl.prerequisites.length === 0));
  const legacyChar = {
    id: 'legacy1', name: 'Legado', className: 'Feiticeiro', level: 3, keyMod: 1,
    spheres: [{
      sphere: 'Mente', section: 'magic', choices: {},
      freePicks: [{ name: realExtra.name, sphere: 'Mente', anchor: '#x', slug: 'y' }],
      talents: [{ name: 'Talento Que Nao Existe De Verdade', sphere: 'Mente', anchor: '#z', slug: 'w' }],
    }],
  };
  t.saveCharacters([...t.getCharacters(), legacyChar]);
  t.migrateCharacters();
  const migrated = t.getCharacters().find(c => c.id === 'legacy1');
  ok('legacy sphere title migrated to id', migrated.spheres[0].sphere === 'mente');
  ok('resolvable legacy freePick migrated to a talent id (string)', migrated.spheres[0].freePicks[0] === realExtra.id);
  ok('unresolvable legacy talent NOT silently dropped (kept + flagged)', Array.isArray(migrated.spheres[0]._unresolvedLegacy) && migrated.spheres[0]._unresolvedLegacy.length === 1);
  ok('unresolvable legacy item retains its original name (no data loss)', migrated.spheres[0]._unresolvedLegacy[0].name === 'Talento Que Nao Existe De Verdade');
  ok('unresolvable item is not left in the active talents array', migrated.spheres[0].talents.length === 0);
  // idempotent: running migration again doesn't duplicate/lose anything.
  t.migrateCharacters();
  const migrated2 = t.getCharacters().find(c => c.id === 'legacy1');
  ok('migration is idempotent (re-run does not duplicate unresolved items)', migrated2.spheres[0]._unresolvedLegacy.length === 1);

  console.log(`\n${pass} assertions passed.`);
  // app.js registers `document.addEventListener('DOMContentLoaded', init)` at load
  // time; jsdom fires that event on its own shortly after the document is built,
  // which would run the REAL full-page init() (search/sidebar/dark-mode/etc.) that
  // this narrow sanity check deliberately doesn't set up a DOM for. Exit now so
  // that stray auto-boot never fires — it's not part of what this script tests.
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
