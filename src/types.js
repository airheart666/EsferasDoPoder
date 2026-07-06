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
 * @property {'talent'|'sphere'|'level'|'text'} type
 * @property {string} [id]   Referenced talent/sphere id (type talent|sphere).
 * @property {number} [min]  Minimum character level (type level).
 * @property {string} [text] Free-form / unresolved prerequisite (type text).
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
 * @property {FreeGroup} [freeGroup]
 * @property {string} [freeLabel]
 * @property {number} [freePicks]
 * @property {string[]} [talentTags]
 * @property {Conditional[]} [conditionals]
 */

/**
 * @typedef {Object} Packages
 * @property {string} [label]
 * @property {PackageOption[]} options
 */

/**
 * @typedef {Object} Acquisition
 * @property {FreeGroup} [freeGroup]
 * @property {string} [freeLabel]
 * @property {number} [freePicks]
 * @property {string[]} [talentTags]
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
 * @property {Object} [choices]     e.g. { pkg: 'formula' } for package spheres.
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
 */

/**
 * @typedef {Object} DataIndex
 * @property {Map<string, Talent>} talentById
 * @property {Map<string, Sphere>} sphereById
 * @property {Object<string, ClassDef>} classes
 * @property {Object<string, any>} classFeatures
 */

/**
 * A single prerequisite check result.
 * @typedef {Object} PrereqResult
 * @property {boolean} ok            All structured prereqs satisfied.
 * @property {Prerequisite[]} missing    Structured prereqs not met (block).
 * @property {Prerequisite[]} unverified Text prereqs needing manual confirmation.
 */

export {};
