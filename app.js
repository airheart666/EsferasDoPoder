/* app.js — inicialização, sidebar, busca, dark mode, navegação por capítulos */

let allPages = [];       // PageData[] completo, na ordem do documento
let chapters = [];       // { start, end, title, sectionLabel, anchor }[]
let tocTreesGlobal = []; // árvores do {{toc}}, reusadas pelo índice de capa
let cardDescriptions = {}; // descrições curadas dos cards (descriptions.json)
let sphereThemes = {};   // identidade por esfera (sphere-themes.json): título -> {h,s,sig,lLight?}
let availableSigils = new Set(); // ids de sigilo já presentes no sprite (sigils.svg)
let talentIndex = new Map();  // normNome -> {name, pageAnchor, slug, chapterTitle, summary}
let talentRefRegex = null;    // regex dos nomes de talento (p/ linkar pré-requisitos)
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

    // Identidade por esfera (cor/sigilo). Opcional.
    try {
      const stRes = await fetch('sphere-themes.json');
      if (stRes.ok) sphereThemes = await stRes.json();
    } catch (_) { /* mantém {} → esferas usam a cor da seção */ }

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

// Estrela em cada talento (dentro da própria .talent-card).
function addFavoriteStars(root, chapter) {
  for (const card of root.querySelectorAll('.talent-card')) {
    const h4 = card.querySelector(':scope > h4, :scope > h5');
    if (!h4) continue;
    const section = card.closest('section[id]');
    const item = { name: h4.textContent.trim(), sphere: chapter.title, anchor: section ? '#' + section.id : chapter.anchor, slug: h4.id || '' };
    card.appendChild(makeFavButton(item));
  }
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
    const btn = e.target.closest('.fav-btn');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const on = toggleFav(JSON.parse(btn.dataset.fav));
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Remover dos favoritos' : 'Salvar nos favoritos');
  });
  // Teclado: Enter/Espaço no título alterna o card
  content.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('fav-toggle')) {
      e.preventDefault(); toggleFavCard(e.target);
    }
  });
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
function buildChapterCards(chapter) {
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
  const map = new Map();
  for (const card of frag.querySelectorAll('.talent-card')) {
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
  if (hash === '#glossario' || hash === '#favoritos') {
    if (hash === '#favoritos') renderFavorites(); else renderGlossary();
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

  // Página do glossário completo / favoritos
  if (href === '#glossario' || href === '#favoritos') {
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
