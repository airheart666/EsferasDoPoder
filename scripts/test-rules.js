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
const traditions = load(path.join('data', 'traditions.json'));
const idx = Rules.indexData(spheres, classes, classFeatures, traditions);

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

// --- Fase 1: multi-pacote (packages[]) ---
// packages[0] = grátis (aquisição); packages[1..] = via o talento repetível (1 slot cada).
/** @type {any} */
const nat2 = { id: 'n2', name: 'N', className: 'Feiticeiro', subclass: '', level: 5, keyMod: 0, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [{ sphere: 'natureza', section: 'magic', packages: ['ar', 'fogo'], freePicks: [], talents: [] }] };
const nat2Owned = Rules.ownedTalentIds(nat2, idx);
ok('MULTI-PKG: dois pacotes → ambas as bases possuídas (Ar+Fogo)', nat2Owned.has('natureza-ar') && nat2Owned.has('natureza-fogo'));
ok('MULTI-PKG: 1 pacote extra custa +1 slot (acesso 1 + extra 1 = 2)', Rules.slotsSpent(nat2, idx).magic === 2);
/** @type {any} */
const nat1 = { ...nat2, spheres: [{ sphere: 'natureza', section: 'magic', packages: ['ar'], freePicks: [], talents: [] }] };
ok('MULTI-PKG: 1 pacote grátis não custa slot extra (só o acesso = 1)', Rules.slotsSpent(nat1, idx).magic === 1);
ok('MULTI-PKG: só o pacote grátis → só a sua base (Ar, não Fogo)', Rules.ownedTalentIds(nat1, idx).has('natureza-ar') && !Rules.ownedTalentIds(nat1, idx).has('natureza-fogo'));
// canAddPackage: gate de `requires` + orçamento
/** @type {any} */
const nat1Rich = { ...nat1, level: 20 };
ok('MULTI-PKG: canAddPackage OK p/ pacote não-possuído com orçamento', Rules.canAddPackage(nat1Rich, 'natureza', 'terra', idx).ok === true);
// Legado choices.pkg segue equivalente ao novo packages[]
/** @type {any} */
const natLegacy = { ...nat1, spheres: [{ sphere: 'natureza', section: 'magic', choices: { pkg: 'ar' }, freePicks: [], talents: [] }] };
ok('MULTI-PKG: choices.pkg legado ≡ packages:[pkg]', Rules.ownedTalentIds(natLegacy, idx).has('natureza-ar') && Rules.slotsSpent(natLegacy, idx).magic === 1);

// --- Fase 2: escopo por elemento/tipo (talento com tag de pacote → exige o pacote) ---
const domFogo = idx.sphereById.get('natureza').talents.find(t => t.id === 'natureza-dominio-do-fogo');
const lava = idx.sphereById.get('natureza').talents.find(t => t.id === 'natureza-dominio-da-lava');
ok('SCOPE: Domínio do Fogo carrega prereq de pacote fogo', !!domFogo && domFogo.prerequisites.some(p => p.type === 'package' && p.pkg === 'fogo'));
/** @type {any} */
const natFogo = { ...nat1, spheres: [{ sphere: 'natureza', section: 'magic', packages: ['fogo'], freePicks: [], talents: [] }] };
ok('SCOPE: Domínio do Fogo BLOQUEADO sem o pacote Fogo', Rules.prereqCheck(nat1, domFogo, idx).ok === false);
ok('SCOPE: Domínio do Fogo LIBERADO com o pacote Fogo', Rules.prereqCheck(natFogo, domFogo, idx).ok === true);
/** @type {any} */
const natFogoTerra = { ...nat1, spheres: [{ sphere: 'natureza', section: 'magic', packages: ['fogo', 'terra'], freePicks: [], talents: [] }] };
ok('SCOPE: Domínio da Lava (terra+fogo) BLOQUEADO só com Fogo', Rules.prereqCheck(natFogo, lava, idx).ok === false);
ok('SCOPE: Domínio da Lava LIBERADO com Fogo+Terra', Rules.prereqCheck(natFogoTerra, lava, idx).ok === true);
// KG-5 salvaguarda: talentos metaesfera da Universal NÃO ganharam prereq de pacote
const metaTal = idx.sphereById.get('universal').talents.find(t => (t.tags || []).includes('metaesfera'));
ok('SCOPE: Universal (tag-scoped) NÃO recebe prereq de pacote (KG-5 intacto)', !!metaTal && !metaTal.prerequisites.some(p => p.type === 'package'));
// Dom. das Feras: alias scopeTags (montaria → cavaleiro) — tag ≠ id do pacote
const montaria = idx.sphereById.get('dominio-das-feras').talents.find(t => t.id === 'm-dominio-das-feras-montaria-acrobatica');
ok('SCOPE: alias montaria→cavaleiro (scopeTags) vira prereq de pacote cavaleiro', !!montaria && montaria.prerequisites.some(p => p.type === 'package' && p.pkg === 'cavaleiro'));
/** @type {any} */
const dfBase = { id: 'df', name: 'DF', className: 'Guerreiro', subclass: '', level: 5, keyMod: 0, tradition: '', proficiencies: { skills: [], tools: [] }, spheres: [{ sphere: 'dominio-das-feras', section: 'martial', packages: ['domador'], freePicks: [], talents: [] }] };
ok('SCOPE: montaria BLOQUEADO com pacote Domador (falta Cavaleiro)', Rules.prereqCheck(dfBase, montaria, idx).ok === false);
/** @type {any} */
const dfCav = { ...dfBase, spheres: [{ sphere: 'dominio-das-feras', section: 'martial', packages: ['cavaleiro'], freePicks: [], talents: [] }] };
ok('SCOPE: montaria LIBERADO com pacote Cavaleiro', Rules.prereqCheck(dfCav, montaria, idx).ok === true);
// canAddPackage: orçamento esgotado → bloqueia (nível 1 tem orçamento pequeno)
/** @type {any} */
const natFull = { ...nat1, level: 1, spheres: [{ sphere: 'natureza', section: 'magic', packages: ['ar', 'terra', 'fogo', 'metal', 'planta'], freePicks: [], talents: [] }] };
const chkFull = Rules.canAddPackage(natFull, 'natureza', 'agua', idx);
ok('MULTI-PKG: canAddPackage bloqueia sem orçamento (budgetOk=false)', chkFull.ok === false && chkFull.budgetOk === false);

// --- KG-4: dual-sphere (esfera dupla) talents now enforce their named spheres ---
const aurora = idx.sphereById.get('universal').talents.find(t => t.id === 'universal-aurora');
ok('KG-4: Aurora carries its 2 sphere prereqs (Luz + Clima)', !!aurora && aurora.prerequisites.filter(p => p.type === 'sphere').length === 2);
/** @type {any} */
const kg4Base = { id: 'k', name: 'K', className: 'Feiticeiro', subclass: '', level: 5, keyMod: 0, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [{ sphere: 'universal', section: 'magic', choices: { pkg: 'criacao-magias' }, freePicks: [], talents: [] }] };
ok('KG-4: Aurora BLOCKED without Luz+Clima', Rules.prereqCheck(kg4Base, aurora, idx).ok === false);
/** @type {any} */
const kg4Two = { ...kg4Base, spheres: [kg4Base.spheres[0], { sphere: 'luz', section: 'magic', choices: {}, freePicks: [], talents: [] }, { sphere: 'clima', section: 'magic', choices: {}, freePicks: [], talents: [] }] };
ok('KG-4: Aurora ALLOWED with Luz+Clima', Rules.prereqCheck(kg4Two, aurora, idx).ok === true);

// --- KG-4: package gate — Criação de Magias needs ≥2 magic spheres besides Universal ---
ok('KG-4: Criação de Magias package BLOCKED with <2 magic spheres', Rules.packageRequirementMet(kg4Base, 'universal', 'criacao-magias', idx).ok === false);
ok('KG-4: Criação de Magias package ALLOWED with ≥2 magic spheres', Rules.packageRequirementMet(kg4Two, 'universal', 'criacao-magias', idx).ok === true);

// --- Tier 2: novos tipos de pré-requisito (or / tag / skill / package / martial-talent) ---
const mkChar = (o) => ({ id: 't2', name: 'T', className: 'Feiticeiro', subclass: '', level: 11, keyMod: 0, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [], ...o });

// OR: Múmia (Morte) requer Esqueleto OU Zumbi
const mumia = idx.sphereById.get('morte').talents.find(t => t.id === 'morte-mumia');
ok('OR: Múmia tem prereq or[Esqueleto, Zumbi]', !!mumia && (mumia.prerequisites || []).some(p => p.type === 'or' && p.of.length === 2));
/** @type {any} */
const semUndead = mkChar({ spheres: [{ sphere: 'morte', section: 'magic', choices: {}, freePicks: [], talents: [] }] });
ok('OR: Múmia BLOQUEADA sem Esqueleto/Zumbi', Rules.prereqCheck(semUndead, mumia, idx).ok === false);
/** @type {any} */
const comEsqueleto = mkChar({ spheres: [{ sphere: 'morte', section: 'magic', choices: {}, freePicks: [], talents: ['morte-esqueleto'] }] });
ok('OR: Múmia LIBERADA com Esqueleto (qualquer alternativa)', Rules.prereqCheck(comEsqueleto, mumia, idx).ok === true);

// TAG: Frasco Universal (Alquimia) requer 5 talentos (fórmula|veneno)
const frasco = idx.sphereById.get('alquimia').talents.find(t => t.name.startsWith('Frasco Universal'));
const formulas = idx.sphereById.get('alquimia').talents.filter(t => (t.tags || []).includes('formula')).slice(0, 5).map(t => t.id);
/** @type {any} */
const quatro = mkChar({ className: 'Artífice', subclass: 'Alquimista', spheres: [{ sphere: 'alquimia', section: 'martial', choices: {}, freePicks: [], talents: formulas.slice(0, 4) }] });
/** @type {any} */
const cinco = mkChar({ className: 'Artífice', subclass: 'Alquimista', spheres: [{ sphere: 'alquimia', section: 'martial', choices: {}, freePicks: [], talents: formulas }] });
ok('TAG: Frasco BLOQUEADO com 4 talentos de fórmula', Rules.prereqCheck(quatro, frasco, idx).ok === false);
ok('TAG: Frasco LIBERADO com 5 talentos de fórmula', Rules.prereqCheck(cinco, frasco, idx).ok === true);

// SKILL: Batedor Especialista requer Furtividade ou Sobrevivência (perícia)
const batEsp = idx.sphereById.get('batedor').talents.find(t => t.name.startsWith('Batedor Especialista'));
/** @type {any} */
const semPer = mkChar({ className: 'Batedor', spheres: [{ sphere: 'batedor', section: 'martial', choices: {}, freePicks: [], talents: [] }] });
/** @type {any} */
const comPer = mkChar({ className: 'Batedor', proficiencies: { skills: ['Furtividade'], tools: [] }, spheres: [{ sphere: 'batedor', section: 'martial', choices: {}, freePicks: [], talents: [] }] });
ok('SKILL: Batedor Especialista BLOQUEADO sem a perícia', Rules.prereqCheck(semPer, batEsp, idx).ok === false);
ok('SKILL: Batedor Especialista LIBERADO com Furtividade', Rules.prereqCheck(comPer, batEsp, idx).ok === true);

// PACKAGE + rename: Contramágica Caótica requer Contramágica OU pacote dissipar
const contraCaotico = idx.sphereById.get('universal').talents.find(t => t.name.startsWith('Contramágica Caótica'));
ok('rename: talento Contramágica existe (era Contrafeitiço)', !!idx.talentById.get('universal-contramagica'));
/** @type {any} */
const comDissipar = mkChar({ spheres: [{ sphere: 'universal', section: 'magic', choices: { pkg: 'dissipar' }, freePicks: [], talents: [] }] });
ok('PACKAGE: Contramágica Caótica LIBERADO com pacote dissipar', Rules.prereqCheck(comDissipar, contraCaotico, idx).ok === true);
/** @type {any} */
const pkgMeta = mkChar({ spheres: [{ sphere: 'universal', section: 'magic', choices: { pkg: 'metaesfera' }, freePicks: [], talents: [] }] });
ok('PACKAGE: Contramágica Caótica BLOQUEADO com outro pacote', Rules.prereqCheck(pkgMeta, contraCaotico, idx).ok === false);

// MARTIAL-TALENT: Foco Místico requer possuir um talento de esfera marcial
const focoMistico = idx.sphereById.get('universal').talents.find(t => t.name === 'Foco Místico');
/** @type {any} */
const artificeMarcial = mkChar({ className: 'Artífice', subclass: 'Alquimista', spheres: [{ sphere: 'alquimia', section: 'martial', choices: {}, freePicks: [], talents: [formulas[0]] }] });
ok('MARTIAL: Foco Místico BLOQUEADO sem talento marcial', Rules.prereqCheck(mkChar({}), focoMistico, idx).ok === false);
ok('MARTIAL: Foco Místico LIBERADO com talento de esfera marcial', Rules.prereqCheck(artificeMarcial, focoMistico, idx).ok === true);

// GRUPO E: esfera dupla aninhada — "protomancia X" (erro de tradução de "geomancia")
// resolve p/ o pacote da Natureza; "Bomba Cadavérica" → talento Bomba de Cadáver.
const ligaMetal = idx.sphereById.get('universal').talents.find(t => t.id === 'universal-aprimoramento-de-liga');
ok('GRUPO E: Aprim. de Liga carrega prereq pacote natureza/metal', !!ligaMetal && ligaMetal.prerequisites.some(p => p.type === 'package' && p.sphere === 'natureza' && p.pkg === 'metal'));
ok('GRUPO E: Explosão Cadavérica → talento Bomba de Cadáver', idx.sphereById.get('universal').talents.find(t => t.id === 'universal-explosao-cadaverica').prerequisites.some(p => p.type === 'talent' && p.id === 'morte-bomba-de-cadaver'));
ok('GRUPO E: nenhum talento continua flagged (_needsReview zerado)', ![...idx.talentById.values()].some(t => t._needsReview && t._needsReview.length));
/** @type {any} */
const ligaSemMetal = mkChar({ spheres: [{ sphere: 'aprimoramento', section: 'magic', packages: [], freePicks: [], talents: [] }, { sphere: 'natureza', section: 'magic', packages: ['ar'], freePicks: [], talents: [] }] });
ok('GRUPO E: Aprim. de Liga BLOQUEADO sem pacote Metal', Rules.prereqCheck(ligaSemMetal, ligaMetal, idx).ok === false);
/** @type {any} */
const ligaComMetal = mkChar({ spheres: [{ sphere: 'aprimoramento', section: 'magic', packages: [], freePicks: [], talents: [] }, { sphere: 'natureza', section: 'magic', packages: ['metal'], freePicks: [], talents: [] }] });
ok('GRUPO E: Aprim. de Liga LIBERADO com Aprimoramento+Natureza+pacote Metal', Rules.prereqCheck(ligaComMetal, ligaMetal, idx).ok === true);

console.log(`\n${pass} assertions passed.`);
