// @ts-check
/**
 * Browser loader for the structured mechanics layer.
 *
 * Fetches the sphere manifest (data/spheres.json), every sphere file it lists,
 * and the migrated classes / class-features. Returns the raw collections for
 * Rules.indexData(). Same-origin fetch, no build step — works on GitHub Pages.
 *
 * Dual-mode like parser.js/rules.js: exposes a global for classic <script> loading
 * and module.exports for Node. In the browser, load this and src/rules.js with
 * plain <script> tags before app.js.
 *
 * @typedef {import('./types.js').Sphere} Sphere
 * @typedef {import('./types.js').ClassDef} ClassDef
 */

const DataLoader = (() => {
  'use strict';

  /**
   * @param {string} [base] path prefix to the data dir (default "data/")
   * @returns {Promise<{spheres: Sphere[], classes: Object<string,ClassDef>, classFeatures: Object<string,any>}>}
   */
  async function loadData(base) {
    const dir = base || 'data/';
    const getJson = (/** @type {string} */ p) => fetch(dir + p).then(r => {
      if (!r.ok) throw new Error(`failed to load ${dir + p}: ${r.status}`);
      return r.json();
    });

    /** @type {{id:string}[]} */
    const manifest = await getJson('spheres.json');
    const [spheres, classes, classFeatures] = await Promise.all([
      Promise.all(manifest.map(m => getJson('spheres/' + m.id + '.json'))),
      getJson('classes.json'),
      getJson('class-features.json'),
    ]);
    return { spheres, classes, classFeatures };
  }

  return { loadData };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DataLoader;
