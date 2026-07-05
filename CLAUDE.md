@.claude/skills/token-optimization.md

## Project

**Esferas de Magia e Poder** — webapp de leitura estática para a tradução PT-BR do
sistema *Spheres of Power* (regras suplementares de D&D 5e, da Drop Dead Studios).

- **O que faz:** transforma um `.txt` fonte no formato Homebrewery (~14.600 linhas) numa
  webapp de leitura fluida e responsiva — sidebar, busca full-text, dark mode, âncoras.
- **Quem usa:** leitores/jogadores brasileiros do sistema; conteúdo em PT-BR.
- **Stack:** HTML/CSS/JS puro, sem build step. O browser faz `fetch()` de `manifest.json`
  + `content/` e renderiza via `parser.js` (Homebrewery → HTML). Deploy em GitHub Pages.
- **Node só pontual:** `scripts/split-source.js` divide/verifica/reconstitui o conteúdo —
  nunca roda no browser.

### Mapa de arquivos
- `index.html` shell · `parser.js` conversor · `app.js` carga+navegação · `chapters.js` limites
- `style.css` · `manifest.json` (ordem de `content/`) · `descriptions.json` · `glossary-extra.json` · `conditions.json`
- `content/` — um arquivo por capítulo (Esfera/seção), fonte editável (49 arquivos)
- `archive/` — cópia intocada do `.txt` monolítico original

### Regras
- Editar conteúdo = editar o `.txt` do capítulo em `content/`; nenhum script depois (o app busca direto).
- Detalhes de parsing, segmentação de capítulos e JSONs curados: ver `README.md`.

## Three Man Team
Available agents: Arch (Architect), Bob (Builder), Richard (Reviewer)
