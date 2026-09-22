# expressionXY — agent notes

This plugin renders the `xyVis` / `layeredXyVis` expression functions. It is **shared code**:
Lens, Visualize, agg-based charts and Discover's histogram all render through it. A change here
must hold for all of them, not just the Lens editor you were looking at.

Read first:

- [lens/AGENTS.md](../../../../../../x-pack/platform/plugins/shared/lens/AGENTS.md) — the surrounding
  pipeline and the "choosing the layer for a fix" rule.
- [CONTEXT.md](./CONTEXT.md) — **canonical vocabulary.** Use those terms exactly, including the
  _Avoid_ list.
- [docs/adr/0001_axis_owned_format_policy.md](./docs/adr/0001_axis_owned_format_policy.md) —
  **canonical decision record** for axis formatting. Its rejected-options list is binding; do not
  re-litigate it.

## `common/` vs `public/` — the ownership line

| | `common/` | `public/` |
|---|---|---|
| Expression functions, layer configs, validation, Inspector logging | ✅ | — |
| **Interpreting or converting row values** | ✅ | ❌ |
| Resolving which format governs a shared resource | ✅ | ❌ |
| elastic-charts props, DOM, interaction, theming | — | ✅ |

`xyVisFn` / `layeredXyVisFn` ([common/expression_functions/](common/expression_functions/)) are
the **normalization seam** — the first and only point that sees evaluated layers, their effective
`column.meta.params`, and the axis configuration together, before anything renders.

**Never transform data in [public/components/xy_chart.tsx](public/components/xy_chart.tsx) or any
component below it.** That file is presentation. Deriving row values there repeats work every
render, couples data meaning to the React lifecycle, and leaves every non-component consumer
reading different numbers than the chart. The ADR rejects this explicitly.

## The axis format policy

One policy per axis group, resolved in `common/` and threaded to every consumer:

| Module | Role |
|---|---|
| [common/axis_grouping.ts](common/axis_grouping.ts) | `groupAxisSeries()` — assigns series to `left` / `right` / explicit groups by formatter compatibility. `auto` is a staging bucket that gets redistributed, **not an axis**. |
| [common/axis_format_policy.ts](common/axis_format_policy.ts) | `resolveAxisFormatPolicies()` picks the anchor, coordinate unit, conversion factors and mismatch diagnostics. `applyAxisFormatPolicies()` produces converted, immutable chart copies. |
| [common/axis_format_policy_types.ts](common/axis_format_policy_types.ts) | `AxisFormatPolicy`, `AxisPolicyMember`, `AxisFormatMismatch`. `source: 'inferred'` keeps provenance explicit so a future persisted axis-unit setting can replace inference without touching consumers. |

Both entry points call it identically — see
[xy_vis_fn.ts](common/expression_functions/xy_vis_fn.ts) and
[layered_xy_vis_fn.ts](common/expression_functions/layered_xy_vis_fn.ts). Duration unit maths lives
in `field_formats` (`getDurationUnitFromOutputFormat`, `getDurationUnitInSeconds`) so there is one
unit table; do not add a second.

## Every consumer of a Y axis

A single elastic-charts axis carries **exactly one tick formatter**. Any change touching axis
values or formatting must be checked against *all* of these. Consumers now resolve through the
policy — keep it that way; a consumer that independently picks a column formatter reintroduces the
bug class:

| Consumer | Where | How it gets its formatter |
|---|---|---|
| Data series coordinates | [public/helpers/data_layers.tsx](public/helpers/data_layers.tsx) | converted chart copies from `applyAxisFormatPolicies()` |
| Axis ticks | [public/helpers/axes_configuration.ts](public/helpers/axes_configuration.ts) | `getAxesConfiguration(..., axisFormatPolicies)` |
| Tooltips | [public/components/tooltip/tooltip.tsx](public/components/tooltip/tooltip.tsx) | axis group's formatter, falling back to the per-series one |
| Literal reference lines | [public/components/reference_lines/reference_line.tsx](public/components/reference_lines/reference_line.tsx) | `axisGroup?.formatter ?? formatters[...] ?? xAxisFormatter` |
| Table-backed reference lines | [public/components/reference_lines/reference_line_layer.tsx](public/components/reference_lines/reference_line_layer.tsx) | same precedence |
| Annotations | [public/helpers/annotations.tsx](public/helpers/annotations.tsx) | — |
| Domain / extent validation | `validateExtents()` in [common/expression_functions/validate.ts](common/expression_functions/validate.ts) | runs on converted layers |
| Percentage stacking | `isPercentage` on data layers | duration conversion runs **first**; percent stays the rendered formatter |
| Inspector / CSV | `logDatatable(s)` in [common/utils/log_datatables.ts](common/utils/log_datatables.ts) | original, pre-conversion tables |

"Fixed the axis, tooltips were already correct" is not a fix. If the axis and the tooltip reach
different answers for the same point, that disagreement **is** the defect.

## Invariants

- **Log before you transform.** `logDatatable(s)` runs on the **original** tables; Inspector and
  CSV always show pre-conversion values. Resolve the policy, log, *then* apply.
- **Chart copies are immutable and one-pass.** Never mutate incoming layer tables. Preserve object
  identity for layers needing no conversion; traverse each affected table at most once.
- **Both entry points, one policy.** `xyVis` builds a single data layer, `layeredXyVis` takes
  layers as an argument, but they converge on the same renderer. Fixing one only is a bug.
- **Left and right resolve independently** — two axes are two coordinate spaces.
- **The anchor converts too.** Conversion targets the coordinate unit, not "everyone else matches
  series one"; the anchor is a member of its own policy.
- **Unknown, malformed and unformatted values are axis-relative** — numerically unchanged, not
  guessed at and not dropped. If the anchor has no format, followers are not converted at all.
- **Grouping has one home.** If you need it from `common/`, it is already there — import
  `groupAxisSeries`. Do not re-implement it in `public/`.

## Worked example: why the first attempt was rejected

Issue #240105: `foo_ms` = `1000` and `foo_s` = `1` (both one second) share a Y axis. One formatter
per axis means the raw `1000` renders with the seconds formatter → "17 minutes".

**[PR #275682](https://github.com/elastic/kibana/pull/275682) — closed as the wrong solution.**
It called a `normalizeSharedDurationAxes()` helper from inside `xy_chart.tsx` during render, and:

- put data semantics in `public/components`, which the ADR rejects by name;
- converted to the anchor's **input** unit instead of a coordinate unit derived from its **output**
  method — standing at the wrong layer concealed the semantic question;
- covered data series only, leaving reference lines and tooltips on different formatters;
- **cloned `getYAccessorWithFieldFormat` from `public/helpers/layers.ts`** because the real helper
  was unreachable from its chosen location. Needing to duplicate an existing helper to stand where
  you are standing is the clearest available signal that you are at the wrong layer;
- chose the winning series silently, with no editor warning and no ADR;
- shipped tests that `.dive()` into React internals — tests at the wrong seam validate the wrong
  seam and can never reveal it.

**[PR #289007](https://github.com/elastic/kibana/pull/289007) — accepted; this branch is stacked on
it.** The policy modules above, resolved after `logDatatable`, with ticks, tooltips and
reference-line labels all consuming one resolved formatter. Grouping moved into `common/`,
**removing 88 lines** from `public/helpers/axes_configuration.ts` — a correct fix here frequently
deletes more than it adds.

The four alternatives it rejected are recorded in
[the ADR](./docs/adr/0001_axis_owned_format_policy.md#considered-options); read them before
proposing a different shape.

## Testing

- Test expression-function behavior against the function's output, not by mounting `XYChart`.
- `node scripts/jest src/platform/plugins/shared/chart_expressions/expression_xy/<path>`
- `node scripts/type_check --project src/platform/plugins/shared/chart_expressions/expression_xy/tsconfig.json`
- Changes here affect page-load bundle size; check `packages/kbn-rspack-optimizer/limits.yml` if CI
  flags an overage.
