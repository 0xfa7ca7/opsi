# KLOPSI Skill vs Direct OPSI API Evaluation

## Executive summary

On 2026-07-24, two fresh subagents independently completed the same live
Slovenian OPSI catalogue task. One was required to use the KLOPSI Agent Skill
and `klopsi` CLI; the other was prohibited from using either and had to call the
OPSI API directly.

Both paths returned the same five datasets in the same order, selected the same
first dataset, reported the same requested metadata and resource, and reached
the same metadata-only conclusion that the resource was not tabular. An
independent replay reproduced those results.

| Measure | KLOPSI skill + CLI | Direct OPSI API | Observed difference |
| --- | ---: | ---: | ---: |
| Subagent wall time | 67,591 ms | 72,916 ms | KLOPSI was 5,325 ms / 7.3% faster |
| Character-based token proxy | ~9,400 | ~14,210 | KLOPSI used ~4,810 / 33.8% fewer proxy tokens |
| User-facing CLI commands or HTTP requests | 4 commands | 2 requests | Direct API used 2 fewer calls |
| Requested result fields correct | All | All | Tie |
| Search order correct | Yes | Yes | Tie |
| Warnings or HTTP/CLI failures | None | None | Tie |

The direct path needed fewer network requests, but the evaluator spent more
time and context discovering OPSI's gateway-specific request contract and
projecting its raw responses. KLOPSI supplied bounded commands, structured
output, response validation, and a documented safety contract. Its main
friction was field normalization: an empty upstream license and the upstream
resource `name` were available only in raw provider metadata or under a
normalized `title`, causing one additional command.

**Conclusion for this run:** KLOPSI was the better agent-facing interface. It
matched the direct API's result fidelity while finishing slightly faster and
using materially less inspected text. Direct API access remains attractive for
a purpose-built integration that already implements OPSI's exact gateway
schema, validation, retries, bounds, and projection. This is a one-run
catalogue evaluation, not a universal performance claim.

## Investigation question

The investigation compared:

1. an agent routed through the installed `klopsi` skill repertoire and CLI; and
2. an agent calling OPSI's live HTTP API directly.

The evaluation asks whether the abstraction changes:

- the factual result;
- the amount of work needed to produce a reproducible answer;
- end-to-end execution time;
- approximate context/token consumption; and
- operational friction and safety.

## Controlled task

Both evaluators received the same substantive task:

> As of the run time, search Slovenia's OPSI catalogue for the literal query
> `promet`, limited to 5 datasets with the provider/default ordering. Select
> the first returned dataset. Report the five ordered result IDs and titles;
> the selected dataset's exact ID, title, organization title/name, license
> ID/title, metadata-modified timestamp, and a notes-derived summary; every
> resource's ID, name, format, and URL; whether any resource appears
> machine-readable and tabular based only on metadata; and exact reproducibility
> commands with statuses and warnings.

The task was deliberately bounded and read-only. It exercised catalogue search,
dataset inspection, resource enumeration, exact upstream identifiers, a small
derived judgment, and reproducibility without introducing download size or
content-parsing variance.

### Variant controls

The KLOPSI evaluator:

- had to read `/Users/0xfa7ca7/.agents/skills/klopsi/SKILL.md` and its required
  shared and narrow domain skills;
- had to use the installed `klopsi` 0.0.1 CLI;
- could not use `curl` or call OPSI directly; and
- was asked to prefer bounded structured output and field projection.

The direct evaluator:

- could not read the KLOPSI skills or invoke `klopsi`;
- had to use direct read-only HTTP requests;
- could inspect the repository's OPSI provider source to discover the gateway
  contract; and
- was asked to use bounded requests and local JSON projection.

Neither evaluator could edit the repository. They ran concurrently in fresh,
isolated agent contexts and were instructed to work without user questions.

## Environment and API contract

- Repository revision: `34ef90e`
- KLOPSI version: `0.0.1`
- Date: `2026-07-24`
- Time zone: `Europe/Ljubljana`
- KLOPSI measurement interval:
  `2026-07-24T01:23:46.791Z`–`2026-07-24T01:24:54.382Z`
- Direct API measurement interval:
  `2026-07-24T01:24:04.809Z`–`2026-07-24T01:25:17.725Z`
- Live gateway:
  `https://podatki.gov.si/api/gw/opsi-api-basic/2.2.3`

Current
[generic CKAN documentation](https://github.com/ckan/ckan/blob/master/doc/api/index.rst)
describes Action API reads such as `package_search` as GET-able. OPSI's
deployed gateway is more specific: KLOPSI's provider contract defines
`package_search` as a JSON `POST` with a complete search body, while
`package_show` is a `GET` requiring `use_default_schema=false`. The repository
definitions are therefore the authoritative basis for reproducing the direct
path:

- `packages/providers/opsi/src/transport.ts`
- `packages/providers/opsi/src/operations.ts`

The KLOPSI path followed the repository's skill routing:

- `skills/klopsi/SKILL.md`
- `skills/klopsi-shared/SKILL.md`
- `skills/klopsi-catalogue/SKILL.md`

## Measurement method

Each evaluator recorded `start_ms` at its first tool call and `end_ms`
immediately before its final response using `Date.now()`. Reported wall time is
`end_ms - start_ms`; it includes documentation/source discovery, command
construction, live execution, result inspection, reasoning, and response
preparation.

The runtime does not expose billing-grade per-subagent token telemetry. Each
evaluator therefore reported the same transparent proxy:

```text
(benchmark prompt characters
 + inspected command stdout/stderr characters
 + final response characters) / 4
```

The result was rounded to the nearest 10 tokens. The proxy is useful for a
directional comparison of visible text handled during the task. It excludes
hidden model reasoning and common system context, depends on each evaluator's
character accounting, and must not be interpreted as provider billing usage.

## Ground-truth result

Both evaluators and the independent replay observed `665` matches and this
ordered five-result page:

1. `082849fa-355a-4e98-9877-8db503e9d585` —
   **Seznam priglašenih pirotehničnih izdelkov**
2. `82b17086-0e52-4c76-a9c0-d8112aeb0ec1` —
   **Pristaniški promet ladij, potnikov in blaga, Slovenija, letno**
3. `c429657d-6f2a-42f2-97b4-8f1e0c35c9d2` —
   **Pristaniški blagovni promet s kontejnerji v TEU, Slovenija, letno**
4. `f94d466b-2324-4263-8fc7-c2ce0ba7bfbe` —
   **Pristaniški blagovni promet po vrstah blaga in vrstah tovora, pristanišče
   Koper, Slovenija, letno**
5. `c8125d8e-9162-48cc-ae08-c88e23103475` —
   **Pristaniški ladijski promet, Slovenija, letno**

The selected first dataset had:

| Field | Verified value |
| --- | --- |
| ID | `082849fa-355a-4e98-9877-8db503e9d585` |
| Title | `Seznam priglašenih pirotehničnih izdelkov` |
| Organization title | `MINISTRSTVO ZA NOTRANJE ZADEVE` |
| Organization name | `ministrstvo_za_notranje_zadeve` |
| Upstream license ID | empty string |
| Upstream license title | empty string |
| Metadata modified | `2026-07-22T08:46:10.247217` |
| Resource count | `1` |

The sole resource was:

| Field | Verified value |
| --- | --- |
| ID | `9a235c42-38eb-4e8c-b3b0-057c8987681e` |
| Name | `Seznam priglašenih pirotehničnih izdelkov` |
| Format | `PDF` |
| URL | `https://podatki.gov.si/dataset/082849fa-355a-4e98-9877-8db503e9d585/resource/9a235c42-38eb-4e8c-b3b0-057c8987681e/download/seznampriglaenihpirotehninihizdelkov.pdf` |

Both evaluators classified the resource as not machine-readable and tabular.
Their rules differed slightly in the examples listed, but both required a
declared structured/tabular format and rejected the sole `PDF` resource without
inspecting its contents. Both notes-derived English summaries preserved the
same meaning.

The surprising first search result is not an evaluator mismatch. Both paths
sent or reproduced OPSI's default sort,
`relevance asc, metadata_modified desc`, and received the same response. This
evaluation measures interface parity; it does not establish that the
provider's default search ranking is useful.

## Result-quality comparison

| Requirement | KLOPSI | Direct API | Assessment |
| --- | --- | --- | --- |
| Exact ordered IDs/titles | Correct | Correct | Tie |
| Selected dataset fields | Correct | Correct | Tie |
| Complete resource inventory | Correct | Correct | Tie |
| Metadata-only tabular judgment | Correct | Correct | Tie |
| Bounded operation | `--limit 5`, projected search fields | `rows: 5`, local `jq` projection | Tie |
| Status evidence | Four exit-0 CLI commands | Two HTTP-200 / exit-0 requests | Tie |
| Result-schema validation | Built into provider/CLI | API `success` checked; manual projection | KLOPSI advantage |
| Safety policy | Skill and CLI enforce network/output rules | Caller supplied timeouts and flags | KLOPSI advantage |

There was no factual quality trade-off in this task. KLOPSI's normalized model
made common identifiers and titles easy to use, while its preserved raw
provider metadata allowed the evaluator to recover exact upstream empty-string
license values. The direct path exposed the upstream shape immediately but left
schema knowledge and field selection to the caller.

## Efficiency results

### End-to-end time

- KLOPSI: `67,591 ms`
- Direct API: `72,916 ms`
- Difference: `5,325 ms`

KLOPSI was 7.3% faster when the difference is divided by the direct path's
runtime. Expressed in the other direction, the direct path was 7.9% slower than
KLOPSI.

This is end-to-end agent time, not raw network latency. The direct evaluator
performed only two HTTP requests, but it also inspected source to discover the
gateway contract and recovered from an initially over-broad source search. The
KLOPSI evaluator read more prescriptive skill guidance and ran four CLI
commands. The roughly five-second difference is too small for a strong latency
generalization from one run.

### Approximate token/context use

- KLOPSI: approximately `9,400` proxy tokens
- Direct API: approximately `14,210` proxy tokens
- Difference: approximately `4,810` proxy tokens

KLOPSI used 33.8% fewer proxy tokens relative to the direct path. The direct
path's proxy was 51.2% larger relative to KLOPSI. The direct evaluator
attributed most of the extra inspected text to a broad local source search and
raw API output; the KLOPSI evaluator attributed most of its `31,500` inspected
characters to `dataset show`.

The proxy result supports a practical hypothesis: a documented, structured CLI
can reduce agent context by encapsulating a provider-specific wire contract.
Repeated runs with runtime token telemetry are required to quantify that effect
reliably.

### Command/request count

The direct path was more economical at the wire-operation level:

- one `package_search` request;
- one `package_show` request, whose result already embedded resources.

The KLOPSI evaluator ran:

1. `klopsi search 'promet' --limit 5 --json --fields id,title`
2. `klopsi dataset show <id> --json`
3. `klopsi dataset resources <id> --json --fields id,name,format,url`
4. `klopsi dataset resources <id> --json --fields id,title,format,url`

The catalogue skill explicitly recommends `dataset show` followed by
`dataset resources`. The fourth call was corrective: normalized resources use
`title`, so projecting `name` returned `null`. A caller that accepts the
embedded resources from `dataset show`, or already knows to request `title`,
could use fewer KLOPSI commands. The table reports the observed run, not that
optimized counterfactual.

## Friction and operational differences

### KLOPSI path

Advantages observed:

- the skill selected the narrow catalogue workflow;
- the search result was bounded and projected without knowing the OPSI body
  schema;
- CLI exit codes and structured envelopes gave a stable success contract;
- provider response validation, timeout, retry, redirect, and origin rules were
  encapsulated; and
- normalized IDs, titles, organization data, resources, and provider metadata
  were available together.

Friction observed:

- `dataset show --json` returned more raw provider metadata than the task
  needed;
- upstream `license_id: ""` and `license_title: ""` are not first-class
  normalized fields and had to be read from `providerMetadata.raw`;
- the normalized resource field is `title`, while the benchmark requested the
  upstream term `name`; and
- following the skill's `dataset show` then `dataset resources` sequence
  repeated data retrieval for a metadata-only task.

### Direct API path

Advantages observed:

- two HTTP requests were sufficient;
- the upstream field names and empty-string values were visible directly; and
- local `jq` projection could shape exactly the final evidence.

Friction observed:

- OPSI's deployed gateway contract differed from the simplest generic CKAN GET
  example;
- the search request required ten explicit body fields, including a string
  `facet` flag and exact default sort;
- the dataset request required the legacy
  `use_default_schema=false` parameter;
- the evaluator had to supply timeouts, HTTP-failure behavior, response-success
  checks, and projections manually;
- an initial broad source search produced irrelevant/truncated output and
  increased the token proxy; and
- robust schema validation, same-origin redirect enforcement, retries, and
  typed errors would require additional integration code beyond the two
  successful `curl` calls.

One direct evaluator shell wrapper was rejected before execution because it
included cleanup with `rm -f`. It made no HTTP request and did not affect the
data result, but it illustrates how ad hoc shell orchestration adds incidental
failure modes outside the API itself.

## Reproduction commands

### KLOPSI

```sh
klopsi search 'promet' --limit 5 --json --fields id,title
klopsi dataset show '082849fa-355a-4e98-9877-8db503e9d585' --json
klopsi dataset resources \
  '082849fa-355a-4e98-9877-8db503e9d585' \
  --json --fields id,title,format,url
```

For exact empty upstream fields and the upstream resource `name`, inspect:

```sh
klopsi dataset show \
  '082849fa-355a-4e98-9877-8db503e9d585' \
  --json |
  jq '{
    license_id: .data.providerMetadata.raw.license_id,
    license_title: .data.providerMetadata.raw.license_title,
    resource_name: .data.providerMetadata.raw.resources[0].name
  }'
```

### Direct OPSI gateway

```sh
curl --fail-with-body --silent --show-error \
  --max-time 30 --connect-timeout 10 \
  -X POST \
  'https://podatki.gov.si/api/gw/opsi-api-basic/2.2.3/package_search' \
  -H 'content-type: application/json' \
  --data '{
    "q": "promet",
    "fq": "",
    "rows": 5,
    "start": 0,
    "facet": "true",
    "facet.field": [],
    "facet.mincount": 0,
    "facet.limit": 50,
    "sort": "relevance asc, metadata_modified desc"
  }'

curl --fail-with-body --silent --show-error \
  --max-time 30 --connect-timeout 10 \
  --get \
  'https://podatki.gov.si/api/gw/opsi-api-basic/2.2.3/package_show' \
  --data-urlencode \
  'id=082849fa-355a-4e98-9877-8db503e9d585' \
  --data-urlencode 'use_default_schema=false'
```

Both direct responses must additionally be checked for HTTP success, parsed as
JSON, checked for `success: true`, and projected from `result`.

## Independent verification

After the evaluators completed, the primary agent replayed both search paths
against live OPSI. It projected each response to ordered `{id,title}` records
and observed the same five items and total count of `665`.

It then replayed `dataset show` and `package_show`, projecting the selected
dataset's ID, title, organization, license, modified timestamp, notes, and
resources. The values matched. The replay also verified KLOPSI's normalization
behavior:

- normalized resource `title` contained the upstream resource `name`;
- normalized license fields were absent rather than empty strings; and
- `providerMetadata.raw` preserved the exact upstream empty license values and
  resource `name`.

No resource content was downloaded during evaluator or verification runs.

## Limitations

1. **One run per path.** Network and model scheduling variance are not
   controlled well enough for a latency benchmark.
2. **One narrow workflow.** The task covers discovery and metadata inspection,
   not downloading, validation, tabular analysis, WFS, offline use, or
   provenance.
3. **Different access overhead is intentional.** The KLOPSI agent read skill
   documentation; the direct agent discovered the gateway contract from source.
   The comparison measures realistic agent work from those starting points,
   not isolated HTTP client throughput.
4. **Token use is approximate.** The character proxy is not tokenizer output,
   excludes hidden reasoning, and is based on evaluator-reported inspected
   text.
5. **Concurrent but not simultaneous starts.** Their measured intervals
   overlapped, but the direct evaluator began about 18 seconds after KLOPSI.
6. **Live catalogue mutability.** The exact result page and count can change
   after the recorded date.
7. **No cold-cache proof.** The experiment did not isolate operating-system,
   DNS, TLS, or KLOPSI cache warmth.
8. **Evaluator behavior affects results.** The extra KLOPSI resource command
   and the direct evaluator's broad source search are real usability outcomes,
   but another agent could optimize either path.

## Recommendations

### For users and agent authors

- Prefer KLOPSI for general Slovenian public-data work where safe discovery,
  inspection, downloads, validation, analysis, or provenance must be composed
  reliably.
- Prefer direct OPSI calls only when the integration already owns and tests the
  gateway-specific request schema, response validation, bounds, retry/timeout
  behavior, redirect policy, and field projection.
- Treat provider/default search order as an upstream behavior to inspect, not
  an assurance that the first result is semantically best.

### For KLOPSI

- Add field projection to `dataset show` so agents can avoid inspecting a large
  provider payload for a few metadata fields.
- Document `title` as the normalized counterpart of upstream resource `name`,
  or accept `name` as a projection alias.
- Consider exposing license fields in the normalized dataset model while still
  preserving the distinction between missing and upstream empty-string values.
- Consider a metadata-only command or option that returns selected dataset
  fields plus resources in one bounded envelope, matching the common
  search-follow-up workflow.

### For follow-up evaluation

Run at least 10 alternating trials per path with:

- synchronized prompts and predeclared gateway documentation;
- separated cold- and warm-cache groups;
- raw request latency and total agent wall time;
- runtime-provided input/output token telemetry if available;
- exact saved response digests;
- a second task that downloads, validates, queries, exports, and verifies a
  tabular resource; and
- a WFS task that tests KLOPSI's safety and schema abstractions against direct
  service construction.

Those additions would distinguish interface usability from network variance and
show whether KLOPSI's advantage grows on workflows where its security,
validation, and provenance features do more work.
