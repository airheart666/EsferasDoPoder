# Curation Notes — flagged prerequisites

_Generated 2026-07-05 from data/spheres/. Confident sphere variants (Domínio de Feras, Guardiã, Temporal, Climática) and D&D skills were auto-resolved in the extractor. What remains needs your game knowledge._

**How to use:** verify each item, edit the source prose OR the extractor mapping, re-run `npm run extract && npm run validate`. Clear a talent's `_needsReview` once correct; set a sphere's `_reviewed: true` when its whole file is verified.

## A. Sphere references I could not map (4 distinct)

These prereqs say "Esfera de X" where X isn't a known sphere id. Likely subclass/package/alias names.

| Prose ref | My guess | # | Example talents |
|---|---|---|---|
| Taverna | Brigão package? (tavern-brawler) | 8 | Brigão › Dragão Alquímico; Brigão › Água Flamejante |
| Esgrima | Duelismo? (fencing→dueling sphere) | 6 | Duelismo › Aparar Qualquer Coisa; Duelismo › Golpe da Alma (exploração) |
| Berserker | ? (rage-themed; Ímpeto or a subclass) | 6 | Ímpeto › Alterar Terreno; Ímpeto › Atavismo (adrenalina) |
| Bar | Brigão package? (see Taverna) | 1 | Brigão › Relaxamento Perfeito |

## B. Prerequisite talents not found by that name (54 distinct)

The prereq names a talent that doesn't exist under that base name in the data. Either it lives in another sphere, is worded differently, is an OR-alternative, or is a descriptive requirement the rules engine will need special handling for.

| Prose ref | # | Example talents |
|---|---|---|
| Quebrar a Terra | 4 | Ímpeto › Alterar Terreno; Ímpeto › Passos Ruinosos |
| Unguento | 3 | Alquimia › Elixir da Imortalidade (fórmula, médico); Alquimia › Poção de Cura (fórmula, médico) |
| Estendida (metasfera) | 3 | Alteração › Transformação Permanente [maldição]; Aprimoramento › Aprimoramentos Referenciais |
| Sinal de Impulso | 3 | General › Legião Infinita (tática); General › Recuperar Espírito (grito) |
| Projeção de Pensamentos | 3 | Mente › Comunicação Superior; Mente › Vínculo Memético |
| Estendida (metaesfera) | 3 | Morte › Morto-vivo Permanente; Natureza › Nuvem Persistente (protomancia, água) |
| Massa (metasfera) | 2 | Aprimoramento › Aprimoramentos Referenciais; Distorção › Teletransportar Exército |
| Forja | 2 | Criação › Criar Materiais; Criação › Mudança Permanente |
| um talento (motivo) | 2 | Destino › Morte (motivo); Destino › A Alta Sacerdotisa (motivo) |
| Teletransporte à Distância | 2 | Distorção › Teletransporte Perfeito; Distorção › Mudança Planar |
| Teletransporte Invisível | 2 | Distorção › Teletransporte Perfeito; Distorção › Mudança Planar |
| Atravessar a Escuridão | 2 | Escuridão › Um com o Vazio; Escuridão › Andarilho das Sombras (véu) |
| Esqueleto (morto-vivo) ou Zumbi (morto-vivo) | 2 | Morte › Múmia (morto-vivo); Morte › Inumano (morto-vivo) |
| Alcance (metasfera) (3) | 2 | Natureza › Incêndio Florestal (protomancia, fogo); Universal › Alcance Extremo |
| Adivinhação | 1 | Adivinhação › Adivinhação Maior (adivinhar) |
| Radiografia | 1 | Adivinhação › Encontrar Localização (adivinhar) |
| qualquer combinação de cinco talentos de (fórmula) ou (veneno) | 1 | Alquimia › Frasco Universal (fórmula, veneno) |
| qualquer talento que conceda resistência a ácido | 1 | Alteração › Manipulação de Energia |
| radiante ou trovão como opção de traço | 1 | Alteração › Manipulação de Energia |
| Corpo Retorcido (traço) | 1 | Alteração › Homogeneizar |
| Salto com Vara ou Balanço de Corda | 1 | Atletismo › Descida de Helicóptero |
| Furtividade ou Sobrevivência | 1 | Batedor › Batedor Especialista |
| Quebrador de Partes | 1 | Batedor › Modificar Características (pesquisa) |
| Gume Afiado | 1 | Brigão › Arma Descartável (frágil) |
| Inalador de Fumaça | 1 | Brigão › Embriaguez Eterna |
| Descontraído e Relaxado | 1 | Brigão › Relaxamento Perfeito |
| Perícia Roubar | 1 | Canalha › Roubar Talento |
| Mudar Material | 1 | Criação › Mudança Permanente |
| Mudar Matéria | 1 | Criação › Mudança de Estado (alterar) |
| pelo menos um talento [maldição] (palavra) | 1 | Destino › Execração |
| Teletransporte de Objeto | 1 | Distorção › Teletransportar Estrutura |
| Sinal Sombreado | 1 | Escuridão › Penumbra Sem Luz (véu) |
| Defender Outros | 1 | Guardião › Eu Irei |
| Estendida [metasfera] | 1 | Ilusão › Ilusão Permanente |
| pacote de companheiros | 1 | Liderança › Companheiro Adicional |
| pacote de ajudante | 1 | Liderança › Mestre dos Mortos (ajudante) |
| pacotes de seguidores e parceiros | 1 | Liderança › Esquadrão |
| Imobilização | 1 | Luta Livre › Dilacerador de Membros (imobilização) |
| Enredar | 1 | Mente › Vínculo Memético |
| Massa — metasfera | 1 | Mente › Vínculo Memético |
| Sombra (morto-vivo) ou Espectro (morto-vivo) | 1 | Morte › Fantasma (morto-vivo) |
| Carniçal (morto-vivo) ou Zumbi (morto-vivo) | 1 | Morte › Prole Vampírica (morto-vivo) |
| Profissional (reanimar) | 1 | Morte › Inumano (morto-vivo) |
| Sombra (morto-vivo) ou Aparição (morto-vivo) | 1 | Morte › Aparição (morto-vivo) |
| Forjar Terra | 1 | Natureza › Terremoto (protomancia, terra) |
| habilidade de contra-ataque | 1 | Retribuição › Condicionamento Intenso (contra) |
| Precisão | 1 | Telecinese › Marionete (levitação) |
| Imagem Fraturada | 1 | Tempo › Imagem Fraturada Aprimorada |
| Tempo | 1 | Tempo › Estase Temporal |
| Contra-ataque ou a capacidade de conjurar dissipar magia | 1 | Universal › Contra-ataque Caótico (magia selvagem) |
| Dissipar ou pacote de mana | 1 | Universal › Contrafeitiço |
| Habilidade para obter foco marcial (veja Esferas de Poder) | 1 | Universal › Foco Místico |
| Prolongada (metasfera) | 1 | Universal › Duração Extrema |
| Golpe (metaesfera) | 1 | Universal › Golpe Extremo |

## C. Cost typos in source (pp instead of PM)

- Adivinhação › Sentido  (cost: 0 pp)
- Aprimoramento › Aprimorar  (cost: 0 pp)

_These 2 are genuine source typos — fix the `pp`→`PM` in the content/*.txt, then re-extract._
