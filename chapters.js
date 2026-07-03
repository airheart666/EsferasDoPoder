/* chapters.js — segmentação do documento em capítulos (Esfera/seção)
   Usado tanto pela webapp (browser) quanto pelo script de divisão (Node) —
   mantém os dois lados usando exatamente os mesmos limites de capítulo.
*/

const Chapters = (() => {

  /* ============================================================
     CHAPTERS — segmentação do documento por Esfera/seção
     ============================================================ */
  function buildChapters(pages, tocTrees) {
    const labels = ['Esferas de Magia', 'Esferas de Poder', 'Classes'];
    const flatEntries = [];
    // Não descer nos filhos do glossário (os termos são âncoras na página,
    // não capítulos). As classes recorrem (classe › subclasses/blocos).
    const GLOSS = 'Regras e Termos Relevantes';

    tocTrees.forEach((tree, ti) => {
      const label = labels[ti] || `Seção ${ti + 1}`;
      const walk = nodes => {
        for (const node of nodes) {
          // Nós de grupo (âncora #grp-…, sem página) não viram capítulo, mas
          // seus filhos (subclasses) sim.
          if (/^#p\d+$/.test(node.anchor)) {
            flatEntries.push({ text: node.text, pageNum: pageNumOfAnchor(node.anchor), sectionLabel: label });
          }
          if (node.children && node.children.length && node.text.trim() !== GLOSS) walk(node.children);
        }
      };
      walk(tree);
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
