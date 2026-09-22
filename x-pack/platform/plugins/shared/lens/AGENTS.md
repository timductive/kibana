# Lens — agent notes

Lens is an **editor that compiles user state into an expression**, not a chart library. Almost
every "Lens bug" is really a question about *which stage of that pipeline owns the behavior*.
Picking the wrong stage is the most common and most expensive mistake an agent makes here, so
read "Choosing the layer for a fix" before writing code.

## The pipeline

Values flow strictly left to right. Each stage can only see what earlier stages produced.

| # | Stage | Lives in | Owns |
|---|-------|----------|------|
| 1 | **Editor state** | `public/state_management`, `public/visualizations/*`, `public/datasources/*` | What the user configured. Persisted in the saved object. |
| 2 | **Expression build** | `buildExpression()` in [expression_helpers.ts](public/editor_frame_service/editor_frame/expression_helpers.ts) — calls each datasource's `toExpression()` then the visualization's `toExpression()` | Turning state into an AST. Sees state only; **no data, no resolved formats**. |
| 3 | **Data fetch** | `esaggs` / ES\|QL expression functions | Producing `Datatable`s. |
| 4 | **Datatable decoration** | `lens_format_column` ([format_column_fn.ts](common/expressions/impl/format_column/format_column_fn.ts)), time-scale, counter-rate, formula wrappers | Rewriting `column.meta.params` — i.e. **the effective format**. |
| 5 | **Chart expression function** | `src/platform/plugins/shared/chart_expressions/expression_*/common/expression_functions/` | Layer configs, validation, Inspector logging, **data semantics**. First stage that sees data *and* final formats together. |
| 6 | **Renderer** | `.../expression_*/public/expression_renderers/` | Mounting React, wiring services. |
| 7 | **React components** | `.../expression_*/public/components/` | **Presentation only** — elastic-charts props, DOM, interaction. |

Lens itself is stages 1–4; stages 5–7 live in the `chart_expressions` plugins under
`src/platform/` and are **shared with Visualize, agg-based charts and Discover's histogram**. A fix
in stage 5+ must work for those callers too, not just the Lens editor.

## Choosing the layer for a fix

> Find the **earliest stage at which every consumer of the value can be made to agree**, and put
> the fix there. Do not put it at the last stage before the symptom becomes visible.

Work through this before editing:

1. **Name the invariant that is broken**, not the pixel that looks wrong. "Two series on one axis
   must share a coordinate space" is an invariant. "The tick label says 17 minutes" is a symptom.
2. **Enumerate every consumer** of the value. For a Y axis that is: data series, `referenceLine`,
   `referenceLineLayer`, annotations, tooltips, value labels, domain/extent validation, percentage
   stacking, and Inspector/CSV. A fix that repairs one consumer and leaves the others reading a
   different truth is not a fix — it relocates the inconsistency.
3. **Find the narrowest stage that all of those consumers are downstream of.** That is your seam.
4. **If no code owns the concept, the defect is a missing abstraction.** Introduce and name it
   (a *policy*, an *owner*, a *resolved X*) rather than bolting a transform onto one consumer.

### Rules that follow

- **Data semantics belong in `common/` expression functions; never in React render.** Converting,
  scaling or reinterpreting row values during render repeats row work on every render and couples
  data meaning to the UI lifecycle. Anything that reads layers outside that one component then
  sees different numbers than the chart does.
- **Effective formats only exist after stage 4.** `column.meta.params` is rewritten at runtime by
  `lens_format_column`, time-scale wrappers, formula formats, percentage overrides, inherited data
  view formats and ES\|QL metadata. **Never reconstruct a column's format from editor state at
  stage 2** — you will compute a different format than the one the chart renders, and you will
  duplicate runtime behavior that then drifts.
- **Duplicating a helper in order to reach it means you are at the wrong layer.** If the logic you
  need lives somewhere you cannot import from, move the helper *down* to a shared location rather
  than cloning it upward. A correct fix in this codebase frequently *deletes* more than it adds.
- **Inspector and CSV must show original, pre-transform values.** Call `logDatatable(s)` before
  creating normalized chart copies, and make the copies immutable — preserve object identity for
  layers that need no change.

## When the fix requires picking a winner

If two user configurations conflict and the platform can only honor one (two formats on one axis,
two color scales on one legend, two intervals on one bucket), you are making a **product decision**,
not a coding decision. Do not silently pick a default. Instead:

- State the rule explicitly and make it **deterministic and order-stable**.
- Decide whether the losing config is *converted*, *ignored*, or *an error*.
- Surface the outcome in the Lens editor — mark the winner, warn on the overridden config.
- Write an ADR under the owning plugin's `docs/adr/` recording the options you rejected and why.
- Raise the decision with the user rather than inferring it.

## Worked example: duration units on a shared axis

Two metrics on one Y axis formatted as Duration with different source units — `foo_ms` = `1000`
and `foo_s` = `1`, both meaning one second. elastic-charts allows exactly **one tick formatter per
axis**, so the axis rendered the raw `1000` with the first series' seconds formatter → "17 minutes".

**[PR #275682](https://github.com/elastic/kibana/pull/275682) (closed — wrong layer).** Added
`normalizeSharedDurationAxes()` and called it inside `xy_chart.tsx`, the React render function,
rewriting follower values and formats into the first series' *input* unit. It hit every trap above:

- Stage 7 instead of stage 5 — data semantics in render.
- Fixed data series only; reference lines were declared out of scope, and the per-series tooltip
  formatter was described as "already correct" when axis/tooltip disagreement *is* the bug class.
- Its own comment says it "mirrors `getYAccessorWithFieldFormat` in `layers.ts`" — a clone, because
  the real helper was unreachable from where it stood. That duplication was the signal.
- Converted to the anchor's **input** unit rather than a coordinate unit derived from the anchor's
  **output** method; standing at the wrong layer hid the semantic question entirely.
- Resolved "which series wins?" silently, with no UI surfacing and no ADR.
- Reported thousands of passing tests — but the new ones drove enzyme `.dive()` into component
  internals. **Tests written at the wrong seam cannot detect the wrong seam.**

**[PR #289007](https://github.com/elastic/kibana/pull/289007) (accepted).** Resolves an *axis format
policy* per axis group inside `xyVisFn` / `layeredXyVisFn` (stage 5), converts data series and both
reference-line kinds into one coordinate unit, and makes ticks, tooltips and reference-line labels
consume that single resolved formatter. Grouping moved down into `common/`, **deleting 88 lines**
from `axes_configuration.ts`.

The reasoning is recorded where the code lives, and both documents are binding:

- [expression_xy/CONTEXT.md](../../../../../src/platform/plugins/shared/chart_expressions/expression_xy/CONTEXT.md)
  — vocabulary (axis group, anchor, effective formatter, coordinate unit vs source unit).
- [expression_xy/docs/adr/0001_axis_owned_format_policy.md](../../../../../src/platform/plugins/shared/chart_expressions/expression_xy/docs/adr/0001_axis_owned_format_policy.md)
  — the decision and its four rejected alternatives, one of which is *"Normalization during React
  rendering … rejected because it repeats row processing during render and couples data semantics
  to UI lifecycle."* That is exactly what #275682 did.
- [expression_xy/AGENTS.md](../../../../../src/platform/plugins/shared/chart_expressions/expression_xy/AGENTS.md)
  — the XY-specific ownership rules and the full list of axis consumers.

## Testing

- Test at the seam you chose. A fix in a `common/` expression function is tested against that
  function's output, not by mounting the chart.
- Existing green tests encode existing behavior; they are evidence you did not regress, never
  evidence the approach is right.
- `node scripts/jest x-pack/platform/plugins/shared/lens/<path>`
- `node scripts/type_check --project x-pack/platform/plugins/shared/lens/tsconfig.json`
