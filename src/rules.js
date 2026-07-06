// @ts-check
/**
 * Rules engine for the character builder — PURE logic, no DOM, no I/O.
 *
 * This is the module that replaces DOM scraping: it decides sphere access, talent
 * legality, prerequisites and talent-slot budget from the structured data in
 * data/spheres/* (+ classes / class-features), never from rendered HTML.
 *
 * Build-time constraint is TALENT SLOTS (magic/martial), not PM. PM is a derived
 * casting pool. Structured prerequisites (talent/sphere/level) are enforced; `text`
 * prerequisites are surfaced as "confirm manually" (unverifiable), never silently
 * blocked or passed.
 *
 * Dual-mode like parser.js/chapters.js: CommonJS export for Node tooling + a global
 * for the browser. Phase 4 may migrate the whole set to ES modules together.
 *
 * @typedef {import('./types.js').Character} Character
 * @typedef {import('./types.js').Sphere} Sphere
 * @typedef {import('./types.js').Talent} Talent
 * @typedef {import('./types.js').ClassDef} ClassDef
 * @typedef {import('./types.js').ProgressionRow} ProgressionRow
 * @typedef {import('./types.js').Section} Section
 * @typedef {import('./types.js').Prerequisite} Prerequisite
 * @typedef {import('./types.js').DataIndex} DataIndex
 * @typedef {import('./types.js').PrereqResult} PrereqResult
 * @typedef {import('./types.js').GrantResult} GrantResult
 */

const Rules = (() => {
  'use strict';

  /** @param {string} s */
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');

  /** @param {{magic:number, martial:number}} o @param {Section} section */
  const bySection = (o, section) => (section === 'martial' ? o.martial : o.magic);

  /**
   * @param {Sphere[]} spheres
   * @param {Object<string, ClassDef>} [classes]
   * @param {Object<string, any>} [classFeatures]
   * @returns {DataIndex}
   */
  function indexData(spheres, classes, classFeatures) {
    /** @type {Map<string, Talent>} */ const talentById = new Map();
    /** @type {Map<string, Sphere>} */ const sphereById = new Map();
    for (const s of spheres) {
      sphereById.set(s.id, s);
      for (const t of s.talents) talentById.set(t.id, t);
    }
    return { talentById, sphereById, classes: classes || {}, classFeatures: classFeatures || {} };
  }

  /**
   * Progression row for a class at a level (nearest row at or below level).
   * @param {DataIndex} idx @param {string} className @param {number} level
   * @returns {ProgressionRow | null}
   */
  function classRow(idx, className, level) {
    const cls = idx.classes[className];
    if (!cls || !cls.progression) return null;
    const lv = Math.max(1, Math.min(20, level || 1));
    /** @type {ProgressionRow | null} */ let row = null;
    for (const r of cls.progression) if (r.level <= lv) row = r;
    return row || cls.progression[0] || null;
  }

  /**
   * Derived stats: proficiency, DC, attack, resource pool, and slot counts.
   * @param {Character} char @param {DataIndex} idx
   */
  function derivedStats(char, idx) {
    const cls = idx.classes[char.className];
    const row = classRow(idx, char.className, char.level);
    if (!cls || !row) return null;
    const prof = row.prof || 0;
    return {
      type: cls.type,
      keyAbility: cls.keyAbility,
      resourceName: cls.resource,
      resource: cls.resource === 'PM' ? (row.pm || 0) : cls.resource === 'Chi' ? (row.chi || 0) : null,
      prof,
      cd: 8 + prof + (char.keyMod || 0),
      attack: prof + (char.keyMod || 0),
      magicTalents: row.magicTalents || 0,
      martialTalents: row.martialTalents || 0,
    };
  }

  // Only the "Base" tradition exists for now: +2 talents of the class's type.
  /** @param {Character} char @param {DataIndex} idx */
  function traditionBonus(char, idx) {
    const cls = idx.classes[char.className];
    if (!cls || !char.tradition) return 0;
    return (cls.type === 'magic' || cls.type === 'martial') ? 2 : 0;
  }

  /**
   * Bonus talent slots from class/subclass features (bonusByLevel, cumulative).
   * @param {Character} char @param {DataIndex} idx
   * @returns {{magic:number, martial:number, notes:string[]}}
   */
  function classFeatureBonus(char, idx) {
    /** @type {{magic:number, martial:number, notes:string[]}} */
    const out = { magic: 0, martial: 0, notes: [] };
    const cf = idx.classFeatures[char.className];
    if (!cf) return out;
    const level = char.level || 1;
    /** @param {any[]} feats */
    const addFeatures = feats => {
      for (const f of feats || []) {
        let sum = 0;
        for (const pair of f.bonusByLevel || []) if (pair[0] <= level) sum += pair[1];
        if (!sum) continue;
        if (f.section === 'martial') out.martial += sum; else out.magic += sum;
        if (f.note) out.notes.push(f.name + ': ' + f.note);
      }
    };
    addFeatures(cf.features);
    if (char.subclass && cf.subclasses && cf.subclasses[char.subclass]) addFeatures(cf.subclasses[char.subclass].features);
    return out;
  }

  /**
   * Total talent-slot budget (magic and martial separately).
   * @param {Character} char @param {DataIndex} idx
   * @returns {{magic:number, martial:number, notes:string[]}}
   */
  function talentBudget(char, idx) {
    const stats = derivedStats(char, idx);
    if (!stats) return { magic: 0, martial: 0, notes: [] };
    const tBonus = traditionBonus(char, idx);
    const cf = classFeatureBonus(char, idx);
    return {
      magic: stats.magicTalents + (stats.type === 'magic' ? tBonus : 0) + cf.magic,
      martial: stats.martialTalents + (stats.type === 'martial' ? tBonus : 0) + cf.martial,
      notes: cf.notes,
    };
  }

  /**
   * Resolve subclass/class grants under the CONDITIONAL rule (Spheres of Power):
   * a granted talent gives the SPECIFIC talent if its sphere is already accessible,
   * otherwise only the sphere's BASE access. Processed in level order; both
   * slot-bought spheres and earlier granted-access count as "prior access". A granted
   * specific the character already owns becomes a (deferred) replacement choice.
   * @param {Character} char @param {DataIndex} idx @returns {GrantResult}
   */
  function computeGrants(char, idx) {
    /** @type {Set<string>} */ const accessSpheres = new Set();
    /** @type {Set<string>} */ const specificTalents = new Set();
    /** @type {GrantResult['pendingReplacements']} */ const pendingReplacements = [];
    const cf = idx.classFeatures[char.className];
    if (!cf) return { accessSpheres, specificTalents, pendingReplacements };
    const level = char.level || 1;
    /** @type {Array<{level:number, feature?:string, talents:any[]}>} */ const grants = [];
    /** @param {any} node */
    const gather = node => { for (const g of node.grants || []) if ((g.level || 1) <= level) grants.push(g); };
    if (char.subclass && cf.subclasses && cf.subclasses[char.subclass]) gather(cf.subclasses[char.subclass]);
    if (cf.grants) gather(cf);
    grants.sort((a, b) => (a.level || 1) - (b.level || 1));

    const accessed = new Set((char.spheres || []).map(e => e.sphere));   // prior access (slots), grows as we grant access
    const owned = new Set();                                             // slot picks (for the "already owns" check)
    for (const e of char.spheres || []) { for (const id of e.freePicks || []) owned.add(id); for (const id of e.talents || []) owned.add(id); }

    for (const g of grants) {
      for (const t of g.talents || []) {
        if (!t.id) continue; // unresolved grant talent — skip
        const S = slug(t.sphere);
        if (accessed.has(S)) {
          if (owned.has(t.id) || specificTalents.has(t.id)) pendingReplacements.push({ sphereId: S, talentId: t.id, name: t.name, feature: g.feature, level: g.level || 1 });
          else specificTalents.add(t.id);
        } else {
          accessSpheres.add(S); accessed.add(S); // gain base access instead of the specific talent
        }
      }
    }
    return { accessSpheres, specificTalents, pendingReplacements };
  }

  // Sphere ids granted FREE base access (cost 0). Spheres whose specific talent was
  // granted are already accessible via slots/earlier grants, so they are NOT here.
  /** @param {Character} char @param {DataIndex} idx @returns {Set<string>} */
  function grantedSphereIds(char, idx) { return computeGrants(char, idx).accessSpheres; }

  /**
   * The section a sphere's cost counts against FOR THIS CHARACTER: the class's own
   * type if the sphere is one of the class/subclass `crossSpheres` (a class spending
   * its budget on the other section, e.g. Artífice buying Engenhosidade with magic
   * slots), else the sphere's own section.
   * @param {Character} char @param {string} sphereId @param {DataIndex} idx @returns {Section}
   */
  function effectiveSection(char, sphereId, idx) {
    const sph = idx.sphereById.get(sphereId);
    const own = sph ? sph.section : /** @type {Section} */ ('magic');
    const cls = idx.classes[char.className];
    if (!cls) return own;
    /** @type {Set<string>} */ const cross = new Set();
    for (const title of cls.crossSpheres || []) cross.add(slug(title));
    const cf = idx.classFeatures[char.className];
    const sub = cf && char.subclass && cf.subclasses && cf.subclasses[char.subclass];
    if (sub) for (const title of sub.crossSpheres || []) cross.add(slug(title));
    return cross.has(sphereId) ? cls.type : own;
  }

  /**
   * Slots spent so far (access cost + extra talents; free picks are free; granted
   * sphere access costs 0).
   * @param {Character} char @param {DataIndex} idx
   * @returns {{magic:number, martial:number}}
   */
  function slotsSpent(char, idx) {
    const granted = grantedSphereIds(char, idx);
    let magic = 0, martial = 0;
    for (const e of char.spheres || []) {
      const cost = (granted.has(e.sphere) ? 0 : 1) + (e.talents ? e.talents.length : 0);
      if (effectiveSection(char, e.sphere, idx) === 'martial') martial += cost; else magic += cost;
    }
    return { magic, martial };
  }

  /** @param {Character} char @param {DataIndex} idx @returns {Set<string>} */
  function accessedSphereIds(char, idx) {
    const set = new Set((char.spheres || []).map(e => e.sphere));
    for (const id of grantedSphereIds(char, idx)) set.add(id);
    return set;
  }

  /**
   * Talent ids the character owns: base abilities of every accessed sphere, all
   * chosen picks, and subclass-granted specific talents.
   * @param {Character} char @param {DataIndex} idx @returns {Set<string>}
   */
  function ownedTalentIds(char, idx) {
    /** @type {Set<string>} */ const set = new Set();
    for (const sid of accessedSphereIds(char, idx)) {
      const sph = idx.sphereById.get(sid);
      if (sph) for (const t of sph.talents) if (t.kind === 'base') set.add(t.id);
    }
    for (const e of char.spheres || []) {
      for (const id of e.freePicks || []) set.add(id);
      for (const id of e.talents || []) set.add(id);
    }
    for (const id of computeGrants(char, idx).specificTalents) set.add(id); // granted specific talents
    return set;
  }

  /**
   * Check a talent's prerequisites. Structured refs (talent/sphere/level) are
   * enforced; text refs are returned as unverified for manual confirmation.
   * @param {Character} char @param {Talent} talent @param {DataIndex} idx
   * @returns {PrereqResult}
   */
  function prereqCheck(char, talent, idx) {
    const owned = ownedTalentIds(char, idx);
    const accessed = accessedSphereIds(char, idx);
    /** @type {Prerequisite[]} */ const missing = [];
    /** @type {Prerequisite[]} */ const unverified = [];
    for (const p of talent.prerequisites || []) {
      if (p.type === 'level') { if ((char.level || 1) < (p.min || 1)) missing.push(p); }
      else if (p.type === 'sphere') { if (!p.id || !accessed.has(p.id)) missing.push(p); }
      else if (p.type === 'talent') { if (!p.id || !owned.has(p.id)) missing.push(p); }
      else unverified.push(p);
    }
    return { ok: missing.length === 0, missing, unverified };
  }

  /**
   * Can this talent be added as an extra (slot-costing) pick? Combines prereqs and
   * remaining budget. Blocks on unmet structured prereqs or exhausted budget.
   * @param {Character} char @param {Talent} talent @param {DataIndex} idx
   */
  function canAddTalent(char, talent, idx) {
    const prereq = prereqCheck(char, talent, idx);
    const section = effectiveSection(char, talent.sphere, idx);
    const remaining = bySection(talentBudget(char, idx), section) - bySection(slotsSpent(char, idx), section);
    const budgetOk = remaining >= 1;
    return { ok: prereq.ok && budgetOk, prereq, budgetOk, remaining, section };
  }

  /**
   * Can the character take access to this sphere? Free if granted; else costs a slot.
   * @param {Character} char @param {string} sphereId @param {DataIndex} idx
   */
  function canAccessSphere(char, sphereId, idx) {
    const sph = idx.sphereById.get(sphereId);
    if (!sph) return { ok: false, reason: 'unknown-sphere', granted: false, remaining: 0, section: /** @type {Section} */ ('magic') };
    const granted = grantedSphereIds(char, idx).has(sphereId);
    const section = effectiveSection(char, sphereId, idx);
    const remaining = bySection(talentBudget(char, idx), section) - bySection(slotsSpent(char, idx), section);
    return { ok: granted || remaining >= 1, granted, remaining, section, reason: '' };
  }

  return {
    indexData, classRow, derivedStats, traditionBonus, classFeatureBonus,
    talentBudget, computeGrants, grantedSphereIds, effectiveSection, slotsSpent,
    accessedSphereIds, ownedTalentIds, prereqCheck, canAddTalent, canAccessSphere,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
