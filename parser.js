/* parser.js — Homebrewery → HTML
   Converte Esferas_do_Poder_HB_source.txt para PageData[] + TocEntry[][]
*/

const HBParser = (() => {

  /* ==========================================================
     TOKENIZER — Pass 1
     Máquina de estados de 4 modos
     ========================================================== */
  function tokenize(source) {
    // Junta linhas separadas por <br> em uma só (herança do Homebrewery: as
    // seções tipo "Pontos de vida"/"Proficiências" usam <br> em linha própria,
    // que sem isto viram parágrafos separados com espaçamento excessivo).
    // (a) <br> logo antes de heading/lista/tabela/bloco/linha em branco é só um
    //     separador — descarta (senão o <br> "engoliria" o heading seguinte).
    source = source.replace(/\r?\n[ \t]*<br\s*\/?>[ \t]*(?=\r?\n[ \t]*(?:#|\||\{\{|\}\}|[-*•][ \t]|<|\r?\n|$))/gi, '');
    // (b) <br> entre duas linhas de conteúdo → junta no mesmo parágrafo.
    source = source.replace(/\r?\n[ \t]*<br\s*\/?>[ \t]*\r?\n/gi, '<br>');
    const lines = source.split('\n');
    const tokens = [];

    const NORMAL         = 0;
    const IN_TOC         = 1;
    const IN_MONSTER     = 2;
    const IN_GENERIC     = 3;

    let state     = NORMAL;
    let buf       = [];
    let blockType = '';

    function flushBuf() {
      if (buf.length === 0) return;
      if (state === IN_TOC) {
        tokens.push({ type: 'block', blockType: 'toc', raw: buf.join('\n') });
      } else if (state === IN_MONSTER) {
        tokens.push({ type: 'block', blockType: 'monster', raw: buf.join('\n') });
      } else if (state === IN_GENERIC) {
        tokens.push({ type: 'block', blockType, raw: buf.join('\n') });
      }
      buf = [];
      state = NORMAL;
      blockType = '';
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (state === IN_TOC) {
        if (line.trim() === '}}') { flushBuf(); }
        else { buf.push(line); }
        continue;
      }

      if (state === IN_MONSTER) {
        if (line.trim() === '}}') { buf.push(line); flushBuf(); }
        else { buf.push(line); }
        continue;
      }

      if (state === IN_GENERIC) {
        if (line.trim() === '}}') { flushBuf(); }
        else { buf.push(line); }
        continue;
      }

      // NORMAL state — detectar openers
      if (/^\{\{toc\b/i.test(line)) {
        state = IN_TOC; buf = [];
        continue;
      }
      if (/^\{\{monster\b/i.test(line)) {
        state = IN_MONSTER; buf = [line];
        continue;
      }

      // Generic block types (ordem importa — wide,note antes de wide)
      const genericMatch = line.match(/^\{\{(classTable[\w,]*|wide,note|wide|note|table,wide|imageMaskCenter[^,}]*(?:,[^}]*)?|footnote|imageMask[^}]*)\b/i);
      if (genericMatch) {
        state = IN_GENERIC;
        blockType = normalizeBlockType(genericMatch[1]);
        buf = [];
        continue;
      }

      // Anonymous {{ block
      if (/^\{\{\s*$/.test(line)) {
        state = IN_GENERIC; blockType = 'anonymous'; buf = [];
        continue;
      }

      // EOF self-closing single-line blocks
      const selfClose = line.match(/^\{\{(frontCover|insideCover|backCover)\}\}\s*$/i);
      if (selfClose) {
        tokens.push({ type: 'block', blockType: selfClose[1].toLowerCase().replace('cover', 'Cover'), raw: line });
        continue;
      }

      const bannerMatch = line.match(/^\{\{banner\s+(.+?)\}\}\s*$/i);
      if (bannerMatch) {
        tokens.push({ type: 'block', blockType: 'banner', text: bannerMatch[1].trim(), raw: line });
        continue;
      }

      if (/^\{\{logo\b/i.test(line)) continue; // ignore logo

      // Regular line
      tokens.push(processLine(line));
    }

    // flush any unclosed block at EOF (e.g. {{logo without }})
    if (state !== NORMAL && buf.length > 0) flushBuf();

    return tokens;
  }

  function normalizeBlockType(s) {
    const t = s.toLowerCase();
    if (t.startsWith('imagemask')) return 'imageMask';
    if (t.startsWith('classtable')) return 'class-table';
    if (t === 'wide,note') return 'wide-note';
    if (t === 'table,wide') return 'table-wide';
    return t;
  }

  /* ==========================================================
     processLine — emite um token a partir de uma linha simples
     ========================================================== */
  function processLine(line) {
    const trimmed = line.trim();

    if (trimmed === '') return { type: 'empty' };

    if (trimmed === '\\page') return { type: 'page_break' };

    if (/^<div class='pageNumber/.test(trimmed)) return { type: 'empty' };

    if (trimmed === '\\column') return { type: 'empty' };

    if (/^___+$/.test(trimmed)) return { type: 'hr' };

    // Spacer: only colons (1-12)
    if (/^:{1,12}$/.test(trimmed)) {
      return { type: 'spacer', level: trimmed.length };
    }

    // # alone (decorative, not heading)
    if (/^#+$/.test(trimmed)) return { type: 'empty' };

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      return { type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() };
    }

    // Table row
    if (/^\|/.test(trimmed)) return { type: 'table_row', raw: line };

    // Cover type declarations
    if (/^\{\{(frontCover|insideCover|backCover)\}\}$/i.test(trimmed)) {
      const m = trimmed.match(/^\{\{(frontCover|insideCover|backCover)\}\}$/i);
      return { type: 'block', blockType: m[1], raw: line };
    }

    // Banner
    const bannerMatch = trimmed.match(/^\{\{banner\s+(.+?)\}\}$/i);
    if (bannerMatch) return { type: 'block', blockType: 'banner', text: bannerMatch[1].trim(), raw: line };

    // Logo — ignore
    if (/^\{\{logo\b/i.test(trimmed)) return { type: 'empty' };

    // Image with possible inline CSS
    if (/^!\[/.test(trimmed)) {
      const url = extractImageUrl(trimmed);
      if (url) return { type: 'image', url, raw: line };
    }

    // {{width:Npx}}• or ○ list item
    const widthPrefix = trimmed.match(/^\{\{width:\d+px\}\}\s*(.*)/);
    if (widthPrefix) return parseListItem(widthPrefix[1]);

    // Direct bullet without width prefix (aceita "• :: texto", "• texto" e "•\ttexto")
    if (/^[•○◦]\s/.test(trimmed)) return parseListItem(trimmed);

    // Paragraph
    return { type: 'paragraph', text: trimmed };
  }

  function parseListItem(rest) {
    // Level 1: "• :: texto", "• texto" ou "•\ttexto" (:: é opcional)
    const l1 = rest.match(/^•\s*(?::{1,2})?\s*(.*)/);
    if (l1) return { type: 'list_item', level: 1, text: l1[1].trim() };
    // Level 2: ○ / ◦ (U+25CB / U+25E6)
    const l2 = rest.match(/^[○◦]\s*(?::{1,2})?\s*(.*)/);
    if (l2) return { type: 'list_item', level: 2, text: l2[1].trim() };
    // Fallback: treat as paragraph
    return { type: 'paragraph', text: rest.trim() };
  }

  function extractImageUrl(line) {
    const m = line.match(/!\[[^\]]*\]\(([^)]+)\)/);
    return m ? m[1] : null;
  }

  /* ==========================================================
     GROUP TABLE ROWS — between Pass 1 and Pass 2
     ========================================================== */
  function groupTableRows(tokens) {
    const result = [];
    let i = 0;
    while (i < tokens.length) {
      if (tokens[i].type === 'table_row') {
        const rows = [];
        while (i < tokens.length && tokens[i].type === 'table_row') {
          rows.push(tokens[i].raw);
          i++;
        }
        result.push({ type: 'table_group', rows });
      } else {
        result.push(tokens[i]);
        i++;
      }
    }
    return result;
  }

  /* ==========================================================
     SPLIT TOKENS BY PAGE
     ========================================================== */
  function splitByPage(tokens) {
    const pages = [];
    let current = [];
    let pageNum = 1;

    for (const tok of tokens) {
      if (tok.type === 'page_break') {
        pages.push({ pageNum, tokens: current });
        pageNum++;
        current = [];
      } else {
        current.push(tok);
      }
    }
    if (current.length > 0) pages.push({ pageNum, tokens: current });
    return pages;
  }

  /* ==========================================================
     DETECT PAGE TYPE
     ========================================================== */
  function detectPageType(tokens) {
    for (const tok of tokens) {
      if (tok.type === 'block') {
        if (tok.blockType === 'frontCover') return 'frontCover';
        if (tok.blockType === 'insideCover') return 'insideCover';
        if (tok.blockType === 'backCover') return 'backCover';
      }
    }
    return 'content';
  }

  /* ==========================================================
     TOC PARSING
     ========================================================== */
  function parseTocBlock(raw) {
    const entries = [];
    const lines = raw.split('\n');
    // Nível 3–6; âncora pode ser página (#pN) ou grupo sem página (#grp-…).
    const re = /^\s*-\s*(#{3,6})\s+\[\{\{\s*(.+?)\s*\}\}\{\{\s*\d*\s*\}\}\]\(#([\w-]+)\)/;

    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      entries.push({
        level: m[1].length,
        text:  m[2].trim(),
        anchor: '#' + m[3],
        children: []
      });
    }

    return buildTocTree(entries);
  }

  function buildTocTree(flat) {
    const root = [];
    const stack = []; // { entry, level }

    for (const entry of flat) {
      while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
        stack.pop();
      }
      if (stack.length === 0) {
        root.push(entry);
      } else {
        stack[stack.length - 1].entry.children.push(entry);
      }
      stack.push({ entry, level: entry.level });
    }

    return root;
  }

  /* ==========================================================
     INLINE MARKDOWN
     ========================================================== */
  function md(text) {
    if (!text) return '';

    // Remove {{width:Npx}} residuais
    text = text.replace(/\{\{width:\d+px\}\}/g, '');

    // Remove :: separator inline (between label and value)
    // Pattern: after ** bold label ** optionally followed by :
    text = text.replace(/(\*\*[^*]+\*\*\s*:?)\s*::\s*/g, '$1 ');
    // Any remaining :: that aren't standalone spacers
    text = text.replace(/\s*::\s*/g, ': ');

    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (not preceded/followed by *)
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Image with optional inline CSS {…}
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?/g, '<img src="$2" alt="$1">');

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    return text;
  }

  /* ==========================================================
     RENDER HELPERS
     ========================================================== */
  function renderToken(tok) {
    switch (tok.type) {
      case 'empty':   return '';
      case 'hr':      return '<hr>';
      case 'spacer':  return `<span class="spacer" style="height:${tok.level * 0.5}rem;display:block"></span>`;
      case 'heading': {
        const id = slugify(tok.text);
        return `<h${tok.level} id="${id}">${md(tok.text)}</h${tok.level}>`;
      }
      case 'paragraph': return `<p>${md(tok.text)}</p>`;
      case 'list_item': {
        const cls = tok.level === 1 ? 'li-l1' : 'li-l2';
        const marker = tok.level === 1 ? '•' : '○';
        return `<div class="li-wrap"><div class="${cls}"><span class="li-marker">${marker}</span><span>${md(tok.text)}</span></div></div>`;
      }
      case 'image': return `<img src="${tok.url}" alt="" style="max-width:100%;display:block;margin:0.5rem 0">`;
      case 'table_group': return renderTable(tok.rows);
      case 'block': return renderBlock(tok);
      default: return '';
    }
  }

  function renderTable(rows, wrapClass) {
    if (rows.length === 0) return '';

    // Parse alignment from separator row
    let alignments = [];
    let headerRow = null;
    let bodyRows = [];
    let sepIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (/^\|[\s:|_-]+\|/.test(rows[i].trim())) { sepIndex = i; break; }
    }

    if (sepIndex > 0) {
      headerRow = rows[0];
      const sepCells = parseCells(rows[sepIndex]);
      alignments = sepCells.map(c => {
        if (/^:-+:$/.test(c.trim())) return 'center';
        if (/^-+:$/.test(c.trim()))  return 'right';
        return 'left';
      });
      bodyRows = rows.slice(sepIndex + 1);
    } else {
      // No separator — first row is header, rest are body
      headerRow = rows[0];
      bodyRows = rows.slice(1);
    }

    const thCells = parseCells(headerRow);
    const thead = '<thead><tr>' +
      thCells.map((c, i) => {
        const a = alignments[i] || 'left';
        return `<th${a !== 'left' ? ` data-align="${a}"` : ''}>${md(c.trim())}</th>`;
      }).join('') +
      '</tr></thead>';

    const tbody = bodyRows.length === 0 ? '' :
      '<tbody>' +
      bodyRows.map(row => {
        const cells = parseCells(row);
        return '<tr>' + cells.map((c, i) => {
          const a = alignments[i] || 'left';
          return `<td${a !== 'left' ? ` data-align="${a}"` : ''}>${md(c.trim())}</td>`;
        }).join('') + '</tr>';
      }).join('') +
      '</tbody>';

    const cls = wrapClass ? ` class="${wrapClass}"` : '';
    return `<div class="table-wrap"${cls}><table>${thead}${tbody}</table></div>`;
  }

  function parseCells(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  }

  function renderBlock(tok) {
    switch (tok.blockType) {
      case 'toc':      return ''; // handled separately
      case 'monster':  return renderMonster(tok.raw);
      case 'note':     return renderNote(tok.raw, false, false);
      case 'wide-note':return renderNote(tok.raw, false, true);
      case 'wide':     return renderWide(tok.raw);
      case 'table-wide': return renderTableWide(tok.raw);
      case 'class-table': return renderWide(tok.raw, 'class-table');
      case 'imageMask':  return ''; // image handled by cover assembly
      case 'footnote':   return ''; // handled by cover assembly
      case 'banner':     return ''; // handled by cover assembly
      case 'anonymous':  return renderAnonymous(tok.raw);
      default:           return '';
    }
  }

  /* ==========================================================
     NOTE / CALLOUT
     ========================================================== */
  function renderNote(raw, _unused, isWide) {
    const lines = raw.split('\n').filter(l => l.trim() !== '');
    const inner = lines.map(l => renderToken(processLine(l))).join('');
    const cls = isWide ? 'callout wide-callout' : 'callout';
    return `<div class="${cls}">${inner}</div>`;
  }

  /* ==========================================================
     WIDE BLOCKS
     ========================================================== */
  function renderWide(raw, extraClass) {
    const lines = raw.split('\n');
    const toks = groupTableRows(lines.map(processLine));
    const inner = toks.map(renderToken).join('');
    const cls = extraClass ? 'wide ' + extraClass : 'wide';
    return `<div class="${cls}">${inner}</div>`;
  }

  function renderTableWide(raw) {
    // Extract the table rows from inside the block
    const rows = raw.split('\n').filter(l => /^\s*\|/.test(l));
    if (rows.length === 0) return renderWide(raw);
    return `<div class="wide">${renderTable(rows)}</div>`;
  }

  function renderAnonymous(raw) {
    const lines = raw.split('\n');
    const toks = groupTableRows(lines.map(processLine));
    return '<div>' + toks.map(renderToken).join('') + '</div>';
  }

  /* ==========================================================
     MONSTER STAT BLOCK — mini-parser
     ========================================================== */
  function renderMonster(raw) {
    const lines = raw.split('\n');
    const parts = [];
    let inAttrTable = false;
    const attrRows = [];

    for (const line of lines) {
      const t = line.trim();
      if (t === '' || /^\{\{monster/.test(t) || t === '}}') continue;

      // Heading (## name, ### section)
      const hm = t.match(/^(#{2,5})\s+(.*)/);
      if (hm) {
        if (hm[1] === '##') {
          parts.push(`<div class="stat-name">${md(hm[2])}</div>`);
        } else {
          parts.push(`<div class="stat-section-title">${md(hm[2])}</div>`);
        }
        continue;
      }

      // Meta (italic type line)
      if (t.startsWith('*') && t.endsWith('*') && !t.startsWith('**')) {
        parts.push(`<div class="stat-meta">${md(t)}</div>`);
        continue;
      }

      // Internal separator
      if (/^___+$/.test(t)) {
        if (attrRows.length > 0) {
          parts.push(renderAttrTable(attrRows));
          attrRows.length = 0;
          inAttrTable = false;
        }
        parts.push('<div class="stat-hr"></div>');
        continue;
      }

      // Attribute table row (| FOR | DES | ... |)
      if (/^\|/.test(t)) {
        if (!/^[\|:\-\s]+$/.test(t)) attrRows.push(t);
        continue;
      }

      // Property line
      parts.push(`<div class="stat-prop">${md(t)}</div>`);
    }

    if (attrRows.length > 0) parts.push(renderAttrTable(attrRows));

    return `<div class="stat-block">${parts.join('')}</div>`;
  }

  function renderAttrTable(rows) {
    if (rows.length === 0) return '';
    const cells = rows.map(r => parseCells(r));
    const thead = '<thead><tr>' + (cells[0] || []).map(c => `<th>${md(c.trim())}</th>`).join('') + '</tr></thead>';
    const tbodyCells = cells.slice(1);
    const tbody = tbodyCells.length === 0 ? '' :
      '<tbody>' + tbodyCells.map(row =>
        '<tr>' + row.map(c => `<td>${md(c.trim())}</td>`).join('') + '</tr>'
      ).join('') + '</tbody>';
    return `<table class="stat-table">${thead}${tbody}</table>`;
  }

  /* ==========================================================
     COVER PAGE ASSEMBLY
     ========================================================== */
  function assembleCoverPage(tokens, pageNum) {
    let title = '';
    let badgeText = '';
    let caption = '';
    let heroImage = null;

    for (const tok of tokens) {
      if (tok.type === 'heading' && !title) {
        title = tok.text;
      }
      if (tok.type === 'image' && !heroImage) {
        heroImage = tok.url;
      }
      if (tok.type === 'block') {
        if (tok.blockType === 'banner' && !badgeText) {
          badgeText = tok.text || '';
        }
        if (tok.blockType === 'footnote' && !caption) {
          // raw contains the content lines
          caption = tok.raw ? tok.raw.split('\n')
            .filter(l => l.trim())
            .map(l => l.trim())
            .join(' ') : '';
        }
        if (tok.blockType === 'imageMask' && !heroImage) {
          const m = tok.raw && tok.raw.match(/!\[[^\]]*\]\(([^)]+)\)/);
          if (m) heroImage = m[1];
        }
      }
    }

    const style = heroImage
      ? `style="background-image:url('${heroImage}')""`
      : 'class="no-image"';

    const heroClass = heroImage ? 'cover-hero' : 'cover-hero no-image';

    let html = `<div class="${heroClass}"${heroImage ? ` style="background-image:url('${esc(heroImage)}')"` : ''}>`;
    html += '<div class="cover-hero-content">';
    if (badgeText) html += `<div class="cover-badge">${esc(badgeText)}</div>`;
    if (title) html += `<div class="cover-title">${esc(title)}</div>`;
    if (title || badgeText) html += '<hr class="cover-divider">';
    if (caption) html += `<div class="cover-caption">${esc(caption)}</div>`;
    html += '</div></div>';

    return html;
  }

  /* ==========================================================
     RENDER CONTENT PAGE
     ========================================================== */
  function renderContentPage(tokens) {
    const grouped = groupTableRows(tokens);
    return grouped.map(renderToken).join('\n');
  }

  /* ==========================================================
     MAIN PARSE ENTRY POINT
     ========================================================== */
  function parse(source) {
    const allTokens = tokenize(source);
    const pages = splitByPage(allTokens);

    const pageDataList = [];
    const tocTrees = [];

    // Extract TOC blocks first (they can appear on any page)
    for (const tok of allTokens) {
      if (tok.type === 'block' && tok.blockType === 'toc') {
        tocTrees.push(parseTocBlock(tok.raw));
      }
    }

    for (const page of pages) {
      const pageType = detectPageType(page.tokens);
      const id = `p${page.pageNum}`;
      let html;

      if (pageType !== 'content') {
        html = assembleCoverPage(page.tokens, page.pageNum);
      } else {
        // A page that hosts a {{toc}} block only exists to introduce the
        // sidebar navigation; its heading (e.g. "Índice de Conteúdos") would
        // otherwise render as an orphan title with no content beneath it.
        const hasToc = page.tokens.some(tok => tok.type === 'block' && tok.blockType === 'toc');

        // Filter out cover-type tokens before rendering
        const contentTokens = page.tokens.filter(tok => {
          if (tok.type === 'block' && ['frontCover','insideCover','backCover','toc'].includes(tok.blockType)) return false;
          if (hasToc && tok.type === 'heading') return false;
          return true;
        });
        html = renderContentPage(contentTokens);
      }

      pageDataList.push({ id, pageType, html });
    }

    return { pages: pageDataList, tocTrees };
  }

  /* ==========================================================
     UTILITIES
     ========================================================== */
  function slugify(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 80);
  }

  function esc(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { parse };

})();

if (typeof module !== 'undefined' && module.exports) module.exports = HBParser;
