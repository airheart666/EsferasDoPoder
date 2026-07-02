#!/usr/bin/env node
/* scripts/split-source.js — uso único (ou pontual)
   Divide Esferas_do_Poder_HB_source.txt em um arquivo por capítulo
   (mesmos limites que Chapters.buildChapters() usa em runtime),
   gera manifest.json e arquiva o .txt original intocado.

   Não é carregado pela webapp — roda só via `node scripts/split-source.js`.

   Uso:
     node scripts/split-source.js            — divide e verifica
     node scripts/split-source.js --verify   — só verifica content/ + manifest.json contra archive/
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'Esferas_do_Poder_HB_source.txt');
const ARCHIVE_PATH = path.join(ROOT, 'archive', 'Esferas_do_Poder_HB_source.ORIGINAL.txt');
const CONTENT_DIR = path.join(ROOT, 'content');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

const HBParser = require(path.join(ROOT, 'parser.js'));
const Chapters = require(path.join(ROOT, 'chapters.js'));

/* ============================================================
   Divide o texto em "chunks de linha" que retêm seu próprio
   terminador (\r\n, \n ou nenhum no último), para que juntar
   os chunks com '' reproduza o arquivo original byte a byte.
   ============================================================ */
function splitLineChunks(text) {
  const chunks = text.match(/[^\n]*\n|[^\n]+$/g);
  return chunks || [];
}

/* ============================================================
   Agrupa os chunks de linha por número de página (1-indexed),
   igual à contagem de \page do parser (splitByPage em parser.js).
   A linha \page fica anexada ao FIM da página que ela fecha.
   ============================================================ */
function buildPageRawTexts(lineChunks) {
  const pageRawTexts = [];
  let current = [];

  for (const chunk of lineChunks) {
    current.push(chunk);
    if (chunk.trim() === '\\page') {
      pageRawTexts.push(current.join(''));
      current = [];
    }
  }
  if (current.length > 0) pageRawTexts.push(current.join(''));

  return pageRawTexts;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
}

function split() {
  const original = fs.readFileSync(SOURCE_PATH, 'utf8');

  const lineChunks = splitLineChunks(original);
  if (lineChunks.join('') !== original) {
    throw new Error('splitLineChunks não é lossless — abortando antes de gravar qualquer coisa.');
  }

  const pageRawTexts = buildPageRawTexts(lineChunks);

  const { pages, tocTrees } = HBParser.parse(original);
  if (pages.length !== pageRawTexts.length) {
    throw new Error(`Divergência de contagem de páginas: parser=${pages.length}, raw=${pageRawTexts.length}`);
  }

  const chapters = Chapters.buildChapters(pages, tocTrees);

  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });

  // limpa divisões anteriores para não deixar arquivos órfãos de uma execução passada
  for (const f of fs.readdirSync(CONTENT_DIR)) {
    if (f.endsWith('.txt')) fs.unlinkSync(path.join(CONTENT_DIR, f));
  }

  const manifest = [];
  const usedNames = new Set();

  chapters.forEach((chapter, i) => {
    const raw = pageRawTexts.slice(chapter.start - 1, chapter.end).join('');
    const prefix = String(i).padStart(2, '0');
    let slug = slugify(chapter.title) || `capitulo-${prefix}`;
    let filename = `${prefix}-${slug}.txt`;
    // desambiguação defensiva, caso dois títulos gerem o mesmo slug
    let n = 2;
    while (usedNames.has(filename)) {
      filename = `${prefix}-${slug}-${n}.txt`;
      n++;
    }
    usedNames.add(filename);

    fs.writeFileSync(path.join(CONTENT_DIR, filename), raw, 'utf8');
    manifest.push(`content/${filename}`);
  });

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.copyFileSync(SOURCE_PATH, ARCHIVE_PATH);

  console.log(`Dividido em ${manifest.length} capítulos.`);
  console.log(`manifest.json e archive/${path.basename(ARCHIVE_PATH)} gravados.`);

  verify();
}

function verify() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const rebuilt = manifest.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('');
  const original = fs.readFileSync(ARCHIVE_PATH, 'utf8');

  if (rebuilt === original) {
    console.log(`Verificação OK: ${manifest.length} arquivos reconstroem o original byte a byte.`);
    return true;
  }

  const len = Math.min(rebuilt.length, original.length);
  let diffAt = -1;
  for (let i = 0; i < len; i++) {
    if (rebuilt[i] !== original[i]) { diffAt = i; break; }
  }
  if (diffAt === -1) diffAt = len;

  console.error('FALHA na verificação — reconstrução diverge do original.');
  console.error(`Tamanhos: reconstruído=${rebuilt.length} original=${original.length}`);
  console.error(`Primeira divergência no índice ${diffAt}:`);
  console.error('  reconstruído:', JSON.stringify(rebuilt.slice(Math.max(0, diffAt - 30), diffAt + 30)));
  console.error('  original:    ', JSON.stringify(original.slice(Math.max(0, diffAt - 30), diffAt + 30)));
  process.exitCode = 1;
  return false;
}

/* ============================================================
   Reconstitui um único .txt a partir de content/ + manifest.json,
   por exemplo para reenviar ao Homebrewery. Não compara com o
   archive/ — reflete o estado atual (possivelmente editado) de content/.
   ============================================================ */
function rebuild(outputPath) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const rebuilt = manifest.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('');
  fs.writeFileSync(outputPath, rebuilt, 'utf8');
  console.log(`Reconstituído em: ${outputPath}`);
}

const args = process.argv.slice(2);
if (args.includes('--verify')) {
  verify();
} else if (args.includes('--rebuild')) {
  const outIdx = args.indexOf('--rebuild');
  const outputPath = path.resolve(ROOT, args[outIdx + 1] || 'Esferas_do_Poder_HB_source.rebuilt.txt');
  rebuild(outputPath);
} else {
  split();
}
