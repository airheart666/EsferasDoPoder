// @ts-check
/**
 * Shared type definitions for the structured mechanics layer.
 *
 * These JSDoc typedefs mirror schema/*.schema.json. The JSON Schemas are the
 * runtime source of truth (checked by `npm run validate`); these typedefs give
 * editors and `npm run typecheck` (tsc --checkJs) static awareness of the same
 * shapes. Keep the two in sync when the schema changes.
 *
 * This module exports nothing at runtime — it exists purely for types.
 */

/**
 * @typedef {'magic'|'martial'} Section
 */

/**
 * @typedef {Object} CostTier
 * @property {string} label
 * @property {number} pm
 */

/**
 * @typedef {Object} Cost
 * @property {number|null} [base]      Flat PM cost, or null when variable / tier-only.
 * @property {CostTier[]}  [tiers]
 * @property {boolean}     [variable]
 * @property {string}      [text]      Original prose cost, for display/audit.
 */

/**
 * @typedef {Object} Prerequisite
 * @property {'talent'|'sphere'|'level'|'text'|'or'|'tag'|'skill'|'package'|'martial-talent'} type
 * @property {string} [id]   Referenced talent/sphere id (type talent|sphere).
 * @property {number} [min]  Minimum character level (type level).
 * @property {string} [text] Free-form / unresolved prerequisite (type text).
 * @property {Prerequisite[]} [of]  Alternativas (type or) — satisfeito se QUALQUER uma.
 * @property {string[]} [tags]      Tags aceitas (type tag).
 * @property {number} [count]       Nº mínimo de talentos com a(s) tag(s) (type tag).
 * @property {string} [skill]       Perícia/ferramenta (type skill).
 * @property {string} [sphere]      Id da esfera do pacote (type package).
 * @property {string} [pkg]         Id do pacote (type package).
 */

/**
 * @typedef {Object} Enhancement
 * @property {number|null} [pm]
 * @property {string} text
 */

/**
 * @typedef {Object} Talent
 * @property {string}  id
 * @property {string}  name
 * @property {string}  sphere         Owning sphere id.
 * @property {Section} section
 * @property {'base'|'talent'} kind
 * @property {string}  [group]        Originating h3 group (free-pick classification).
 * @property {string[]} [tags]
 * @property {Cost}    [cost]
 * @property {string|null} [action]
 * @property {string|null} [range]
 * @property {string|null} [duration]
 * @property {string|null} [target]
 * @property {string|null} [area]
 * @property {string|null} [save]
 * @property {Prerequisite[]} [prerequisites]
 * @property {boolean} [advanced]
 * @property {Enhancement[]} [enhancements]
 * @property {string}  [body]
 * @property {string[]|boolean} [_needsReview]
 */

/**
 * @typedef {Object} FreeGroup
 * @property {string}   [tag]
 * @property {string[]} [tags]
 * @property {string}   [h3]   Regex tested against a talent's group heading.
 */

/**
 * @typedef {Object} Conditional
 * @property {string|string[]} requires  Proficiency (or one of several) unlocking a bonus pick.
 * @property {number} [addPicks]
 */

/**
 * @typedef {Object} PackageOption
 * @property {string} id
 * @property {string} label
 * @property {string[]} [baseTalents]    Talent names auto-granted as the package's base ability.
 * @property {string[]} [baseTalentIds]  Resolved ids of baseTalents (extractor-filled).
 * @property {string[]} [scopeTags]      Fase 2: tags que amarram um talento a este pacote (talento com a tag → prereq de pacote). Ausente = usa o id do pacote.
 * @property {FreeGroup} [freeGroup]
 * @property {string} [freeLabel]
 * @property {number} [freePicks]
 * @property {string[]} [talentTags]
 * @property {Conditional[]} [conditionals]
 * @property {{minMagicSpheresExcludingSelf?: number}} [requires]  Gate to CHOOSE this package.
 */

/**
 * @typedef {Object} Packages
 * @property {string} [label]
 * @property {string} [grantTalent]  Nome do talento repetível que concede um pacote adicional (ex.: 'Protomancia Expandida'). Ausente = só o pacote grátis da aquisição.
 * @property {PackageOption[]} options
 */

/**
 * @typedef {Object} FreeGroupTyped  Grupo-grátis tipado (freeGroups): filtro por tag(s) + contagem própria.
 * @property {string} [tag]
 * @property {string[]} [tags]
 * @property {string} [h3]
 * @property {number} [picks]
 * @property {string} [label]
 *
 * @typedef {Object} Acquisition
 * @property {FreeGroup} [freeGroup]
 * @property {FreeGroupTyped[]} [freeGroups]  Múltiplos grupos-grátis tipados (ex.: Destruição = tipo + formato).
 * @property {string} [freeLabel]
 * @property {number} [freePicks]
 * @property {string[]} [talentTags]
 * @property {string[]} [baseTalents]  Nomes de talentos forçados a kind:base (auto-concedidos) — bases que não ficam antes do 1º grupo na fonte.
 * @property {Conditional[]} [conditionals]
 * @property {Packages} [packages]
 */

/**
 * @typedef {Object} Theme
 * @property {number} h
 * @property {number} s
 * @property {string} sig
 * @property {number|null} [lLight]
 */

/**
 * @typedef {Object} Sphere
 * @property {string}  id
 * @property {string}  name
 * @property {Section} section
 * @property {string|null} [summary]
 * @property {string} [intro]  Preâmbulo da esfera (builder — ponto 3).
 * @property {Theme|null}  [theme]
 * @property {Acquisition|null} [acquisition]
 * @property {Talent[]} talents
 * @property {boolean} [_reviewed]
 */

/**
 * @typedef {Object} ProgressionRow
 * @property {number} level
 * @property {number} prof
 * @property {number} [magicTalents]
 * @property {number} [martialTalents]
 * @property {number} [pm]
 * @property {number} [chi]
 */

/**
 * @typedef {Object} ClassDef
 * @property {Section} type
 * @property {string}  keyAbility
 * @property {'PM'|'Chi'|'none'|null} resource
 * @property {ProgressionRow[]} progression
 * @property {string[]} [crossSpheres]  Titles of other-section spheres buyable with this class's budget.
 */

/**
 * Result of computeGrants: what a character's subclass/class grants resolve to,
 * applying the conditional access-vs-specific rule.
 * @typedef {Object} GrantResult
 * @property {Set<string>} accessSpheres    Sphere ids granted BASE access (character lacked prior access).
 * @property {Set<string>} specificTalents  Talent ids granted specifically (character had prior access).
 * @property {Array<{sphereId:string, talentId:string, name?:string, feature?:string, level:number}>} pendingReplacements  Granted specifics the character already owns → free replacement choice (deferred).
 */

/* ---- Character model (Phase 3: talent references are stable ids) ---- */

/**
 * @typedef {Object} CharSphere
 * @property {string} sphere        Sphere id.
 * @property {Section} section
 * @property {boolean} [granted]    Access granted by a subclass (free); absent/false if slot-bought.
 * @property {string[]} [packages]  Pacotes possuídos (multi): [0] = grátis da aquisição; [1..] via o talento repetível (custam 1 slot cada).
 * @property {{pkg?: string}} [choices]  Legado single-pacote (migrado p/ `packages`); ainda usado por dados salvos antigos.
 * @property {string[]} freePicks   Talent ids taken via the sphere's free picks.
 * @property {string[]} talents     Talent ids taken as extra (slot-costing) picks.
 */

/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name
 * @property {string} className
 * @property {string} [subclass]
 * @property {number} level
 * @property {number} [keyMod]
 * @property {string} [tradition]
 * @property {{skills: string[], tools: string[]}} proficiencies
 * @property {CharSphere[]} spheres
 * @property {string[]} [metamagic]  Talent ids chosen via a restricted allowance (e.g. Feiticeiro Metamágica → Universal metaesfera), cost 0.
 * @property {number} [updatedAt]    Date.now() do último write — carimbo de last-write-wins do sync na nuvem.
 * @property {string} [ownerUid]     uid do dono na nuvem (Firestore); ausente no modo local.
 * @property {string[]} [sharedTo]   (Fase 2) uids de mestres que podem LER — DERIVADO de sharedTables (únicos gmUid). Regra + query do mestre.
 * @property {{code:string, name:string, gmUid:string}[]} [sharedTables]  (Fase 2) mesas às quais está exposto.
 */

/**
 * @typedef {Object} Table  (Fase 2) mesa/campanha; doc id = code (convite).
 * @property {string} code
 * @property {string} gmUid
 * @property {string} [gmName]
 * @property {string} name
 * @property {number} [createdAt]
 */

/**
 * @typedef {Object} Tradition  Tradição nomeada (traditions.json), por tipo (magic/martial).
 * @property {string} id
 * @property {string} label
 * @property {number} talentBonus   Talentos extras concedidos (somados ao orçamento do tipo).
 * @property {string|null} [keyAbility]
 * @property {string} [notes]
 *
 * @typedef {Object} DataIndex
 * @property {Map<string, Talent>} talentById
 * @property {Map<string, Sphere>} sphereById
 * @property {Object<string, ClassDef>} classes
 * @property {Object<string, any>} classFeatures
 * @property {{magic?: Tradition[], martial?: Tradition[]}} traditions
 */

/**
 * A single prerequisite check result.
 * @typedef {Object} PrereqResult
 * @property {boolean} ok            All structured prereqs satisfied.
 * @property {Prerequisite[]} missing    Structured prereqs not met (block).
 * @property {Prerequisite[]} unverified Text prereqs needing manual confirmation.
 */

export {};
