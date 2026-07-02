/* app.js — inicialização, sidebar, busca, dark mode, navegação por capítulos */

let allPages = [];       // PageData[] completo, na ordem do documento
let chapters = [];       // { start, end, title, sectionLabel, anchor }[]
let tocTreesGlobal = []; // árvores do {{toc}}, reusadas pelo índice de capa
let cardDescriptions = {}; // descrições curadas dos cards (descriptions.json)
let currentChapterIndex = -1;
let activeObserver = null;

async function init() {
  setupDarkMode();

  try {
    const manifestRes = await fetch('manifest.json');
    if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status} ao carregar manifest.json`);
    const manifest = await manifestRes.json();

    const parts = await Promise.all(manifest.map(async p => {
      const res = await fetch(p);
      if (!res.ok) throw new Error(`HTTP ${res.status} ao carregar ${p}`);
      return res.text();
    }));
    const text = parts.join('');

    // Descrições curadas dos cards da capa (opcional; se faltar, cai para a
    // extração automática da 1ª frase de cada capítulo).
    try {
      const dRes = await fetch('descriptions.json');
      if (dRes.ok) cardDescriptions = await dRes.json();
    } catch (_) { /* mantém {} → fallback para extração */ }

    // Glossário curado extra (abreviações: PM, CD, MHC, MAC…). Opcional.
    try {
      const gRes = await fetch('glossary-extra.json');
      if (gRes.ok) glossaryExtra = await gRes.json();
    } catch (_) { /* mantém {} */ }

    // Condições de D&D 5e (enfeitiçado, amedrontado…). Opcional.
    try {
      const cRes = await fetch('conditions.json');
      if (cRes.ok) conditionsData = await cRes.json();
    } catch (_) { /* mantém {} */ }

    const { pages, tocTrees } = HBParser.parse(text);

    allPages = pages;
    tocTreesGlobal = tocTrees;
    chapters = Chapters.buildChapters(pages, tocTrees);
    reassignLeadInParagraphs();

    buildSidebar(tocTrees);
    buildGlossary(pages);
    buildSphereRefIndex(tocTrees);
    buildSearchIndex(pages);
    setupSearch();
    setupGlossary();
    setupHowto();
    setupMobileMenu();
    setupBackToTop();

    document.getElementById('content').addEventListener('click', handleInternalLinkClick);
    document.getElementById('toc-nav').addEventListener('click', handleInternalLinkClick);
    document.getElementById('home-link').addEventListener('click', handleInternalLinkClick);
    document.getElementById('home-link').href = chapters[0]?.anchor || '#p1';
    window.addEventListener('popstate', () => navigate(location.hash, { silent: true }));

    navigate(location.hash || chapters[0]?.anchor, { replace: true });

    document.getElementById('loading')?.remove();
  } catch (err) {
    const el = document.getElementById('loading');
    if (el) {
      el.textContent = `Erro ao carregar o arquivo: ${err.message}`;
      el.style.color = 'red';
    }
    console.error(err);
  }
}

/* ============================================================
   CHAPTERS — segmentação por Esfera/seção (lógica em chapters.js,
   compartilhada com scripts/split-source.js)
   ============================================================ */
const pageNumOfAnchor = Chapters.pageNumOfAnchor;
const pageNumOfId = Chapters.pageNumOfId;

/* ============================================================
   TEXTO INTRODUTÓRIO ÓRFÃO
   Parágrafos que abrem a primeira página de uma subseção (antes de
   qualquer heading) pertencem, na prática, à página de capa/divisória
   da seção — não à primeira subseção listada no TOC. Movemos esse
   trecho para o final do capítulo anterior quando ele termina em uma
   página de capa (frontCover/insideCover/backCover).
   ============================================================ */
function extractLeadIn(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  const firstHeading = container.querySelector('h1,h2,h3,h4,h5,h6');
  if (!firstHeading) return null;

  const leadContainer = document.createElement('div');
  let node = container.firstChild;
  while (node && node !== firstHeading) {
    const next = node.nextSibling;
    leadContainer.appendChild(node); // move: sai de `container`
    node = next;
  }

  if (!leadContainer.textContent.trim()) return null;
  return { leadHtml: leadContainer.innerHTML, restHtml: container.innerHTML };
}

function reassignLeadInParagraphs() {
  for (let i = 1; i < chapters.length; i++) {
    const prevChapter = chapters[i - 1];
    const prevLastPage = allPages[prevChapter.end - 1];
    if (!prevLastPage || prevLastPage.pageType === 'content') continue;

    const firstPage = allPages[chapters[i].start - 1];
    const split = extractLeadIn(firstPage.html);
    if (!split) continue;

    prevChapter.leadInHtml = split.leadHtml;
    firstPage.html = split.restHtml;
  }
}

function findChapterIndexForPage(pageNum) {
  const idx = chapters.findIndex(c => pageNum >= c.start && pageNum <= c.end);
  return idx === -1 ? 0 : idx;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   CONTROLADOR DE MODAIS (overlay de busca + bottom sheet do glossário)
   Abre/fecha com trava de scroll do fundo e gestão de foco.
   ============================================================ */
let openModalEl = null;
let lastFocusedBeforeModal = null;

function openModal(el, trigger) {
  if (openModalEl && openModalEl !== el) closeModal(openModalEl);
  lastFocusedBeforeModal = trigger || document.activeElement;
  el.hidden = false;
  void el.offsetWidth; // força reflow p/ a transição de entrada
  el.classList.add('open');
  document.body.classList.add('modal-open');
  openModalEl = el;
  const focusable = el.querySelector('input, button, a[href], [tabindex]');
  focusable?.focus();
}

function closeModal(el) {
  el.classList.remove('open');
  if (openModalEl === el) openModalEl = null;
  if (!document.querySelector('.modal.open')) document.body.classList.remove('modal-open');
  window.setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 250);
  if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
  lastFocusedBeforeModal = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && openModalEl) closeModal(openModalEl);
});

/* ============================================================
   GLOSSÁRIO INTERATIVO
   Extrai termo→definição dos capítulos "Regras e Termos Relevantes"
   e liga a 1ª ocorrência de cada termo no corpo do texto a um painel
   com a definição, sem tirar o leitor da página.
   ============================================================ */
const GLOSSARY_CHAPTER_TITLE = 'Regras e Termos Relevantes';
const PARAMS_CHAPTER_TITLE = 'Usando uma Esfera de Magia';
// Rótulos de parâmetro dos talentos (ficha) — também viram termos de glossário,
// mas NÃO entram no auto-link de prosa (são palavras comuns: custo, alcance, área…).
const PARAM_LABELS = ['Tempo de Conjuração', 'Alcance', 'Duração', 'Alvo', 'Área', 'Custo', 'Teste de Resistência', 'Pré-requisitos'];
const PARAM_LABELS_SET = new Set(PARAM_LABELS.map(s => normalizeTerm(s)));
const ENHANCEMENT_RE = /^Aprimoramento\s+\d+\s*pm$/i;
let glossary = new Map();   // normKey -> { key, term, defHtml, pageAnchor, slug, autolink }
let glossaryRegex = null;
let glossaryExtra = {};     // de glossary-extra.json (abreviações/curados)
let conditionsData = {};    // de conditions.json (condições 5e, com flexão de gênero/número)
let glossaryList = [];      // lista deduplicada p/ a página "Glossário completo" ({term, defHtml, pageAnchor?, slug?, category})

function defHtml(text) { return '<p>' + escapeHtml(text) + '</p>'; }

function normalizeTerm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ');
}

// Varre todas as páginas em ordem, marcando quando estamos dentro de uma
// seção "Regras e Termos Relevantes" (h2). Cada h3 sob essa seção é um termo.
// Feito por heading (não por capítulo) porque o glossário marcial vive
// dentro do capítulo "Esferas Marciais e Talentos Marciais", não em capítulo
// próprio. A 1ª definição de um termo vence (mágico antes de marcial).
function buildGlossary(pages) {
  glossary = new Map();
  glossaryList = [];
  const tmp = document.createElement('div');
  const GLOSS_KEY = normalizeTerm(GLOSSARY_CHAPTER_TITLE);
  const PARAMS_KEY = normalizeTerm(PARAMS_CHAPTER_TITLE);
  const paramKeys = new Set(PARAM_LABELS.map(normalizeTerm));
  let mode = null; // 'glossary' | 'params' | null

  for (const page of pages) {
    tmp.innerHTML = page.html;
    for (const el of tmp.children) {
      const tag = el.tagName;

      if (tag === 'H1' || tag === 'H2') {
        const k = normalizeTerm(el.textContent);
        mode = tag === 'H2' && k === GLOSS_KEY ? 'glossary'
             : tag === 'H2' && k === PARAMS_KEY ? 'params'
             : null;
        continue;
      }

      // Termos de "Regras e Termos Relevantes" (h3 → definição até o próximo heading)
      if (mode === 'glossary' && tag === 'H3') {
        const term = el.textContent.trim();
        if (!term) continue;
        const key = normalizeTerm(term);
        if (glossary.has(key)) continue;

        const defDiv = document.createElement('div');
        let node = el.nextSibling;
        while (node && !(node.nodeType === 1 && /^H[123]$/.test(node.tagName))) {
          defDiv.appendChild(node.cloneNode(true));
          node = node.nextSibling;
        }

        const rulesDef = defDiv.innerHTML.trim();
        glossary.set(key, {
          key, term,
          defHtml: rulesDef,
          pageAnchor: '#' + page.id,
          slug: el.id || null,
          autolink: true,
        });
        glossaryList.push({ term, defHtml: rulesDef, pageAnchor: '#' + page.id, slug: el.id || null, category: 'regra' });
      }

      // Parâmetros definidos em "Usando uma Esfera de Magia" (p com <strong>Label</strong>: def).
      // Ficam disponíveis para a ficha e o painel, mas NÃO entram no auto-link de prosa.
      if (mode === 'params' && tag === 'P') {
        const strong = el.querySelector(':scope > strong');
        if (!strong) continue;
        const label = strong.textContent.replace(/:\s*$/, '').trim();
        const key = normalizeTerm(label);
        if (!paramKeys.has(key) || glossary.has(key)) continue;
        const def = el.textContent.slice(strong.textContent.length).replace(/^[:\s]+/, '').trim();
        if (!def) continue;
        glossary.set(key, {
          key, term: label, defHtml: defHtml(def),
          pageAnchor: '#' + page.id, slug: null, autolink: false,
        });
        glossaryList.push({ term: label, defHtml: defHtml(def), pageAnchor: '#' + page.id, category: 'parametro' });
      }
    }
  }

  // Mescla glossary-extra.json (abreviações/curados). Não sobrescreve o que já
  // veio do conteúdo. "PM" fica fora do auto-link de prosa (curto/ambíguo).
  for (const [term, def] of Object.entries(glossaryExtra)) {
    const key = normalizeTerm(term);
    if (glossary.has(key)) continue;
    glossary.set(key, { key, term, defHtml: defHtml(def), pageAnchor: null, slug: null, autolink: key !== 'pm' });
    glossaryList.push({ term, defHtml: defHtml(def), category: 'abreviacao' });
  }

  // Condições de D&D 5e: cada condição vira várias entradas (uma por forma de
  // gênero/número), pois no texto aparecem flexionadas ("a criatura fica cega").
  // exact:true → o regex casa a forma literal (sem sufixo extra de plural).
  for (const [canonical, def] of Object.entries(conditionsData)) {
    const html = defHtml(def);
    for (const form of conditionForms(canonical)) {
      const key = normalizeTerm(form);
      if (glossary.has(key)) continue;
      glossary.set(key, { key, term: form, defHtml: html, pageAnchor: null, slug: null, autolink: true, exact: true });
    }
    glossaryList.push({ term: canonical.charAt(0).toUpperCase() + canonical.slice(1), defHtml: html, category: 'condicao' });
  }

  buildGlossaryRegex();
}

// Gera as formas de gênero/número de uma condição (canônico masc. sing.).
function conditionForms(word) {
  if (/[oa]$/.test(word)) { const s = word.slice(0, -1); return [s + 'o', s + 'a', s + 'os', s + 'as']; }
  if (/l$/.test(word))   { const s = word.slice(0, -1); return [s + 'l', s + 'is']; } // invisível/invisíveis
  if (/e$/.test(word))   return [word, word + 's'];
  return [word, word + 's', word + 'es'];
}

function buildGlossaryRegex() {
  const entries = [...glossary.values()].filter(e => e.autolink !== false).sort((a, b) => b.term.length - a.term.length);
  if (entries.length === 0) { glossaryRegex = null; return; }
  const parts = entries.map(e => {
    const esc = escapeRegex(e.term);
    if (e.exact || /\s/.test(e.term)) return esc; // formas de condição / termos multipalavra: literal
    return esc + 's?';                            // palavra única: casa plural simples
  });
  try {
    glossaryRegex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  } catch (_) {
    // Fallback p/ engines sem lookbehind: sem fronteira à esquerda
    glossaryRegex = new RegExp(`(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  }
}

// Liga os termos do glossário no corpo do capítulo. O escopo de "1ª ocorrência
// de cada termo" é POR TALENTO (.talent-card) — cada talento é uma unidade de
// leitura, então uma condição citada dentro dele vira gatilho ali mesmo,
// independentemente de já ter aparecido em outro talento. O conteúdo fora dos
// cards (descrição da esfera) é um escopo próprio por seção.
function linkGlossaryTerms(root, chapter) {
  if (!glossaryRegex || glossary.size === 0) return;
  if (chapter && chapter.title === GLOSSARY_CHAPTER_TITLE) return;

  const scopes = [];
  root.querySelectorAll('.talent-card').forEach(card => scopes.push([card, false]));
  root.querySelectorAll('section[id]').forEach(sec => scopes.push([sec, true]));

  for (const [el, skipCards] of scopes) {
    const used = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        let sel = 'h1,h2,h3,h4,h5,h6,a,button,.glossary-term,.stat-name,.stat-section-title,.talent-params';
        if (skipCards) sel += ',.talent-card'; // conteúdo do card já foi tratado no escopo dele
        if (p.closest(sel)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const textNode of nodes) wrapTermsInNode(textNode, used);
  }
}

function wrapTermsInNode(textNode, used) {
  const text = textNode.textContent;
  glossaryRegex.lastIndex = 0;
  let m, last = 0, frag = null;

  while ((m = glossaryRegex.exec(text)) !== null) {
    const matched = m[0];
    let entry = glossary.get(normalizeTerm(matched));
    if (!entry) entry = glossary.get(normalizeTerm(matched.replace(/s$/i, '')));
    if (!entry || used.has(entry.key)) continue;
    used.add(entry.key);

    if (!frag) frag = document.createDocumentFragment();
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'glossary-term';
    btn.dataset.term = entry.key;
    btn.textContent = matched;
    frag.appendChild(btn);

    last = m.index + matched.length;
  }

  if (frag) {
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

function setupGlossary() {
  const sheet = document.getElementById('glossary-sheet');
  const nameEl = document.getElementById('glossary-term-name');
  const defEl = document.getElementById('glossary-def');
  const moreEl = document.getElementById('glossary-more');
  const closeBtn = document.getElementById('glossary-close');
  let currentEntry = null;

  document.getElementById('content').addEventListener('click', e => {
    const btn = e.target.closest('.glossary-term');
    if (!btn) return;
    const entry = glossary.get(btn.dataset.term);
    if (!entry) return;
    currentEntry = entry;
    nameEl.textContent = entry.term;
    defEl.innerHTML = entry.defHtml || '<p>(definição não encontrada)</p>';
    moreEl.hidden = !entry.pageAnchor; // termos curados/abreviações não têm página
    openModal(sheet, btn);
  });

  moreEl.addEventListener('click', e => {
    e.preventDefault();
    if (!currentEntry) return;
    const entry = currentEntry;
    closeModal(sheet);
    navigate(entry.pageAnchor);
    if (entry.slug) {
      requestAnimationFrame(() => {
        document.getElementById(entry.slug)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  });

  closeBtn.addEventListener('click', () => closeModal(sheet));
  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(sheet); });
}

/* ============================================================
   GUIA "COMO LER UMA ESFERA"
   ============================================================ */
function openHowto(trigger) {
  const sheet = document.getElementById('howto-sheet');
  if (sheet) openModal(sheet, trigger);
}

function setupHowto() {
  const sheet = document.getElementById('howto-sheet');
  if (!sheet) return;
  document.getElementById('howto-close').addEventListener('click', () => closeModal(sheet));
  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(sheet); });
  // gatilho no onboarding da capa (delegação)
  document.getElementById('content').addEventListener('click', e => {
    const t = e.target.closest('.howto-link');
    if (t) { e.preventDefault(); openHowto(t); }
  });
}

/* ============================================================
   ÍNDICE DE CAPA
   A página de capa não leva a apenas um dos dois "caminhos" do
   livro — monta duas colunas (Esferas de Magia / Esferas de Poder)
   com uma descrição curta e o índice de capítulos de cada seção,
   a partir das mesmas tocTrees usadas pela sidebar.
   ============================================================ */
const SECTION_DESCRIPTIONS = {
  'Esferas de Magia': 'Um sistema de magia alternativo para D&D 5ª edição, baseado em Esferas temáticas de habilidades e Pontos de Magia, no lugar de magias e espaços de magia tradicionais.',
  'Esferas de Poder': 'Um suplemento de combate para D&D 5ª edição: expande o que personagens marciais podem fazer, combinando esferas e talentos marciais em vez de ficar preso a uma única classe.',
};

function findChapterAnchorByTitle(title) {
  const c = chapters.find(ch => ch.title === title);
  return c ? c.anchor : null;
}

// Descrição de um card: usa a versão curada de descriptions.json (por título)
// quando existe; senão, cai para a extração automática do conteúdo.
function cardDescription(child) {
  return cardDescriptions[child.text] || chapterShortDescription(child.anchor);
}

// Descrição temática curta de um capítulo, extraída automaticamente da 1ª
// frase do primeiro parágrafo do próprio conteúdo (fallback de cardDescription).
function chapterShortDescription(anchor, maxLen = 110) {
  const chapterIdx = findChapterIndexForPage(pageNumOfAnchor(anchor));
  const chapter = chapters[chapterIdx];
  if (!chapter) return '';
  const tmp = document.createElement('div');
  for (let pn = chapter.start; pn <= chapter.end; pn++) {
    tmp.innerHTML = allPages[pn - 1]?.html || '';
    const p = tmp.querySelector('p');
    if (p && p.textContent.trim()) {
      let s = p.textContent.trim().replace(/\s+/g, ' ');
      const dot = s.indexOf('. ');
      if (dot >= 30 && dot <= maxLen + 25) s = s.slice(0, dot + 1);
      if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
      return s;
    }
  }
  return '';
}

// Callout de boas-vindas na capa, apontando o passo a passo inicial.
function buildOnboarding() {
  const box = document.createElement('div');
  box.className = 'onboarding';
  const introAnchor = findChapterAnchorByTitle('Usando uma Esfera de Magia') || '#p4';
  box.innerHTML =
    '<h2 class="onboarding-title">Novo por aqui? Comece assim</h2>' +
    '<ol class="onboarding-steps">' +
      `<li>Entenda o básico em <a href="${introAnchor}">Usando uma Esfera de Magia</a> — o que são Esferas, Pontos de Magia e Talentos.</li>` +
      '<li>Escolha um caminho abaixo: <strong>Esferas de Magia</strong> (conjuração) ou <strong>Esferas de Poder</strong> (combate marcial).</li>' +
      '<li>Explore as esferas pelos cartões — cada um descreve o que a esfera faz. No texto, toque nos termos <em>destacados</em> para ver a definição sem sair da página.</li>' +
    '</ol>' +
    '<p class="onboarding-help">Primeira vez lendo uma esfera? <a href="#" class="howto-link">Como ler uma esfera →</a></p>' +
    '<p class="onboarding-help"><a href="#glossario" class="glossary-link">📖 Abrir o glossário completo →</a></p>';
  return box;
}

function buildCoverIndex(tocTrees) {
  const wrap = document.createElement('div');
  wrap.className = 'cover-index';

  for (const tree of tocTrees) {
    const root = tree[0];
    if (!root) continue;

    const col = document.createElement('div');
    col.className = 'cover-index-col';

    const heading = document.createElement('h2');
    const headingLink = document.createElement('a');
    headingLink.href = root.anchor;
    headingLink.textContent = root.text;
    heading.appendChild(headingLink);
    col.appendChild(heading);

    const desc = SECTION_DESCRIPTIONS[root.text.trim()];
    if (desc) {
      const p = document.createElement('p');
      p.className = 'cover-index-desc';
      p.textContent = desc;
      col.appendChild(p);
    }

    const grid = document.createElement('div');
    grid.className = 'sphere-card-grid';
    for (const child of root.children) {
      const card = document.createElement('a');
      card.href = child.anchor;
      card.className = 'sphere-card';

      const name = document.createElement('span');
      name.className = 'sphere-card-name';
      name.textContent = child.text;
      card.appendChild(name);

      const cd = cardDescription(child);
      if (cd) {
        const d = document.createElement('span');
        d.className = 'sphere-card-desc';
        d.textContent = cd;
        card.appendChild(d);
      }

      grid.appendChild(card);
    }
    col.appendChild(grid);

    wrap.appendChild(col);
  }

  return wrap;
}

/* ============================================================
   "NESTA PÁGINA" — mini-índice das seções do capítulo atual
   Colapsável, amigável a toque; evita uma coluna lateral que não
   caberia no celular. Só aparece em capítulos com >= 3 seções.
   ============================================================ */
function buildOnThisPage(sourceFrag, isSphere) {
  // h2 = esfera, h3 = agrupamento de talentos, h4 = talento/habilidade individual.
  const heads = [...sourceFrag.querySelectorAll('section[id] h2, section[id] h3, section[id] h4')]
    .filter(h => h.id && h.textContent.trim());
  if (heads.length < 3) return null;

  const details = document.createElement('details');
  details.className = 'on-this-page';
  details.open = window.matchMedia('(min-width: 769px)').matches;

  const summary = document.createElement('summary');
  const summaryLabel = document.createElement('span');
  summaryLabel.textContent = 'Nesta página';
  summary.appendChild(summaryLabel);
  if (isSphere) {
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'howto-trigger';
    help.textContent = 'Como ler?';
    // impede que o clique no botão alterne o <details>
    help.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openHowto(help); });
    summary.appendChild(help);
  }
  details.appendChild(summary);

  // Filtro de talentos (finder rápido nas esferas com dezenas de talentos)
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.className = 'otp-filter';
  filter.placeholder = 'Filtrar talentos…';
  filter.setAttribute('aria-label', 'Filtrar itens desta página');
  filter.addEventListener('click', e => e.stopPropagation());
  details.appendChild(filter);

  const ul = document.createElement('ul');
  const usedIds = new Set();
  for (const h of heads) {
    // Talentos com nomes repetidos (ou esfera base = nome da esfera) geram o
    // mesmo slug. Torna o id único e reatribui ao heading para que cada item
    // do índice role até a sua própria ocorrência.
    let id = h.id;
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
      h.id = id;
    }
    usedIds.add(id);

    const li = document.createElement('li');
    li.className = 'otp-' + h.tagName.toLowerCase();
    const a = document.createElement('a');
    a.href = '#' + id;
    a.className = 'otp-link';
    a.textContent = h.textContent.trim();
    li.appendChild(a);
    ul.appendChild(li);
  }
  details.appendChild(ul);

  filter.addEventListener('input', () => {
    const q = normalizeTerm(filter.value);
    for (const li of ul.children) {
      li.hidden = q && !normalizeTerm(li.textContent).includes(q);
    }
  });

  return details;
}

/* ============================================================
   SCROLL-SPY do mini-índice ("Nesta página")
   Destaca o item correspondente ao heading atualmente visível.
   ============================================================ */
let miniTocObserver = null;

function setupMiniTocSpy() {
  if (miniTocObserver) { miniTocObserver.disconnect(); miniTocObserver = null; }
  const otp = document.querySelector('#content .on-this-page');
  if (!otp) return;

  const links = new Map(); // id -> .otp-link
  otp.querySelectorAll('.otp-link').forEach(a => links.set(a.getAttribute('href').slice(1), a));
  const targets = [...links.keys()].map(id => document.getElementById(id)).filter(Boolean);
  if (targets.length === 0) return;

  const ul = otp.querySelector('ul');

  miniTocObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const link = links.get(entry.target.id);
      if (!link) continue;
      otp.querySelectorAll('.otp-link.active').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
      // Mantém o item visível SÓ dentro da lista do índice (via scrollTop),
      // nunca movendo a janela — usar scrollIntoView aqui puxaria a página
      // de volta ao topo quando o índice já saiu da viewport.
      if (ul && otp.open) {
        const u = ul.getBoundingClientRect();
        const l = link.getBoundingClientRect();
        if (l.top < u.top) ul.scrollTop -= (u.top - l.top);
        else if (l.bottom > u.bottom) ul.scrollTop += (l.bottom - u.bottom);
      }
    }
  }, { rootMargin: '-15% 0px -80% 0px', threshold: 0 });

  targets.forEach(t => miniTocObserver.observe(t));
}

/* ============================================================
   TALENTOS ESCANEÁVEIS
   Agrupa as linhas de parâmetro numa ficha (dl), destaca os
   aprimoramentos e distingue habilidade base de talento. Opera sobre
   o sectionsFrag antes de entrar no DOM. Não toca no parser/conteúdo.
   ============================================================ */
function glossaryTriggerButton(label, key) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'glossary-term';
  btn.dataset.term = key;
  btn.textContent = label;
  return btn;
}

// Envolve tokens de custo "X PM" / "XPM" em gatilhos de glossário para "PM".
function wrapPmTokens(container) {
  if (!glossary.has('pm')) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!/\d\s*pm/i.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement && node.parentElement.closest('a,button,.glossary-term')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = []; let n;
  while ((n = walker.nextNode())) nodes.push(n);
  const re = /\b\d+\s*pm\b/gi;
  for (const textNode of nodes) {
    const text = textNode.textContent;
    re.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = re.exec(text)) !== null) {
      if (!frag) frag = document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(glossaryTriggerButton(m[0], 'pm'));
      last = m.index + m[0].length;
    }
    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
}

// Um <p> é uma linha de parâmetro se começa com <strong>Rótulo</strong> onde
// Rótulo ∈ PARAM_LABELS. Retorna { label, value } ou null.
function paramFromParagraph(el) {
  if (!el || el.tagName !== 'P') return null;
  const first = el.firstChild;
  if (!first || first.nodeName !== 'STRONG') return null;
  const label = first.textContent.replace(/:\s*$/, '').trim();
  if (!PARAM_LABELS_SET.has(normalizeTerm(label))) return null;
  const value = el.textContent.slice(first.textContent.length).replace(/^[:\s]+/, '').trim();
  return { label, value };
}

function enhanceTalents(root) {
  const sections = root.querySelectorAll('section[id]');

  // 0. Realça o parágrafo introdutório da esfera (1º <p> do capítulo).
  const introP = sections[0] && sections[0].querySelector(':scope > p');
  if (introP) introP.classList.add('sphere-intro');

  for (const section of sections) {
    // 1. Agrupa parágrafos de parâmetro consecutivos numa ficha <dl>.
    let child = section.firstElementChild;
    while (child) {
      if (!paramFromParagraph(child)) { child = child.nextElementSibling; continue; }

      const dl = document.createElement('dl');
      dl.className = 'talent-params';
      let cursor = child;
      let param;
      while (cursor && (param = paramFromParagraph(cursor))) {
        const dt = document.createElement('dt');
        const key = normalizeTerm(param.label);
        if (glossary.has(key)) dt.appendChild(glossaryTriggerButton(param.label, key));
        else dt.textContent = param.label;

        const dd = document.createElement('dd');
        dd.textContent = param.value;
        wrapPmTokens(dd);

        if (key === 'pre-requisitos') { dt.classList.add('param-prereq'); dd.classList.add('param-prereq'); }

        dl.appendChild(dt);
        dl.appendChild(dd);

        const next = cursor.nextElementSibling;
        cursor.remove();
        cursor = next;
      }
      section.insertBefore(dl, cursor);
      child = cursor;
    }

    // 2. Realça os aprimoramentos e liga o custo ao glossário.
    for (const p of [...section.children]) {
      if (p.tagName !== 'P') continue;
      const strong = p.firstChild;
      if (!strong || strong.nodeName !== 'STRONG') continue;
      if (!ENHANCEMENT_RE.test(strong.textContent.trim())) continue;
      p.classList.add('enhancement');
      strong.classList.add('enhancement-label');
      wrapPmTokens(strong);
    }
  }

  // 3. Habilidades base = h4 antes do 1º h3 do capítulo.
  let seenH3 = false;
  for (const section of sections) {
    for (const el of section.children) {
      if (el.tagName === 'H3') seenH3 = true;
      else if (el.tagName === 'H4' && !seenH3) el.classList.add('base-ability');
    }
  }

  // 4. Encaixota cada talento (h4 + conteúdo até o próximo h2/h3/h4) num
  //    .talent-card, dentro da própria <section> (mantém ids/âncoras).
  let currentGroup = '';
  for (const section of sections) {
    let child = section.firstElementChild;
    while (child) {
      const tag = child.tagName;
      if (tag === 'H2') { currentGroup = ''; child = child.nextElementSibling; continue; }
      if (tag === 'H3') { currentGroup = child.textContent || ''; child = child.nextElementSibling; continue; }
      if (tag !== 'H4') { child = child.nextElementSibling; continue; }

      const h4 = child;
      const move = [];
      let cursor = h4;
      while (cursor && !(cursor !== h4 && /^H[234]$/.test(cursor.tagName))) {
        move.push(cursor);
        cursor = cursor.nextElementSibling;
      }
      const card = document.createElement('div');
      card.className = 'talent-card';
      section.insertBefore(card, cursor);
      move.forEach(node => card.appendChild(node));
      if (/avan[çc]ad|lend[áa]ri/i.test(currentGroup)) card.classList.add('advanced');
      decorateCard(card, h4);
      child = cursor;
    }
  }
}

/* ============================================================
   NOTAÇÃO MECÂNICA — realça dados (1d6) e CD (CD 15) para escanear.
   Roda por último; skip-list evita mexer no que já foi processado.
   ============================================================ */
const MECH_RE = /\b\d+d\d+\b|\bCD\s?\d+\b/gi;

function highlightMechanics(root) {
  for (const section of root.querySelectorAll('section[id]')) {
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/\dd\d|CD\s?\d/i.test(node.textContent)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('h1,h2,h3,h4,h5,h6,a,button,.glossary-term,.dice,.dc')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = []; let n;
    while ((n = walker.nextNode())) nodes.push(n);

    for (const textNode of nodes) {
      const text = textNode.textContent;
      MECH_RE.lastIndex = 0;
      let m, last = 0, frag = null;
      while ((m = MECH_RE.exec(text)) !== null) {
        if (!frag) frag = document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = /^cd/i.test(m[0]) ? 'dc' : 'dice';
        span.textContent = m[0];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (frag) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }
}

// Fila de tags de relance no topo do card, derivadas da ficha (dl.talent-params).
function decorateCard(card, h4) {
  const dl = card.querySelector('dl.talent-params');
  const info = {};
  if (dl) {
    dl.querySelectorAll('dt').forEach(dt => {
      const dd = dt.nextElementSibling;
      info[normalizeTerm(dt.textContent)] = dd ? dd.textContent.trim() : '';
    });
  }
  const tags = [];
  const cap = s => (s.length > 22 ? s.slice(0, 21) + '…' : s);

  if ('pre-requisitos' in info) card.classList.add('advanced');
  if (card.classList.contains('advanced')) tags.push({ t: 'Avançado', cls: 'tag-adv' });

  const custo = info['custo'];
  if (custo && custo !== '—' && custo !== '-') tags.push({ t: cap(custo), cls: 'tag-cost' });
  const acao = info['tempo de conjuracao'];
  if (acao) tags.push({ t: cap(acao), cls: 'tag-action' });
  if (info['duracao'] && /concentra/i.test(info['duracao'])) tags.push({ t: 'Concentração', cls: 'tag-conc' });
  if ('area' in info) tags.push({ t: 'Área', cls: 'tag-area' });

  if (tags.length === 0) return;
  const row = document.createElement('div');
  row.className = 'talent-tags';
  for (const tag of tags) {
    const chip = document.createElement('span');
    chip.className = 'talent-tag ' + tag.cls;
    chip.textContent = tag.t;
    row.appendChild(chip);
  }
  h4.insertAdjacentElement('afterend', row);
}

/* ============================================================
   LINKS ENTRE ESFERAS
   Liga nomes de esfera citados no texto (só no padrão seguro
   "esfera(s) de/da/do X") para evitar falsos positivos com palavras
   comuns (luz, vida, tempo…).
   ============================================================ */
let sphereRefMap = null;   // normName -> anchor
let sphereRefRegex = null;

function buildSphereRefIndex(tocTrees) {
  sphereRefMap = new Map();
  const skip = new Set([PARAMS_CHAPTER_TITLE, GLOSSARY_CHAPTER_TITLE, 'Esferas Marciais e Talentos Marciais'].map(normalizeTerm));
  for (const tree of tocTrees) {
    for (const root of tree) {
      for (const child of root.children) {
        const key = normalizeTerm(child.text);
        if (skip.has(key) || sphereRefMap.has(key)) continue;
        sphereRefMap.set(key, child.anchor);
      }
    }
  }
  const names = [...sphereRefMap.keys()].map(k => k).sort((a, b) => b.length - a.length);
  // reconstrói os nomes originais para o regex (com acentos/caixa)
  const original = [];
  for (const tree of tocTrees) for (const root of tree) for (const child of root.children) {
    if (sphereRefMap.has(normalizeTerm(child.text))) original.push(child.text);
  }
  original.sort((a, b) => b.length - a.length);
  const parts = original.map(escapeRegex);
  try {
    sphereRefRegex = new RegExp(`(esferas?\\s+d[aeo]s?\\s+)(${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  } catch (_) {
    sphereRefRegex = new RegExp(`(esferas?\\s+d[aeo]s?\\s+)(${parts.join('|')})`, 'gi');
  }
}

function linkSphereCrossRefs(root, chapter) {
  if (!sphereRefRegex || !sphereRefMap) return;
  const currentAnchor = chapter ? chapter.anchor : null;

  for (const section of root.querySelectorAll('section[id]')) {
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/esfera/i.test(node.textContent)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('h1,h2,h3,h4,h5,h6,a,button,.glossary-term,.talent-params,.stat-name,.stat-section-title')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = []; let n;
    while ((n = walker.nextNode())) nodes.push(n);

    for (const textNode of nodes) {
      const text = textNode.textContent;
      sphereRefRegex.lastIndex = 0;
      let m, last = 0, frag = null;
      while ((m = sphereRefRegex.exec(text)) !== null) {
        const anchor = sphereRefMap.get(normalizeTerm(m[2]));
        if (!anchor || anchor === currentAnchor) continue; // não linka a própria esfera
        if (!frag) frag = document.createDocumentFragment();
        const start = m.index;
        if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
        frag.appendChild(document.createTextNode(m[1])); // "esfera da "
        const a = document.createElement('a');
        a.className = 'sphere-xref';
        a.href = anchor;
        a.textContent = m[2];
        frag.appendChild(a);
        last = start + m[0].length;
      }
      if (frag) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
      }
    }
  }
}

/* ============================================================
   RENDER CHAPTER
   ============================================================ */
function renderChapter(index) {
  index = Math.max(0, Math.min(index, chapters.length - 1));
  currentChapterIndex = index;
  const chapter = chapters[index];
  const isCover = allPages[chapter.start - 1]?.pageType === 'frontCover';

  const content = document.getElementById('content');
  content.innerHTML = '';
  const frag = document.createDocumentFragment();

  if (chapter.sectionLabel) {
    const crumb = document.createElement('div');
    crumb.className = 'chapter-breadcrumb';
    crumb.textContent = chapter.sectionLabel;
    frag.appendChild(crumb);
  }

  // Seções em um sub-fragment para extrair headings (mini-índice) e ligar
  // os termos do glossário antes de inserir no DOM.
  const sectionsFrag = document.createDocumentFragment();
  for (let pn = chapter.start; pn <= chapter.end; pn++) {
    const page = allPages[pn - 1];
    const section = document.createElement('section');
    section.id = page.id;
    section.innerHTML = page.html;
    sectionsFrag.appendChild(section);
  }
  // Post-processos de compreensão (ordem importa: cada um pula o que o outro
  // já marcou). Só nas esferas para a ficha/aprimoramentos/base.
  const isSphere = !isCover && chapter.title !== PARAMS_CHAPTER_TITLE && chapter.title !== GLOSSARY_CHAPTER_TITLE;
  if (isSphere) enhanceTalents(sectionsFrag);
  linkSphereCrossRefs(sectionsFrag, chapter);
  linkGlossaryTerms(sectionsFrag, chapter);
  highlightMechanics(sectionsFrag);

  if (isCover) {
    frag.appendChild(sectionsFrag);
    if (tocTreesGlobal.length > 0) {
      frag.appendChild(buildOnboarding());
      frag.appendChild(buildCoverIndex(tocTreesGlobal));
    }
  } else {
    const miniToc = buildOnThisPage(sectionsFrag, isSphere);
    if (miniToc) frag.appendChild(miniToc);
    frag.appendChild(sectionsFrag);
  }

  if (chapter.leadInHtml) {
    const leadIn = document.createElement('div');
    leadIn.className = 'chapter-lead-in';
    leadIn.innerHTML = chapter.leadInHtml;
    frag.appendChild(leadIn);
  }

  const nav = document.createElement('nav');
  nav.className = 'chapter-nav';
  const prev = chapters[index - 1];
  const next = chapters[index + 1];
  nav.innerHTML = `
    ${prev ? `<a class="chapter-nav-btn prev" href="${prev.anchor}"><span>← Anterior</span>${escapeHtml(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="chapter-nav-btn next" href="${next.anchor}"><span>Próximo →</span>${escapeHtml(next.title)}</a>` : '<span></span>'}
  `;
  frag.appendChild(nav);

  applySectionTheme(content, chapter.sectionLabel);
  content.appendChild(frag);
  applyStagger(content);

  document.getElementById('top-title').textContent = chapter.title;
  document.title = `${chapter.title} — Esferas de Magia e Poder`;

  setupObserver();
  setupMiniTocSpy();
  updateActiveSidebarLink(chapter.anchor);
}

/* Tema de seção (accent Magia=oxblood / Marcial=verdete) + carregamento
   escalonado dos blocos de topo (revelação "sangria de tinta"). */
function applySectionTheme(content, sectionLabel) {
  const sec = sectionLabel === 'Esferas de Poder' ? 'martial'
            : sectionLabel === 'Esferas de Magia' ? 'magic' : '';
  if (sec) content.dataset.section = sec; else content.removeAttribute('data-section');
}

function applyStagger(content) {
  let i = 0;
  for (const el of content.children) {
    el.classList.add('reveal');
    el.style.setProperty('--i', Math.min(i, 6));
    i++;
  }
}

/* ============================================================
   PÁGINA "GLOSSÁRIO COMPLETO"
   Reúne, num só lugar, todos os termos que o app conhece
   (condições, termos de regra, parâmetros e abreviações).
   ============================================================ */
const GLOSSARY_CATEGORIES = [
  ['condicao',   'Condições'],
  ['regra',      'Termos e Regras'],
  ['parametro',  'Parâmetros de habilidade'],
  ['abreviacao', 'Abreviações'],
];

function renderGlossary() {
  currentChapterIndex = -1;
  const content = document.getElementById('content');
  content.innerHTML = '';
  const frag = document.createDocumentFragment();

  const h1 = document.createElement('h1');
  h1.textContent = 'Glossário';
  frag.appendChild(h1);

  const intro = document.createElement('p');
  intro.className = 'glossary-intro';
  intro.textContent = 'Todos os termos, condições e abreviações usados no material. Onde houver, use “ver no texto” para ir direto ao trecho das regras.';
  frag.appendChild(intro);

  for (const [cat, label] of GLOSSARY_CATEGORIES) {
    const items = glossaryList
      .filter(e => e.category === cat)
      .sort((a, b) => a.term.localeCompare(b.term, 'pt', { sensitivity: 'base' }));
    if (items.length === 0) continue;

    const h2 = document.createElement('h2');
    h2.textContent = label;
    frag.appendChild(h2);

    const dl = document.createElement('dl');
    dl.className = 'glossary-list';
    for (const e of items) {
      const dt = document.createElement('dt');
      const name = document.createElement('span');
      name.className = 'glossary-name';
      name.textContent = e.term;
      dt.appendChild(name);
      if (e.pageAnchor) {
        const see = document.createElement('a');
        see.className = 'glossary-see';
        see.href = e.pageAnchor;
        if (e.slug) see.dataset.slug = e.slug;
        see.textContent = 'ver no texto →';
        dt.appendChild(see);
      }
      const dd = document.createElement('dd');
      dd.innerHTML = e.defHtml;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    frag.appendChild(dl);
  }

  content.removeAttribute('data-section');
  content.appendChild(frag);
  applyStagger(content);
  document.getElementById('top-title').textContent = 'Glossário';
  document.title = 'Glossário — Esferas de Magia e Poder';
  setupObserver();
  updateActiveSidebarLink('#glossario');
  window.scrollTo(0, 0);
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function navigate(hash, opts = {}) {
  if (hash === '#glossario') {
    renderGlossary();
    if (!opts.silent) {
      if (opts.replace) history.replaceState(null, '', hash);
      else if (location.hash !== hash) history.pushState(null, '', hash);
    }
    return;
  }

  if (!hash || !/^#p\d+$/.test(hash)) hash = chapters[0]?.anchor;
  if (!hash) return;

  const pageNum = pageNumOfAnchor(hash);
  const idx = findChapterIndexForPage(pageNum);
  const chapter = chapters[idx];
  const isNewChapter = idx !== currentChapterIndex;

  if (isNewChapter) renderChapter(idx);

  if (pageNum !== chapter.start) {
    document.getElementById('p' + pageNum)?.scrollIntoView({ behavior: isNewChapter ? 'auto' : 'smooth', block: 'start' });
  } else if (isNewChapter) {
    window.scrollTo(0, 0);
  }

  if (!opts.silent) {
    if (opts.replace) history.replaceState(null, '', hash);
    else if (location.hash !== hash) history.pushState(null, '', hash);
  }
}

function handleInternalLinkClick(e) {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const href = a.getAttribute('href');

  // Página do glossário completo
  if (href === '#glossario') {
    e.preventDefault();
    navigate('#glossario');
    return;
  }

  // Âncora de página/capítulo (#pN) → navegação por capítulo
  if (/^#p\d+$/.test(href)) {
    e.preventDefault();
    const li = a.closest('li.toc-has-children');
    if (li) li.classList.toggle('toc-collapsed');
    navigate(href);
    const slug = a.dataset.slug; // "ver no texto" do glossário: rola até o termo
    if (slug) requestAnimationFrame(() => document.getElementById(slug)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return;
  }

  // Âncora interna para um heading do capítulo atual (ex. mini-índice
  // "Nesta página") → rola sem mexer no histórico.
  if (href.length > 1) {
    const target = document.getElementById(href.slice(1));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
}

/* ============================================================
   SIDEBAR
   Espelha a hierarquia real do {{toc}} (### raiz da seção, ####
   subseções/Esferas, ##### termos de glossário), com tipografia
   por nível e "líder pontilhado + página" no estilo de um índice
   de livro impresso (referência: TOC renderizado no Homebrewery).
   ============================================================ */
function buildSidebar(tocTrees) {
  const nav = document.getElementById('toc-nav');
  if (!tocTrees || tocTrees.length === 0) return;

  const frag = document.createDocumentFragment();

  const homeLink = document.createElement('a');
  homeLink.href = chapters[0]?.anchor || '#p1';
  homeLink.className = 'toc-link toc-home';
  homeLink.textContent = '⌂ Início';
  frag.appendChild(homeLink);

  const glossaryLink = document.createElement('a');
  glossaryLink.href = '#glossario';
  glossaryLink.className = 'toc-link toc-home';
  glossaryLink.textContent = '📖 Glossário';
  frag.appendChild(glossaryLink);

  frag.appendChild(document.createElement('hr'));

  tocTrees.forEach((tree, i) => {
    const list = buildTocList(tree);
    // 0 = Esferas de Magia (oxblood), 1 = Esferas de Poder (verdete)
    list.dataset.section = i === 1 ? 'martial' : 'magic';
    frag.appendChild(list);
    if (i < tocTrees.length - 1) {
      frag.appendChild(document.createElement('hr'));
    }
  });

  nav.appendChild(frag);
}

function buildTocList(entries) {
  const ul = document.createElement('ul');
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = `toc-l${entry.level}`;

    const a = document.createElement('a');
    a.href = entry.anchor;
    a.className = 'toc-link';
    a.textContent = entry.text;

    li.appendChild(a);

    if (entry.children && entry.children.length > 0) {
      li.classList.add('toc-has-children', 'toc-collapsed');
      const childUl = buildTocList(entry.children);
      childUl.className = 'toc-children';
      li.appendChild(childUl);
    }

    ul.appendChild(li);
  }
  return ul;
}

function expandAncestors(link) {
  let li = link.closest('li');
  while (li) {
    li.classList.remove('toc-collapsed');
    li = li.parentElement.closest('li');
  }
}

function updateActiveSidebarLink(anchor) {
  document.querySelectorAll('#toc-nav a.active').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`#toc-nav a[href="${anchor}"]`);
  if (link) {
    link.classList.add('active');
    expandAncestors(link);
    link.scrollIntoView({ block: 'nearest' });
  }
}

/* ============================================================
   INTERSECTION OBSERVER (seção ativa dentro do capítulo)
   ============================================================ */
function setupObserver() {
  if (activeObserver) activeObserver.disconnect();

  const sections = document.querySelectorAll('#content section[id]');
  if (sections.length === 0) return;

  activeObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id;
      const link = document.querySelector(`#toc-nav a[href="#${id}"]`);
      if (!link) continue;

      document.querySelectorAll('#toc-nav a.active').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
      expandAncestors(link);
      link.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, {
    rootMargin: '-10% 0px -85% 0px',
    threshold: 0
  });

  sections.forEach(s => activeObserver.observe(s));
}

/* ============================================================
   SEARCH INDEX (todas as páginas, para busca global)
   ============================================================ */
let searchIndex = [];

function buildSearchIndex(pages) {
  const stripper = document.createElement('div');
  searchIndex = pages.map(p => {
    stripper.innerHTML = p.html;
    return { pageNum: pageNumOfId(p.id), text: stripper.textContent };
  });

  // Texto introdutório movido para uma página de capa (ver reassignLeadInParagraphs)
  // continua indexado, associado à página onde agora é exibido.
  const byPageNum = new Map(searchIndex.map(e => [e.pageNum, e]));
  chapters.forEach(c => {
    if (!c.leadInHtml) return;
    stripper.innerHTML = c.leadInHtml;
    const entry = byPageNum.get(c.end);
    if (entry) entry.text += ' ' + stripper.textContent;
  });
}

// Resultados de busca agrupados por página, com trecho de contexto —
// para a lista do overlay, em vez de teletransportar direto ao 1º match.
function computeSearchResults(query, limit = 60) {
  const re = new RegExp(escapeRegex(query), 'gi');
  const results = [];

  for (const { pageNum, text } of searchIndex) {
    re.lastIndex = 0;
    const first = re.exec(text);
    if (!first) continue;

    let count = 1;
    while (re.exec(text) !== null) count++;

    const chapterIdx = findChapterIndexForPage(pageNum);
    const chapter = chapters[chapterIdx];
    results.push({
      pageNum,
      chapterTitle: chapter ? chapter.title : `Página ${pageNum}`,
      sectionLabel: chapter ? chapter.sectionLabel : null,
      count,
      snippet: makeSnippet(text, first.index, query.length),
    });
    if (results.length >= limit) break;
  }

  return results;
}

function makeSnippet(text, index, matchLen, pad = 45) {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + matchLen + pad);
  const before = (start > 0 ? '…' : '') + text.slice(start, index);
  const match = text.slice(index, index + matchLen);
  const after = text.slice(index + matchLen, end) + (end < text.length ? '…' : '');
  return escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after);
}

/* ============================================================
   SEARCH ENGINE (destaque dentro do capítulo atualmente exibido)
   ============================================================ */
class SearchEngine {
  constructor() {
    this.matches = [];
    this.current = -1;
  }

  highlightAll(query) {
    this.clearHighlights();

    const re = new RegExp(escapeRegex(query), 'gi');
    const content = document.getElementById('content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);

    const nodesToProcess = [];
    let node;
    while ((node = walker.nextNode())) {
      re.lastIndex = 0;
      if (re.test(node.textContent)) nodesToProcess.push(node);
    }

    for (const textNode of nodesToProcess) {
      re.lastIndex = 0;
      const parts = textNode.textContent.split(re);
      if (parts.length < 2) continue;

      re.lastIndex = 0;
      const rawMatches = textNode.textContent.match(re) || [];
      const frag = document.createDocumentFragment();

      parts.forEach((part, idx) => {
        if (part) frag.appendChild(document.createTextNode(part));
        if (idx < rawMatches.length) {
          const mark = document.createElement('mark');
          mark.className = 'hl';
          mark.textContent = rawMatches[idx];
          this.matches.push(mark);
          frag.appendChild(mark);
        }
      });

      textNode.parentNode.replaceChild(frag, textNode);
    }

    return this.matches.length;
  }

  setCurrent(localIndex) {
    this.matches[this.current]?.classList.remove('current');
    this.current = localIndex;
    const mark = this.matches[this.current];
    if (mark) {
      mark.classList.add('current');
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  clearHighlights() {
    document.querySelectorAll('#content mark.hl').forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      }
    });
    this.matches = [];
    this.current = -1;
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setupSearch() {
  const overlay = document.getElementById('search-overlay');
  const toggle = document.getElementById('search-toggle');
  const input = document.getElementById('search-input');
  const statusEl = document.getElementById('search-status');
  const resultsEl = document.getElementById('search-results');
  const closeBtn = document.getElementById('search-close');
  const engine = new SearchEngine();

  let debounceTimer;

  toggle.addEventListener('click', () => {
    openModal(overlay, toggle);
    input.focus();
    input.select();
  });
  closeBtn.addEventListener('click', () => closeModal(overlay));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(input.value.trim()), 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal(overlay);
  });

  resultsEl.addEventListener('click', e => {
    const row = e.target.closest('.search-result');
    if (!row) return;
    const pageNum = parseInt(row.dataset.page, 10);
    const query = row.dataset.query || '';
    closeModal(overlay);
    navigate('#p' + pageNum);
    if (query) {
      requestAnimationFrame(() => {
        engine.highlightAll(query);
        engine.setCurrent(0);
      });
    }
  });

  function runSearch(query) {
    resultsEl.innerHTML = '';
    if (query.length < 2) {
      statusEl.textContent = 'Digite ao menos 2 caracteres para buscar.';
      return;
    }

    const results = computeSearchResults(query);
    if (results.length === 0) {
      statusEl.textContent = 'Nenhum resultado encontrado.';
      return;
    }

    const total = results.reduce((s, r) => s + r.count, 0);
    statusEl.textContent = `${total} ocorrência${total > 1 ? 's' : ''} em ${results.length} trecho${results.length > 1 ? 's' : ''}`;

    const frag = document.createDocumentFragment();
    for (const r of results) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-result';
      row.dataset.page = r.pageNum;
      row.dataset.query = query;
      const label = r.sectionLabel ? `${r.sectionLabel} · ${r.chapterTitle}` : r.chapterTitle;
      row.innerHTML =
        `<span class="search-result-chapter">${escapeHtml(label)}</span>` +
        `<span class="search-result-snippet">${r.snippet}</span>`;
      frag.appendChild(row);
    }
    resultsEl.appendChild(frag);
  }
}

/* ============================================================
   VOLTAR AO TOPO (FAB)
   ============================================================ */
function setupBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  btn.hidden = false; // visibilidade passa a ser controlada pela classe .visible

  let ticking = false;
  const update = () => {
    ticking = false;
    btn.classList.toggle('visible', window.scrollY > window.innerHeight * 0.8);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });

  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ============================================================
   DARK MODE
   ============================================================ */
function setupDarkMode() {
  const saved = localStorage.getItem('theme');
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = saved || preferred;
  document.documentElement.dataset.theme = theme;

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
}

/* ============================================================
   MOBILE MENU
   ============================================================ */
function setupMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menu-toggle');
  const close = document.getElementById('sidebar-close');

  // overlay div para fechar ao clicar fora
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  document.body.appendChild(overlay);

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }

  toggle.addEventListener('click', openSidebar);
  close.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  // fecha ao clicar em link na sidebar (mobile)
  document.getElementById('toc-nav').addEventListener('click', e => {
    if (e.target.tagName === 'A') closeSidebar();
  });
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);
