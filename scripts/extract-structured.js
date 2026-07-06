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

// Confident sphere-name variants seen in prereq prose → canonical sphere id.
// (spelling/gender/adjective forms of an EXISTING sphere; not game guesses).
// Ambiguous ones (Esgrima, Berserker, Taverna, Bar) are intentionally NOT here —
// they stay flagged for Owner curation. See data/CURATION-NOTES.md.
const SPHERE_ALIAS = {
  'dominio-de-feras': 'dominio-das-feras',
  'guardia': 'guardiao',
  'temporal': 'tempo',
  'climatica': 'clima',
};
// Bucket-1 talent-name variants: a prereq names a talent differently from its
// heading (e.g. "Quebrar a Terra" vs the talent "Quebra-Terra"). Confirmed with the
// Owner. Keyed by normalized name with ALL () / [] groups stripped ("loose" form),
// value = the real talent's base name. Applied only during prereq resolution, so the
// reader prose is untouched (safer than editing text — "Massa (metasfera)" is a
// substring of the real talent "Em Massa (metasfera)"). See data/CURATION-NOTES.md.
const TALENT_ALIAS = {
  'quebrar a terra': 'Quebra-Terra',
  'projecao de pensamentos': 'Pensamentos Projetados',
  'estendida': 'Estendido',
  'massa': 'Em Massa',
  'massa — metasfera': 'Em Massa',
  'massa - metasfera': 'Em Massa',
  'alcance': 'Alcance',                 // resolves "Alcance (metasfera) (3)" / spelling variants
  'imobilizacao': 'Imobilizar',
  'imagem fraturada': 'Imagem Fragmentada',
  'defender outros': 'Defender Outro',
  'forjar terra': 'Forjar a Terra',
  'teletransporte a distancia': 'Teleporte à Distância',
  'teletransporte invisivel': 'Teleporte Invisível',
  'teletransporte de objeto': 'Teletransportar Objeto',
  'corpo retorcido': 'Corpo Distorcido',
  'pacote de companheiros': 'Pacote de Companheiro',
};
// D&D 5e perícias (PT-BR) that appear as bare prereqs — proficiency requirements,
// not talents. Excludes "Atletismo"/"Natureza" (also sphere names) to avoid clashes.
const SKILLS = new Set(['percepcao', 'furtividade', 'sobrevivencia', 'investigacao', 'intuicao',
  'persuasao', 'enganacao', 'intimidacao', 'acrobacia', 'prestidigitacao', 'medicina',
  'historia', 'religiao', 'arcanismo', 'atuacao', 'lidar com animais'].map(s => s));
const baseName = s => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();
const tagsOf = name => {
  const m = String(name).match(/\(([^)]*)\)\s*$/);
  return m ? m[1].split(/[,;/]|\be\b|\bou\b/i).map(t => normalizeTerm(t.trim())).filter(Boolean) : [];
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
    const resolved = [];
    for (const pr of t._prereqs || []) {
      if (pr.type === 'level') { resolved.push({ type: 'level', min: pr.min }); continue; }
      if (pr.type === 'text') { resolved.push({ type: 'text', text: pr.text }); continue; }
      if (pr.type === 'sphere') {
        const id = SPHERE_ALIAS[slugify(pr.name)] || slugify(pr.name);
        resolved.push({ type: 'sphere', id });
        if (!sphereIds.has(id)) (t._needsReview = t._needsReview || []).push('prereq:sphere-unknown:' + pr.name);
        continue;
      }
      // talent — prefer the sphere the clause named, else the owning sphere.
      // Apply a talent-name alias (loose key: strip all () [] groups) before lookup.
      const loose = normalizeTerm(String(pr.name).replace(/[([][^)\]]*[)\]]/g, ' '));
      const alias = TALENT_ALIAS[normalizeTerm(baseName(pr.name))] || TALENT_ALIAS[loose];
      const base = normalizeTerm(alias ? alias : baseName(pr.name));
      const sphereId = pr.sphereName ? slugify(pr.sphereName) : t.sphere;
      const id = byKey.get(sphereId + '|' + base) || globalBase.get(base);
      if (id) resolved.push({ type: 'talent', id });
      else { resolved.push({ type: 'text', text: pr.name }); (t._needsReview = t._needsReview || []).push('prereq:unresolved:' + pr.name); }
    }
    t.prerequisites = resolved;
    delete t._prereqs;
  }
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
}

main();
