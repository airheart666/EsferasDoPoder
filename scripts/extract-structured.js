#!/usr/bin/env node
/* scripts/extract-structured.js — MIGRATION AID (Phase 1), run once (then by hand).
 *
 * Bootstraps data/spheres/<slug>.json from the presentational content/*.txt by
 * reusing the reader's parser (parser.js) and re-implementing, in one auditable
 * place, the talent/param detection the runtime currently scatters across app.js.
 *
 * It does NOT ship to the browser and is NOT a runtime dependency. Its output is a
 * DRAFT: every field the heuristics could not infer confidently is flagged in a
 * per-talent `_needsReview` array (and surfaced in the console summary) for a human
 * to correct. A sphere file is trustworthy only once `_reviewed` is set true and all
 * `_needsReview` markers are cleared. `npm run validate` enforces the schema.
 *
 * Usage:
 *   node scripts/extract-structured.js                 — extract all spheres
 *   node scripts/extract-structured.js --sphere=Mente  — extract one (for iteration)
 *   node scripts/extract-structured.js --dry           — report only, write nothing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HBParser = require(path.join(ROOT, 'parser.js'));
const Chapters = require(path.join(ROOT, 'chapters.js'));

const load = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// ---- CLI ---------------------------------------------------------------------
const args = process.argv.slice(2);
const onlySphere = (args.find(a => a.startsWith('--sphere=')) || '').split('=')[1] || null;
const dryRun = args.includes('--dry');

// ---- Conventions mirrored from app.js ---------------------------------------
const PARAM_LABELS = ['Tempo de Conjuração', 'Alcance', 'Duração', 'Alvo', 'Área', 'Custo', 'Teste de Resistência', 'Pré-requisitos'];
const ENHANCEMENT_RE = /^Aprimoramento\s+\d+\s*pm$/i;
const normalizeTerm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ');
const PARAM_KEY = new Map(PARAM_LABELS.map(l => [normalizeTerm(l), l]));
const PARAM_FIELD = {
  'tempo de conjuracao': 'action', 'alcance': 'range', 'duracao': 'duration',
  'alvo': 'target', 'area': 'area', 'custo': 'custo', 'teste de resistencia': 'save',
  'pre-requisitos': 'prereq',
};
const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');

// NOTE: there are intentionally no sphere/talent name aliases. Every prereq
// name variance was fixed at the SOURCE (content/*.txt) so prose and structured
// data agree and the reader shows the canonical names. Prereqs resolve by direct
// name match. (Book-wide: metasfera→metaesfera, sphere self-references, and all
// talent-name mismatches — see handoff/SYMMETRY-CURATION.md.)
// D&D 5e perícias (PT-BR) that appear as bare prereqs — proficiency requirements,
// not talents. Excludes "Atletismo"/"Natureza" (also sphere names) to avoid clashes.
const SKILLS = new Set(['percepcao', 'furtividade', 'sobrevivencia', 'investigacao', 'intuicao',
  'persuasao', 'enganacao', 'intimidacao', 'acrobacia', 'prestidigitacao', 'medicina',
  'historia', 'religiao', 'arcanismo', 'atuacao', 'lidar com animais'].map(s => s));
// Depth-aware split of the LAST top-level "(...)" in a name → { base, inner }.
// Robust to nested parens like "X (esfera dupla, A, B (talento))" that the old
// simple-regex baseName/tagsOf choked on (leaving nested talents empty-tagged — KG-4).
function lastTopParen(name) {
  const s = String(name); let d = 0, start = -1, end = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') { if (d === 0) start = i; d++; }
    else if (c === ')') { d--; if (d === 0) end = i; }
  }
  return (start >= 0 && end > start) ? { base: s.slice(0, start).trim(), inner: s.slice(start + 1, end) } : { base: s.trim(), inner: null };
}
const baseName = s => lastTopParen(s).base;
const tagsOf = name => {
  const { inner } = lastTopParen(name);
  if (!inner) return [];
  const out = [];
  for (const item of splitTopLevel(inner)) {
    const p = item.indexOf('(');                 // tag = the item's head (sphere/keyword); drop any nested "(talento)"
    const head = (p >= 0 ? item.slice(0, p) : item);
    for (const part of head.split(/[/]|\be\b|\bou\b/i)) { const t = normalizeTerm(part.trim()); if (t) out.push(t); }
  }
  return out;
};

// ---- Cost parsing: "0PM (menor), 1PM (maior), 2PM (poderoso)" | "1 PM" | "varia"
function parseCost(text) {
  const raw = (text || '').trim();
  const review = [];
  if (!raw || raw === '—' || raw === '-') return { cost: { base: 0, text: raw || '—' }, review };
  if (/\bpp\b/i.test(raw)) review.push('cost:uses-pp-not-PM');
  const re = /(\d+)\s*(?:pm|pp)\b\s*(?:\(([^)]*)\))?/gi;
  const found = [];
  let m;
  while ((m = re.exec(raw)) !== null) found.push({ pm: Number(m[1]), label: (m[2] || '').trim() });
  if (found.length === 0) {
    review.push('cost:no-numeric');
    return { cost: { base: null, variable: true, text: raw }, review };
  }
  if (found.length === 1 && !found[0].label) return { cost: { base: found[0].pm, text: raw }, review };
  return { cost: { base: null, tiers: found.map(f => ({ label: f.label || '?', pm: f.pm })), text: raw }, review };
}

// ---- Prereq parsing ----------------------------------------------------------
// Format seen in the source, e.g.:
//   "Esfera da Mente (Delírio, Projeção de Pensamentos), nível 11 ou superior"
// A clause is a sphere access (whose parenthetical lists prerequisite talents),
// a character-level requirement ("nível N"), or a bare talent name. Splits at
// paren-depth 0 so commas inside "(...)" stay with their clause. Returns
// intermediate objects ({type, name?/min?}); talent/sphere names → ids in a
// second pass across the whole dataset.
function splitTopLevel(s) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth = Math.max(0, depth - 1); cur += ch; }
    else if ((ch === ';' || ch === ',') && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function parsePrereqs(text) {
  const raw = (text || '').trim();
  if (!raw || raw === '—') return [];
  const out = [];
  for (let clause of splitTopLevel(raw)) {
    clause = clause.replace(/\.+$/, '').trim();
    if (!clause) continue;
    // level: any clause mentioning "nível" with a number ("5º nível ou superior",
    // "nível 11", "nível de personagem 5º")
    if (/n[íi]vel/i.test(clause)) {
      const n = clause.match(/(\d+)/);
      if (n) { out.push({ type: 'level', min: Number(n[1]) }); continue; }
    }
    // proficiency / skill / package requirements — recognized, kept as text (not talents)
    if (/^proficiente\b|^pacote\b|^per[íi]cia\b/i.test(clause) || SKILLS.has(normalizeTerm(clause))) { out.push({ type: 'text', text: clause }); continue; }
    // sphere access: "Esfera [da] X (talent list)" — manual split handles nested parens
    const sm = clause.match(/^esferas?\s+(?:d[aeo]s?\s+)?(.+)$/i);
    if (sm) {
      const rest = sm[1].trim();
      const pi = rest.indexOf('(');
      const sphereName = (pi >= 0 ? rest.slice(0, pi) : rest).trim();
      out.push({ type: 'sphere', name: sphereName });
      if (pi >= 0) {
        const inner = rest.slice(pi + 1, rest.lastIndexOf(')'));
        // Items may be OR-alternatives ("A ou B") — kept whole for human review;
        // talent base name resolved in the 2nd pass (tags stripped there).
        for (const t of splitTopLevel(inner)) { const tn = t.replace(/\.+$/, '').trim(); if (tn) out.push({ type: 'talent', name: tn, sphereName }); }
      }
      continue;
    }
    out.push({ type: 'talent', name: clause });
  }
  return out;
}

// ---- param detection: <p><strong>Label</strong>: value> ----------------------
function paramFromParagraph(el) {
  if (!el || el.tagName !== 'P') return null;
  const first = el.firstChild;
  if (!first || first.nodeName !== 'STRONG') return null;
  const label = first.textContent.replace(/:\s*$/, '').trim();
  const key = normalizeTerm(label);
  if (!PARAM_KEY.has(key)) return null;
  const value = el.textContent.slice(first.textContent.length).replace(/^[:\s]+/, '').trim();
  return { key, value };
}

// ---- Build the chapter DOM and extract talents -------------------------------
function extractSphere(sphere, chapter, pages, meta) {
  const section = chapter.sectionLabel === 'Esferas de Poder' ? 'martial' : 'magic';
  // The parser emits raw top-level elements; the <section id="pN"> wrappers are
  // added by app.js at render time, so here everything is a flat sibling list.
  const html = pages.slice(chapter.start - 1, chapter.end).map(p => p.html).join('\n');
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const container = dom.window.document.body;

  // Flatten every top-level element in reading order (cards may cross \page).
  const items = [];
  for (let el = container.firstElementChild; el; el = el.nextElementSibling) items.push(el);

  // base abilities = h4 before the first h3
  let seenH3 = false;
  const baseSet = new Set();
  for (const el of items) {
    if (el.tagName === 'H3') seenH3 = true;
    else if (el.tagName === 'H4' && !seenH3) baseSet.add(el);
  }

  const isTable = el => /^\s*tabela\s*:/i.test(el.textContent);
  const nextContent = i => {
    for (let j = i + 1; j < items.length; j++) {
      const e = items[j];
      if (/^H[1-6]$/.test(e.tagName) || e.textContent.trim()) return e;
    }
    return null;
  };
  const isGroupH4 = i => { const nx = nextContent(i); return !!nx && nx.tagName === 'H5' && !isTable(nx); };

  // Card = { headingEl, group, els[] }
  const cards = [];
  let currentGroup = '', inGroup = false, open = null;
  const openCard = (el, group) => { open = { headingEl: el, group, els: [] }; cards.push(open); };
  for (let i = 0; i < items.length; i++) {
    const el = items[i], tag = el.tagName;
    if (tag === 'H2') { currentGroup = ''; inGroup = false; open = null; continue; }
    if (tag === 'H3') { currentGroup = el.textContent || ''; inGroup = false; open = null; continue; }
    if (tag === 'H4') {
      if (isGroupH4(i)) { inGroup = true; open = null; }
      else { inGroup = false; openCard(el, currentGroup); }
      continue;
    }
    if (tag === 'H5') {
      if (!isTable(el) && inGroup) openCard(el, currentGroup);
      else if (open) open.els.push(el);
      continue;
    }
    if (open) open.els.push(el);
  }

  // Build talent records
  const talents = [];
  const usedIds = new Map();
  for (const card of cards) {
    const h = card.headingEl;
    const name = h.textContent.trim();
    const kind = baseSet.has(h) ? 'base' : 'talent';
    const group = card.group || '';
    const review = [];

    // params
    const fields = {};
    for (const el of card.els) {
      const p = paramFromParagraph(el);
      if (!p) continue;
      fields[PARAM_FIELD[p.key] || p.key] = p.value;
    }

    // cost
    let cost;
    if ('custo' in fields) { const c = parseCost(fields.custo); cost = c.cost; review.push(...c.review); }

    // prerequisites (intermediate now; talent/sphere names → ids in 2nd pass)
    const prereqs = 'prereq' in fields ? parsePrereqs(fields.prereq) : [];
    const advanced = prereqs.length > 0 || /avan[çc]ad|lend[áa]ri/i.test(group);

    // enhancements
    const enhancements = [];
    for (const el of card.els) {
      if (el.tagName !== 'P') continue;
      const strong = el.firstChild;
      if (!strong || strong.nodeName !== 'STRONG' || !ENHANCEMENT_RE.test(strong.textContent.trim())) continue;
      const pm = Number((strong.textContent.match(/(\d+)\s*pm/i) || [])[1]);
      enhancements.push({ pm: Number.isFinite(pm) ? pm : null, text: el.textContent.replace(/^[^:]*:\s*/, '').trim() });
    }

    // body = prose that isn't a param/enhancement line
    const bodyParts = card.els.filter(el => !paramFromParagraph(el) &&
      !(el.tagName === 'P' && el.firstChild && el.firstChild.nodeName === 'STRONG' && ENHANCEMENT_RE.test(el.firstChild.textContent.trim())))
      .map(el => el.textContent.trim()).filter(Boolean);

    // stable unique id
    let id = section === 'martial' ? 'm-' + sphere.id + '-' + slugify(baseName(name)) : sphere.id + '-' + slugify(baseName(name));
    const n = (usedIds.get(id) || 0) + 1; usedIds.set(id, n);
    if (n > 1) id += '-' + n;

    talents.push({
      id, name, sphere: sphere.id, section, kind,
      ...(group ? { group } : {}),
      tags: tagsOf(name),
      ...(cost ? { cost } : {}),
      ...(fields.action ? { action: fields.action } : {}),
      ...(fields.range ? { range: fields.range } : {}),
      ...(fields.duration ? { duration: fields.duration } : {}),
      ...(fields.target ? { target: fields.target } : {}),
      ...(fields.area ? { area: fields.area } : {}),
      ...(fields.save ? { save: fields.save } : {}),
      prerequisites: [],            // filled by resolvePrereqs()
      advanced,
      enhancements,
      body: bodyParts.join('\n\n'),
      ...(review.length ? { _needsReview: review } : {}),
      _prereqs: prereqs,            // internal, stripped after id resolution
    });
  }
  return { section, talents };
}

// KG-4: "(esfera dupla, A, B (talento), ...)" in a talent NAME encodes the required
// spheres (+ optional specific talents). Synthesize prereqs from the name clause;
// non-sphere descriptors ("socorro", "forma de explosão") are left as tags only.
function dualSpherePrereqs(name, sphereIds) {
  const { inner } = lastTopParen(name);
  if (!inner) return [];
  const items = splitTopLevel(inner);
  if (!items.length || normalizeTerm(items[0]) !== 'esfera dupla') return [];
  const out = [];
  for (const item of items.slice(1)) {
    const { base: head, inner: nested } = lastTopParen(item);
    if (!sphereIds.has(slugify(head))) continue;   // descriptor, not a sphere → skip (stays a tag)
    out.push({ type: 'sphere', name: head });
    if (nested) for (const tn of splitTopLevel(nested)) { const t = tn.replace(/\.+$/, '').trim(); if (t) out.push({ type: 'talent', name: t, sphereName: head }); }
  }
  return out;
}

// ---- Second pass: resolve talent/sphere prereq names to ids across the set ---
function resolvePrereqs(allTalents, sphereIds) {
  const byKey = new Map();        // "sphereId|base" -> talent id (scoped)
  const globalBase = new Map();   // base -> talent id (fallback, first wins)
  for (const t of allTalents) {
    const base = normalizeTerm(baseName(t.name));
    const scoped = t.sphere + '|' + base;
    if (!byKey.has(scoped)) byKey.set(scoped, t.id);
    if (!globalBase.has(base)) globalBase.set(base, t.id);
  }
  for (const t of allTalents) {
    // KG-4: dual-sphere talents carry their sphere/talent requirements in the name.
    if ((t.tags || []).includes('esfera dupla')) {
      for (const pr of dualSpherePrereqs(t.name, sphereIds)) (t._prereqs = t._prereqs || []).push(pr);
    }
    const resolved = [];
    for (const pr of t._prereqs || []) {
      if (pr.type === 'level') { resolved.push({ type: 'level', min: pr.min }); continue; }
      if (pr.type === 'text') { resolved.push({ type: 'text', text: pr.text }); continue; }
      if (pr.type === 'sphere') {
        const id = slugify(pr.name);
        resolved.push({ type: 'sphere', id });
        if (!sphereIds.has(id)) (t._needsReview = t._needsReview || []).push('prereq:sphere-unknown:' + pr.name);
        continue;
      }
      // talent — prefer the sphere the clause named, else the owning sphere.
      const base = normalizeTerm(baseName(pr.name));
      const sphereId = pr.sphereName ? slugify(pr.sphereName) : t.sphere;
      const id = byKey.get(sphereId + '|' + base) || globalBase.get(base);
      if (id) resolved.push({ type: 'talent', id });
      else { resolved.push({ type: 'text', text: pr.name }); (t._needsReview = t._needsReview || []).push('prereq:unresolved:' + pr.name); }
    }
    t.prerequisites = resolved;
    delete t._prereqs;
  }
}

// ---- Resolve package baseTalents (names) → ids within the sphere -------------
// e.g. Universal's "Dissipar" package auto-grants the "Dissipar" base ability.
function resolvePackageBaseTalents(sphere) {
  const pkgs = sphere.acquisition && sphere.acquisition.packages;
  if (!pkgs) return;
  const byBase = new Map();
  for (const t of sphere.talents) { const k = normalizeTerm(baseName(t.name)); if (!byBase.has(k)) byBase.set(k, t.id); }
  for (const opt of pkgs.options || []) {
    if (!Array.isArray(opt.baseTalents)) continue;
    opt.baseTalentIds = opt.baseTalents.map(n => byBase.get(normalizeTerm(baseName(n)))).filter(Boolean);
    const missing = opt.baseTalents.filter(n => !byBase.get(normalizeTerm(baseName(n))));
    if (missing.length) console.log(`  ⚠ ${sphere.name} package "${opt.id}": baseTalents unresolved: ${missing.join(', ')}`);
  }
}

// ---- Migrate classes.json + class-features.json into data/ -------------------
// classes.json is already schema-shaped (copied through). class-features grants
// reference talents by {name, sphere}; we resolve each to a stable talent id so
// the rules engine can match granted talents by id, not by fragile name compare.
function migrateClasses(allTalents) {
  const byKey = new Map(), globalBase = new Map();
  for (const t of allTalents) {
    const base = normalizeTerm(baseName(t.name));
    if (!byKey.has(t.sphere + '|' + base)) byKey.set(t.sphere + '|' + base, t.id);
    if (!globalBase.has(base)) globalBase.set(base, t.id);
  }
  const resolve = (name, sphereName) => {
    const base = normalizeTerm(baseName(name));
    const sid = slugify(sphereName);
    return byKey.get(sid + '|' + base) || globalBase.get(base) || null;
  };
  const classes = load('classes.json');
  const cf = load('class-features.json');
  const unresolved = [];
  const addIds = node => {
    for (const g of node.grants || []) for (const t of g.talents || []) {
      const id = resolve(t.name, t.sphere);
      if (id) t.id = id; else unresolved.push(`${t.name} [${t.sphere}]`);
    }
    for (const sub of Object.values(node.subclasses || {})) addIds(sub);
  };
  for (const cls of Object.values(cf)) addIds(cls);
  if (!dryRun) {
    fs.writeFileSync(path.join(ROOT, 'data', 'classes.json'), JSON.stringify(classes, null, 2) + '\n');
    fs.writeFileSync(path.join(ROOT, 'data', 'class-features.json'), JSON.stringify(cf, null, 2) + '\n');
  }
  return unresolved;
}

// ---- Main --------------------------------------------------------------------
function main() {
  const manifest = load('manifest.json');
  const themes = load('sphere-themes.json');
  const rules = load('sphere-rules.json');
  const descriptions = load('descriptions.json');

  const fullSource = manifest.map(rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')).join('');
  const { pages, tocTrees } = HBParser.parse(fullSource);
  const chapters = Chapters.buildChapters(pages, tocTrees);

  const sphereNames = new Set(Object.keys(themes));
  const targets = chapters.filter(ch => sphereNames.has(ch.title) && (!onlySphere || ch.title === onlySphere));
  if (targets.length === 0) { console.error('No matching sphere chapters found' + (onlySphere ? ` for "${onlySphere}"` : '') + '.'); process.exit(1); }

  const outDir = path.join(ROOT, 'data', 'spheres');
  if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  const allTalents = [];
  for (const ch of targets) {
    const sphere = {
      id: slugify(ch.title), name: ch.title,
      section: ch.sectionLabel === 'Esferas de Poder' ? 'martial' : 'magic',
      summary: descriptions[ch.title] || null,
      theme: themes[ch.title] || null,
      acquisition: rules[ch.title] || null,
      talents: [],
      _reviewed: false,
    };
    const { talents } = extractSphere(sphere, ch, pages, {});
    sphere.talents = talents;
    resolvePackageBaseTalents(sphere);
    allTalents.push(...talents);
    results.push(sphere);
  }
  const allSphereIds = new Set([...sphereNames].map(slugify));
  resolvePrereqs(allTalents, allSphereIds);

  // Report + write
  let totalTalents = 0, flagged = 0;
  for (const sphere of results) {
    totalTalents += sphere.talents.length;
    const f = sphere.talents.filter(t => t._needsReview && t._needsReview.length).length;
    flagged += f;
    const bases = sphere.talents.filter(t => t.kind === 'base').length;
    console.log(`  ${sphere.name.padEnd(20)} ${String(sphere.talents.length).padStart(3)} talents (${bases} base)  ${f ? '⚠ ' + f + ' need review' : '✓'}`);
    if (!dryRun) fs.writeFileSync(path.join(outDir, sphere.id + '.json'), JSON.stringify(sphere, null, 2) + '\n', 'utf8');
  }
  console.log(`\n${results.length} spheres, ${totalTalents} talents, ${flagged} flagged for review.` + (dryRun ? ' (dry run — nothing written)' : ` Written to data/spheres/.`));

  // Full extraction only: emit the sphere manifest (browsers can't list a dir)
  // and migrate classes / class-features into data/ with grant ids resolved.
  if (!onlySphere) {
    if (!dryRun) {
      const sphereManifest = results.map(s => ({ id: s.id, name: s.name, section: s.section }));
      fs.writeFileSync(path.join(ROOT, 'data', 'spheres.json'), JSON.stringify(sphereManifest, null, 2) + '\n');
    }
    const grantUnresolved = migrateClasses(allTalents);
    console.log(`data/classes.json + data/class-features.json migrated` +
      (grantUnresolved.length ? ` — ⚠ ${grantUnresolved.length} grant talents unresolved: ${grantUnresolved.join(', ')}` : ` (all grant talents resolved to ids)`));
  } else {
    console.log('(--sphere filter: skipped class migration + manifest — run without filter for those)');
  }
}

main();
