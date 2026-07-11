#!/usr/bin/env node
/* scripts/validate.js — Phase 2 guardrail. Run: `npm run validate`.
 *
 * Fails loudly (non-zero exit) when the structured data drifts. Three checks:
 *   1. Schema conformance — every file in data/ against schema/*.schema.json.
 *   2. Referential integrity — every prerequisite/grant talent-id and sphere-id
 *      resolves; talent ids are globally unique; sphere ids unique.
 *   3. Transitional prose cross-check — every talent the reader's parser finds in
 *      content/ has a structured entry, and vice-versa (no silent drops). This is
 *      what makes rewording the prose a loud failure instead of a silent builder bug.
 *
 * Flags: --no-crosscheck skips (3); --quiet prints only the summary.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const doCross = !args.includes('--no-crosscheck');

const errors = [];
const warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

// ---- 1. Schema conformance ---------------------------------------------------
const ajv = new Ajv({ allErrors: true, strict: false });
for (const f of ['schema/talent.schema.json', 'schema/sphere.schema.json', 'schema/class.schema.json', 'schema/class-features.schema.json', 'schema/traditions.schema.json'])
  ajv.addSchema(load(f));
const validateSphere = ajv.getSchema('sphere.schema.json');

const spheresDir = path.join(ROOT, 'data', 'spheres');
const sphereFiles = fs.existsSync(spheresDir) ? fs.readdirSync(spheresDir).filter(f => f.endsWith('.json')) : [];
if (sphereFiles.length === 0) err('data/spheres/ is empty — run `npm run extract` first.');

const spheres = [];
for (const f of sphereFiles) {
  const doc = load(path.join('data', 'spheres', f));
  if (!validateSphere(doc)) for (const e of validateSphere.errors) err(`${f}: ${e.instancePath || '/'} ${e.message}`);
  spheres.push(doc);
}

// classes.json + class-features.json schema conformance (if migrated into data/)
const validateClasses = ajv.getSchema('class.schema.json');
const validateClassFeatures = ajv.getSchema('class-features.schema.json');
if (fs.existsSync(path.join(ROOT, 'data', 'classes.json'))) {
  const doc = load(path.join('data', 'classes.json'));
  if (!validateClasses(doc)) for (const e of validateClasses.errors) err(`classes.json: ${e.instancePath || '/'} ${e.message}`);
}
if (fs.existsSync(path.join(ROOT, 'data', 'class-features.json'))) {
  const doc = load(path.join('data', 'class-features.json'));
  if (!validateClassFeatures(doc)) for (const e of validateClassFeatures.errors) err(`class-features.json: ${e.instancePath || '/'} ${e.message}`);
}
const validateTraditions = ajv.getSchema('traditions.schema.json');
if (fs.existsSync(path.join(ROOT, 'data', 'traditions.json'))) {
  const doc = load(path.join('data', 'traditions.json'));
  if (!validateTraditions(doc)) for (const e of validateTraditions.errors) err(`traditions.json: ${e.instancePath || '/'} ${e.message}`);
  else { // ids únicos por tipo
    for (const type of ['magic', 'martial']) {
      const seen = new Set();
      for (const tr of doc[type] || []) { if (seen.has(tr.id)) err(`traditions.json: duplicate id "${tr.id}" in ${type}`); seen.add(tr.id); }
    }
  }
}

// prereq-overrides.json (fonte autoral): estrutura leve — cada entrada é um array de
// prereqs {type,...}. Nomes talent/sphere são resolvidos pelo extractor; o RESULTADO já
// é validado pelo talent.schema acima. Aqui só pega malformação grosseira na fonte.
if (fs.existsSync(path.join(ROOT, 'prereq-overrides.json'))) {
  const ov = load('prereq-overrides.json');
  for (const [k, v] of Object.entries(ov)) {
    if (k.startsWith('_')) continue;
    if (!Array.isArray(v)) { err(`prereq-overrides.json: "${k}" deve ser um array de prereqs`); continue; }
    for (const p of v) if (!p || typeof p.type !== 'string') err(`prereq-overrides.json: "${k}" tem um prereq sem type`);
  }
}

// ---- 2. Referential integrity ------------------------------------------------
const talentIds = new Set();
const sphereIds = new Set();
for (const s of spheres) {
  if (sphereIds.has(s.id)) err(`duplicate sphere id: ${s.id}`);
  sphereIds.add(s.id);
}
for (const s of spheres) for (const t of s.talents) {
  if (talentIds.has(t.id)) err(`duplicate talent id: ${t.id}`);
  talentIds.add(t.id);
  if (t.sphere !== s.id) err(`${t.id}: talent.sphere "${t.sphere}" != file sphere "${s.id}"`);
}
for (const s of spheres) for (const t of s.talents) for (const p of t.prerequisites || []) {
  if (p.type === 'talent' && !talentIds.has(p.id)) err(`${t.id}: prereq talent id not found: ${p.id}`);
  if (p.type === 'sphere' && !sphereIds.has(p.id)) warn(`${t.id}: prereq sphere id not found: ${p.id}`);
}

// KG-4: every "esfera dupla" talent must resolve ≥2 sphere prereqs from its name clause.
for (const s of spheres) for (const t of s.talents) {
  if ((t.tags || []).includes('esfera dupla')) {
    const n = (t.prerequisites || []).filter(p => p.type === 'sphere').length;
    if (n < 2) warn(`${t.id}: dual-sphere talent has only ${n} sphere prereq(s) — name-clause parse gap`);
  }
}

// class-features grants (if migrated into data/) reference talents by id
const cfPath = path.join(ROOT, 'data', 'class-features.json');
if (fs.existsSync(cfPath)) {
  const cf = load(path.join('data', 'class-features.json'));
  const walkGrants = node => {
    for (const g of node.grants || []) for (const t of g.talents || [])
      if (t.id && !talentIds.has(t.id)) err(`class-features: grant talent id not found: ${t.id}`);
    for (const sub of Object.values(node.subclasses || {})) walkGrants(sub);
  };
  for (const cls of Object.values(cf)) walkGrants(cls);
}

// ---- 3. Transitional prose cross-check ---------------------------------------
// Reuse the reader's parser to count the talents the CURRENT pipeline sees per
// sphere, and compare to the structured entries. A mismatch means the migration
// dropped or invented a talent.
if (doCross && errors.length === 0) {
  const HBParser = require(path.join(ROOT, 'parser.js'));
  const Chapters = require(path.join(ROOT, 'chapters.js'));
  const manifest = load('manifest.json');
  const themes = load('sphere-themes.json');
  const fullSource = manifest.map(rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('');
  const { pages, tocTrees } = HBParser.parse(fullSource);
  const chapters = Chapters.buildChapters(pages, tocTrees);
  const sphereNames = new Set(Object.keys(themes));

  // Count h4/h5 headings that open a card, mirroring enhanceTalents' grouping.
  const countCards = ch => {
    const html = pages.slice(ch.start - 1, ch.end).map(p => p.html).join('\n');
    const body = new JSDOM(`<body>${html}</body>`).window.document.body;
    const items = []; for (let el = body.firstElementChild; el; el = el.nextElementSibling) items.push(el);
    const isTable = el => /^\s*tabela\s*:/i.test(el.textContent);
    const nextContent = i => { for (let j = i + 1; j < items.length; j++) { const e = items[j]; if (/^H[1-6]$/.test(e.tagName) || e.textContent.trim()) return e; } return null; };
    const isGroupH4 = i => { const nx = nextContent(i); return !!nx && nx.tagName === 'H5' && !isTable(nx); };
    let inGroup = false, n = 0;
    for (let i = 0; i < items.length; i++) {
      const tag = items[i].tagName;
      if (tag === 'H2' || tag === 'H3') { inGroup = false; continue; }
      // A non-group h4 opens a card AND ends group mode (its following h5s are
      // sub-parts of that card, not separate talents) — matches enhanceTalents.
      if (tag === 'H4') { if (isGroupH4(i)) inGroup = true; else { inGroup = false; n++; } continue; }
      if (tag === 'H5') { if (!isTable(items[i]) && inGroup) n++; }
    }
    return n;
  };

  const bySphere = new Map(spheres.map(s => [s.name, s]));
  for (const ch of chapters) {
    if (!sphereNames.has(ch.title)) continue;
    const structured = bySphere.get(ch.title);
    if (!structured) { err(`cross-check: sphere "${ch.title}" exists in content but has no data/spheres file`); continue; }
    const domCount = countCards(ch);
    if (domCount !== structured.talents.length)
      err(`cross-check: "${ch.title}" parser sees ${domCount} talents, structured has ${structured.talents.length}`);
  }
}

// ---- Report ------------------------------------------------------------------
const needReview = spheres.reduce((a, s) => a + s.talents.filter(t => t._needsReview && t._needsReview.length).length, 0);
const reviewed = spheres.filter(s => s._reviewed).length;
if (!quiet) {
  for (const w of warnings) console.log('  ⚠ ' + w);
  for (const e of errors) console.log('  ✗ ' + e);
}
console.log(`\n${spheres.length} spheres, ${talentIds.size} talents · ${reviewed} reviewed · ${needReview} talents still flagged _needsReview`);
console.log(`${warnings.length} warnings, ${errors.length} errors.`);
process.exit(errors.length ? 1 : 0);
