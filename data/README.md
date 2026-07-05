# `data/` — Canonical structured mechanics layer

This directory is the **single source of truth for game mechanics** consumed by the character builder.
The builder reads these files exclusively — it never infers rules from the rendered DOM.

## Layout

- `spheres/<slug>.json` — one file per sphere: identity, presentation (`theme`), acquisition rules, and
  its `talents[]`. Validated against `schema/sphere.schema.json` (talents against `schema/talent.schema.json`).
- `classes.json` — per-class, per-level progression (migrated from the root `classes.json`).
  Validated against `schema/class.schema.json`.
- `class-features.json` — class/subclass talent grants + budget bonuses (migrated from root).
  Validated against `schema/class-features.schema.json`.

## Provenance

Sphere files are bootstrapped by `scripts/extract-structured.js` (a one-time migration aid that reuses
the reader's parser), then reviewed and corrected by hand. A file is trustworthy only once `_reviewed`
is `true` and all `_needsReview` markers are cleared. `npm run validate` enforces schema conformance,
referential integrity, and a transitional cross-check against the prose in `content/`.

The root-level `sphere-rules.json`, `sphere-themes.json`, `descriptions.json`, `classes.json`, and
`class-features.json` remain in place until Phase 3 rewires the builder to read from here; their content
is folded into these files during migration.
