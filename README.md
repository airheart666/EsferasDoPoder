# Esferas de Magia e Poder — Webapp de Leitura

Webapp de leitura estática para a tradução brasileira do sistema **Spheres of Power** (Esferas de Magia e Poder), um conjunto de regras suplementares para D&D 5ª edição, originalmente criado para Pathfinder pela **Drop Dead Studios**.

---

## Contexto

**Fonte original:** [spheres5e.wikidot.com/spheres-of-power](http://spheres5e.wikidot.com/spheres-of-power)

O sistema Spheres of Power substitui o sistema de magias padrão do D&D 5e por um modelo baseado em **Esferas** (grupos temáticos de habilidades) e **Pontos de Magia**, com extensões marciais chamadas **Esferas de Poder**. O material cobre:

- **20 Esferas Mágicas** (Adivinhação, Alteração, Clima, Conjuração, Criação, Destino, Destruição, Distorção, Escuridão, Ilusão, Luz, Mente, Morte, Natureza, Proteção, Telecinese, Tempo, Universal, Vida, Aprimoramento)
- **~20 Esferas Marciais** (Alquimia, Armadilha, Atletismo, Barragem, Brigão, Bruto, Canalha, Domínio das Feras, Duelismo, Engenhosidade, entre outras)
- Regras de **Tradições de Conjuração** (personalização de como e por que a magia funciona por personagem)

O arquivo fonte `Esferas_do_Poder_HB_source.txt` é uma tradução completa para o português brasileiro, formatada originalmente para o site [Homebrewery (naturalcrit.com)](https://homebrewery.naturalcrit.com/), uma plataforma de criação de PDFs com layout de livro D&D.

---

## Problema

O formato Homebrewery é otimizado para **impressão em PDF de duas colunas com páginas fixas**. Manter o conteúdo exige ajustes manuais constantes de dimensionamento de página, quebras de coluna e posicionamento de elementos. O arquivo acumula ~14.600 linhas e 291 "páginas" de marcadores de layout que não fazem sentido fora do contexto de impressão.

---

## Propósito

Transformar o arquivo fonte em uma **webapp de leitura estática**, onde:

- O conteúdo é dividido em um arquivo por capítulo (Esfera/seção de regras), editável diretamente, sem migração de formato
- A webapp faz `fetch()` de cada parte e as renderiza no browser via parser client-side
- O layout é fluido e responsivo, sem colunas fixas nem dimensionamento manual
- A navegação é feita por sidebar, com busca e links de âncora por seção

---

## Estrutura do Projeto

```
EsferasDoPoder/
├── README.md
├── index.html                        — shell: header, sidebar, área de conteúdo
├── parser.js                         — conversor Homebrewery → HTML
├── chapters.js                       — limites de capítulo (usado pela webapp e por scripts/)
├── style.css                         — estética e dark mode
├── manifest.json                     — lista ordenada dos arquivos de content/
├── descriptions.json                 — descrições curadas dos cards da capa (por título de esfera/seção)
├── glossary-extra.json               — definições curadas de abreviações/termos extras do glossário (PM, CD, MHC, MAC…)
├── conditions.json                   — definições das condições de D&D 5e (enfeitiçado, amedrontado…), com auto-flexão de gênero/número
├── content/                          — um arquivo por capítulo (Esfera/seção), fonte editável
│   ├── 00-capa.txt
│   ├── 04-adivinhacao.txt
│   └── ...                           — 49 arquivos ao todo
├── scripts/
│   └── split-source.js               — divide/verifica/reconstitui o conteúdo (uso pontual, não roda no browser)
└── archive/
    └── Esferas_do_Poder_HB_source.ORIGINAL.txt   — cópia intocada do .txt monolítico original, para referência
```

### Por que dividir em arquivos por capítulo

O `.txt` original tinha 14.610 linhas, o que tornava editar uma Esfera específica uma questão de rolar ou buscar num arquivo enorme. A numeração de página (`#p8`, `#p201`, usada em âncoras e no `{{toc}}`) é apenas um contador sequencial de marcadores `\page` — não depende do conteúdo — então dividir o texto em arquivos e concatená-los na ordem certa antes de rodar o parser reproduz exatamente o mesmo resultado de antes. Por isso `parser.js` e a lógica de navegação/busca não precisaram mudar; só a etapa de carregamento em `app.js` (que agora busca `manifest.json` e concatena as partes) e a extração de `chapters.js` (para ser reusada pelo script de divisão).

### Editando o conteúdo

Para editar uma Esfera ou seção, abra o arquivo correspondente em `content/` (o nome já indica o capítulo, ex. `04-adivinhacao.txt`) e edite normalmente a sintaxe Homebrewery. Não é preciso rodar nenhum script depois de editar — a webapp busca os arquivos de `content/` diretamente a cada carregamento.

### Descrições dos cards da capa (`descriptions.json`)

Os cards de esferas na capa mostram uma descrição curta. O texto vem de `descriptions.json`, um mapa simples **`"Nome da Esfera": "descrição"`** — escrito à mão para resumir bem cada esfera para quem é novo no sistema. Para ajustar um card, edite o valor da chave correspondente (as chaves são os nomes exatos das esferas/seções, iguais aos do `{{toc}}`).

Observações:
- Se um nome **não** estiver no `descriptions.json`, o card cai automaticamente para a **extração da 1ª frase** do conteúdo daquele capítulo (fallback), então nenhum card fica vazio.
- Há uma chave única `"Regras e Termos Relevantes"` compartilhada pelos dois cards de mesmo nome (mágico e marcial), pois ambos têm o mesmo título. Se quiser textos distintos para cada um, será preciso trocar a chave por algo que os diferencie (peça e eu ajusto o esquema).

### Glossário interativo (`glossary-extra.json`)

Os termos destacados no texto abrem um painel com a definição. A maior parte é montada **automaticamente** a partir do conteúdo: os termos do capítulo "Regras e Termos Relevantes" e os parâmetros definidos em "Usando uma Esfera de Magia" (Custo, Alcance, Duração…).

O `glossary-extra.json` é um mapa `"termo": "definição"` (mesmo formato do `descriptions.json`) para o que **não** está definido no texto — principalmente abreviações (PM, CD, MHC, MAC). Para ajustar/adicionar, edite o valor da chave. Observações:
- É **opcional**: se o arquivo faltar, o app segue com o glossário automático (só sem as abreviações).
- Os parâmetros de talento (Custo, Alcance, Área…) ficam disponíveis no painel e na ficha, mas **não** viram links automáticos no meio da prosa (são palavras comuns) — para evitar falsos positivos. As abreviações entram no auto-link (exceto "PM", que aparece nas fichas/aprimoramentos).

### Condições de D&D 5e (`conditions.json`)

Mapa `"condição (masc. singular)": "definição"` para as condições que o texto assume conhecidas (enfeitiçado, amedrontado, cego, atordoado, caído, agarrado, paralisado, envenenado, inconsciente, invisível…). O app **gera automaticamente as formas de gênero/número** (amedrontado/amedrontada/amedrontados/amedrontadas, invisível/invisíveis…), então basta cadastrar a forma masculina singular e as ocorrências flexionadas no texto viram gatilhos tocáveis. Também é **opcional** (some sem quebrar nada se o arquivo faltar). Para ajustar uma definição, edite o valor da chave.

### Leitura de talentos (cartões, tags, notação)

Sem tocar no conteúdo, o app estrutura cada talento em runtime: agrupa a ficha de parâmetros, delimita cada talento num **cartão** com **tags de relance** (custo, ação, "Concentração", "Área") derivadas da própria ficha, marca **"Avançado"** os talentos com pré-requisito, distingue **habilidades base** dos talentos, e realça a **notação mecânica** (dados como `1d6` e `CD 15`). Nada disso exige edição manual — tudo é inferido do texto renderizado.

### Reconstituindo um único arquivo (ex. para reenviar ao Homebrewery)

```
node scripts/split-source.js --rebuild caminho/de/saida.txt
```

Concatena todos os arquivos de `content/` na ordem do `manifest.json` em um único `.txt`, pronto para colar de volta no Homebrewery. Para conferir que a divisão original não corrompeu nada, `node scripts/split-source.js --verify` reconcatena `content/` e compara byte a byte com `archive/Esferas_do_Poder_HB_source.ORIGINAL.txt`.

---

## Funcionalidades

- **Leitura segmentada por capítulo**: em vez de uma rolagem contínua com o documento inteiro, o conteúdo é dividido em capítulos (uma Esfera, seção de regras ou página de divisória por vez), evitando a "muralha de texto". A navegação entre capítulos usa `history.pushState`/`hashchange`, permitindo voltar/avançar pelo navegador e compartilhar links diretos (`#p8`)
- **Botões Anterior/Próximo** ao final de cada capítulo, para leitura sequencial sem depender da sidebar
- **Sidebar de navegação** gerada a partir do `{{toc}}` do documento; cada item leva diretamente ao capítulo correspondente
- **Busca full-text global** (não apenas no capítulo atual): navega automaticamente até o capítulo do resultado e destaca o termo
- **Links de âncora** por página (`#p8`, etc.), incluindo referências cruzadas dentro do próprio texto
- **Dark mode** com toggle e persistência via `localStorage`

### Segmentação em capítulos

Os capítulos são derivados dinamicamente a partir de duas fontes, sem exigir dados extras no `.txt`:

1. **Entradas de `{{toc}}`** de nível `###` (seção raiz, ex. "Esferas de Magia") e `####` (cada Esfera/subseção) — cada uma marca o início de um capítulo.
2. **Páginas de capa** (`{{frontCover}}`, `{{insideCover}}`, `{{backCover}}`) que não coincidam com uma entrada do TOC também iniciam um capítulo próprio (ex. a divisória entre "Esferas de Magia" e "Esferas de Poder"), evitando que fiquem coladas ao final do capítulo anterior.

Entradas de nível `#####` (glossário dentro de "Regras e Termos Relevantes") não geram novos capítulos — apontam para uma página dentro do capítulo pai, e a navegação rola até ela sem trocar de capítulo.

---

## Regras de Parsing

O parser converte a sintaxe proprietária do Homebrewery para HTML. Cada padrão tem um comportamento definido abaixo.

### Estrutura de Página e Navegação

| Padrão | Comportamento |
|---|---|
| `\page` + `<div class='pageNumber auto'></div>` | Converte em `<section id="pN">` — âncoras de navegação invisíveis, sem divisor visual |
| `\column` | Ignorado — layout fluido não tem colunas fixas |
| `{{toc ...}}` | Usado para construir a sidebar; **não renderiza inline** |

### Páginas de Capa

Todos os elementos de capa (`{{frontCover}}`, `{{insideCover}}`, `{{backCover}}`) são renderizados como uma **seção hero** com:

| Elemento | Comportamento |
|---|---|
| `![img](url){position:absolute,...}` | URL extraída; usada como `background-image` CSS da seção hero (`object-fit: cover`) |
| `{{imageMaskCenter...}}` | URL da imagem interna extraída; aplicada como background da seção hero |
| `{{banner TEXT}}` | Renderizado como badge de texto estilizado |
| `{{footnote ...}}` | Renderizado como caption abaixo do título |
| `{{logo ...}}` | Ignorado — referencia assets internos do Homebrewery que não carregam fora da plataforma |

### Containers de Conteúdo

| Padrão | Comportamento |
|---|---|
| `{{monster ...}}` | Componente stat block estilizado: fundo destacado, separadores entre seções, tabela de 6 atributos (FOR/DES/CON/INT/SAB/CAR) centralizada |
| `{{note ...}}` | Callout box com borda/fundo destacado e ícone de nota |
| `{{wide,note ...}}` | Callout box de largura total da área de conteúdo |
| `{{wide ...}}` | `<div class="wide">` de largura total, com scroll horizontal se necessário |
| `{{table,wide ...}}` | Tabela de largura total, com scroll horizontal se necessário |

### Formatação Inline e de Texto

| Padrão | Comportamento |
|---|---|
| `**Label**: :: valor` | Remove o ` :: `; renderiza como texto corrido com label em negrito: `**Label**: valor` |
| `• :: texto` | Item de lista de primeiro nível (`<li>`); `::` é removido |
| `◦ :: texto` | Item de lista de segundo nível (`<li>` recuado); `::` é removido |
| `{{width:Npx}}` | Ignorado — recuo das listas controlado por CSS |
| `:` sozinho na linha | Espaçamento vertical proporcional: cada colon = 0,5rem de margem |
| `::` / `:::` / `:::::` sozinho | Margem progressiva: `::` = 1rem, `:::` = 1,5rem, etc. |
| `___` fora de `{{monster}}` | `<hr>` — linha horizontal padrão |
| `___` dentro de `{{monster}}` | Separador interno entre seções do stat block |
| `<br>` / `<br><br>` | Mantidos como `<br>` HTML |

### Hierarquia de Headings

Mantida sem remapping:

| Markdown | HTML | Papel no documento |
|---|---|---|
| `#` | `<h1>` | Seção principal (Esferas de Magia / Esferas de Poder) |
| `##` | `<h2>` | Nome da esfera ou subseção maior |
| `###` | `<h3>` | Subseção de regras ou agrupamento de talentos |
| `####` | `<h4>` | Nome individual de talento ou habilidade |
| `#####` | `<h5>` | Sub-elemento, tabela, sub-talento |
| `######` | `<h6>` | Rótulo de tabela ou sub-sub-elemento |

### Markdown Padrão

Tratado com regras padrão:

- `**negrito**` → `<strong>`
- `*itálico*` → `<em>`
- Tabelas Markdown (`| col | col |`) → `<table>` estilizada
- Links Markdown → `<a>`

---

## Compatibilidade

A webapp é compatível com **GitHub Pages** sem build step: o browser faz `fetch()` de `manifest.json` e dos arquivos de `content/` diretamente (same-origin, sem CORS). Nenhuma dependência externa, nenhuma ferramenta de build — `scripts/split-source.js` roda em Node só pontualmente (para dividir/verificar/reconstituir conteúdo), nunca no browser.

Para desenvolvimento local, servir com qualquer servidor HTTP simples:

```
python -m http.server
```

Abrir em: `http://localhost:8000`

---

## Fonte e Créditos

- **Sistema original:** Spheres of Power para D&D 5e — Drop Dead Studios
- **Wiki de referência:** [spheres5e.wikidot.com](http://spheres5e.wikidot.com/spheres-of-power)
- **Tradução PT-BR:** dividida em `content/` (arquivo original preservado em `archive/Esferas_do_Poder_HB_source.ORIGINAL.txt`)
- **Formatação original:** [Homebrewery — Natural Crit](https://homebrewery.naturalcrit.com/)
