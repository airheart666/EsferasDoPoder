/* chapters.js — segmentação do documento em capítulos (Esfera/seção)
   Usado tanto pela webapp (browser) quanto pelo script de divisão (Node) —
   mantém os dois lados usando exatamente os mesmos limites de capítulo.
*/

const Chapters = (() => {

  /* ============================================================
     CHAPTERS — segmentação do documento por Esfera/seção
     ============================================================ */
  function buildChapters(pages, tocTrees) {
    const labels = ['Esferas de Magia', 'Esferas de Poder'];
    const flatEntries = [];

    tocTrees.forEach((tree, ti) => {
      for (const root of tree) {
        flatEntries.push({ text: root.text, pageNum: pageNumOfAnchor(root.anchor), sectionLabel: labels[ti] || `Seção ${ti + 1}` });
        for (const child of root.children) {
          flatEntries.push({ text: child.text, pageNum: pageNumOfAnchor(child.anchor), sectionLabel: labels[ti] || `Seção ${ti + 1}` });
        }
      }
    });

    const entryByPage = new Map();
    flatEntries.forEach(e => { if (!entryByPage.has(e.pageNum)) entryByPage.set(e.pageNum, e); });

    const boundaries = new Set([1]);
    pages.forEach(p => {
      if (p.pageType !== 'content') boundaries.add(pageNumOfId(p.id));
    });
    entryByPage.forEach((_, pageNum) => boundaries.add(pageNum));

    const sorted = [...boundaries].sort((a, b) => a - b);
    const totalPages = pages.length;
    const coverTitles = { frontCover: 'Capa', insideCover: 'Divisória', backCover: 'Contracapa' };

    return sorted.map((start, i) => {
      const end = i + 1 < sorted.length ? sorted[i + 1] - 1 : totalPages;
      const entry = entryByPage.get(start);
      const page = pages[start - 1];
      let title, sectionLabel = null;

      if (entry) {
        title = entry.text;
        sectionLabel = entry.sectionLabel;
      } else if (page && page.pageType !== 'content') {
        title = coverTitles[page.pageType] || 'Divisória';
      } else {
        title = `Página ${start}`;
      }

      return { start, end, title, sectionLabel, anchor: `#p${start}` };
    });
  }

  function pageNumOfAnchor(anchor) { return parseInt(anchor.slice(2), 10); }
  function pageNumOfId(id) { return parseInt(id.slice(1), 10); }

  return { buildChapters, pageNumOfAnchor, pageNumOfId };

})();

if (typeof module !== 'undefined' && module.exports) module.exports = Chapters;
