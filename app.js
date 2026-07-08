/* app.js — inicialização, sidebar, busca, dark mode, navegação por capítulos */

let allPages = [];       // PageData[] completo, na ordem do documento
let chapters = [];       // { start, end, title, sectionLabel, anchor }[]
let tocTreesGlobal = []; // árvores do {{toc}}, reusadas pelo índice de capa
let cardDescriptions = {}; // descrições curadas dos cards (descriptions.json)
let sphereThemes = {};   // identidade por esfera (sphere-themes.json): título -> {h,s,sig,lLight?}
// Camada estruturada de regras (data/spheres/*, data/classes.json, data/class-features.json),
// carregada via DataLoader + indexada por Rules.indexData — NUNCA o DOM. Todas as decisões de
// regra (orçamento, pré-requisitos, concedidos, classificação grátis/base/extra) leem daqui.
let dataIndex = null;             // Rules.DataIndex — null se o carregamento falhar
let sphereIdByTitle = new Map();  // "Vida" -> "vida" (título do capítulo -> id estruturado)
let sphereTitleById = new Map();  // "vida" -> "Vida"
let sphereModelCache = new Map(); // título -> modelo classificado (getSphereModel), cache do pipeline pesado
let availableSigils = new Set(); // ids de sigilo já presentes no sprite (sigils.svg)
let talentIndex = new Map();  // normNome -> {name, pageAnchor, slug, chapterTitle, summary}
let talentRefRegex = null;    // regex dos nomes de talento (p/ linkar pré-requisitos)
let currentChapterIndex = -1;
let activeObserver = null;
// Estado de VIEW da ficha "Meu Personagem" (Layout B / Bancada) — nunca persiste
// no localStorage; sobrevive aos re-renders (não é reconstruído a cada chamada de
// renderCharacter). sphere = título da esfera ativa no rail; benchMode = 'talents'
// (bancada lista candidatos a talento) | 'spheres' (bancada lista esferas p/ adquirir);
// sel = id do item selecionado na bancada (talento OU título de esfera, conforme
// benchMode); scope = 'sphere' | 'all' (candidatos só da esfera ativa vs. de todas).
let charView = { sphere: null, benchMode: 'talents', sel: null, scope: 'sphere', search: '' };
// Sentinela de charView.sphere para a entrada "Metamágica" (cota restrita — KG-5) no
// accordion: mesmo mecanismo de expandir/recolher das esferas normais, mas não é um
// título de esfera. Só há UMA allowance hoje (Feiticeiro); se surgir outra no futuro,
// isto precisa virar chave-por-feature — escopo atual é 1.
const METAMAGIC_KEY = 'mm:Metamágica';

async function init() {
  setupDarkMode();
  setupReadingControls();

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

    // Identidade por esfera (cor/sigilo). Opcional.
    try {
      const stRes = await fetch('sphere-themes.json');
      if (stRes.ok) sphereThemes = await stRes.json();
    } catch (_) { /* mantém {} → esferas usam a cor da seção */ }

    // Camada estruturada (esferas/talentos + classes + características de classe) — decide
    // orçamento, pré-requisitos, concedidos e classificação grátis/base/extra. Se falhar, o
    // companheiro de personagem fica indisponível (mesmo tratamento de antes).
    try {
      const { spheres, classes, classFeatures: cf } = await DataLoader.loadData();
      dataIndex = Rules.indexData(spheres, classes, cf);
      for (const sph of dataIndex.sphereById.values()) {
        sphereIdByTitle.set(sph.name, sph.id);
        sphereTitleById.set(sph.id, sph.name);
      }
    } catch (_) { dataIndex = null; }

    // Sprite de sigilos (SVG injetado uma vez; referenciado por <use>). Opcional.
    try {
      const sigRes = await fetch('sigils.svg');
      if (sigRes.ok) {
        const holder = document.createElement('div');
        holder.style.display = 'none';
        holder.innerHTML = await sigRes.text();
        document.body.insertBefore(holder, document.body.firstChild);
        holder.querySelectorAll('symbol[id^="sig-"]').forEach(s => availableSigils.add(s.id.slice(4)));
      }
    } catch (_) { /* sem sigilos → esferas mostram só a cor */ }

    const { pages, tocTrees } = HBParser.parse(text);

    allPages = pages;
    tocTreesGlobal = tocTrees;
    chapters = Chapters.buildChapters(pages, tocTrees);
    reassignLeadInParagraphs();

    buildSidebar(tocTrees);
    buildGlossary(pages);
    buildTalentIndex(pages);
    buildSphereRefIndex(tocTrees);
    buildSearchIndex(pages);
    setupSearch();
    setupGlossary();
    setupHowto();
    setupPeek();
    setupFavorites();
    setupCharacter();
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
   PRÉVIA ("ESPIAR") de talento/esfera referenciados
   ============================================================ */
function openPeek({ kind, title, bodyHtml, anchor, slug }) {
  const sheet = document.getElementById('peek-sheet');
  document.getElementById('peek-kind').textContent = kind || '';
  document.getElementById('peek-title').textContent = title || '';
  document.getElementById('peek-body').innerHTML = bodyHtml || '';
  const go = document.getElementById('peek-go');
  go.dataset.anchor = anchor || '';
  go.dataset.slug = slug || '';
  openModal(sheet, document.activeElement);
}

function setupPeek() {
  const sheet = document.getElementById('peek-sheet');
  if (!sheet) return;
  document.getElementById('peek-close').addEventListener('click', () => closeModal(sheet));
  sheet.addEventListener('click', e => { if (e.target === sheet) closeModal(sheet); });

  document.getElementById('peek-go').addEventListener('click', e => {
    e.preventDefault();
    const a = e.currentTarget;
    const anchor = a.dataset.anchor, slug = a.dataset.slug;
    closeModal(sheet);
    if (anchor) {
      navigate(anchor);
      if (slug) requestAnimationFrame(() => document.getElementById(slug)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  });

  // Clique numa referência (talento em pré-requisitos, ou esfera citada) → prévia
  document.getElementById('content').addEventListener('click', e => {
    const ref = e.target.closest('.ref-link');
    if (ref) {
      e.preventDefault();
      const t = talentIndex.get(ref.dataset.ref);
      if (t) openPeek({
        kind: 'Talento' + (t.chapterTitle ? ' · ' + t.chapterTitle : ''),
        title: t.name,
        bodyHtml: t.summary ? `<p>${escapeHtml(t.summary)}</p>` : '<p class="peek-empty">(sem resumo)</p>',
        anchor: t.pageAnchor, slug: t.slug,
      });
      return;
    }
    const xref = e.target.closest('.sphere-xref');
    if (xref) {
      e.preventDefault();
      const name = xref.textContent.trim();
      const href = xref.getAttribute('href');
      const desc = cardDescriptions[name] || chapterShortDescription(href, 220);
      openPeek({ kind: 'Esfera', title: name, bodyHtml: desc ? `<p>${escapeHtml(desc)}</p>` : '', anchor: href, slug: '' });
    }
  });
}

/* ============================================================
   FAVORITOS ("Meu compêndio") + CONTINUAR LENDO (localStorage)
   ============================================================ */
const LS_FAVS = 'esferas:favs', LS_RECENT = 'esferas:recent', LS_LAST = 'esferas:last';
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (_) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

/* ---- Ponte capítulo (título) <-> dado estruturado (id) --------------------------
   O leitor navega por título de capítulo ("Vida"); o estado do personagem e o
   Rules engine trabalham por id ("vida"). Estas funções são a única ponte entre
   os dois mundos — nenhuma outra função deve ler `dataIndex` sem passar por elas
   quando o que tem em mãos é um título. ------------------------------------- */
function sphereIdFor(title) { return sphereIdByTitle.get(title) || null; }
function sphereByTitle(title) {
  const id = sphereIdFor(title);
  return (id && dataIndex) ? dataIndex.sphereById.get(id) : null;
}
// Resolve o talento estruturado de um card do DOM (nome + se é habilidade-base),
// desambiguando homônimos (ex.: "Invocação" base vs. talento avançado homônimo).
function resolveTalentId(title, name, isBaseCard) {
  const sph = sphereByTitle(title);
  if (!sph) return null;
  const cands = sph.talents.filter(t => t.name === name);
  if (cands.length <= 1) return cands[0] ? cands[0].id : null;
  const m = cands.find(t => (t.kind === 'base') === !!isBaseCard);
  return (m || cands[0]).id;
}
// Resolve por nome só quando o casamento é inequívoco (migração de dados antigos,
// sem informação de DOM para desambiguar homônimos — mais seguro não adivinhar).
function resolveTalentIdLoose(title, name) {
  const sph = sphereByTitle(title);
  if (!sph) return null;
  const cands = sph.talents.filter(t => t.name === name);
  return cands.length === 1 ? cands[0].id : null;
}
// Notificação transiente de bloqueio de regra (pré-requisito/orçamento). Reusa o
// estilo .char-warn; aparece perto do controle clicado e some sozinha.
function showCharNotice(anchorEl, message) {
  document.querySelectorAll('.char-warn-toast').forEach(n => n.remove());
  const note = document.createElement('p');
  note.className = 'char-warn char-warn-toast';
  note.setAttribute('role', 'alert');
  note.textContent = message;
  const host = (anchorEl && anchorEl.closest) ? anchorEl.closest('.sphere-acquire, .talent-card, .char-sphere') : null;
  if (host && host.parentNode) host.parentNode.insertBefore(note, host.nextSibling);
  else document.getElementById('content')?.prepend(note);
  window.setTimeout(() => note.remove(), 4500);
}

function favKey(it) { return normalizeTerm(it.name) + '|' + normalizeTerm(it.sphere || ''); }
function getFavs() { return lsGet(LS_FAVS, []); }
function isFav(it) { const k = favKey(it); return getFavs().some(f => favKey(f) === k); }
function toggleFav(it) {
  const favs = getFavs(); const k = favKey(it);
  const i = favs.findIndex(f => favKey(f) === k);
  if (i >= 0) favs.splice(i, 1); else favs.unshift(it);
  lsSet(LS_FAVS, favs);
  return i < 0;
}

function makeFavButton(item) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fav-btn';
  const on = isFav(item);
  btn.textContent = on ? '★' : '☆';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? 'Remover dos favoritos' : 'Salvar nos favoritos');
  btn.dataset.fav = JSON.stringify(item);
  return btn;
}

// Controle de personagem de um card, conforme o papel na esfera (base/free/extra/
// ignore) e o estado do personagem ativo. Base → chip; ignore → nada; demais → +/✓.
function makeCharControl(item, role, active, entry, multi, granted) {
  if (role === 'ignore') return null; // não é talento (feature de pacote/regras)
  if (role === 'base' || role === 'granted') {
    const chip = document.createElement('span');
    chip.className = role === 'granted' ? 'granted-chip' : 'base-included';
    chip.textContent = role === 'granted' ? '✦ concedido' : '✦ incluída';
    chip.title = role === 'granted' ? 'Talento concedido pela subclasse' : 'Habilidade-base — vem junto ao adquirir a esfera';
    return chip;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'char-btn';
  btn.dataset.char = JSON.stringify(item);
  btn.dataset.sphere = item.sphere;
  btn.dataset.role = role; // 'free' | 'extra' → decide grátis vs +1 no clique
  if (!active) { // sem personagem → clique leva à página de personagem
    btn.textContent = '+';
    btn.title = 'Adicionar ao personagem';
    btn.setAttribute('aria-label', 'Adicionar ao personagem');
    return btn;
  }
  if (!entry && !granted) { // esfera não adquirida nem concedida p/ o ativo
    btn.textContent = '+';
    if (multi) { // vários personagens → clique abre o seletor de alvo
      btn.title = 'Escolher personagem';
      btn.setAttribute('aria-label', 'Escolher personagem');
    } else {     // um só → guia a adquirir a esfera
      btn.disabled = true;
      btn.classList.add('needs-sphere');
      btn.title = 'Adquira a esfera primeiro';
      btn.setAttribute('aria-label', 'Adquira a esfera primeiro');
    }
    return btn;
  }
  const e = entry || { freePicks: [], talents: [] }; // esfera concedida sem entry ainda
  const k = item.id; // freePicks/talents são arrays de id de talento
  const isFree = (e.freePicks || []).includes(k);
  const isExtra = (e.talents || []).includes(k);
  if (isFree) {
    btn.textContent = '✓ grátis';
    btn.classList.add('on', 'is-free');
    btn.title = 'Escolha grátis da esfera — clique para remover';
    btn.setAttribute('aria-label', 'Remover escolha grátis');
  } else if (isExtra) {
    btn.textContent = '✓';
    btn.classList.add('on');
    btn.title = 'No personagem (custa 1) — clique para remover';
    btn.setAttribute('aria-label', 'Remover do personagem');
  } else {
    btn.textContent = '+';
    btn.title = 'Adicionar ao personagem';
    btn.setAttribute('aria-label', 'Adicionar ao personagem');
  }
  return btn;
}

// Estrela (favorito) + controle de personagem em cada talento (na própria .talent-card).
function addFavoriteStars(root, chapter) {
  const active = getActiveChar();
  const entry = active ? sphereEntry(active, chapter.title) : null;
  const model = getSphereModel(chapter.title, entry && entry.choices ? entry.choices.pkg : null);
  const gc = grantCtxFor(active, chapter.title);
  const multi = getCharacters().length > 1;
  for (const card of root.querySelectorAll('.talent-card')) {
    const h4 = card.querySelector(':scope > h4, :scope > h5');
    if (!h4) continue;
    const section = card.closest('section[id]');
    const name = h4.textContent.trim();
    const isBaseCard = card.classList.contains('base-ability');
    const { id, role } = cardDisplayRole(model, chapter.title, name, isBaseCard, gc);
    const item = { id, name, sphere: chapter.title, anchor: section ? '#' + section.id : chapter.anchor, slug: h4.id || '' };
    const actions = document.createElement('div');
    actions.className = 'talent-actions';
    const ctl = makeCharControl(item, role, active, entry, multi, gc.granted);
    if (ctl) actions.appendChild(ctl);
    actions.appendChild(makeFavButton(item));
    card.appendChild(actions);
  }
}

// Seletor de pacote-base (Alquimia/Universal) — usado pela barra de aquisição
// (leitura) E pelo painel in-sheet (ficha); mesma marcação/classe nos dois, então
// o handler delegado de `.pkg-select` (setupFavorites) funciona nos dois lugares.
function buildPackageSelector(active, title, spec) {
  if (!spec.packages) return null;
  const lbl = document.createElement('label');
  lbl.className = 'pkg-l';
  lbl.textContent = `${spec.packages.label || 'Pacote'}: `;
  const sel = document.createElement('select');
  sel.className = 'pkg-select';
  sel.dataset.sphere = title;
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— escolher —';
  sel.appendChild(none);
  for (const opt of spec.packages.options) {
    const o = document.createElement('option');
    o.value = opt.id; o.textContent = opt.label;
    // Gate de escolha (ex.: Criação de Magias exige ≥2 esferas mágicas) → desabilita
    // a option não-atendida (a menos que já seja a escolhida) com o motivo no rótulo.
    if (opt.requires && active && dataIndex && spec.pkg !== opt.id) {
      const req = Rules.packageRequirementMet(active, sphereIdFor(title), opt.id, dataIndex);
      if (!req.ok) { o.disabled = true; o.textContent = `${opt.label} — ${req.reason}`; }
    }
    if (spec.pkg === opt.id) o.selected = true;
    sel.appendChild(o);
  }
  lbl.appendChild(sel);
  return lbl;
}
// Seletores de escolha grátis (um por slot, N = capacidade resolvida) — mesmo uso
// duplo que buildPackageSelector (barra de leitura + painel in-sheet).
function buildFreePickSelectors(active, title, spec, model, entry) {
  const out = [];
  if (!(spec.freePicks > 0 && model.freeGroup.length)) return out;
  const picks = ((entry && entry.freePicks) || []).slice(0, spec.freePicks);
  for (let i = 0; i < spec.freePicks; i++) {
    const lbl = document.createElement('label');
    lbl.className = 'freepick-l';
    lbl.textContent = spec.freePicks > 1 ? `Grátis (${spec.freeLabel}) ${i + 1}: ` : `Grátis — 1 ${spec.freeLabel}: `;
    const sel = document.createElement('select');
    sel.className = 'freepick-select';
    sel.dataset.sphere = title;
    sel.dataset.i = String(i);
    const none = document.createElement('option');
    none.value = ''; none.textContent = '—';
    sel.appendChild(none);
    const chosenIds = new Set(picks.filter(Boolean));
    for (const it of model.freeGroup) {
      // esconde os já escolhidos em OUTROS slots
      if (chosenIds.has(it.id) && picks[i] !== it.id) continue;
      const opt = document.createElement('option');
      opt.value = it.id; opt.textContent = it.name;
      if (picks[i] === it.id) opt.selected = true;
      sel.appendChild(opt);
    }
    lbl.appendChild(sel);
    out.push(lbl);
  }
  return out;
}
// Aplica o valor de um seletor de escolha grátis: confere Rules.prereqCheck antes
// de mutar (mesma regra de addFreePickChecked); devolve true só se mutou, para o
// chamador decidir como re-renderizar (refreshSphereUI na leitura, renderCharacter
// na ficha). Compartilhado pelos dois handlers de `.freepick-select`.
function applyFreePickSelection(active, title, index, talentId, anchorEl) {
  if (talentId && dataIndex) {
    const talent = dataIndex.talentById.get(talentId);
    const pre = talent ? Rules.prereqCheck(active, talent, dataIndex) : { ok: false, missing: [], unverified: [] };
    if (!pre.ok) { showCharNotice(anchorEl, `Pré-requisito não atendido para "${talent ? talent.name : talentId}".`); return false; }
    if (pre.unverified.length) showCharNotice(anchorEl, `"${talent.name}" tem um pré-requisito em texto — confirme manualmente se ele é atendido.`);
  }
  setFreePickAt(active, title, index, talentId);
  return true;
}

// Barra de aquisição sob o título da esfera. Só aparece quando já existe pelo
// menos um personagem; o alvo é escolhido num seletor visível (nunca presumido).
function renderSphereAcquireBar(chapter) {
  const chars = getCharacters();
  if (!chars.length) return null;
  let active = getActiveChar();
  if (!active) { setActiveCharId(chars[0].id); active = chars[0]; }
  const entry = sphereEntry(active, chapter.title);
  const bar = document.createElement('div');
  bar.className = 'sphere-acquire';
  bar.dataset.sphere = chapter.title;

  // Seletor do personagem-alvo (sempre visível → sem presumir o último)
  const who = document.createElement('label');
  who.className = 'acquire-who';
  who.textContent = 'Personagem: ';
  const whoSel = document.createElement('select');
  whoSel.className = 'char-target-select';
  whoSel.dataset.sphere = chapter.title;
  for (const c of chars) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name || '(sem nome)';
    if (c.id === active.id) o.selected = true;
    whoSel.appendChild(o);
  }
  who.appendChild(whoSel);
  bar.appendChild(who);

  const granted = isGrantedSphere(active, chapter.title);

  // Não adquirida e não concedida → só o botão de adquirir.
  if (!granted && !entry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acquire-btn';
    btn.dataset.acquire = chapter.title;
    btn.textContent = `+ Adquirir ${chapter.title} (1 talento)`;
    bar.appendChild(btn);
    return bar;
  }

  // Adquirida OU concedida: mostra pacote + escolha grátis (uma esfera concedida
  // também dá o grátis inicial da esfera). `entry` pode ser null numa esfera
  // concedida ainda sem escolhas — os seletores criam a entrada ao escolher.
  const choices = (entry && entry.choices) || {};
  const spec = resolveSpec(active, chapter.title, choices);
  const model = getSphereModel(chapter.title, spec.pkg);

  const status = document.createElement('span');
  status.className = 'acquire-status' + (granted ? ' granted' : '');
  status.textContent = granted
    ? `✦ ${chapter.title} concedida${active.subclass ? ' (' + active.subclass + ')' : ''}`
    : `✓ ${chapter.title} adquirida`;
  bar.appendChild(status);

  // Seletor de pacote-base (Alquimia)
  const pkgSel = buildPackageSelector(active, chapter.title, spec);
  if (pkgSel) bar.appendChild(pkgSel);

  // Notas das condicionais de proficiência (resolvidas automaticamente)
  for (const c of spec.conditionals) {
    const note = document.createElement('span');
    note.className = 'acquire-cond' + (c.satisfied ? ' on' : '');
    const reqTxt = Array.isArray(c.requires) ? c.requires.join(' e ') : c.requires;
    note.textContent = c.satisfied
      ? `✓ proficiente em ${reqTxt} → +${c.addPicks} grátis`
      : `a esfera concede proficiência em ${reqTxt}`;
    bar.appendChild(note);
  }

  // Seletores de escolha grátis (N = capacidade resolvida)
  for (const lbl of buildFreePickSelectors(active, chapter.title, spec, model, entry)) bar.appendChild(lbl);

  const cost = document.createElement('span');
  cost.className = 'acquire-cost';
  const extras = (entry && entry.talents) ? entry.talents.length : 0;
  cost.textContent = granted
    ? (extras ? `${extras} talento(s) extra` : 'acesso grátis')
    : `${sphereCost(entry, active)} talento(s)`;
  bar.appendChild(cost);

  if (!granted) { // esferas concedidas pela subclasse não podem ser removidas
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'sphere-remove';
    rm.dataset.removesphere = chapter.title;
    rm.textContent = 'Remover esfera';
    bar.appendChild(rm);
  }
  return bar;
}

// Atualiza in-place a barra e os controles dos cards da esfera após uma operação
// (evita re-renderizar o capítulo e perder a rolagem do leitor).
function refreshSphereUI(title) {
  const content = document.getElementById('content');
  const active = getActiveChar();
  const entry = active ? sphereEntry(active, title) : null;
  const model = getSphereModel(title, entry && entry.choices ? entry.choices.pkg : null);
  const gc = grantCtxFor(active, title);
  const multi = getCharacters().length > 1;
  const chapter = chapters.find(c => c.title === title);

  content.querySelectorAll('.sphere-acquire').forEach(bar => {
    if (bar.dataset.sphere !== title || !chapter) return;
    const fresh = renderSphereAcquireBar(chapter);
    if (fresh) bar.replaceWith(fresh); else bar.remove();
  });

  for (const card of content.querySelectorAll('.talent-card')) {
    const h = card.querySelector(':scope > h4, :scope > h5');
    if (!h) continue;
    const section = card.closest('section[id]');
    const name = h.textContent.trim();
    const isBaseCard = card.classList.contains('base-ability');
    const { id, role } = cardDisplayRole(model, title, name, isBaseCard, gc);
    const item = { id, name, sphere: title, anchor: section ? '#' + section.id : (chapter ? chapter.anchor : ''), slug: h.id || '' };
    const actions = card.querySelector('.talent-actions');
    if (!actions) continue;
    const oldCtl = actions.querySelector(':scope > .char-btn, :scope > .base-included, :scope > .granted-chip');
    const newCtl = makeCharControl(item, role, active, entry, multi, gc.granted);
    if (oldCtl) { if (newCtl) oldCtl.replaceWith(newCtl); else oldCtl.remove(); }
    else if (newCtl) actions.insertBefore(newCtl, actions.firstChild);
  }
}

// Aplica o clique de um talento ao personagem `active`: alterna grátis/extra —
// remoção nunca é bloqueada; adição passa por Rules.prereqCheck/canAddTalent
// (pré-requisito estruturado não atendido ou orçamento esgotado → bloqueia).
function applyTalentToggle(active, title, item, cardEl) {
  const granted = isGrantedSphere(active, title);
  const entry = sphereEntry(active, title);
  if (!entry && !granted) return false; // esfera não adquirida nem concedida
  if (isGrantedTalentId(active, item.id)) return false; // talento específico concedido é fixo
  const id = item.id;
  if (!id || !dataIndex) { showCharNotice(cardEl, 'Não foi possível localizar este talento nos dados estruturados — recarregue a página.'); return false; }
  if (entry && (entry.freePicks || []).includes(id)) { removeFreePick(active, title, id); return true; }
  if (entry && (entry.talents || []).includes(id)) { toggleExtraTalent(active, title, id); return true; }
  const talent = dataIndex.talentById.get(id);
  if (!talent) { showCharNotice(cardEl, 'Talento não encontrado nos dados estruturados.'); return false; }
  if (granted) return addExtraTalentChecked(active, title, talent, cardEl); // esfera concedida: só extras (+1)
  const model = getSphereModel(title, entry.choices && entry.choices.pkg);
  const role = model.roleByKey.get(id) || 'extra';
  const cap = resolveSpec(active, title, entry.choices).freePicks;
  const room = (entry.freePicks || []).length < cap;
  if (role === 'free' && room) return addFreePickChecked(active, title, talent, cardEl);
  return addExtraTalentChecked(active, title, talent, cardEl);
}
// Confere Rules.prereqCheck antes de conceder um grátis — o grupo já filtra por
// tag/pacote; isto cobre pré-requisitos do próprio talento (ex.: nível mínimo).
// Pré-requisito em texto (unverified) nunca bloqueia, só avisa p/ conferir.
function addFreePickChecked(active, title, talent, anchorEl) {
  const pre = Rules.prereqCheck(active, talent, dataIndex);
  if (!pre.ok) { showCharNotice(anchorEl, `Pré-requisito não atendido para "${talent.name}".`); return false; }
  const ok = addFreePick(active, title, talent.id);
  if (ok && pre.unverified.length) showCharNotice(anchorEl, `"${talent.name}" tem um pré-requisito em texto — confirme manualmente se ele é atendido.`);
  return ok;
}
// Confere Rules.canAddTalent (pré-requisito + orçamento de talentos) antes de
// adicionar um extra (custa 1 talento mágico/marcial).
function addExtraTalentChecked(active, title, talent, anchorEl) {
  const check = Rules.canAddTalent(active, talent, dataIndex);
  if (!check.ok) {
    const msg = !check.prereq.ok
      ? `Pré-requisito não atendido para "${talent.name}".`
      : `Sem talentos ${check.section === 'martial' ? 'marciais' : 'mágicos'} suficientes para "${talent.name}".`;
    showCharNotice(anchorEl, msg);
    return false;
  }
  const added = toggleExtraTalent(active, title, talent.id);
  if (added && check.prereq.unverified.length) showCharNotice(anchorEl, `"${talent.name}" tem um pré-requisito em texto — confirme manualmente se ele é atendido.`);
  return added;
}

// Popover "Adicionar a…": escolhe explicitamente o personagem-alvo do talento.
function closeCharPicker() {
  const p = document.querySelector('.char-picker');
  if (p) p.remove();
}
function showCharPicker(btn, title, item) {
  closeCharPicker();
  const chars = getCharacters();
  const activeId = getActiveCharId();
  const pop = document.createElement('div');
  pop.className = 'char-picker';
  pop.__title = title; pop.__item = item; pop.__card = btn.closest('.talent-card');
  const head = document.createElement('div');
  head.className = 'char-picker-head';
  head.textContent = 'Adicionar a…';
  pop.appendChild(head);
  for (const c of chars) {
    const entry = sphereEntry(c, title);
    let state;
    if (!entry) state = 'adquira a esfera';
    else {
      const k = item.id;
      if ((entry.freePicks || []).includes(k)) state = '✓ grátis';
      else if ((entry.talents || []).includes(k)) state = '✓ no personagem';
      else state = '+ adicionar';
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'char-picker-row' + (c.id === activeId ? ' active' : '');
    row.dataset.id = c.id;
    row.innerHTML = `<span class="cp-name">${escapeHtml(c.name || '(sem nome)')}</span><span class="cp-state">${escapeHtml(state)}</span>`;
    pop.appendChild(row);
  }
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 200;
  pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
  pop.style.left = (window.scrollX + Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
}

function toggleFavCard(head) {
  const card = head.parentElement;
  const nowCollapsed = card.classList.toggle('collapsed');
  head.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
}

function setupFavorites() {
  const content = document.getElementById('content');
  content.addEventListener('click', e => {
    // Expandir/recolher um card no compêndio (clique no título)
    const tog = e.target.closest('.fav-toggle');
    if (tog && tog.parentElement && tog.parentElement.classList.contains('fav-card')) {
      e.preventDefault(); toggleFavCard(tog); return;
    }
    const rm = e.target.closest('.fav-remove');
    if (rm) { e.preventDefault(); toggleFav(JSON.parse(rm.dataset.fav)); renderFavorites(); return; }
    // Barra de aquisição: adquirir esfera
    const ab = e.target.closest('.acquire-btn');
    if (ab) {
      e.preventDefault();
      const active = getActiveChar();
      if (!active) { navigate('#personagem'); return; }
      const res = tryAcquireSphere(active, ab.dataset.acquire);
      if (!res.ok) { showCharNotice(ab, res.message); return; }
      refreshSphereUI(ab.dataset.acquire);
      return;
    }
    // Barra de aquisição: remover esfera
    const rs = e.target.closest('.sphere-remove');
    if (rs) {
      e.preventDefault();
      const active = getActiveChar();
      if (active) { removeSphere(active, rs.dataset.removesphere); refreshSphereUI(rs.dataset.removesphere); }
      return;
    }
    // Adicionar/remover em cada talento — com ≥2 personagens, pergunta o alvo
    // (dentro da ficha (.char-sphere) o alvo já é fixo — setupCharacter cuida disso)
    const cbtn = e.target.closest('.char-btn');
    // Ficha (.char-sphere = build panel; .char-bench = bancada) → setupCharacter cuida,
    // com o alvo fixo no personagem ativo. Sem o guard de .char-bench, o botão
    // "Adicionar" da bancada é processado nos DOIS listeners e o toggle se anula.
    if (cbtn && (cbtn.closest('.char-sphere') || cbtn.closest('.char-bench'))) return;
    if (cbtn) {
      e.preventDefault(); e.stopPropagation();
      const chars = getCharacters();
      if (!chars.length) { navigate('#personagem'); return; } // sem personagem → cria
      const title = cbtn.dataset.sphere;
      const item = JSON.parse(cbtn.dataset.char);
      if (chars.length > 1) { showCharPicker(cbtn, title, item); return; }
      setActiveCharId(chars[0].id);
      applyTalentToggle(chars[0], title, item, cbtn.closest('.talent-card'));
      refreshSphereUI(title);
      return;
    }
    const btn = e.target.closest('.fav-btn');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const on = toggleFav(JSON.parse(btn.dataset.fav));
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Remover dos favoritos' : 'Salvar nos favoritos');
  });
  content.addEventListener('change', e => {
    // Trocar o personagem-alvo na barra de aquisição (sem presumir o último)
    const who = e.target.closest('.char-target-select');
    if (who) { setActiveCharId(who.value); refreshSphereUI(who.dataset.sphere); return; }
    // Escolher o pacote-base (Alquimia) — na ficha (.char-sphere), setupCharacter cuida disso
    const pkg = e.target.closest('.pkg-select');
    if (pkg && pkg.closest('.char-sphere')) return;
    if (pkg) {
      const active = getActiveChar();
      if (active) { setPackage(active, pkg.dataset.sphere, pkg.value || null); refreshSphereUI(pkg.dataset.sphere); }
      return;
    }
    // Seletor de escolha grátis (por slot) na barra de aquisição — idem, ficha à parte
    const sel = e.target.closest('.freepick-select');
    if (sel && sel.closest('.char-sphere')) return;
    if (!sel) return;
    const active = getActiveChar();
    if (!active) return;
    if (applyFreePickSelection(active, sel.dataset.sphere, parseInt(sel.dataset.i || '0', 10), sel.value || null, sel)) {
      refreshSphereUI(sel.dataset.sphere);
    }
  });
  // Teclado: Enter/Espaço no título alterna o card
  content.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fav-toggle')) {
      e.preventDefault(); toggleFavCard(e.target);
    }
  });

  // Popover "Adicionar a…" fica no <body> → tratado no nível do documento.
  document.addEventListener('click', e => {
    const row = e.target.closest('.char-picker-row');
    if (row) {
      e.preventDefault();
      const pop = row.closest('.char-picker');
      const title = pop.__title, item = pop.__item, card = pop.__card;
      setActiveCharId(row.dataset.id);
      applyTalentToggle(getActiveChar(), title, item, card);
      closeCharPicker();
      refreshSphereUI(title);
      // se o alvo não tem a esfera, traz a barra de aquisição dele à vista
      if (!sphereEntry(getActiveChar(), title)) {
        const barEl = [...document.querySelectorAll('#content .sphere-acquire')].find(b => b.dataset.sphere === title);
        if (barEl) barEl.scrollIntoView({ block: 'center' });
      }
      return;
    }
    if (!e.target.closest('.char-picker') && !e.target.closest('.char-btn')) closeCharPicker();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCharPicker(); });
}

// Registra o capítulo lido (último + recentes), exceto a capa.
function recordVisit(chapter, isCover) {
  if (!chapter || isCover) return;
  lsSet(LS_LAST, { anchor: chapter.anchor, title: chapter.title });
  let recent = lsGet(LS_RECENT, []).filter(r => r.anchor !== chapter.anchor);
  recent.unshift({ anchor: chapter.anchor, title: chapter.title, sectionLabel: chapter.sectionLabel || '' });
  lsSet(LS_RECENT, recent.slice(0, 8));
}

// Reconstrói os .talent-card de um capítulo (mesmo pipeline do render) e
// devolve um mapa nomeNormalizado -> card, para o compêndio exibir o talento
// inteiro (ficha, tags, glossário, dados) sem abrir a esfera.
// Fragmento com os .talent-card do capítulo (ordem de leitura, SEM deduplicar).
// getSphereModel precisa de todos os cards — nomes repetidos (ex.: Conjuração tem
// uma habilidade-base "Invocação" e um talento avançado homônimo) colidiriam no mapa.
function buildChapterCardFrag(chapter) {
  const frag = document.createDocumentFragment();
  for (let pn = chapter.start; pn <= chapter.end; pn++) {
    const page = allPages[pn - 1];
    if (!page) continue;
    const section = document.createElement('section');
    section.id = page.id;
    section.innerHTML = page.html;
    frag.appendChild(section);
  }
  enhanceTalents(frag);
  linkSphereCrossRefs(frag, chapter);
  linkGlossaryTerms(frag, chapter);
  highlightMechanics(frag);
  return frag;
}
function buildChapterCards(chapter) {
  const map = new Map();
  for (const card of buildChapterCardFrag(chapter).querySelectorAll('.talent-card')) {
    const h = card.querySelector(':scope > h4, :scope > h5');
    if (h) map.set(normalizeTerm(h.textContent), card);
  }
  return map;
}

// Rodapé de ações de um card no compêndio: remover + abrir na esfera.
function buildFavCardActions(item) {
  const row = document.createElement('div');
  row.className = 'fav-actions';
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'fav-remove'; rm.textContent = '★ Remover'; rm.dataset.fav = JSON.stringify(item);
  const go = document.createElement('a');
  go.href = item.anchor; go.className = 'fav-open'; if (item.slug) go.dataset.slug = item.slug;
  go.textContent = 'Abrir na esfera →';
  row.appendChild(rm); row.appendChild(go);
  return row;
}

function renderFavorites() {
  currentChapterIndex = -1;
  const content = document.getElementById('content');
  content.removeAttribute('data-section');
  applySphereTheme(content, null);
  content.innerHTML = '';
  const frag = document.createDocumentFragment();

  const h1 = document.createElement('h1');
  h1.textContent = 'Meu compêndio';
  frag.appendChild(h1);

  const favs = getFavs();
  if (favs.length === 0) {
    const p = document.createElement('p');
    p.className = 'glossary-intro';
    p.textContent = 'Toque na ☆ de qualquer talento para salvá-lo aqui e montar a lista das habilidades do seu personagem.';
    frag.appendChild(p);
  } else {
    const intro = document.createElement('p');
    intro.className = 'glossary-intro';
    intro.textContent = `${favs.length} talento(s) salvo(s) — as habilidades do seu personagem, reunidas aqui.`;
    frag.appendChild(intro);

    const bySphere = new Map();
    for (const f of favs) { const s = f.sphere || '—'; if (!bySphere.has(s)) bySphere.set(s, []); bySphere.get(s).push(f); }
    for (const [sphere, items] of bySphere) {
      const chapter = chapters.find(c => c.title === sphere);
      const cardMap = chapter ? buildChapterCards(chapter) : new Map();

      // Grupo por esfera, tingido com a cor da esfera (como sidebar/capa).
      const group = document.createElement('section');
      group.className = 'fav-group';
      const theme = sphereThemes[sphere];
      if (theme) {
        group.classList.add('sphere-tinted');
        group.style.setProperty('--sphere-h', theme.h);
        group.style.setProperty('--sphere-s', theme.s);
      }

      const h2 = document.createElement('h2');
      h2.className = 'fav-group-title';
      h2.textContent = sphere;
      group.appendChild(h2);

      for (const it of items) {
        const card = cardMap.get(normalizeTerm(it.name));
        if (card) {
          const clone = card.cloneNode(true);
          clone.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); // evita ids duplicados
          clone.classList.add('fav-card', 'collapsed'); // começa minimizado
          const head = clone.querySelector(':scope > h4, :scope > h5');
          if (head) {
            head.classList.add('fav-toggle');
            head.setAttribute('role', 'button');
            head.setAttribute('tabindex', '0');
            head.setAttribute('aria-expanded', 'false');
          }
          clone.appendChild(buildFavCardActions(it));
          group.appendChild(clone);
        } else {
          // Fallback (ex.: favorito antigo que não é mais um card): link simples.
          const p = document.createElement('p');
          p.className = 'fav-missing';
          const rm = document.createElement('button');
          rm.type = 'button'; rm.className = 'fav-remove'; rm.textContent = '★'; rm.title = 'Remover'; rm.dataset.fav = JSON.stringify(it);
          const a = document.createElement('a');
          a.href = it.anchor; a.className = 'fav-open'; if (it.slug) a.dataset.slug = it.slug; a.textContent = it.name + ' — abrir na esfera →';
          p.appendChild(rm); p.appendChild(a);
          group.appendChild(p);
        }
      }
      frag.appendChild(group);
    }
  }

  content.appendChild(frag);
  applyStagger(content);
  document.getElementById('top-title').textContent = 'Meu compêndio';
  document.title = 'Meu compêndio — Esferas de Magia e Poder';
  setupObserver();
  updateActiveSidebarLink('#favoritos');
  window.scrollTo(0, 0);
}


/* ============================================================
   COMPANHEIRO DE PERSONAGEM (A2/A3) — modelo, storage e cálculos
   Personagem = Rules Character (src/types.js): { id, name, className, subclass,
   level, keyMod, tradition, proficiencies, spheres[] }, onde cada
   spheres[] = { sphere: <id>, section, choices, freePicks: [talentId…], talents:
   [talentId…] } — mesma forma que Rules.* espera, sem adaptação. Todas as
   decisões de regra (orçamento, pré-requisito, concedido) vêm de src/rules.js
   sobre `dataIndex`; só a EXIBIÇÃO do card ainda clona o HTML renderizado.
   ============================================================ */
const LS_CHARS = 'esferas:characters', LS_ACTIVE = 'esferas:activechar';

function getCharacters() { return lsGet(LS_CHARS, []); }
function saveCharacters(list) { lsSet(LS_CHARS, list); }
function getActiveCharId() { return lsGet(LS_ACTIVE, null); }
function setActiveCharId(id) { lsSet(LS_ACTIVE, id); }
function getActiveChar() {
  const id = getActiveCharId();
  return getCharacters().find(c => c.id === id) || null;
}
function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function createCharacter(patch) {
  const chars = getCharacters();
  const char = Object.assign({ id: uid(), name: 'Novo personagem', className: '', subclass: '', level: 1, keyMod: 0, tradition: 'base', proficiencies: { skills: [], tools: [] }, spheres: [] }, patch);
  chars.push(char);
  saveCharacters(chars);
  setActiveCharId(char.id);
  return char;
}
function updateCharacter(id, patch) {
  const chars = getCharacters();
  const c = chars.find(x => x.id === id);
  if (c) { Object.assign(c, patch); saveCharacters(chars); }
  return c;
}
function deleteCharacter(id) {
  let chars = getCharacters().filter(c => c.id !== id);
  saveCharacters(chars);
  if (getActiveCharId() === id) setActiveCharId(chars[0] ? chars[0].id : null);
}

/* ---- Proficiências (perícias 5e + ferramentas citadas por condicionais) ------ */
const SKILLS_5E = ['Acrobacia', 'Arcanismo', 'Atletismo', 'Atuação', 'Enganação', 'Furtividade',
  'História', 'Intimidação', 'Intuição', 'Investigação', 'Lidar com Animais', 'Medicina',
  'Natureza', 'Percepção', 'Persuasão', 'Prestidigitação', 'Religião', 'Sobrevivência'];
const TOOLS_COND = ['Ferramentas de ladrão', 'Suprimentos de alquimista', 'Kit de envenenador',
  'Ferramentas do consertador'];
function charProfs(char) {
  const p = (char && char.proficiencies) || {};
  return new Set([].concat(p.skills || [], p.tools || []).map(normalizeTerm));
}
// req = string ou array (todas exigidas). Compara normalizado.
function isProficient(char, req) {
  if (!req) return false;
  const set = charProfs(char);
  const reqs = Array.isArray(req) ? req : [req];
  return reqs.every(r => set.has(normalizeTerm(r)));
}

/* ---- Características de classe/subclasse (concedem talentos) ------------------
   data/class-features.json → por classe: features (bônus por nível) + subclasses
   {features, grants}. Bônus somam ao teto por nível (Rules.classFeatureBonus);
   grants concedem talentos específicos (já com id resolvido) + acesso implícito
   à esfera (custo 0). Mapeado por TÍTULO do capítulo (não por id) porque é assim
   que toda a UI da esfera indexa — a ponte pro id estruturado é feita ao ler
   `dataIndex.classFeatures` (nunca o DOM). ---------------------------------- */
function subclassesOf(className) {
  // reusa a travessia do TOC de injectSubclassTable (nós sob #grp-…)
  const node = tocTreesGlobal[2] && tocTreesGlobal[2][0] && tocTreesGlobal[2][0].children.find(c => c.text === className);
  if (!node) return [];
  const subs = [];
  for (const child of node.children) {
    if (child.anchor && child.anchor.startsWith('#grp-') && child.children) subs.push(...child.children.map(s => s.text));
  }
  return subs;
}
// Concessões da subclasse pela REGRA CONDICIONAL (fonte única: Rules.computeGrants):
// esferas com ACESSO grátis (sem acesso prévio → só habilidades iniciais) vs.
// talentos ESPECÍFICOS concedidos (com acesso prévio). Ver src/rules.js.
function charGrants(char) {
  return (char && dataIndex) ? Rules.computeGrants(char, dataIndex)
    : { accessSpheres: new Set(), specificTalents: new Set(), pendingReplacements: [] };
}
// Mapa TÍTULO da esfera → talentos específicos concedidos (p/ exibição na ficha).
// Inclui esferas de acesso-concedido (lista vazia) para que apareçam na ficha.
function grantedSpheresMap(char) {
  const map = new Map();
  const g = charGrants(char);
  for (const sid of g.accessSpheres) { const title = sphereTitleById.get(sid) || sid; if (!map.has(title)) map.set(title, []); }
  for (const id of g.specificTalents) {
    const t = dataIndex && dataIndex.talentById.get(id);
    if (!t) continue;
    const title = sphereTitleById.get(t.sphere) || t.sphere;
    if (!map.has(title)) map.set(title, []);
    map.get(title).push({ id: t.id, name: t.name, sphere: title });
  }
  return map;
}
// Esfera com ACESSO concedido de graça (custo 0 + selo "concedida").
function isGrantedSphere(char, title) { const sid = sphereIdFor(title); return !!sid && charGrants(char).accessSpheres.has(sid); }
// Um talento específico concedido pela subclasse é fixo (não removível/alternável).
function isGrantedTalentId(char, id) { return !!id && charGrants(char).specificTalents.has(id); }

/* ---- Esferas adquiridas (custo real + escolha grátis condicional) ------------
   entry = { sphere: <id>, section, choices:{pkg?}, freePicks:[talentId…], talents:[talentId…] }.
   Custo = 1 (acesso) + talentos-extra; bases e os freePicks são grátis. Chamadores
   continuam trabalhando por TÍTULO de capítulo — a conversão título→id acontece
   aqui dentro via sphereIdFor/sphereByTitle. -------------------------------- */
function sphereEntry(char, title) {
  const sid = sphereIdFor(title);
  return (char && sid && Array.isArray(char.spheres)) ? char.spheres.find(s => s.sphere === sid) : null;
}
// Acesso de uma esfera: grátis (0) se concedida pela subclasse; senão 1 talento.
function sphereAccessCost(char, title) { return isGrantedSphere(char, title) ? 0 : 1; }
function sphereCost(entry, char) {
  const title = sphereTitleById.get(entry.sphere) || entry.sphere;
  const access = char ? sphereAccessCost(char, title) : 1;
  return access + (entry && entry.talents ? entry.talents.length : 0);
}

// Ação de baixo nível "garanta que a entrada existe" — usada tanto pelo botão de
// adquirir (via tryAcquireSphere, que checa Rules.canAccessSphere antes) quanto
// internamente por setPackage/addFreePick/toggleExtraTalent, que só ajustam uma
// esfera já adquirida (idempotente: não repete o bloqueio de orçamento).
function acquireSphere(char, title) {
  if (!char) return null;
  const sid = sphereIdFor(title);
  const sph = sid && dataIndex ? dataIndex.sphereById.get(sid) : null;
  if (!sph) return null; // dados da esfera não carregados/reconhecidos
  if (!Array.isArray(char.spheres)) char.spheres = [];
  let e = sphereEntry(char, title);
  if (!e) {
    // Marca se o ACESSO é concedido (grátis) — calculado ANTES de inserir a entrada
    // (a esfera ainda não está em char.spheres, então não interfere no cálculo).
    e = { sphere: sid, section: sph.section, granted: isGrantedSphere(char, title), choices: {}, freePicks: [], talents: [] };
    char.spheres.push(e);
    updateCharacter(char.id, { spheres: char.spheres });
  }
  return e;
}
// Ação do usuário "Adquirir esta esfera": bloqueia se Rules.canAccessSphere não
// permitir (orçamento esgotado); adquirir uma esfera já adquirida é um no-op ok.
function tryAcquireSphere(char, title) {
  if (!char) return { ok: false, message: 'Crie ou selecione um personagem primeiro.' };
  if (sphereEntry(char, title)) return { ok: true };
  // Acesso concedido pela subclasse é grátis e automático — "adquirir" é um no-op
  // (não cria entrada; criar uma faria a esfera contar como "acesso prévio pago" na
  // regra condicional de concessões).
  if (isGrantedSphere(char, title)) return { ok: true };
  const sid = sphereIdFor(title);
  if (!sid || !dataIndex) return { ok: false, message: 'Os dados desta esfera não puderam ser carregados — recarregue a página.' };
  const check = Rules.canAccessSphere(char, sid, dataIndex);
  if (!check.ok) return { ok: false, message: `Sem talentos ${check.section === 'martial' ? 'marciais' : 'mágicos'} suficientes para adquirir ${title}.` };
  acquireSphere(char, title);
  return { ok: true };
}
function removeSphere(char, title) {
  if (!char || !Array.isArray(char.spheres)) return;
  const sid = sphereIdFor(title);
  char.spheres = char.spheres.filter(s => s.sphere !== sid);
  updateCharacter(char.id, { spheres: char.spheres });
}
// Escolhe o pacote-base (Alquimia). Muda o grupo-grátis → limpa os grátis atuais.
// Gate: pacotes com `requires` (ex.: Criação de Magias exige ≥2 esferas mágicas)
// são bloqueados — a option já vem disabled no seletor; isto é a defesa extra.
function setPackage(char, title, pkgId) {
  if (pkgId && dataIndex && !Rules.packageRequirementMet(char, sphereIdFor(title), pkgId, dataIndex).ok) return false;
  const e = acquireSphere(char, title);
  e.choices = e.choices || {};
  e.choices.pkg = pkgId || null;
  e.freePicks = [];
  updateCharacter(char.id, { spheres: char.spheres });
  return true;
}
// Define/limpa o grátis do slot `index` (usado pelos seletores da barra). `talentId`
// é um id de talento (ou null p/ limpar); a checagem de pré-requisito acontece no
// chamador (setupFavorites), aqui só a mutação de estado.
function setFreePickAt(char, title, index, talentId) {
  const e = acquireSphere(char, title);
  const cap = resolveSpec(char, title, e.choices).freePicks;
  const picks = (e.freePicks || []).slice(0, cap);
  while (picks.length < cap) picks.push(null);
  if (talentId) {
    e.talents = (e.talents || []).filter(id => id !== talentId);   // grátis e extra são exclusivos
    for (let i = 0; i < picks.length; i++) if (i !== index && picks[i] === talentId) picks[i] = null;
    if (index < cap) picks[index] = talentId;
  } else if (index < picks.length) {
    picks[index] = null;
  }
  e.freePicks = picks.filter(Boolean);
  updateCharacter(char.id, { spheres: char.spheres });
}
// Adiciona um grátis no próximo slot livre (clique no + de um card elegível).
// Mutação pura — quem chama (addFreePickChecked) já confirmou o pré-requisito.
function addFreePick(char, title, talentId) {
  const e = acquireSphere(char, title);
  const cap = resolveSpec(char, title, e.choices).freePicks;
  if (!Array.isArray(e.freePicks)) e.freePicks = [];
  if (e.freePicks.length >= cap || e.freePicks.includes(talentId)) return false;
  e.talents = (e.talents || []).filter(id => id !== talentId);
  e.freePicks.push(talentId);
  updateCharacter(char.id, { spheres: char.spheres });
  return true;
}
function removeFreePick(char, title, talentId) {
  const e = sphereEntry(char, title);
  if (!e) return;
  e.freePicks = (e.freePicks || []).filter(id => id !== talentId);
  updateCharacter(char.id, { spheres: char.spheres });
}
// Alterna um talento-extra (+1): remove se já presente (nunca bloqueado), adiciona
// se ausente — quem chama para ADICIONAR (addExtraTalentChecked) já confirmou
// Rules.canAddTalent antes. Não adiciona algo que já é grátis.
function toggleExtraTalent(char, title, talentId) {
  const e = acquireSphere(char, title);
  if ((e.freePicks || []).includes(talentId)) return false;
  const i = e.talents.findIndex(id => id === talentId);
  if (i >= 0) { e.talents.splice(i, 1); updateCharacter(char.id, { spheres: char.spheres }); return false; }
  e.talents.push(talentId);
  updateCharacter(char.id, { spheres: char.spheres });
  return true;
}

/* ---- Classificação e resolução das regras de aquisição -----------------------
   Lê SEMPRE dado estruturado (sph.acquisition / talent.tags|kind|group), nunca o
   DOM — a única ponte com o card renderizado é resolveTalentId (nome + classe
   .base-ability, só para identificar QUAL talento o card é). ------------------ */
// Nome-base de um talento (sem a tag entre parênteses no fim): "Cativar (encanto)" → "Cativar".
// Usado para casar talentos concedidos (nomeados sem tag) com os nomes reais.
function talentBaseName(s) { return String(s).replace(/\s*\([^)]*\)\s*$/, '').trim(); }
function matchesFreeGroupStructured(talent, fg) {
  if (!fg) return true; // fallback: qualquer não-base é elegível ao grátis
  if (fg.tag || fg.tags) {
    const want = (fg.tags || [fg.tag]).map(normalizeTerm);
    return (talent.tags || []).map(normalizeTerm).some(w => want.includes(w));
  }
  if (fg.h3) { try { return new RegExp(fg.h3, 'i').test(talent.group || ''); } catch (_) { return false; } }
  return false;
}
// Spec de CLASSIFICAÇÃO (independe do personagem/proficiência): grupo-grátis,
// tags de talento válidas e se a esfera/pacote pode conceder grátis. Depende só
// do título + pacote escolhido → base do cache do getSphereModel.
function classSpec(title, pkg) {
  const sph = sphereByTitle(title);
  const rule = (sph && sph.acquisition) || {};
  let fg = rule.freeGroup || null, freeLabel = rule.freeLabel || 'talento', talentTags = rule.talentTags || null;
  let baseFree = rule.freePicks != null ? rule.freePicks : 1;
  let conds = rule.conditionals || [];
  let baseTalentIds = [];   // habilidades-base concedidas pelo pacote (ex.: Dissipar)
  if (rule.packages) {
    const opt = rule.packages.options.find(o => o.id === pkg);
    if (opt) {
      fg = opt.freeGroup || null; freeLabel = opt.freeLabel || freeLabel;
      talentTags = opt.talentTags || talentTags; baseFree = opt.freePicks != null ? opt.freePicks : 0;
      conds = opt.conditionals || []; baseTalentIds = opt.baseTalentIds || [];
    } else { baseFree = 0; conds = []; } // pacote ainda não escolhido
  }
  // O que "pertence a algum pacote" desta esfera (tags de pacote + habilidades-base
  // de qualquer pacote) — p/ talentRole distinguir talento GERAL de talento de OUTRO
  // pacote (KG-4 / decisão b). Base de outro pacote ≠ geral.
  const allPackageTags = [], allPackageBaseIds = [];
  if (rule.packages) {
    const set = new Set(), bases = new Set();
    for (const o of rule.packages.options) {
      for (const t of (o.talentTags || [])) set.add(normalizeTerm(t));
      const fgt = o.freeGroup && (o.freeGroup.tags || (o.freeGroup.tag ? [o.freeGroup.tag] : []));
      for (const t of (fgt || [])) set.add(normalizeTerm(t));
      for (const id of (o.baseTalentIds || [])) bases.add(id);
    }
    for (const t of set) allPackageTags.push(t);
    for (const id of bases) allPackageBaseIds.push(id);
  }
  return { fg, freeLabel, talentTags, baseFree, conds, baseTalentIds, allPackageTags, allPackageBaseIds, canFree: baseFree > 0 || conds.length > 0, packages: rule.packages || null };
}
// Spec RESOLVIDO (com o personagem): capacidade de grátis = base + condicionais
// satisfeitas por proficiência.
function resolveSpec(char, title, choices) {
  choices = choices || {};
  const cs = classSpec(title, choices.pkg);
  let freePicks = cs.baseFree;
  const conditionals = cs.conds.map(c => {
    const satisfied = isProficient(char, c.requires);
    if (satisfied) freePicks += (c.addPicks != null ? c.addPicks : 1);
    return { requires: c.requires, addPicks: c.addPicks != null ? c.addPicks : 1, satisfied };
  });
  return { fg: cs.fg, freeLabel: cs.freeLabel, talentTags: cs.talentTags, canFree: cs.canFree, freePicks, conditionals, packages: cs.packages, pkg: choices.pkg || null };
}
// Papel ESTRUTURAL de um Talent (base/free/extra/ignore), lido do dado, não do DOM.
function talentRole(talent, cs) {
  if (cs.baseTalentIds && cs.baseTalentIds.includes(talent.id)) return 'base'; // habilidade-base do pacote (auto)
  if (cs.talentTags && cs.talentTags.length) {
    const tags = (talent.tags || []).map(normalizeTerm);
    const hasChosen = cs.talentTags.map(normalizeTerm).some(w => tags.includes(w));
    // Pertence a OUTRO pacote se tem tag de pacote ≠ a escolhida OU é habilidade-base de
    // outro pacote → ignora. Talentos GERAIS (nenhuma tag/base de pacote) ficam
    // disponíveis em qualquer pacote (decisão b).
    const isOtherPkgBase = (cs.allPackageBaseIds || []).includes(talent.id) && !(cs.baseTalentIds || []).includes(talent.id);
    if (!hasChosen && ((cs.allPackageTags || []).some(t => tags.includes(t)) || isOtherPkgBase)) return 'ignore';
  }
  if (talent.kind === 'base') return 'base';
  if (!cs.canFree) return 'extra';
  return matchesFreeGroupStructured(talent, cs.fg) ? 'free' : 'extra';
}
// Contexto de concessão de uma esfera para um personagem (p/ cardDisplayRole/UI).
function grantCtxFor(char, title) {
  const g = charGrants(char);
  const sid = sphereIdFor(title);
  return {
    granted: !!sid && g.accessSpheres.has(sid),  // esfera de acesso-concedido (base grátis)
    specificTalents: g.specificTalents,           // ids dos talentos específicos concedidos
    title,
  };
}
// Papel de EXIBIÇÃO de um card do DOM: casa o card com o talento estruturado
// (nome + .base-ability p/ desambiguar homônimos), lê o papel estrutural do
// modelo da esfera e aplica a sobreposição "concedido pela subclasse" por cima
// (específica do personagem, não da esfera — nunca lê o DOM p/ decidir a regra).
function cardDisplayRole(model, title, name, isBaseCard, gc) {
  const id = resolveTalentId(title, name, isBaseCard);
  const structural = id ? (model.roleByKey.get(id) || 'ignore') : 'ignore';
  if (structural === 'ignore' || structural === 'base') return { id, role: structural };
  if (id && gc && gc.specificTalents.has(id)) return { id, role: 'granted' };  // talento específico concedido
  return { id, role: structural };  // free/extra normal — esfera concedida também dá o grátis inicial da esfera
}
// Classifica os TALENTOS da esfera (dado estruturado; para o pacote escolhido).
// Cacheado por título|pacote. `model.frag` guarda os cards renderizados do
// capítulo — usado só por charTalentCard/findCardInFrag para CLONAR o card
// completo na ficha (exibição), nunca para decidir papel/regra.
function getSphereModel(title, pkg) {
  const key = title + '|' + (pkg || '');
  if (sphereModelCache.has(key)) return sphereModelCache.get(key);
  const sph = sphereByTitle(title);
  const cs = classSpec(title, pkg);
  const model = { bases: [], freeGroup: [], extras: [], freeLabel: cs.freeLabel, roleByKey: new Map(), frag: null };
  if (sph) {
    for (const t of sph.talents) {
      const role = talentRole(t, cs);
      if (role === 'ignore') continue;
      const item = { id: t.id, name: t.name, sphere: title, section: t.section };
      model.roleByKey.set(t.id, role);
      (role === 'base' ? model.bases : role === 'free' ? model.freeGroup : model.extras).push(item);
    }
  }
  const chapter = chapters.find(ch => ch.title === title);
  if (chapter) model.frag = buildChapterCardFrag(chapter); // só p/ clonar cards completos na ficha
  sphereModelCache.set(key, model);
  return model;
}
// Acha o card renderizado de um Talent estruturado, desambiguando homônimos pelo
// mesmo sinal usado na extração (.base-ability ⟺ kind:'base').
function findCardInFrag(frag, talent) {
  if (!frag || !talent) return null;
  let byKind = null, byName = null;
  for (const card of frag.querySelectorAll('.talent-card')) {
    const h = card.querySelector(':scope > h4, :scope > h5');
    if (!h) continue;
    if (h.textContent.trim() !== talent.name) continue;
    if (!byName) byName = card;
    const isBaseCard = card.classList.contains('base-ability');
    if ((talent.kind === 'base') === isBaseCard) { byKind = card; break; }
  }
  return byKind || byName;
}

// Valores derivados (proficiência, CD, recurso, orçamento por nível) e bônus de
// tradição/classe-feature — delegados ao Rules engine (nunca recomputados aqui),
// só com um fallback seguro quando dataIndex ainda não carregou.
function characterStats(char) {
  return (char && dataIndex) ? Rules.derivedStats(char, dataIndex) : null;
}
function traditionBonus(char) {
  return (char && dataIndex) ? Rules.traditionBonus(char, dataIndex) : 0;
}
function classFeatureBonus(char) {
  return (char && dataIndex) ? Rules.classFeatureBonus(char, dataIndex) : { magic: 0, martial: 0, notes: [] };
}

/* ---- Tradições (Conjurador / Marcial) ---------------------------------------
   Por ora só a opção "Base" (+2 talentos do tipo da classe). Estrutura pronta
   para tradições reais (bônus/desvantagens) no futuro. O tipo do seletor segue
   o tipo da classe: magic → Tradição de Conjurador; martial → Tradição Marcial. */
const TRADITIONS = {
  magic:   { label: 'Tradição de Conjurador', options: [{ id: 'base', label: 'Base', bonus: 2 }] },
  martial: { label: 'Tradição Marcial',       options: [{ id: 'base', label: 'Base', bonus: 2 }] },
};
// Campo <select> da tradição no formulário (só quando a classe define um tipo).
function traditionField(char) {
  const cls = dataIndex && dataIndex.classes[char.className];
  const t = cls && TRADITIONS[cls.type];
  if (!t) return '';
  const opts = ['<option value="">— nenhuma —</option>']
    .concat(t.options.map(o => `<option value="${o.id}"${char.tradition === o.id ? ' selected' : ''}>${escapeHtml(o.label)} (+${o.bonus} talentos)</option>`))
    .join('');
  return `<label class="char-field-l">${t.label}
       <select class="char-field" data-field="tradition">${opts}</select>
     </label>`;
}
// Campo <select> da subclasse (opções das subclasses da classe, via TOC).
function subclassField(char) {
  const subs = subclassesOf(char.className);
  if (!subs.length) return '';
  const opts = ['<option value="">— nenhuma —</option>']
    .concat(subs.map(s => `<option value="${escapeHtml(s)}"${char.subclass === s ? ' selected' : ''}>${escapeHtml(s)}</option>`))
    .join('');
  return `<label class="char-field-l">Subclasse
       <select class="char-field" data-field="subclass">${opts}</select>
     </label>`;
}

// Seção de proficiências: chips alternáveis de perícias + ferramentas.
// Gravadas em char.proficiencies.{skills,tools} como ids normalizados.
function buildProficiencies(char) {
  const wrap = document.createElement('section');
  wrap.className = 'char-profs';
  const h2 = document.createElement('h2');
  h2.className = 'char-profs-title';
  h2.textContent = 'Proficiências';
  wrap.appendChild(h2);
  const hint = document.createElement('p');
  hint.className = 'char-profs-hint';
  hint.textContent = 'Marque as perícias e ferramentas em que você já é proficiente (classe/antecedente). Isso libera as escolhas grátis condicionais de algumas esferas.';
  wrap.appendChild(hint);

  const prof = char.proficiencies || {};
  const has = (kind, label) => ((prof[kind] || []).map(normalizeTerm)).includes(normalizeTerm(label));
  const row = (title, kind, labels) => {
    const r = document.createElement('div');
    r.className = 'char-profs-row';
    const cap = document.createElement('span');
    cap.className = 'char-profs-cap';
    cap.textContent = title;
    r.appendChild(cap);
    for (const label of labels) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'prof-chip' + (has(kind, label) ? ' on' : '');
      chip.dataset.kind = kind;
      chip.dataset.prof = normalizeTerm(label);
      chip.setAttribute('aria-pressed', has(kind, label) ? 'true' : 'false');
      chip.textContent = label;
      r.appendChild(chip);
    }
    wrap.appendChild(r);
  };
  row('Perícias', 'skills', SKILLS_5E);
  row('Ferramentas', 'tools', TOOLS_COND);
  return wrap;
}

// Títulos das esferas do personagem (adquiridas ∪ concedidas pela subclasse) —
// mesma união usada pelo antigo loop per-sphere e pelo rail da bancada (Layout B).
function charSphereTitles(active) {
  if (!active) return [];
  const titles = (active.spheres || []).map(e => sphereTitleById.get(e.sphere) || e.sphere);
  const grantedMap = grantedSpheresMap(active);
  for (const t of grantedMap.keys()) if (!titles.includes(t)) titles.push(t);
  return titles;
}

// Candidatos a talento de UMA esfera (grátis OU extra, pelo dado estruturado —
// nunca base/concedido-fixo): mesma conta que o antigo buildAddTalentPicker
// (freeGroup+extras − já possuídos − concedidos específicos). Só esferas já
// adquiridas ou concedidas têm candidatos (as demais nunca aparecem aqui).
function talentCandidatesForSphere(active, title) {
  const entry = sphereEntry(active, title);
  const granted = isGrantedSphere(active, title);
  if (!entry && !granted) return [];
  const model = getSphereModel(title, entry && entry.choices && entry.choices.pkg);
  const e = entry || { freePicks: [], talents: [] };
  // char.metamagic entra na exclusão: um talento tomado pela cota restrita (Metamágica)
  // não pode reaparecer como extra comprável na esfera comum (dedupe nos dois sentidos —
  // metamagicCandidates já exclui via Rules.ownedTalentIds, que inclui char.metamagic).
  const owned = new Set([...(e.freePicks || []), ...(e.talents || []), ...((active && active.metamagic) || [])]);
  return model.freeGroup.concat(model.extras)
    .filter(it => !owned.has(it.id) && !isGrantedTalentId(active, it.id))
    .map(it => ({ id: it.id, name: it.name, sphere: title }));
}

// Cota restrita ativa do personagem (ex.: Metamágica do Feiticeiro nível ≥3) — Rules
// já garante 0 ou 1 item hoje (escopo atual); null quando a feature não existe (nível
// baixo, outra classe, ou a subclasse não a concede).
function metamagicAllowance(active) {
  if (!active || !dataIndex) return null;
  const list = Rules.restrictedAllowances(active, dataIndex);
  return list[0] || null;
}

// Caminho que applyTalentToggle tomaria ao adicionar este candidato: 'free'
// (ocupa uma escolha grátis, custo 0) ou 'extra' (custa 1 talento). Mesma
// árvore de decisão de applyTalentToggle (892) — só para EXIBIR o rótulo de
// custo/estado; a mutação real sempre passa por applyTalentToggle.
function talentPickPath(active, title, item) {
  if (isGrantedSphere(active, title)) return 'extra';
  const entry = sphereEntry(active, title);
  if (!entry) return 'extra';
  const model = getSphereModel(title, entry.choices && entry.choices.pkg);
  const role = model.roleByKey.get(item.id) || 'extra';
  if (role !== 'free') return 'extra';
  const cap = resolveSpec(active, title, entry.choices).freePicks;
  const room = (entry.freePicks || []).length < cap;
  return room ? 'free' : 'extra';
}

// Descreve prerequisitos estruturados (nível/esfera/talento) por extenso, em PT-BR.
function describePrereqs(list) {
  return list.map(p => {
    if (p.type === 'level') return `nível ${p.min}`;
    if (p.type === 'sphere') return sphereTitleById.get(p.id) || p.id;
    if (p.type === 'talent') { const t = dataIndex.talentById.get(p.id); return t ? t.name : p.id; }
    return 'pré-requisito em texto';
  }).join(', ');
}
function prereqStatusLabel(pre, talent) {
  if (!pre.missing.length) {
    if (pre.unverified.length) return 'Pré-requisito em texto — confirme manualmente se é atendido.';
    if (talent && talent.prerequisites && talent.prerequisites.length) return 'Requer ' + describePrereqs(talent.prerequisites) + ' — disponível.';
    return 'Sem pré-requisitos — disponível.';
  }
  return 'Requer ' + describePrereqs(pre.missing) + '.';
}
// Gate SÓ-DE-EXIBIÇÃO de um candidato a talento (motivo do bloqueio na lista/
// detalhe da bancada): Rules.prereqCheck quando cairia no caminho grátis,
// Rules.canAddTalent (pré-requisito + orçamento) quando cairia no caminho extra.
// Leitura apenas — nunca muta; a mutação real segue por applyTalentToggle.
function talentGate(active, title, item) {
  const talent = dataIndex && dataIndex.talentById.get(item.id);
  if (!talent) return { blocked: true, label: 'Talento não encontrado nos dados estruturados.' };
  const path = talentPickPath(active, title, item);
  if (path === 'free') {
    const pre = Rules.prereqCheck(active, talent, dataIndex);
    return { blocked: !pre.ok, label: prereqStatusLabel(pre, talent) };
  }
  const check = Rules.canAddTalent(active, talent, dataIndex);
  if (!check.prereq.ok) return { blocked: true, label: prereqStatusLabel(check.prereq, talent) };
  if (!check.budgetOk) return { blocked: true, label: `Sem talentos ${check.section === 'martial' ? 'marciais' : 'mágicos'} suficientes (nível ${active.level}).` };
  return { blocked: false, label: prereqStatusLabel(check.prereq, talent) };
}

// Esferas candidatas a adquirir (não possuídas nem concedidas), agrupadas
// magia/poder — mesma conta do antigo buildAddSpherePicker, sem construir DOM
// (a bancada monta lista+detalhe a partir disto).
function sphereCandidates(active) {
  if (!dataIndex) return { magic: [], martial: [] };
  const have = new Set((active.spheres || []).map(e => sphereTitleById.get(e.sphere) || e.sphere));
  const granted = grantedSpheresMap(active);
  const groups = { magic: [], martial: [] };
  for (const sph of dataIndex.sphereById.values()) {
    const title = sph.name;
    if (have.has(title) || granted.has(title)) continue;
    (groups[sph.section] || groups.magic).push({ id: sph.id, title, section: sph.section });
  }
  groups.magic.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  groups.martial.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  return groups;
}

// Card recolhível de um talento na "Bancada" (painel .char-build): clona o card
// completo da esfera → lê a descrição inteira sem sair da ficha; reusa
// .fav-card/.fav-toggle. `ref` é um id de talento estruturado (caminho normal)
// ou, para dados antigos que a migração não conseguiu resolver, o objeto legado
// {name,sphere,anchor,slug} (mantido — nunca descartado silenciosamente).
// Hoisted para módulo (era interno a renderCharacter) — só lê módulo-level
// (dataIndex/chapters), sem estado de um render específico.
function charTalentCard(fr, ref, kind, title) {
  const wrap = document.createElement('div');
  wrap.className = 'char-talent' + (kind === 'extra' ? ' char-talent-extra' : '');
  const isLegacy = ref && typeof ref === 'object';
  const talentId = isLegacy ? null : ref;
  const talent = talentId ? dataIndex.talentById.get(talentId) : null;
  const name = talent ? talent.name : (isLegacy ? ref.name : String(ref));
  if (kind === 'extra') {
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'char-talent-remove'; rm.textContent = '✕';
    rm.title = 'Remover do personagem'; rm.dataset.char = JSON.stringify(ref); rm.dataset.sphere = title;
    wrap.appendChild(rm);
  }
  const src = talent ? findCardInFrag(fr, talent) : null;
  if (!src) { // fallback: link simples (card não encontrado / dado legado sem id)
    const chapter = chapters.find(c => c.title === title);
    const a = document.createElement('a');
    a.href = (isLegacy && ref.anchor) ? ref.anchor : (chapter ? chapter.anchor : '#');
    a.className = 'fav-go';
    if (isLegacy && ref.slug) a.dataset.slug = ref.slug;
    a.textContent = name;
    wrap.appendChild(a);
    return wrap;
  }
  const clone = src.cloneNode(true);
  clone.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); // evita ids duplicados
  clone.classList.add('fav-card', 'collapsed');
  const head = clone.querySelector(':scope > h4, :scope > h5');
  if (head) {
    head.classList.add('fav-toggle');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', 'false');
    if (kind !== 'extra') {
      const tag = document.createElement('span');
      tag.className = 'char-card-tag' + (kind === 'free' ? ' char-tag-free' : kind === 'granted' ? ' char-tag-granted' : '');
      tag.textContent = kind === 'free' ? 'grátis' : kind === 'granted' ? 'concedido' : 'base';
      head.appendChild(tag);
    }
  }
  wrap.appendChild(clone);
  return wrap;
}

// Painel "Bancada — build" (.char-build): SÓ a esfera ativa (charView.sphere).
// Extraído do antigo corpo do loop per-sphere — mesmo DOM (cabeçalho +
// .char-sphere-manage + "Incluído com a esfera" + "Talentos" + "Remover esfera"),
// mantém a classe .char-sphere (guards .closest('.char-sphere') de P1/P2 dependem
// dela). Só que agora roda para UMA esfera por vez, não num loop.
function renderSphereBuildPanel(active, title) {
  const entry = sphereEntry(active, title);
  const granted = isGrantedSphere(active, title); // acesso concedido → selo "concedida" + não removível
  const grantedMap = grantedSpheresMap(active);
  const grantedItems = grantedMap.get(title) || [];
  const model = getSphereModel(title, entry && entry.choices && entry.choices.pkg);
  const fr = model.frag;
  const freePicks = (entry && entry.freePicks) || [];
  const extras = (entry && entry.talents) || [];
  const unresolvedLegacy = (entry && entry._unresolvedLegacy) || [];
  const count = grantedItems.length + freePicks.length + extras.length;

  const group = document.createElement('section');
  group.className = 'char-sphere';
  const h3 = document.createElement('h3');
  h3.className = 'char-sphere-title char-sphere-toggle';
  h3.dataset.sphere = title;
  h3.setAttribute('role', 'button');
  h3.setAttribute('tabindex', '0');
  h3.title = 'Recolher esta esfera';
  h3.textContent = `${title} — ${count} talento(s)`;
  if (granted) {
    const badge = document.createElement('span');
    badge.className = 'char-granted-badge';
    badge.textContent = 'concedida';
    h3.appendChild(badge);
  }
  group.appendChild(h3);

  if (unresolvedLegacy.length) {
    const warn = document.createElement('p');
    warn.className = 'char-warn';
    warn.textContent = `${unresolvedLegacy.length} talento(s) salvo(s) antes desta atualização não puderam ser reconhecidos automaticamente: ${unresolvedLegacy.map(it => it.name).join(', ')}. Reabra-os pelo capítulo e adicione de novo.`;
    group.appendChild(warn);
  }

  // Gestão in-sheet: pacote-base (Alquimia/Universal) + escolhas grátis
  // (mesmos helpers da barra de aquisição da leitura — P1/P2 funcionam aqui também).
  const choices = (entry && entry.choices) || {};
  const spec = resolveSpec(active, title, choices);
  const pkgSel = buildPackageSelector(active, title, spec);
  const freePickSels = buildFreePickSelectors(active, title, spec, model, entry);
  if (pkgSel || freePickSels.length) {
    const manage = document.createElement('div');
    manage.className = 'char-sphere-manage';
    if (pkgSel) manage.appendChild(pkgSel);
    for (const lbl of freePickSels) manage.appendChild(lbl);
    group.appendChild(manage);
  }

  if (model.bases.length || freePicks.length || grantedItems.length) {
    const sub = document.createElement('p'); sub.className = 'char-subhead'; sub.textContent = 'Incluído com a esfera';
    group.appendChild(sub);
    const box = document.createElement('div'); box.className = 'char-cards';
    for (const it of model.bases) box.appendChild(charTalentCard(fr, it.id, 'base', title));
    for (const it of grantedItems) box.appendChild(charTalentCard(fr, it.id, 'granted', title));
    for (const id of freePicks) box.appendChild(charTalentCard(fr, id, 'free', title));
    group.appendChild(box);
  }

  if (extras.length) {
    const sub = document.createElement('p'); sub.className = 'char-subhead'; sub.textContent = 'Talentos';
    group.appendChild(sub);
    const box = document.createElement('div'); box.className = 'char-cards';
    for (const id of extras) box.appendChild(charTalentCard(fr, id, 'extra', title));
    group.appendChild(box);
  }

  if (!granted) { // esferas concedidas pela subclasse não podem ser removidas
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'char-sphere-remove'; rm.dataset.removesphere = title;
    rm.textContent = 'Remover esfera';
    group.appendChild(rm);
  }

  return group;
}

// Conteúdo de .char-build para o render/refresh atual: nada durante o catálogo
// de esferas (benchMode='spheres' — a bancada ocupa a tela toda), mensagem
// quando não há esfera ativa, senão o painel da esfera ativa.
function buildCharBuildContent(active) {
  if (charView.benchMode === 'spheres') return null;
  const titles = charSphereTitles(active);
  const mm = metamagicAllowance(active);
  if (!titles.length && !mm) {
    const p = document.createElement('p');
    p.className = 'glossary-intro';
    p.textContent = 'Nenhuma esfera ainda. Use “+ Adicionar esfera” na bancada abaixo para começar.';
    return p;
  }
  // Accordion: TODAS as esferas adquiridas/concedidas ficam visíveis — a ativa
  // (charView.sphere) expandida com o painel completo (gestão + cards), as demais
  // recolhidas (cabeçalho clicável = nome + contagem) → visão do conjunto num relance.
  // A entrada Metamágica (cota restrita, sentinela METAMAGIC_KEY) entra por último,
  // com o mesmo mecanismo de expandir/recolher — só quando a feature existe.
  const acc = document.createElement('div');
  acc.className = 'char-accordion';
  for (const title of titles) {
    if (title === charView.sphere) acc.appendChild(renderSphereBuildPanel(active, title));
    else acc.appendChild(buildCollapsedSphere(active, title));
  }
  if (mm) {
    if (charView.sphere === METAMAGIC_KEY) acc.appendChild(renderMetamagicPanel(active, mm));
    else acc.appendChild(buildCollapsedMetamagic(active, mm));
  }
  return acc;
}

// Cabeçalho recolhido da entrada Metamágica no accordion — mesmo padrão de
// buildCollapsedSphere (reusa .char-sphere-collapsed + o handler já existente que lê
// data-sphere), só que a "contagem" é X/N escolhas em vez de N talento(s).
function buildCollapsedMetamagic(active, allowance) {
  const count = (active.metamagic || []).length;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'char-sphere-collapsed char-mm-entry';
  btn.dataset.sphere = METAMAGIC_KEY;
  btn.innerHTML = `<span class="csc-caret" aria-hidden="true">▸</span><span class="csc-name">✦ Metamágica</span>`
    + `<span class="csc-count">${count}/${allowance.count} escolha(s)</span>`;
  return btn;
}

// Painel expandido da entrada Metamágica no accordion — espelha renderSphereBuildPanel:
// mesma classe .char-sphere (as guards .closest('.char-sphere') de P1/P2 dependem dela)
// e mesmo cabeçalho clicável (.char-sphere-toggle, sentinela METAMAGIC_KEY) para recolher.
// As escolhas vivem em char.metamagic (ids de talento), custo 0 e fora do orçamento geral
// — este painel só EXIBE; a mutação (push/remove) é tratada em setupCharacter via
// .char-mm-add/.char-mm-remove (nunca applyTalentToggle).
function renderMetamagicPanel(active, allowance) {
  const picks = active.metamagic || [];
  const model = getSphereModel(allowance.sphere, null);

  const group = document.createElement('section');
  group.className = 'char-sphere';
  const h3 = document.createElement('h3');
  h3.className = 'char-sphere-title char-sphere-toggle char-mm-entry';
  h3.dataset.sphere = METAMAGIC_KEY;
  h3.setAttribute('role', 'button');
  h3.setAttribute('tabindex', '0');
  h3.title = 'Recolher esta entrada';
  h3.textContent = `✦ Metamágica — ${picks.length}/${allowance.count} escolha(s)`;
  group.appendChild(h3);

  if (allowance.note) {
    const note = document.createElement('p');
    note.className = 'char-subhead';
    note.textContent = allowance.note;
    group.appendChild(note);
  }

  if (picks.length) {
    const sub = document.createElement('p'); sub.className = 'char-subhead'; sub.textContent = 'Escolhidos';
    group.appendChild(sub);
    const box = document.createElement('div'); box.className = 'char-cards';
    for (const id of picks) {
      // charTalentCard(kind='free') não inclui botão de remoção próprio — o ✕ aqui é
      // .char-mm-remove (NÃO .char-talent-remove, que chamaria toggleExtraTalent).
      const card = charTalentCard(model.frag, id, 'free', allowance.sphere);
      card.classList.add('char-talent-extra');
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'char-mm-remove';
      rm.dataset.id = id;
      rm.title = 'Remover da Metamágica';
      rm.textContent = '✕';
      card.insertBefore(rm, card.firstChild);
      box.appendChild(card);
    }
    group.appendChild(box);
  }

  if (picks.length < allowance.count) {
    const hint = document.createElement('p');
    hint.className = 'char-subhead';
    hint.textContent = `Escolha ${allowance.count - picks.length} talento(s) de metaesfera na bancada abaixo.`;
    group.appendChild(hint);
  }

  return group;
}

// Cabeçalho recolhido de uma esfera no accordion: nome + selo "concedida" +
// contagem de talentos. Clicar torna a esfera ativa (setupCharacter → refreshCharBench),
// expandindo-a e recolhendo a anterior.
function buildCollapsedSphere(active, title) {
  const entry = sphereEntry(active, title);
  const granted = isGrantedSphere(active, title);
  const grantedItems = grantedSpheresMap(active).get(title) || [];
  const count = grantedItems.length + ((entry && entry.freePicks) || []).length + ((entry && entry.talents) || []).length;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'char-sphere-collapsed';
  btn.dataset.sphere = title;
  btn.innerHTML = `<span class="csc-caret" aria-hidden="true">▸</span><span class="csc-name">${escapeHtml(title)}</span>`
    + (granted ? '<span class="char-granted-badge">concedida</span>' : '')
    + `<span class="csc-count">${count} talento(s)</span>`;
  return btn;
}

function statCellHTML(label, val, hint) {
  return `<div class="char-stat"><span class="cs-val">${val}</span><span class="cs-label">${label}</span>${hint ? `<span class="cs-hint">${escapeHtml(hint)}</span>` : ''}</div>`;
}
function budgetBarHTML(active, label, used, total, hint) {
  const over = used > total;
  const pct = total > 0 ? Math.min(100, Math.round(used / total * 100)) : (used > 0 ? 100 : 0);
  return `<div class="char-budget-bar${over ? ' over' : ''}">
    <div class="cbb-line"><span>${escapeHtml(label)}</span><b>${used}/${total}</b></div>
    <div class="cbb-track"><i style="width:${pct}%"></i></div>
    ${over ? `<div class="cbb-warn">⚠ Acima do permitido para o nível ${active.level}.</div>` : (hint ? `<div class="cbb-hint">${escapeHtml(hint)}</div>` : '')}
  </div>`;
}
// Mini-grid de stats + barra(s) de orçamento do rail — MESMO cálculo do painel
// de valores derivados antigo (Rules.derivedStats/slotsSpent/traditionBonus/
// classFeatureBonus), só re-apresentado como grid compacto + barra em vez de
// células de texto soltas.
function buildCharBudgetHTML(active) {
  const stats = characterStats(active);
  if (!stats) return '';
  const spent = Rules.slotsSpent(active, dataIndex);
  const usedMagic = spent.magic, usedMartial = spent.martial;
  let cells = '';
  cells += statCellHTML('Proficiência', '+' + stats.prof);
  cells += statCellHTML('CD', stats.cd, '8 + prof + mod');
  cells += statCellHTML('Ataque', (stats.attack >= 0 ? '+' : '') + stats.attack);
  if (stats.resourceName) cells += statCellHTML(stats.resourceName, stats.resource);
  const tBonus = traditionBonus(active);        // +N da tradição (tipo da classe)
  const cfBonus = classFeatureBonus(active);    // +N de features de classe/subclasse
  const magicBudget = stats.magicTalents + (stats.type === 'magic' ? tBonus : 0) + cfBonus.magic;
  const martialBudget = stats.martialTalents + (stats.type === 'martial' ? tBonus : 0) + cfBonus.martial;
  const budgetHint = (b, cf) => {
    const parts = [];
    if (b) parts.push(`+${b} tradição`);
    if (cf) parts.push(`+${cf} classe/subclasse`);
    return parts.length ? 'inclui ' + parts.join(', ') : '';
  };
  let bars = '';
  if (stats.type === 'magic') bars += budgetBarHTML(active, 'Talentos mágicos', usedMagic, magicBudget, budgetHint(tBonus, cfBonus.magic));
  if (stats.type === 'martial' || usedMartial > 0) bars += budgetBarHTML(active, 'Talentos marciais', usedMartial, martialBudget, budgetHint(stats.type === 'martial' ? tBonus : 0, cfBonus.martial));
  let notes = '';
  if (cfBonus.notes.length) notes = `<ul class="char-feature-notes">${cfBonus.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
  return `<div class="char-stats">${cells}</div>${bars}${notes}`;
}

// Navegação de esferas do rail: um .char-rail-sphere por esfera (união
// spheres[]+grantedMap), selo "concedida" p/ granted, ativo destacado. A entrada
// "+ Adicionar esfera" fica na barra da bancada (sempre visível), não aqui.
function buildRailNavHTML(active) {
  const titles = charSphereTitles(active);
  const grantedMap = grantedSpheresMap(active);
  let nav = '';
  for (const title of titles) {
    const entry = sphereEntry(active, title);
    const granted = isGrantedSphere(active, title);
    const grantedItems = grantedMap.get(title) || [];
    const count = grantedItems.length + ((entry && entry.freePicks) || []).length + ((entry && entry.talents) || []).length;
    const isActive = charView.benchMode === 'talents' && charView.sphere === title;
    nav += `<button type="button" class="char-rail-sphere${isActive ? ' active' : ''}" data-sphere="${escapeHtml(title)}">
      <span>${escapeHtml(title)}</span>
      ${granted ? '<span class="crs-granted">concedida</span>' : `<span class="crs-count">${count}</span>`}
    </button>`;
  }
  if (!titles.length) nav += '<div class="char-railnav-empty">Nenhuma esfera ainda.</div>';
  return `<div class="char-railnav"><div class="char-railnav-h">Esferas</div>${nav}</div>`;
}

// Detalhe de um candidato a talento na bancada: tag da esfera, nome, custo
// (grátis vs. 1 slot — talentPickPath), descrição CLONADA do card real
// (findCardInFrag — nunca reconstruída), linha de pré-requisito (talentGate,
// só leitura) e o botão Adicionar = makeCharControl (mesmo estado +/✓/grátis
// do compêndio — o clique é tratado em setupCharacter via applyTalentToggle).
function buildTalentDetail(active, item) {
  const box = document.createElement('div');
  box.className = 'char-bench-detail-inner';
  if (!item) { box.innerHTML = '<div class="char-bench-empty">Selecione um talento à esquerda.</div>'; return box; }
  const title = item.sphere;
  const entry = sphereEntry(active, title);
  const granted = isGrantedSphere(active, title);
  const talent = dataIndex.talentById.get(item.id);
  const model = getSphereModel(title, entry && entry.choices && entry.choices.pkg);
  const sph = dataIndex.sphereById.get(sphereIdFor(title));
  const mtl = sph && sph.section === 'martial';
  const path = talentPickPath(active, title, item);
  const gate = talentGate(active, title, item);

  // Cabeçalho fixo: identidade + ação (Adicionar). Fica preso no topo enquanto o
  // corpo com as regras rola → a ação está sempre visível.
  const head = document.createElement('div');
  head.className = 'cbd-head';
  const info = document.createElement('div');
  info.className = 'cbd-head-info';
  const h4 = document.createElement('h4');
  h4.textContent = item.name;
  info.appendChild(h4);
  const meta = document.createElement('div');
  meta.className = 'cbd-meta';
  meta.textContent = `${title} · ${mtl ? 'poder' : 'magia'} · ${path === 'free' ? 'grátis — escolha da esfera' : `custa 1 talento ${mtl ? 'marcial' : 'mágico'}`}`;
  info.appendChild(meta);
  const req = document.createElement('div');
  req.className = 'cbd-req' + (gate.blocked ? ' bad' : '');
  req.innerHTML = (gate.blocked ? '⚠ ' : '✓ ') + '<b>Pré-requisito:</b> ' + escapeHtml(gate.label || '');
  info.appendChild(req);
  head.appendChild(info);
  const btn = makeCharControl(item, model.roleByKey.get(item.id) || 'extra', active, entry, false, granted);
  if (btn) {
    btn.classList.add('char-bench-add');
    if (!btn.classList.contains('on') && !btn.disabled) btn.textContent = 'Adicionar ao personagem';
    head.appendChild(btn);
  }
  box.appendChild(head);

  // Corpo rolável: o card de regras clonado (leitura em largura confortável).
  const body = document.createElement('div');
  body.className = 'cbd-body';
  const desc = document.createElement('div');
  desc.className = 'cbd-desc';
  const src = talent ? findCardInFrag(model.frag, talent) : null;
  if (src) {
    const clone = src.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    desc.appendChild(clone);
  } else {
    desc.textContent = 'Descrição não encontrada — abra o capítulo da esfera.';
  }
  body.appendChild(desc);
  box.appendChild(body);
  return box;
}

// Candidatos da cota de Metamágica: talentos da esfera-alvo da allowance (Universal,
// hoje) que carregam a tag da allowance (metaesfera) e ainda não estão possuídos —
// Rules.ownedTalentIds já inclui char.metamagic E as escolhas normais da esfera, então
// o dedupe nos dois sentidos (não repetir um pick da Metamágica como extra comprável,
// nem repetir um talento já comprado como opção de Metamágica) vem de graça daqui.
function metamagicCandidates(active, allowance) {
  const sid = sphereIdFor(allowance.sphere);
  const sph = sid ? dataIndex.sphereById.get(sid) : null;
  if (!sph) return [];
  const owned = Rules.ownedTalentIds(active, dataIndex);
  return sph.talents
    .filter(t => (t.tags || []).includes(allowance.tag) && !owned.has(t.id))
    .map(t => ({ id: t.id, name: t.name, sphere: allowance.sphere }));
}

// Detalhe de um candidato à Metamágica: mesmo layout de buildTalentDetail (nome, meta,
// descrição CLONADA do card real), mas a ação é .char-mm-add — custo 0, fora do
// orçamento geral, NUNCA passa por applyTalentToggle. Desabilitado ("Cota cheia") ao
// atingir allowance.count.
function buildMetamagicDetail(active, item, allowance) {
  const box = document.createElement('div');
  box.className = 'char-bench-detail-inner';
  if (!item) { box.innerHTML = '<div class="char-bench-empty">Selecione um talento à esquerda.</div>'; return box; }
  const talent = dataIndex.talentById.get(item.id);
  const model = getSphereModel(item.sphere, null);
  const picks = active.metamagic || [];
  const full = picks.length >= allowance.count;

  const head = document.createElement('div');
  head.className = 'cbd-head';
  const info = document.createElement('div');
  info.className = 'cbd-head-info';
  const h4 = document.createElement('h4');
  h4.textContent = item.name;
  info.appendChild(h4);
  const meta = document.createElement('div');
  meta.className = 'cbd-meta';
  meta.textContent = `${item.sphere} · Metamágica · grátis — fora do orçamento geral`;
  info.appendChild(meta);
  head.appendChild(info);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'char-mm-add';
  btn.dataset.id = item.id;
  btn.disabled = full;
  btn.textContent = full ? 'Cota cheia' : 'Adicionar (Metamágica)';
  head.appendChild(btn);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cbd-body';
  const desc = document.createElement('div');
  desc.className = 'cbd-desc';
  const src = talent ? findCardInFrag(model.frag, talent) : null;
  if (src) {
    const clone = src.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    desc.appendChild(clone);
  } else {
    desc.textContent = 'Descrição não encontrada — abra o capítulo da esfera.';
  }
  body.appendChild(desc);
  box.appendChild(body);
  return box;
}

// Bancada em modo Metamágica (sentinela METAMAGIC_KEY): mesma estrutura master-detail
// (busca + lista .char-bench-li + detalhe), mas sem chips de escopo nem "+ Adicionar
// esfera" (não fazem sentido para uma cota restrita de UMA esfera/tag fixa).
function buildMetamagicBenchPanel(active, allowance) {
  const wrap = document.createElement('div');
  wrap.className = 'char-bench-panel';
  const picks = active.metamagic || [];
  let candidates = metamagicCandidates(active, allowance);
  if (charView.search) {
    const q = normalizeTerm(charView.search);
    candidates = candidates.filter(it => normalizeTerm(it.name).includes(q));
  }
  if (charView.sel === null || !candidates.some(it => it.id === charView.sel)) {
    charView.sel = candidates.length ? candidates[0].id : null;
  }

  const tools = document.createElement('div');
  tools.className = 'char-bench-tools';
  tools.innerHTML = `<input type="text" class="char-bench-search" placeholder="Buscar talento…" value="${escapeHtml(charView.search)}">
    <span class="char-bench-scope on" style="cursor:default">Metamágica — escolha talentos (Meta) da ${escapeHtml(allowance.sphere)} (${picks.length}/${allowance.count})</span>`;

  const listBox = document.createElement('div');
  listBox.className = 'char-bench-list';
  if (!candidates.length) {
    listBox.innerHTML = '<div class="char-bench-empty">Nenhum talento disponível — já foram adquiridos todos ou não há resultado para a busca.</div>';
  } else {
    listBox.innerHTML = candidates.map(it => `<div class="char-bench-li${it.id === charView.sel ? ' sel' : ''}" data-id="${escapeHtml(it.id)}">
      <span class="cbl-name">${escapeHtml(it.name)}</span>
    </div>`).join('');
  }

  const detail = document.createElement('div');
  detail.className = 'char-bench-detail';
  detail.appendChild(buildMetamagicDetail(active, candidates.find(it => it.id === charView.sel) || null, allowance));

  const grid = document.createElement('div');
  grid.className = 'char-bench-grid';
  grid.appendChild(listBox);
  grid.appendChild(detail);

  wrap.appendChild(tools);
  wrap.appendChild(grid);
  return wrap;
}

// Bancada modo "talentos": busca + escopo (esfera ativa/Todas) + lista mestre
// (.char-bench-li) + detalhe (.char-bench-detail). Candidatos = mesma conta de
// talentCandidatesForSphere (extraída do antigo buildAddTalentPicker); a
// mutação real segue por applyTalentToggle (setupCharacter), nunca aqui.
function buildTalentBenchPanel(active) {
  // Sentinela Metamágica: bancada dedicada (candidatos = talentos da tag da allowance,
  // botão .char-mm-add em vez de applyTalentToggle) — nunca cai no caminho normal abaixo.
  if (charView.sphere === METAMAGIC_KEY) {
    const allowance = metamagicAllowance(active);
    if (allowance) return buildMetamagicBenchPanel(active, allowance);
  }
  const wrap = document.createElement('div');
  wrap.className = 'char-bench-panel';
  const addSphereBtn = '<button type="button" class="char-bench-addsphere">+ Adicionar esfera</button>';
  const title = charView.sphere;
  if (!title) {
    const tools = document.createElement('div');
    tools.className = 'char-bench-tools';
    tools.innerHTML = addSphereBtn;
    wrap.appendChild(tools);
    const msg = charSphereTitles(active).length
      ? 'Expanda uma esfera acima para ver e adicionar seus talentos.'
      : 'Nenhuma esfera ainda. Use “+ Adicionar esfera” para escolher a primeira.';
    wrap.insertAdjacentHTML('beforeend', `<div class="char-bench-empty">${msg}</div>`);
    return wrap;
  }
  const titles = charSphereTitles(active);
  let candidates = charView.scope === 'all'
    ? titles.flatMap(t => talentCandidatesForSphere(active, t))
    : talentCandidatesForSphere(active, title);
  if (charView.search) {
    const q = normalizeTerm(charView.search);
    candidates = candidates.filter(it => normalizeTerm(it.name).includes(q));
  }
  if (charView.sel === null || !candidates.some(it => it.id === charView.sel)) {
    charView.sel = candidates.length ? candidates[0].id : null;
  }

  const tools = document.createElement('div');
  tools.className = 'char-bench-tools';
  tools.innerHTML = `<input type="text" class="char-bench-search" placeholder="Buscar talento…" value="${escapeHtml(charView.search)}">
    <button type="button" class="char-bench-scope${charView.scope === 'sphere' ? ' on' : ''}" data-scope="sphere">${escapeHtml(title)}</button>
    <button type="button" class="char-bench-scope${charView.scope === 'all' ? ' on' : ''}" data-scope="all">Todas</button>
    ${addSphereBtn}`;

  const listBox = document.createElement('div');
  listBox.className = 'char-bench-list';
  if (!candidates.length) {
    listBox.innerHTML = '<div class="char-bench-empty">Nenhum talento disponível — já foram adquiridos todos ou não há resultado para a busca.</div>';
  } else {
    listBox.innerHTML = candidates.map(it => {
      const gate = talentGate(active, it.sphere, it);
      const path = talentPickPath(active, it.sphere, it);
      const meta = gate.blocked ? '<span class="cbl-lock">🔒</span>' : `<span class="cbl-meta">${path === 'free' ? 'grátis' : '1 slot'}</span>`;
      const tag = charView.scope === 'all' ? `<span class="cbl-tag">${escapeHtml(it.sphere)}</span>` : '';
      return `<div class="char-bench-li${gate.blocked ? ' blocked' : ''}${it.id === charView.sel ? ' sel' : ''}" data-id="${escapeHtml(it.id)}">
        <span class="cbl-name">${escapeHtml(it.name)}</span>${tag}${meta}
      </div>`;
    }).join('');
  }

  const detail = document.createElement('div');
  detail.className = 'char-bench-detail';
  detail.appendChild(buildTalentDetail(active, candidates.find(it => it.id === charView.sel) || null));

  const grid = document.createElement('div');
  grid.className = 'char-bench-grid';
  grid.appendChild(listBox);
  grid.appendChild(detail);

  wrap.appendChild(tools);
  wrap.appendChild(grid);
  return wrap;
}

// Detalhe de uma esfera candidata: descrição (cardDescription/descriptions.json),
// custo de acesso, gate só-de-exibição (Rules.canAccessSphere) e o botão
// Adquirir → tratado em setupCharacter via tryAcquireSphere (mesmo gate de
// orçamento usado por qualquer outra aquisição — nenhuma regra nova).
function buildSphereDetail(active, def) {
  const box = document.createElement('div');
  box.className = 'char-bench-detail-inner';
  if (!def) { box.innerHTML = '<div class="char-bench-empty">Selecione uma esfera à esquerda.</div>'; return box; }
  const mtl = def.section === 'martial';
  const check = Rules.canAccessSphere(active, def.id, dataIndex);
  const blocked = !check.ok;
  const chapter = chapters.find(c => c.title === def.title);

  const head = document.createElement('div');
  head.className = 'cbd-head';
  const info = document.createElement('div');
  info.className = 'cbd-head-info';
  const h4 = document.createElement('h4');
  h4.textContent = def.title;
  info.appendChild(h4);
  const meta = document.createElement('div');
  meta.className = 'cbd-meta';
  meta.textContent = `${mtl ? 'esfera de poder' : 'esfera de magia'} · acesso: 1 talento ${mtl ? 'marcial' : 'mágico'}`;
  info.appendChild(meta);
  const req = document.createElement('div');
  req.className = 'cbd-req' + (blocked ? ' bad' : '');
  req.innerHTML = (blocked ? '⚠ ' : '✓ ') + `<b>Requisito:</b> ${blocked ? `Sem talentos ${mtl ? 'marciais' : 'mágicos'} suficientes.` : 'Dentro do seu orçamento.'}`;
  info.appendChild(req);
  head.appendChild(info);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'char-bench-acquire';
  if (blocked) btn.disabled = true;
  btn.textContent = blocked ? 'Indisponível' : '+ Adquirir esfera';
  head.appendChild(btn);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cbd-body';
  const desc = document.createElement('div');
  desc.className = 'cbd-desc';
  desc.textContent = chapter ? cardDescription({ text: def.title, anchor: chapter.anchor }) : '';
  body.appendChild(desc);
  box.appendChild(body);
  return box;
}

// Bancada modo "esferas": lista de esferas não adquiridas/concedidas
// (sphereCandidates — extraída do antigo buildAddSpherePicker), agrupadas
// magia/poder, + detalhe.
function buildSphereBenchPanel(active) {
  const wrap = document.createElement('div');
  wrap.className = 'char-bench-panel';
  const groups = sphereCandidates(active);
  const all = groups.magic.concat(groups.martial);
  if (charView.sel === null || !all.some(s => s.title === charView.sel)) {
    charView.sel = all.length ? all[0].title : null;
  }
  const tools = document.createElement('div');
  tools.className = 'char-bench-tools';
  tools.innerHTML = '<span class="char-bench-scope on" style="cursor:default">Não adquiridas</span>'
    + '<button type="button" class="char-bench-backtotalents">‹ Voltar aos talentos</button>';

  const listBox = document.createElement('div');
  listBox.className = 'char-bench-list';
  if (!all.length) {
    listBox.innerHTML = '<div class="char-bench-empty">Todas as esferas já foram adquiridas ou concedidas.</div>';
  } else {
    listBox.innerHTML = all.map(s => {
      const check = Rules.canAccessSphere(active, s.id, dataIndex);
      const blocked = !check.ok;
      const meta = blocked ? '<span class="cbl-lock">🔒</span>' : '<span class="cbl-meta">1 talento</span>';
      return `<div class="char-bench-li${blocked ? ' blocked' : ''}${s.title === charView.sel ? ' sel' : ''}" data-id="${escapeHtml(s.title)}">
        <span class="cbl-name">${escapeHtml(s.title)}</span>${meta}
      </div>`;
    }).join('');
  }

  const detail = document.createElement('div');
  detail.className = 'char-bench-detail';
  const selDef = all.find(s => s.title === charView.sel) || null;
  detail.appendChild(buildSphereDetail(active, selDef));

  const grid = document.createElement('div');
  grid.className = 'char-bench-grid';
  grid.appendChild(listBox);
  grid.appendChild(detail);

  wrap.appendChild(tools);
  wrap.appendChild(grid);
  return wrap;
}

// Conteúdo de .char-bench para o render/refresh atual (modo talentos ou esferas).
function buildCharBenchInner(active) {
  return charView.benchMode === 'spheres' ? buildSphereBenchPanel(active) : buildTalentBenchPanel(active);
}

// Reseta charView p/ um personagem (troca de personagem, criação, exclusão, ou
// quando a esfera ativa deixou de existir): primeira esfera adquirida/concedida,
// modo talentos, sem seleção nem busca. Nunca persiste — só estado de módulo.
function resetCharView(active) {
  const titles = active ? charSphereTitles(active) : [];
  charView.sphere = titles.length ? titles[0] : null;
  charView.benchMode = 'talents';
  charView.sel = null;
  charView.search = '';
}
// Normaliza charView.sphere se ele não existe mais entre as esferas do ativo
// (ex.: esfera removida) — chamada no topo de todo renderCharacter(). Preserva
// benchMode/sel/scope/search quando a esfera ativa continua válida.
function normalizeCharView(active) {
  const titles = charSphereTitles(active);
  // null = "nenhuma esfera expandida" (accordion todo recolhido) — sempre válido;
  // só reseta se a esfera ativa apontar para um título que não existe mais. O sentinela
  // METAMAGIC_KEY só é válido enquanto a allowance existir — se a feature sumir (ex.:
  // nível caiu abaixo de 3), vira inválido e reseta como qualquer esfera removida.
  const validSphere = charView.sphere === null || titles.includes(charView.sphere)
    || (charView.sphere === METAMAGIC_KEY && !!metamagicAllowance(active));
  if (!validSphere) resetCharView(active);
}
// Troca de personagem ativo — sempre reseta charView (mesmo semântica do
// antigo seletor de abas, agora também limpando a view da bancada).
function switchActiveChar(id) {
  setActiveCharId(id);
  resetCharView(getActiveChar());
}

// Re-render em DOIS NÍVEIS (contrato do Layout B):
// - Mutações (add/remove talento, adquirir/remover esfera, pacote, grátis,
//   .char-field) → renderCharacter() completo (função abaixo — já é o padrão).
// - Só-view (selecionar item, escopo, busca, trocar esfera ativa) →
//   refreshCharBench() — substitui .char-build (a esfera ativa pode ter mudado)
//   + .char-bench, e atualiza a classe ativa do rail, SEM tocar no resto do rail
//   (form/proficiências/stats), preservando foco/cursor da busca.
function refreshCharBench() {
  const active = getActiveChar();
  if (!active) return;
  const rail = document.querySelector('.char-rail');
  if (rail) {
    rail.querySelectorAll('.char-rail-sphere').forEach(el => {
      el.classList.toggle('active', charView.benchMode === 'talents' && el.dataset.sphere === charView.sphere);
    });
  }
  const buildHost = document.getElementById('char-build');
  if (buildHost) {
    buildHost.innerHTML = '';
    const content = buildCharBuildContent(active);
    if (content) buildHost.appendChild(content);
  }
  const benchHost = document.getElementById('char-bench');
  if (benchHost) {
    const activeEl = document.activeElement;
    const wasSearch = !!(activeEl && activeEl.classList && activeEl.classList.contains('char-bench-search'));
    const caret = wasSearch ? activeEl.selectionStart : null;
    benchHost.innerHTML = '';
    benchHost.appendChild(buildCharBenchInner(active));
    if (wasSearch) {
      const inp = benchHost.querySelector('.char-bench-search');
      if (inp) { inp.focus(); if (caret != null) { try { inp.setSelectionRange(caret, caret); } catch (_) { /* ignora */ } } }
    }
  }
}

function renderCharacter() {
  currentChapterIndex = -1;
  const content = document.getElementById('content');
  content.removeAttribute('data-section');
  applySphereTheme(content, null);
  content.innerHTML = '';
  const frag = document.createDocumentFragment();

  const h1 = document.createElement('h1');
  h1.textContent = 'Meu Personagem';
  frag.appendChild(h1);

  if (!dataIndex || Object.keys(dataIndex.classes).length === 0) {
    const p = document.createElement('p');
    p.className = 'glossary-intro';
    p.textContent = 'Os dados das classes não puderam ser carregados. Recarregue a página para tentar de novo.';
    frag.appendChild(p);
    content.appendChild(frag);
    finishCharRender();
    return;
  }

  const chars = getCharacters();
  let active = getActiveChar();

  // Seletor de personagens + "novo"
  const sel = document.createElement('div');
  sel.className = 'char-selector';
  for (const c of chars) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'charsel-tab' + (active && c.id === active.id ? ' active' : '');
    tab.dataset.id = c.id;
    tab.textContent = c.name || '(sem nome)';
    sel.appendChild(tab);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'char-new';
  add.className = 'char-new';
  add.textContent = '+ Novo personagem';
  sel.appendChild(add);

  if (!active) {
    frag.appendChild(sel);
    const p = document.createElement('p');
    p.className = 'glossary-intro';
    p.textContent = 'Crie um personagem para reunir seus talentos e ver PM, CD e orçamento de talentos por nível. Depois, use o botão + em qualquer talento para adicioná-lo aqui.';
    frag.appendChild(p);
    content.appendChild(frag);
    finishCharRender();
    return;
  }

  normalizeCharView(active);

  const layout = document.createElement('div');
  layout.className = 'char-layout';

  // ---- RAIL: seletor + identidade + proficiências + stats/orçamento + nav de esferas
  const rail = document.createElement('div');
  rail.className = 'char-rail';
  rail.appendChild(sel);

  const form = document.createElement('div');
  form.className = 'char-form';
  form.innerHTML =
    `<label class="char-field-l">Nome
       <input type="text" class="char-field" data-field="name" value="${escapeHtml(active.name || '')}" maxlength="40">
     </label>
     <label class="char-field-l">Classe
       <select class="char-field" data-field="className">
         <option value="">—</option>
         ${Object.keys(dataIndex.classes).map(k => `<option value="${escapeHtml(k)}"${k === active.className ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}
       </select>
     </label>
     ${subclassField(active)}
     <label class="char-field-l">Nível
       <input type="number" class="char-field" data-field="level" min="1" max="20" value="${active.level || 1}">
     </label>
     <label class="char-field-l">Mod. de ${escapeHtml((dataIndex.classes[active.className] && dataIndex.classes[active.className].keyAbility) || 'habilidade-chave')}
       <input type="number" class="char-field" data-field="keyMod" min="-5" max="10" value="${active.keyMod || 0}">
     </label>
     ${traditionField(active)}`;
  rail.appendChild(form);

  // Proficiências (perícias + ferramentas) — resolvem as condicionais das esferas.
  // Dentro de um <details> recolhível (o próprio buildProficiencies fica intacto;
  // o título interno dele é escondido via CSS quando aninhado no <summary>).
  const profDetails = document.createElement('details');
  profDetails.className = 'char-profs-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Proficiências';
  profDetails.appendChild(summary);
  profDetails.appendChild(buildProficiencies(active));
  rail.appendChild(profDetails);

  const statsWrap = document.createElement('div');
  statsWrap.className = 'char-rail-stats';
  statsWrap.innerHTML = buildCharBudgetHTML(active);
  rail.appendChild(statsWrap);

  const navWrap = document.createElement('div');
  navWrap.innerHTML = buildRailNavHTML(active);
  rail.appendChild(navWrap.firstElementChild);

  layout.appendChild(rail);

  // ---- MAIN: nota (concessões pendentes) + build da esfera ativa + bancada
  const main = document.createElement('div');
  main.className = 'char-main';

  // Concessão de talento específico que o personagem já possui → a regra permite
  // escolher um substituto na mesma esfera (picker adiado; por ora, nota manual).
  const pendingGrants = charGrants(active).pendingReplacements;
  if (pendingGrants.length) {
    const note = document.createElement('p');
    note.className = 'char-warn';
    note.textContent = 'Talento(s) concedido(s) pela subclasse que você já possui: ' +
      pendingGrants.map(p => `${p.name || p.talentId} (${sphereTitleById.get(p.sphereId) || p.sphereId})`).join(', ') +
      '. A regra permite escolher um talento substituto da mesma esfera — por ora, adicione-o manualmente com o + no capítulo.';
    main.appendChild(note);
  }

  const buildHost = document.createElement('div');
  buildHost.className = 'char-build';
  buildHost.id = 'char-build';
  const buildContent = buildCharBuildContent(active);
  if (buildContent) buildHost.appendChild(buildContent);
  main.appendChild(buildHost);

  const benchHost = document.createElement('div');
  benchHost.className = 'char-bench';
  benchHost.id = 'char-bench';
  benchHost.appendChild(buildCharBenchInner(active));
  main.appendChild(benchHost);

  layout.appendChild(main);
  frag.appendChild(layout);

  const del = document.createElement('button');
  del.type = 'button';
  del.id = 'char-delete';
  del.className = 'char-delete';
  del.textContent = 'Excluir este personagem';
  frag.appendChild(del);

  content.appendChild(frag);
  finishCharRender();
}

function finishCharRender() {
  applyStagger(document.getElementById('content'));
  document.getElementById('top-title').textContent = 'Meu Personagem';
  document.title = 'Meu Personagem — Esferas de Magia e Poder';
  setupObserver();
  updateActiveSidebarLink('#personagem');
  window.scrollTo(0, 0);
}

// Seção (magic/martial) de uma esfera pelo título — para contar orçamento.
function sphereSection(title) {
  for (let ti = 0; ti < tocTreesGlobal.length; ti++) {
    for (const root of tocTreesGlobal[ti]) {
      if (root.children.some(c => c.text === title)) return ti === 1 ? 'martial' : ti === 0 ? 'magic' : 'classes';
    }
  }
  return 'magic';
}

// Migração (roda no setupCharacter, após o carregamento de dataIndex): garante
// choices/proficiências, achata o formato antigo talents[] → spheres[], e migra
// cada entrada de esfera para o formato de IDS do Rules engine — sphere: título
// curado → id estruturado; freePicks/talents: objeto {name,sphere,anchor,slug}
// → id de talento. Nunca descarta dados: o que não resolver fica marcado
// (_needsReview na entrada de esfera; itens de talento não resolvidos vão para
// _unresolvedLegacy, exibidos na ficha). Só roda de verdade quando dataIndex
// carregou — sem isso, não migra nada e tenta de novo na próxima carga.
function migrateCharacters() {
  const chars = getCharacters();
  let changed = false;
  for (const c of chars) {
    if (!c.proficiencies) { c.proficiencies = { skills: [], tools: [] }; changed = true; }
    if (!('tradition' in c)) { c.tradition = 'base'; changed = true; } // regra da mesa: +2 talentos a todos
    if (!('subclass' in c)) { c.subclass = ''; changed = true; }
    if (!Array.isArray(c.metamagic)) { c.metamagic = []; changed = true; } // cota restrita (KG-5)

    // Formato antigo (pré-esferas): talents[] plano → spheres[] agrupado por título.
    if (!Array.isArray(c.spheres) && Array.isArray(c.talents)) {
      const bySphere = new Map();
      for (const t of c.talents) { const s = t.sphere || '—'; if (!bySphere.has(s)) bySphere.set(s, []); bySphere.get(s).push(t); }
      c.spheres = [];
      for (const [title, items] of bySphere) {
        const sph = sphereByTitle(title);
        const nonBase = sph
          ? items.filter(it => { const cands = sph.talents.filter(t => t.name === it.name); return !(cands.length === 1 && cands[0].kind === 'base'); })
          : items;
        c.spheres.push({ sphere: title, section: sphereSection(title), choices: {}, freePicks: nonBase[0] ? [nonBase[0]] : [], talents: nonBase.slice(1) });
      }
      delete c.talents;
      changed = true;
    } else if (!Array.isArray(c.spheres)) {
      c.spheres = [];
      changed = true;
    }

    // Heurística p/ o campo `granted` (acesso concedido pela subclasse, custo 0) em
    // entradas antigas: a esfera aparece nas concessões da subclasse ≤ nível.
    const grantedSids = new Set();
    const mcf = dataIndex && dataIndex.classFeatures[c.className];
    const msub = mcf && c.subclass && mcf.subclasses && mcf.subclasses[c.subclass];
    if (msub) for (const g of (msub.grants || [])) if ((g.level || 1) <= (c.level || 1)) for (const tt of (g.talents || [])) { const s = sphereIdByTitle.get(tt.sphere); if (s) grantedSids.add(s); }

    for (const e of c.spheres) {
      if ('freePick' in e) { e.freePicks = e.freePick ? [e.freePick] : []; delete e.freePick; changed = true; }
      if (!Array.isArray(e.freePicks)) { e.freePicks = []; changed = true; }
      if (!Array.isArray(e.talents)) { e.talents = []; changed = true; }
      if (!e.choices) { e.choices = {}; changed = true; }

      // título curado → id estruturado (só se ainda não for um id conhecido)
      if (dataIndex && e.sphere && !dataIndex.sphereById.has(e.sphere)) {
        const sid = sphereIdByTitle.get(e.sphere);
        if (sid) { e.sphere = sid; changed = true; }
        else { e._needsReview = true; changed = true; } // esfera não reconhecida — mantém, sinaliza
      }
      if (!('granted' in e)) { e.granted = grantedSids.has(e.sphere); changed = true; }
      if (!e.section) {
        const sph = dataIndex && dataIndex.sphereById.get(e.sphere);
        e.section = sph ? sph.section : sphereSection(sphereTitleById.get(e.sphere) || e.sphere);
        changed = true;
      }
      if (!dataIndex) continue; // sem dataIndex não há como resolver nomes → tenta de novo depois

      const title = sphereTitleById.get(e.sphere) || e.sphere;
      const migrateList = list => {
        const out = [];
        const unresolved = [];
        for (const it of list) {
          if (typeof it === 'string') { out.push(it); continue; }
          const id = it && it.name ? resolveTalentIdLoose(title, it.name) : null;
          if (id) out.push(id); else unresolved.push(it);
        }
        if (unresolved.length) { e._unresolvedLegacy = (e._unresolvedLegacy || []).concat(unresolved); changed = true; }
        if (out.length !== list.length || out.some((v, i) => v !== list[i])) changed = true;
        return out;
      };
      e.freePicks = migrateList(e.freePicks);
      e.talents = migrateList(e.talents);
    }
  }
  if (changed) {
    saveCharacters(chars);
    const flagged = chars.filter(c => (c.spheres || []).some(e => e._needsReview || (e._unresolvedLegacy || []).length));
    if (flagged.length) console.warn('[Esferas] Alguns dados de personagem salvos antes desta atualização não puderam ser migrados automaticamente — veja _needsReview/_unresolvedLegacy em cada personagem.', flagged);
  }
}

function setupCharacter() {
  migrateCharacters();
  const content = document.getElementById('content');
  content.addEventListener('click', e => {
    const tab = e.target.closest('.charsel-tab');
    if (tab) { switchActiveChar(tab.dataset.id); renderCharacter(); return; }
    if (e.target.closest('#char-new')) {
      const c = createCharacter({ name: 'Personagem ' + (getCharacters().length + 1) });
      switchActiveChar(c.id); renderCharacter(); return;
    }
    // Alternar uma proficiência (perícia/ferramenta) — sem re-render (só afeta esferas)
    const chip = e.target.closest('.prof-chip');
    if (chip) {
      const active = getActiveChar();
      if (!active) return;
      const prof = active.proficiencies || (active.proficiencies = { skills: [], tools: [] });
      const kind = chip.dataset.kind;
      const id = chip.dataset.prof;
      const list = prof[kind] || (prof[kind] = []);
      const i = list.indexOf(id);
      let on;
      if (i >= 0) { list.splice(i, 1); on = false; } else { list.push(id); on = true; }
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      updateCharacter(active.id, { proficiencies: prof });
      return;
    }
    // Remover talento-extra de uma esfera (na ficha)
    const rm = e.target.closest('.char-talent-remove');
    if (rm) {
      const active = getActiveChar();
      if (active) { toggleExtraTalent(active, rm.dataset.sphere, JSON.parse(rm.dataset.char)); renderCharacter(); }
      return;
    }
    // Remover esfera inteira (na ficha)
    const rs = e.target.closest('.char-sphere-remove');
    if (rs) {
      const active = getActiveChar();
      if (active) { removeSphere(active, rs.dataset.removesphere); renderCharacter(); }
      return;
    }
    if (e.target.closest('#char-delete')) {
      const active = getActiveChar();
      if (active && confirm(`Excluir "${active.name}"? Isso não pode ser desfeito.`)) {
        deleteCharacter(active.id);
        resetCharView(getActiveChar());
        renderCharacter();
      }
      return;
    }
    // Adicionar talento pelo painel "adicionar talento" de uma esfera (na ficha) —
    // alvo já é o personagem ativo (sem popover de escolha, ao contrário do compêndio).
    const cbtn = e.target.closest('.char-btn');
    if (cbtn && cbtn.closest('.char-sphere')) {
      const active = getActiveChar();
      if (!active) return;
      const title = cbtn.dataset.sphere;
      const item = JSON.parse(cbtn.dataset.char);
      if (applyTalentToggle(active, title, item, cbtn)) renderCharacter();
      return;
    }
    // Adicionar talento pelo botão Adicionar da bancada (.char-bench, modo talentos)
    // — MESMO botão/estado do compêndio (makeCharControl) e MESMA mutação
    // (applyTalentToggle); é uma mutação → re-render completo (orçamento muda).
    if (cbtn && cbtn.closest('.char-bench')) {
      const active = getActiveChar();
      if (!active) return;
      const title = cbtn.dataset.sphere;
      const item = JSON.parse(cbtn.dataset.char);
      if (applyTalentToggle(active, title, item, cbtn)) { charView.sel = null; renderCharacter(); }
      return;
    }
    // Adicionar um talento à cota de Metamágica (bancada, sentinela METAMAGIC_KEY) —
    // custo 0, fora do orçamento geral; NUNCA passa por applyTalentToggle.
    const mmAdd = e.target.closest('.char-mm-add');
    if (mmAdd) {
      const active = getActiveChar();
      if (!active || mmAdd.disabled) return;
      const allowance = metamagicAllowance(active);
      if (!allowance) return;
      const id = mmAdd.dataset.id;
      const talent = dataIndex.talentById.get(id);
      const picks = active.metamagic || [];
      const tagOk = talent && (talent.tags || []).includes(allowance.tag);
      if (picks.length >= allowance.count || !tagOk) { showCharNotice(mmAdd, `Cota de Metamágica cheia (${allowance.count}).`); return; }
      updateCharacter(active.id, { metamagic: picks.concat([id]) });
      charView.sel = null;
      renderCharacter();
      return;
    }
    // Remover um talento da cota de Metamágica (na ficha) — não usa .char-talent-remove
    // (aquele chama toggleExtraTalent, que mexe em spheres[].talents, não em metamagic).
    const mmRm = e.target.closest('.char-mm-remove');
    if (mmRm) {
      const active = getActiveChar();
      if (!active) return;
      const id = mmRm.dataset.id;
      updateCharacter(active.id, { metamagic: (active.metamagic || []).filter(x => x !== id) });
      renderCharacter();
      return;
    }
    // Trocar a esfera ativa pelo rail (view-only → refreshCharBench)
    const rsp = e.target.closest('.char-rail-sphere');
    if (rsp) {
      charView.sphere = rsp.dataset.sphere;
      charView.benchMode = 'talents';
      charView.sel = null;
      charView.search = '';
      refreshCharBench();
      return;
    }
    // Expandir uma esfera recolhida no accordion = torná-la a ativa (view-only)
    const csc = e.target.closest('.char-sphere-collapsed');
    if (csc) {
      charView.sphere = csc.dataset.sphere;
      charView.benchMode = 'talents';
      charView.sel = null;
      charView.search = '';
      refreshCharBench();
      return;
    }
    // Clicar no cabeçalho da esfera EXPANDIDA a recolhe → nenhuma expandida
    // (accordion "minimizar todas"; a bancada abaixo passa ao estado neutro).
    const stog = e.target.closest('.char-sphere-toggle');
    if (stog) {
      charView.sphere = null;
      charView.benchMode = 'talents';
      charView.sel = null;
      charView.search = '';
      refreshCharBench();
      return;
    }
    // Entrar no modo "esferas" da bancada (botão sempre visível na barra da bancada)
    const badd = e.target.closest('.char-bench-addsphere');
    if (badd) {
      charView.benchMode = 'spheres';
      charView.sel = null;
      refreshCharBench();
      return;
    }
    // Voltar do catálogo de esferas para os talentos da esfera ativa (view-only)
    const bback = e.target.closest('.char-bench-backtotalents');
    if (bback) {
      charView.benchMode = 'talents';
      charView.sel = null;
      refreshCharBench();
      return;
    }
    // Selecionar um item (talento ou esfera candidata) na lista da bancada (view-only)
    const bli = e.target.closest('.char-bench-li');
    if (bli) {
      charView.sel = bli.dataset.id;
      refreshCharBench();
      return;
    }
    // Trocar o escopo da bancada (esfera ativa/Todas) (view-only)
    const bscope = e.target.closest('.char-bench-scope[data-scope]');
    if (bscope) {
      charView.scope = bscope.dataset.scope;
      charView.sel = null;
      refreshCharBench();
      return;
    }
    // Adquirir a esfera selecionada na bancada (modo esferas) — mutação → render completo
    const bacq = e.target.closest('.char-bench-acquire');
    if (bacq) {
      const active = getActiveChar();
      if (!active || bacq.disabled) return;
      const title = charView.sel;
      if (!title) return;
      const res = tryAcquireSphere(active, title);
      if (!res.ok) { showCharNotice(bacq, res.message); return; }
      charView.sphere = title;
      charView.benchMode = 'talents';
      charView.sel = null;
      renderCharacter();
      return;
    }
  });
  content.addEventListener('change', e => {
    const field = e.target.closest('.char-field');
    if (field) {
      const active = getActiveChar();
      if (!active) return;
      const key = field.dataset.field;
      let val = field.value;
      if (key === 'level') val = Math.max(1, Math.min(20, parseInt(val, 10) || 1));
      if (key === 'keyMod') val = Math.max(-5, Math.min(10, parseInt(val, 10) || 0));
      updateCharacter(active.id, { [key]: val });
      renderCharacter();
      return;
    }
    // Pacote-base (Alquimia/Universal) escolhido no painel in-sheet de uma esfera
    const pkg = e.target.closest('.pkg-select');
    if (pkg && pkg.closest('.char-sphere')) {
      const active = getActiveChar();
      if (active) { setPackage(active, pkg.dataset.sphere, pkg.value || null); renderCharacter(); }
      return;
    }
    // Escolha grátis (por slot) no painel in-sheet de uma esfera
    const sel = e.target.closest('.freepick-select');
    if (sel && sel.closest('.char-sphere')) {
      const active = getActiveChar();
      if (active && applyFreePickSelection(active, sel.dataset.sphere, parseInt(sel.dataset.i || '0', 10), sel.value || null, sel)) renderCharacter();
      return;
    }
  });
  // Busca da bancada (modo talentos) — view-only a cada tecla; refreshCharBench
  // preserva foco/cursor do input (ele é recriado no patch).
  content.addEventListener('input', e => {
    const s = e.target.closest('.char-bench-search');
    if (s) { charView.search = s.value; refreshCharBench(); }
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
  'Classes': 'Classes de D&D 5ª edição adaptadas ao sistema de Esferas — cada uma com progressão de nível, características e opções de subclasse. Escolha uma para montar seu personagem.',
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

// Banner "Continuar lendo" + capítulos recentes (na capa), se houver histórico.
function buildContinueBanner() {
  const last = lsGet(LS_LAST, null);
  const recent = lsGet(LS_RECENT, []);
  const coverAnchor = chapters[0] && chapters[0].anchor;
  const hasLast = last && last.anchor && last.anchor !== coverAnchor;
  if (!hasLast && recent.length === 0) return null;

  const box = document.createElement('div');
  box.className = 'continue-box';

  if (hasLast) {
    const a = document.createElement('a');
    a.className = 'continue-link';
    a.href = last.anchor;
    a.innerHTML = `<span class="continue-kicker">▸ Continuar lendo</span><span class="continue-title">${escapeHtml(last.title)}</span>`;
    box.appendChild(a);
  }

  const rec = recent.filter(r => !(hasLast && r.anchor === last.anchor)).slice(0, 6);
  if (rec.length) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const lbl = document.createElement('span');
    lbl.className = 'recent-label';
    lbl.textContent = 'Recentes:';
    row.appendChild(lbl);
    for (const r of rec) {
      const chip = document.createElement('a');
      chip.className = 'recent-chip';
      chip.href = r.anchor;
      chip.textContent = r.title;
      row.appendChild(chip);
    }
    box.appendChild(row);
  }
  return box;
}

// Grade de cards de acesso (esferas na capa / classes na landing de Classes).
function buildAccessCards(children) {
  const grid = document.createElement('div');
  grid.className = 'sphere-card-grid';
  for (const child of children) {
    const card = document.createElement('a');
    card.href = child.anchor;
    card.className = 'sphere-card';

    const theme = sphereThemes[child.text];
    let sig = null;
    if (theme) {
      card.classList.add('themed');
      card.style.setProperty('--sphere-h', theme.h);
      card.style.setProperty('--sphere-s', theme.s);
      if (theme.sig && availableSigils.has(theme.sig)) sig = makeSigil(theme.sig, 'card-sig');
    }

    const text = document.createElement('div');
    text.className = 'sphere-card-text';
    const name = document.createElement('span');
    name.className = 'sphere-card-name';
    name.textContent = child.text;
    text.appendChild(name);
    const cd = cardDescription(child);
    if (cd) {
      const d = document.createElement('span');
      d.className = 'sphere-card-desc';
      d.textContent = cd;
      text.appendChild(d);
    }

    if (sig) card.appendChild(sig);
    card.appendChild(text);
    grid.appendChild(card);
  }
  return grid;
}

function buildCoverIndex(tocTrees) {
  const wrap = document.createElement('div');
  wrap.className = 'cover-index';

  tocTrees.forEach((tree, ti) => {
    const root = tree[0];
    if (!root) return;

    const col = document.createElement('div');
    col.className = 'cover-index-col';
    // cor de seção nos cards não-esfera (0 = magia, 1 = marcial)
    col.dataset.section = ti === 2 ? 'classes' : ti === 1 ? 'martial' : 'magic';

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

    col.appendChild(buildAccessCards(root.children));
    wrap.appendChild(col);
  });

  return wrap;
}

/* ============================================================
   "NESTA PÁGINA" — mini-índice das seções do capítulo atual
   Colapsável, amigável a toque; evita uma coluna lateral que não
   caberia no celular. Só aparece em capítulos com >= 3 seções.
   ============================================================ */
function buildOnThisPage(sourceFrag, isSphere) {
  // Hierarquia: h2 (esfera) › h3 (grupo de talentos) › h4-grupo ".talent-group"
  // (sub-grupo, ex.: "Esfera de Alteração") › talento (heading primário de cada
  // card). Sub-habilidades h5 DENTRO de um pacote (não :first-child) ficam de fora.
  // Esferas: talentos vêm de cards. Classes (leitura limpa, sem cards): usa os
  // headings crus h3/h4 (características e sub-características) para o índice.
  const sel = isSphere
    ? 'section[id] h2, section[id] h3, section[id] h4.talent-group,' +
      ' section[id] .talent-card > h4:first-child, section[id] .talent-card > h5:first-child'
    : 'section[id] h2, section[id] h3, section[id] h4';
  const heads = [...sourceFrag.querySelectorAll(sel)].filter(h => h.id && h.textContent.trim());
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
    // nível de indentação: h2 › h3 › grupo (h4.talent-group) › talento (h4/h5)
    li.className = h.classList.contains('talent-group') ? 'otp-group' : 'otp-' + h.tagName.toLowerCase();
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

        if (key === 'pre-requisitos') { dt.classList.add('param-prereq'); dd.classList.add('param-prereq'); linkTalentRefs(dd); }

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

  // 4. Encaixota cada talento num .talent-card, respeitando a hierarquia do
  //    source (h4/h5/h6). Distinção validada estruturalmente:
  //     - h4 GRUPO  = h4 cujo 1º conteúdo seguinte é um h5 (sem intro). É só um
  //       divisor (ex.: "Esfera de Alteração"): NÃO vira card; seus h5 filhos
  //       viram talentos (cards separados).
  //     - h4 TALENTO/pacote = tem intro antes do h5, ou não tem h5 (ex.: "Arma
  //       Mortal", "Ar"). Vira card; h5/h6 internos são SUB-PARTES do card.
  //     - h5 "Tabela:" e todo h6 nunca abrem card (ficam no card atual).
  //    Trabalha sobre a lista achatada (ordem de leitura) para detectar h4→h5
  //    e para o conteúdo poder CRUZAR quebras de página (\page): a continuação
  //    entra no card, que permanece na seção onde o talento começou.
  const items = [];
  for (const section of sections)
    for (let el = section.firstElementChild; el; el = el.nextElementSibling) items.push(el);

  const isTable = el => /^\s*tabela\s*:/i.test(el.textContent);
  const nextContent = i => {
    for (let j = i + 1; j < items.length; j++) {
      const e = items[j];
      if (/^H[1-6]$/.test(e.tagName) || e.textContent.trim()) return e;
    }
    return null;
  };
  const isGroupH4 = i => {
    const nx = nextContent(i);
    return !!nx && nx.tagName === 'H5' && !isTable(nx);
  };

  let currentGroup = '';
  let inGroup = false;   // sob um h4-grupo → h5 são talentos (cards)
  let openCard = null;
  const cards = [];
  const openCardFor = el => {
    const card = document.createElement('div');
    card.className = 'talent-card';
    if (el.classList.contains('base-ability')) card.classList.add('base-ability'); // passo 3 já marcou o h4
    if (currentGroup) card.dataset.group = currentGroup;                            // h3 de origem (p/ detecção de grupo-grátis)
    if (/avan[çc]ad|lend[áa]ri/i.test(currentGroup)) card.classList.add('advanced');
    el.parentNode.insertBefore(card, el);
    card.appendChild(el);
    openCard = card;
    cards.push(card);
  };

  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const tag = el.tagName;
    if (tag === 'H2') { currentGroup = ''; inGroup = false; openCard = null; continue; }
    if (tag === 'H3') { currentGroup = el.textContent || ''; inGroup = false; openCard = null; continue; }
    if (tag === 'H4') {
      if (isGroupH4(i)) { inGroup = true; openCard = null; el.classList.add('talent-group'); }
      else { inGroup = false; openCardFor(el); }
      continue;
    }
    if (tag === 'H5') {
      if (!isTable(el) && inGroup) openCardFor(el);   // talento de um grupo → card
      else if (openCard) openCard.appendChild(el);    // sub-parte OU tabela dentro do card
      continue;
    }
    // Conteúdo (p, ul, table, blockquote, h6…): entra no card aberto (inclui a
    // continuação vinda da próxima página).
    if (openCard) openCard.appendChild(el);
  }
  for (const card of cards) decorateCard(card, card.querySelector(':scope > h4, :scope > h5'));
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
  const isSphere = !isCover && chapter.sectionLabel !== 'Classes'
    && chapter.title !== PARAMS_CHAPTER_TITLE && chapter.title !== GLOSSARY_CHAPTER_TITLE;
  if (isSphere) enhanceTalents(sectionsFrag);
  linkSphereCrossRefs(sectionsFrag, chapter);
  linkGlossaryTerms(sectionsFrag, chapter);
  highlightMechanics(sectionsFrag);
  if (isSphere) injectSphereSigil(sectionsFrag, chapter);
  if (isSphere) addFavoriteStars(sectionsFrag, chapter);
  if (isSphere) {
    const bar = renderSphereAcquireBar(chapter);
    if (bar) {
      const firstH2 = sectionsFrag.querySelector('section h2');
      if (firstH2) firstH2.insertAdjacentElement('afterend', bar);
      else sectionsFrag.insertBefore(bar, sectionsFrag.firstChild);
    }
  }
  injectSubclassTable(sectionsFrag, chapter);

  if (isCover) {
    frag.appendChild(sectionsFrag);
    if (tocTreesGlobal.length > 0) {
      const cont = buildContinueBanner();
      if (cont) frag.appendChild(cont);
      frag.appendChild(buildOnboarding());
      frag.appendChild(buildCoverIndex(tocTreesGlobal));
    }
  } else {
    const miniToc = buildOnThisPage(sectionsFrag, isSphere);
    if (miniToc) frag.appendChild(miniToc);
    frag.appendChild(sectionsFrag);
    // Landing da seção Classes: mostra cards de acesso a cada classe.
    if (chapter.sectionLabel === 'Classes' && chapter.title === 'Classes'
        && tocTreesGlobal[2] && tocTreesGlobal[2][0]) {
      frag.appendChild(buildAccessCards(tocTreesGlobal[2][0].children));
    }
  }

  if (chapter.leadInHtml) {
    const leadIn = document.createElement('div');
    leadIn.className = 'chapter-lead-in';
    leadIn.innerHTML = chapter.leadInHtml;
    frag.appendChild(leadIn);
  }

  applySectionTheme(content, chapter.sectionLabel);
  applySphereTheme(content, chapter);
  content.appendChild(frag);
  applyStagger(content);

  document.getElementById('top-title').textContent = chapter.title;
  document.title = `${chapter.title} — Esferas de Magia e Poder`;

  setupObserver();
  setupMiniTocSpy();
  updateActiveSidebarLink(chapter.anchor);
  recordVisit(chapter, isCover);
}

/* Tema de seção (accent Magia=oxblood / Marcial=verdete) + carregamento
   escalonado dos blocos de topo (revelação "sangria de tinta"). */
function applySectionTheme(content, sectionLabel) {
  const sec = sectionLabel === 'Esferas de Poder' ? 'martial'
            : sectionLabel === 'Esferas de Magia' ? 'magic'
            : sectionLabel === 'Classes' ? 'classes' : '';
  if (sec) content.dataset.section = sec; else content.removeAttribute('data-section');
}

// Identidade por esfera: define o matiz/saturação (e L opcional) que o CSS
// converte em accent. Fora de uma esfera, limpa e cai na cor da seção.
function applySphereTheme(content, chapter) {
  const t = chapter && sphereThemes[chapter.title];
  if (t) {
    content.classList.add('sphere-themed');
    content.style.setProperty('--sphere-h', t.h);
    content.style.setProperty('--sphere-s', t.s);
    if (t.lLight != null) content.style.setProperty('--sphere-l-light', t.lLight + '%');
    else content.style.removeProperty('--sphere-l-light');
  } else {
    content.classList.remove('sphere-themed');
    content.style.removeProperty('--sphere-h');
    content.style.removeProperty('--sphere-s');
    content.style.removeProperty('--sphere-l-light');
  }
}

// Cria um <svg> que referencia um sigilo do sprite (herda a cor da esfera).
function makeSigil(sigId, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls || 'sphere-sigil');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#sig-' + sigId);
  svg.appendChild(use);
  return svg;
}

// Insere o sigilo da esfera acima do título (1º h2 do capítulo), se houver.
function injectSphereSigil(sectionsFrag, chapter) {
  const t = sphereThemes[chapter.title];
  if (!t || !t.sig || !availableSigils.has(t.sig)) return;
  const h2 = sectionsFrag.querySelector('section[id] h2');
  if (h2 && h2.parentNode) h2.parentNode.insertBefore(makeSigil(t.sig), h2);
}

// Característica de classe que introduz as subclasses (recebe a tabela de subclasses).
const SUBCLASS_FEATURE = {
  'Artífice': 'Especialidade de Artífice',
  'Feiticeiro': 'Origem de Feitiçaria',
  'Guerreiro': 'Arquétipo Marcial',
  'Ladino': 'Arquétipo de Ladino',
  'Monge': 'Tradição Monástica',
};

// Nos capítulos-base de classe, insere na característica de subclasse uma tabela
// com as subclasses disponíveis (nome com link + descrição).
function injectSubclassTable(sectionsFrag, chapter) {
  const featureText = SUBCLASS_FEATURE[chapter.title];
  if (!featureText || !tocTreesGlobal[2] || !tocTreesGlobal[2][0]) return;
  const classNode = tocTreesGlobal[2][0].children.find(c => c.text === chapter.title);
  if (!classNode) return;
  const subs = [];
  for (const child of classNode.children) {
    if (child.anchor.startsWith('#grp-') && child.children) subs.push(...child.children);
  }
  if (subs.length === 0) return;
  const heading = [...sectionsFrag.querySelectorAll('h3')]
    .find(h => normalizeTerm(h.textContent) === normalizeTerm(featureText));
  if (!heading) return;

  const table = document.createElement('table');
  table.className = 'subclass-table';
  table.innerHTML = '<thead><tr><th>Subclasse</th><th>Descrição</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const sub of subs) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    const a = document.createElement('a');
    a.href = sub.anchor;
    a.className = 'subclass-link';
    a.textContent = sub.text;
    tdName.appendChild(a);
    const tdDesc = document.createElement('td');
    tdDesc.textContent = cardDescriptions[sub.text] || '';
    tr.appendChild(tdName);
    tr.appendChild(tdDesc);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  const next = heading.nextElementSibling;
  const after = next && !/^H[1-6]$/.test(next.tagName) ? next : heading;
  after.insertAdjacentElement('afterend', table);
}

/* ============================================================
   ÍNDICE DE TALENTOS + REFERÊNCIAS NAVEGÁVEIS
   Cataloga cada talento (h4) → onde está + um resumo, para linkar
   pré-requisitos e mostrar uma prévia ("espiar") sem sair da página.
   ============================================================ */
function firstSentence(s, maxLen = 160) {
  s = s.replace(/\s+/g, ' ').trim();
  const dot = s.indexOf('. ');
  if (dot >= 24 && dot <= maxLen + 30) return s.slice(0, dot + 1);
  return s.length > maxLen ? s.slice(0, maxLen).replace(/\s+\S*$/, '') + '…' : s;
}

function buildTalentIndex(pages) {
  talentIndex = new Map();
  const tmp = document.createElement('div');
  const isTable = el => /^\s*tabela\s*:/i.test(el.textContent);
  for (const page of pages) {
    const pageNum = pageNumOfId(page.id);
    const chapter = chapters[findChapterIndexForPage(pageNum)];
    tmp.innerHTML = page.html;
    // Indexa talentos h4 E h5 — pula legendas "Tabela:" e h4-grupo (cujo 1º
    // conteúdo seguinte é um h5), que são divisores, não talentos.
    tmp.querySelectorAll('h4, h5').forEach(h => {
      const name = h.textContent.trim();
      if (!name || !h.id) return;
      if (h.tagName === 'H5' && isTable(h)) return;
      if (h.tagName === 'H4') {
        let nx = h.nextElementSibling;
        while (nx && !/^H[1-6]$/.test(nx.tagName) && !nx.textContent.trim()) nx = nx.nextElementSibling;
        if (nx && nx.tagName === 'H5' && !isTable(nx)) return; // h4-grupo → ignora
      }
      const key = normalizeTerm(name);
      if (talentIndex.has(key)) return; // 1ª ocorrência vence
      let summary = '';
      let n = h.nextElementSibling;
      while (n && !/^H[1-6]$/.test(n.tagName)) {
        if (n.tagName === 'P' && n.textContent.trim()) { summary = firstSentence(n.textContent.trim()); break; }
        n = n.nextElementSibling;
      }
      talentIndex.set(key, { name, key, pageAnchor: '#' + page.id, slug: h.id, chapterTitle: chapter ? chapter.title : '', summary });
    });
  }
  buildTalentRefRegex();
}

function buildTalentRefRegex() {
  const names = [...talentIndex.values()].map(t => t.name).sort((a, b) => b.length - a.length);
  if (names.length === 0) { talentRefRegex = null; return; }
  const parts = names.map(escapeRegex);
  try {
    talentRefRegex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  } catch (_) {
    talentRefRegex = new RegExp(`(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  }
}

// Liga nomes de talento dentro de um nó (usado só no valor de "Pré-requisitos").
function linkTalentRefs(container) {
  if (!talentRefRegex || talentIndex.size === 0) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const nodes = []; let n;
  while ((n = walker.nextNode())) if (n.textContent.trim()) nodes.push(n);
  for (const textNode of nodes) {
    const text = textNode.textContent;
    talentRefRegex.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = talentRefRegex.exec(text)) !== null) {
      const entry = talentIndex.get(normalizeTerm(m[0]));
      if (!entry) continue;
      if (!frag) frag = document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement('a');
      a.className = 'ref-link';
      a.href = entry.pageAnchor;
      a.dataset.ref = entry.key;
      a.textContent = m[0];
      frag.appendChild(a);
      last = m.index + m[0].length;
    }
    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
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
  applySphereTheme(content, null);
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
  if (hash === '#glossario' || hash === '#favoritos' || hash === '#personagem') {
    if (hash === '#favoritos') renderFavorites();
    else if (hash === '#personagem') renderCharacter();
    else renderGlossary();
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
  // Referências (pré-requisito de talento, esfera citada) são tratadas pelo peek
  if (a.classList.contains('ref-link') || a.classList.contains('sphere-xref')) return;
  // Nó de grupo na sidebar (ex.: "Especialidades de Artífice"): só alterna a lista.
  if (a.classList.contains('toc-grp')) {
    e.preventDefault();
    const li = a.closest('li.toc-has-children');
    if (li) li.classList.toggle('toc-collapsed');
    return;
  }
  const href = a.getAttribute('href');

  // Páginas sintéticas (glossário / favoritos / personagem)
  if (href === '#glossario' || href === '#favoritos' || href === '#personagem') {
    e.preventDefault();
    navigate(href);
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

  const favLink = document.createElement('a');
  favLink.href = '#favoritos';
  favLink.className = 'toc-link toc-home';
  favLink.textContent = '★ Favoritos';
  frag.appendChild(favLink);

  const charLink = document.createElement('a');
  charLink.href = '#personagem';
  charLink.className = 'toc-link toc-home';
  charLink.textContent = '🛡 Meu personagem';
  frag.appendChild(charLink);

  frag.appendChild(document.createElement('hr'));

  tocTrees.forEach((tree, i) => {
    const list = buildTocList(tree);
    // 0 = Esferas de Magia (oxblood), 1 = Esferas de Poder (verdete), 2 = Classes (índigo)
    list.dataset.section = i === 2 ? 'classes' : i === 1 ? 'martial' : 'magic';
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
    a.className = 'toc-link';
    // Nó de grupo (âncora #grp-…, sem página): só expande/recolhe, não navega.
    const isGroup = entry.anchor.startsWith('#grp-');
    if (isGroup) { a.href = '#'; a.classList.add('toc-grp'); }
    else a.href = entry.anchor;

    // Item de esfera: tinge pelo matiz da esfera + mini-sigilo (se houver).
    const theme = sphereThemes[entry.text];
    if (theme) {
      a.classList.add('toc-sphere');
      a.style.setProperty('--sphere-h', theme.h);
      a.style.setProperty('--sphere-s', theme.s);
      if (theme.sig && availableSigils.has(theme.sig)) a.appendChild(makeSigil(theme.sig, 'toc-sig'));
      a.appendChild(document.createTextNode(entry.text));
    } else {
      a.textContent = entry.text;
    }

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
/* ============================================================
   AJUSTES DE LEITURA — tamanho do texto (base rem) + largura
   ============================================================ */
const READ_FONT_STEPS = [14, 16, 18, 20, 22]; // px na base (html)
const READ_FONT_DEFAULT = 16;
const READ_WIDTHS = { narrow: '720px', normal: '860px', wide: '1040px' };
const READ_WIDTH_DEFAULT = 'normal';

function applyReadingFont(px) {
  document.documentElement.style.fontSize = px + 'px';
  const val = document.getElementById('rp-font-val');
  if (val) val.textContent = Math.round((px / READ_FONT_DEFAULT) * 100) + '%';
  const dec = document.getElementById('rp-font-dec'), inc = document.getElementById('rp-font-inc');
  if (dec) dec.disabled = px <= READ_FONT_STEPS[0];
  if (inc) inc.disabled = px >= READ_FONT_STEPS[READ_FONT_STEPS.length - 1];
}

function applyReadingWidth(key) {
  const w = READ_WIDTHS[key] || READ_WIDTHS[READ_WIDTH_DEFAULT];
  document.documentElement.style.setProperty('--read-width', w);
  document.querySelectorAll('#rp-width button').forEach(b =>
    b.classList.toggle('active', b.dataset.w === key));
}

function currentReadFont() {
  const px = parseInt(localStorage.getItem('esferas:fontpx'), 10);
  return READ_FONT_STEPS.includes(px) ? px : READ_FONT_DEFAULT;
}
function currentReadWidth() {
  const k = localStorage.getItem('esferas:readwidth');
  return READ_WIDTHS[k] ? k : READ_WIDTH_DEFAULT;
}

function setupReadingControls() {
  // Aplica preferências salvas o quanto antes (evita flash).
  applyReadingFont(currentReadFont());
  applyReadingWidth(currentReadWidth());

  const btn = document.getElementById('reading-toggle');
  const panel = document.getElementById('reading-panel');
  if (!btn || !panel) return;

  const open = () => { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
  const close = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => (panel.hidden ? open() : close());

  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  // fecha ao clicar fora ou com Escape
  document.addEventListener('click', e => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

  const stepFont = dir => {
    const cur = currentReadFont();
    const i = READ_FONT_STEPS.indexOf(cur);
    const ni = Math.min(READ_FONT_STEPS.length - 1, Math.max(0, i + dir));
    const px = READ_FONT_STEPS[ni];
    localStorage.setItem('esferas:fontpx', px);
    applyReadingFont(px);
  };
  document.getElementById('rp-font-dec').addEventListener('click', () => stepFont(-1));
  document.getElementById('rp-font-inc').addEventListener('click', () => stepFont(1));

  document.getElementById('rp-width').addEventListener('click', e => {
    const b = e.target.closest('button[data-w]');
    if (!b) return;
    localStorage.setItem('esferas:readwidth', b.dataset.w);
    applyReadingWidth(b.dataset.w);
  });

  document.getElementById('rp-reset').addEventListener('click', () => {
    localStorage.removeItem('esferas:fontpx');
    localStorage.removeItem('esferas:readwidth');
    applyReadingFont(READ_FONT_DEFAULT);
    applyReadingWidth(READ_WIDTH_DEFAULT);
  });
}

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
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menu-toggle');
  const close = document.getElementById('sidebar-close');
  const desktop = window.matchMedia('(min-width: 769px)');
  const COLLAPSE_KEY = 'sidebarCollapsed';

  // overlay div para fechar ao clicar fora (só no off-canvas mobile)
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

  // Desktop: recolher/expandir o índice lateral (persistido). A classe só tem
  // efeito no CSS >=769px; no mobile ela é inócua (lá vale o off-canvas .open).
  function setCollapsed(on) {
    app.classList.toggle('sidebar-collapsed', on);
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (e) {}
  }
  if (localStorage.getItem(COLLAPSE_KEY) === '1') app.classList.add('sidebar-collapsed');

  // ☰: no desktop expande (só aparece quando recolhido); no mobile abre off-canvas.
  toggle.addEventListener('click', () => {
    if (desktop.matches) setCollapsed(false);
    else openSidebar();
  });
  // ✕: no desktop recolhe; no mobile fecha o off-canvas.
  close.addEventListener('click', () => {
    if (desktop.matches) setCollapsed(true);
    else closeSidebar();
  });
  overlay.addEventListener('click', closeSidebar);

  // fecha ao clicar em link na sidebar (só mobile off-canvas)
  document.getElementById('toc-nav').addEventListener('click', e => {
    if (e.target.tagName === 'A' && !desktop.matches) closeSidebar();
  });
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);
