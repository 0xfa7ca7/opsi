# Final review fixes report: agent HTML dashboards

## Outcome

All seven final-review findings and both minor test/documentation findings were
addressed in the agent-authored dashboard contracts, generated resources, and
black-box verification. The work does not add a dashboard-rendering CLI command
or runtime dependency; GitHub issue #28 remains the backlog for deterministic
CLI-backed rendering.

## Test-first evidence

The complete verifier regression set was added before the fixes and run against
the prior implementation:

```sh
pnpm exec vitest run --project unit apps/cli/test/dashboard-verifier.test.ts
```

Observed RED: 42 expected failures and 25 passes across 67 tests. The failures
covered unsafe DOM sinks and active URL schemes, incomplete companion-resource
and CSP checks, structural/accessibility omissions, permissive nested manifest
objects and reductions, incomplete geography validation, the contradictory
static-map data rule, and missing production-template behavior coverage.

The generated-package drift test was independently observed RED after the
source contract changed but before regeneration: 1 expected failure and 36
passes. This proved that the new recursive comparison detects stale generated
resources, not only `SKILL.md` files.

The direct generated-file symlink unit and E2E regressions passed immediately:
the existing writer already refused the dangerous file target. Those tests are
retained to prove that behavior and that the outside symlink target is
unchanged.

## Finding-by-finding resolution

### 1. Unsafe code and active URL coverage

- Added stable `UNSAFE_CODE` detection for `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`/`writeln`, `DOMParser`, contextual
  fragments, `createHTMLDocument`, `parseHTMLUnsafe`, `setHTMLUnsafe`, and
  `srcdoc`.
- Added active-scheme detection for `javascript:` and related executable URL
  forms after whitespace/control-character and CSS-escape normalization.
- Kept inert manifest and presentation-data JSON outside executable-code
  scanning, so dangerous-looking strings in source data remain valid data.
- Added black-box regressions for every sink, active scheme, obfuscated form,
  and inert-JSON counterexample.

### 2. Self-contained output and exact CSP policy

- Expanded loadable companion-resource detection across resource-bearing HTML
  attributes, CSS `@import`, and CSS `url()`, including relative, root-relative,
  protocol-relative, `file:`, `http(s):`, and `blob:` references.
- Retained visible citation anchors and safe embedded `data:` raster/audio/video
  resources, including SVG `<image>` data resources, without treating them as
  external dependencies.
- Required exactly one CSP meta element. Both modes now require
  `default-src`, `connect-src`, `object-src`, `base-uri`, and `form-action` to be
  exactly `'none'`; `style-src` and `img-src` are constrained; static mode
  forbids executable script policy while interactive mode permits only the
  expected inline script policy. Network, file, self, and blob allowances are
  rejected.
- Added companion-reference and directive-by-directive CSP regressions.

### 3. Document structure and accessibility

- Added stable findings for the required doctype, language, UTF-8 charset,
  viewport, non-empty title, exactly one main element, and a valid single `h1`.
- Required non-empty, visible methodology, limitations, and lineage regions.
- Required labeled native interactive controls, an actual reset button, a
  polite live count, a semantic table, and useful empty-state and `noscript`
  content in interactive mode.
- Required every inline data SVG to expose both title and description through
  `aria-labelledby`.
- Ignored HTML/script/CSS comments when recognizing required structure and
  template markers, preventing comment-only false positives.
- Added focused regressions for every structure, control, table, SVG, and
  comment-only case.

### 4. Exact nested manifest and ordered reduction contract

- Enforced exact keys and value types for all nested manifest objects:
  `source`, `source.fields`, `data`, `data.fields`, `data.reduction`,
  `geography`, and `view`.
- Required ordered row-accounting: source rows to normalized rows to presented
  rows. Every transition must be non-increasing and every drop must have a
  truthful disclosed reduction; reductions are forbidden when original and
  presented counts are equal, including the zero-row case.
- Required exact embedded row/byte agreement rather than accepting internally
  plausible but mismatched metadata.
- Added missing-key, extra-key, wrong-type, out-of-order, undisclosed-drop, and
  unnecessary-reduction regressions.

### 5. Geography and valid static-map reconciliation

The design permits static maps, while the prior contract forbade all static
presentation data. The reconciled rule is:

- static non-map dashboards use `geography.kind: "none"`, have no
  `klopsi-presentation-data` block, and declare zero embedded bytes;
- static coordinate/geometry maps may include exactly one inert
  `klopsi-presentation-data` JSON block as spatial evidence, but never
  executable JavaScript;
- the inert body must match the manifest's exact UTF-8 byte and row counts, and
  every spatial row is validated;
- coordinate geography is limited to EPSG:4326; geometry geography supports
  EPSG:4326, EPSG:3794, and OGC:CRS84;
- geography objects have exact keys, referenced fields must exist, coordinate
  values must be finite and within range, GeoJSON is structurally validated,
  and `validRecords`/`excludedRecords` must agree with the embedded rows and
  visible exclusion disclosure.

The interactive 10,000-row limit remains interactive-only; it is not
incorrectly applied to a valid static spatial evidence block. Tests cover
valid/invalid coordinate and geometry cases, count mismatches, excluded-row
disclosure, and both static-map and static-non-map forms.

### 6. Recursive generated drift and symlink safety

- Replaced the top-level checked-in package comparison with an exact recursive
  file-set and byte comparison using `renderAgentSkillPackages()`. Missing,
  unexpected, and stale nested templates/references/scripts now fail.
- Added unit and CLI E2E regressions that place a symbolic link at a known
  generated resource file, assert generation fails safely, and confirm the
  outside target is untouched.

### 7. Interactive starter contract and runtime behavior

- Added an explicit sortable-header example to the generated interactive
  template using `data-field="category"` and the existing sort-field marker.
- Documented the `data-field` contract in the generated interaction guide.
- Added a minimal VM-backed DOM harness that executes the actual production
  template script and verifies initial row/count rendering, filtering into a
  useful empty state, exposed sort direction, reset restoration, and focus
  restoration. This tests the generated starter rather than a test-only copy of
  the behavior.

## Minor findings

- The generated-resource invariant now detects the complete recursive package
  tree, including unexpected nested files, instead of checking only known
  top-level files.
- The manually verified static fixture's recorded size was corrected from
  7,412 to 7,384 bytes after its CSP was tightened. The interactive artifact
  remains 13,812 bytes.

## Generated artifacts and visual-evidence impact

All checked-in packages were regenerated from
`apps/cli/src/agent-skill-resources.ts` and `apps/cli/src/agent-skills.ts`; no
generated resource was hand-edited afterward.

The production interactive script and rendered presentation were not changed:
only a contract example comment and interaction-guide wording were added. The
static fixture changed only by removing an invalid `script-src 'unsafe-inline'`
CSP allowance. Therefore the prior browser layout/interaction evidence remains
truthful; no visual rerun was necessary. The production-template VM behavior
harness, verifier fixture runs, structural tests, and corrected byte inventory
provide fresh evidence for the changed contract surface.

## Verification

Focused final-tree checks:

```text
agent-skills.test.ts + dashboard-verifier.test.ts: 104 passed
generate-skills.e2e.test.ts: 8 passed
agent-setup.test.ts + release-contract.test.ts: 19 passed
agent-setup.integration.test.ts: 2 passed
pack.test.ts: 3 passed
checked-in verifier syntax: passed
static fixture verifier: valid, zero findings
interactive fixture verifier: valid, zero findings
ESLint: passed
TypeScript: passed
git diff --check: passed
```

Full final-tree check:

```text
pnpm check: passed
format, lint, typecheck, and build: passed
unit: 517 passed
integration: 310 passed
CLI E2E: 82 passed
pack: 3 passed
```

## Round 2 verifier hardening

The second independent re-review identified four narrow defensive gaps. Each
was reproduced in the black-box verifier suite before production changes.
Running the focused verifier against the prior implementation produced 12
expected failures and 70 passes across 82 tests: four compound/bracket HTML
property assignments, four named-whitespace-entity active URLs, three
unexpected CSP directives, and the first unavailable reset mutation in the
combined control matrix. The retained counterexamples for inert JSON and
browser-significant entity spelling already passed.

The fixes and adjacent audit map to the findings as follows:

- HTML-producing property detection now recognizes simple and compound
  assignment operators through whitespace-tolerant dot access and quoted
  bracket access for `innerHTML`, `outerHTML`, and `srcdoc`. Optional chaining
  is accepted in prohibited HTML-producing method-call detection. Inert
  application/JSON strings containing those spellings remain outside
  executable scanning.
- URL normalization now removes the case-sensitive standard HTML named
  whitespace references `&Tab;` and `&NewLine;` before active-scheme checks.
  Tests cover quoted and unquoted attributes, incorrect case, and the required
  semicolon boundary; missing-semicolon text remains inert as browsers leave it
  undecoded.
- CSP validation now compares against an exact directive/value map: seven
  static directives and the same set plus `script-src 'unsafe-inline'` for
  interactive mode. Unexpected fallback, element/attribute-specific, and even
  restrictive extra directives are rejected. Directive names are normalized
  case-insensitively and any duplicate still fails.
- Interactive filters and reset are rejected when hidden, disabled, inert,
  `aria-hidden`, `aria-disabled`, hidden-type, or removed from sequential
  keyboard focus with `tabindex="-1"`. The tests assert structural operability
  signals only and do not claim browser execution.

The normative contract and both starter templates were synchronized with the
exact CSP and operable-control policy. All 13 checked-in skill packages were
regenerated from the source registry, and recursive drift is clean.

Round 2 focused and final-tree evidence:

```text
dashboard verifier: 84 passed
dashboard verifier + agent skill packages: 121 passed
focused unit package/setup/release matrix: 140 passed
agent setup integration: 2 passed
generate-skills + packed CLI E2E: 11 passed
checked-in verifier syntax: passed
static fixture verifier: valid, zero findings
interactive fixture verifier: valid, zero findings
git diff --check: passed

pnpm check: passed
format, lint, typecheck, and build: passed
unit: 534 passed
integration: 310 passed
CLI E2E: 82 passed
pack: 3 passed
```

## Round 3 clean-room review hardening

The third independent review produced five confirmed verifier gaps and one
fixture-content correction. All production changes were preceded by direct
black-box regressions. Against the prior verifier, the first focused run
reported 23 expected failures and 88 passes across 111 tests. The failures
covered seven quoted-bracket HTML-producing calls, five quoted-bracket network
calls, two active XML/SVG data URL forms, a CSS `image-set()` string reference,
a body-scoped CSP meta, two impossible view counts, four ancestor/fieldset
operability cases, and an extra unnamed button. Existing `text/xml`, negative
counts, URL-form image sets, inert JSON, named operable buttons, safe raster
data, and fragment references already passed and remain as counterexamples.

The fixes map to the review findings as follows:

- Prohibited network and HTML-producing calls now recognize equivalent
  single- or double-quoted bracket property access for every previously named
  method. Inert application/JSON bodies remain excluded from executable-code
  scanning.
- Interactive structure is scanned with a bounded element stack rather than a
  flat substring of the marked filter region. Hidden, inert, and `aria-hidden`
  ancestors and disabled fieldsets make descendant controls/reset unavailable.
  Every button under the sole main contract scope is checked individually for
  operability and a resolvable nonempty accessible name.
- The exact CSP meta must be the sole policy, inside the sole head, before the
  body and any active content. Moving the otherwise exact policy into the body
  now produces the stable `CSP_INVALID` finding.
- Active XML-derived and SVG data URLs are rejected even on citation anchors.
  Standard and WebKit `image-set()` string and `url()` companion references are
  rejected, while safe embedded raster data and fragment-only references stay
  valid.
- Every view count is nonnegative and no larger than original source rows.
  Interactive view counts are additionally bounded by embedded presented rows;
  static aggregate views may truthfully describe a larger source population.
- The static fixture now contains three truthful headline KPI cards. Its exact
  size is 7,592 bytes, its wide grid has three columns, and the existing 620px
  breakpoint still collapses the grid to one column.

All 13 checked-in packages were regenerated from the source registry. Recursive
file-set and byte drift is clean. The in-app Browser workflow was attempted for
the changed static fixture, but runtime discovery exposed no browser backend.
No unrelated automation surface was substituted. The retained content tests
assert the three KPI cards and truthful added content, while the fixture itself
retains its narrow and print rules; earlier browser evidence continues to cover
the unchanged chart/table and offline structure.

Round 3 focused and final-tree evidence:

```text
dashboard verifier: 113 passed
verifier + package/setup/release unit matrix: 169 passed
checked-in verifier syntax: passed
static fixture verifier: valid, zero findings
interactive fixture verifier: valid, zero findings
agent setup integration: 2 passed
generate/setup/pack CLI E2E: 23 passed
git diff --check: passed

pnpm check: passed
format, lint, typecheck, and build: passed
unit: 563 passed
integration: 310 passed
CLI E2E: 82 passed
pack: 3 passed
```

## Round 4 optional-call and main-scope closure

The final review confirmed two immediate syntax/scope equivalents. Both were
captured before production changes. The prior verifier reported 11 expected
failures and 113 passes across 124 focused tests: five HTML-producing optional
calls, five network optional calls, and one hidden-extra-main scope bypass. The
expanded inert application/JSON counterexample continued to pass.

- Every existing prohibited network and HTML-producing method-call form now
  accepts the JavaScript optional-call token between its property reference and
  argument list. This applies consistently to dot, optional-property, and
  single- or double-quoted bracket access. The adjacent `eval` matcher received
  the same syntactic treatment; invalid optional forms for `new Function` and
  dynamic `import()` were not invented.
- Document validation and per-button validation now resolve main scope through
  the same sole nonhidden, non-inert main predicate. Button validation fails
  closed when that scope is absent or ambiguous. A hidden extra main therefore
  no longer prevents an unnamed button in the real available main from being
  checked.

All 13 checked-in packages were regenerated from the source registry, and the
recursive file-set/byte drift check is clean.

Round 4 focused evidence before the exact-tree full gate:

```text
dashboard verifier: 124 passed
verifier + package/setup/release unit matrix: 180 passed
checked-in verifier syntax: passed
static fixture verifier: valid, zero findings
interactive fixture verifier: valid, zero findings
generate-skills + packed CLI E2E: 11 passed
git diff --check: passed
```

## Concerns

No code concern. The verifier remains intentionally bounded as a
dependency-free contract linter; it is not a full HTML parser, sanitizer,
browser renderer, or security sandbox. The only evidence limitation is the
unavailable browser backend noted above; structural, responsive-content,
offline, verifier, and prior visual evidence remain in place.
