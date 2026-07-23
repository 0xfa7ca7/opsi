# Dashboard Color and Rendering Design

## Goal

Make KLOPSI static boards and interactive dashboards visibly richer while preventing invisible chart marks and heatmap intensity failures in generated offline HTML.

## Design

Both dashboard templates use the same named color roles: blue, cyan, green, amber, orange, magenta, and violet, plus soft variants for card backgrounds and heatmap fallbacks. Templates expose these roles as CSS custom properties so an agent can select evidence-matched colors without inventing a new palette for every report.

Color adds hierarchy and distinction, not meaning by itself. KPI and view cards receive reusable accent classes; chart marks remain labeled or position/length encoded; sequential and diverging data colors require a labeled legend. Text and interactive controls retain readable foreground/background contrast, visible focus, and print-safe borders.

Interactive chart contracts require visible geometry. Inline bar marks must be block-level, heatmap cells must have a non-white fallback background, and generated RGB values must use comma-separated `rgb(r, g, b)` syntax for renderer compatibility. Empty results still render an explicit message.

## Skill behavior

The static encoding guide defines the palette roles and color-scale rules. The interactive guide adds the runtime rendering contract and requires computed-style or screenshot review for chart marks, heatmap cells, legends, and filtered states. Each skill’s verification step explicitly includes a visual-rendering review rather than relying only on DOM node counts.

## Testing

Repository tests inspect both rendered skill packages and their source templates. They require the named palette, reusable accent classes, visible bar geometry, heatmap fallbacks, compatible RGB guidance, legends, and non-color encodings. Existing verifier, packaging, formatting, lint, typecheck, and unit tests remain unchanged in scope.

## Scope

This change updates reusable skills, templates, generated resource constants, tests, documentation, and the existing example artifact. It does not add a dashboard CLI, external charting library, network dependency, or new verifier finding code.
