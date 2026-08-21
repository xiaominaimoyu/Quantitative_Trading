# Recovery provenance

This document records what was preserved, what was reconstructed directly from
an extant contract, and what was conservatively rebuilt from summaries after
the original project sources were lost.  It does not claim that reconstructed
implementation code is the original source.

## Preserved existing work

- The React application, its generated OpenAPI type file, its `openapi.json`,
  pages, and real/mock facades were retained.  The only approved front-end
  compatibility edits are the pure ten-state-to-UI-status mapper, fixed-point
  decimal-to-number mapping in the existing paper-trading facade, and the
  minimal `PaperTradingReal.tsx` display of null market price/submission time
  as `市价`/`—`; the public UI domain remains camelCase.
- Existing `/acceptance/*` routers, acceptance SQLAlchemy models, schemas, and
  services remain separate from B5 `/reports` and related research-report
  resources.  Their former fixed zero-UUID write actor was repaired as a
  lazily-created local acceptance-system user so foreign-key-enabled databases
  do not receive a fabricated reference.
- Existing migration revision `e2aac586a3cd` and its revision linkage were not
  changed.

## Faithfully restored from exact retained contract

- The 68 historical paths and their HTTP operations were restored from
  `frontend/openapi.json`; the direct runtime `quant_trading.main.app` audit
  found all 68 paths, methods, and operation IDs present.
- Request IDs, public error envelopes, development-session authentication,
  role/scopes, pagination envelopes, content hashes, and lifecycle endpoints
  are recovered contract behaviors.  Runtime auth and all paper-trading
  request/response models are explicitly represented with Pydantic models,
  UUID/date/query constraints, and HTTP bearer security metadata.
- Front-end-facing paper-trading response compatibility takes precedence over
  a few older OpenAPI response shapes.  Core paper financial facts are emitted
  as fixed-point decimal JSON strings (and market-order `price` stays JSON
  null); the facade explicitly converts string-or-number inputs to its existing
  numeric camelCase UI types.  Reconciliation separately exposes execution
  `status` and result `result_status`, with a facade fallback only for retained
  older result-in-`status` fixtures.
- `account_id` is optional only when there is a single account (or an explicit,
  request-time default development seed is created); a request with multiple
  accounts and no ID receives a conflict instead of guessing.

## Runtime contract gaps and frozen artifact compatibility

- The runtime OpenAPI is not a byte-for-byte restoration of the retained
  historical document.  The current direct audit has 37 runtime component
  schemas versus 121 frozen schemas.  It verifies historical paths/methods/
  operation IDs and key runtime auth/paper schemas, but it does not claim
  parameter, request-body, success-response, or security-schema equivalence
  beyond those tested live boundaries.  These remaining differences are
  explicitly not represented as runtime contract equivalence.
- `quant_trading.app.create_app()` has a narrowly-scoped
  `FrozenHistoricalContractArtifactExport` path only when the retained legacy
  generator sets `QUANT_ENV=test`.  It reads the frozen front-end OpenAPI
  artifact so the generator does not overwrite retained generated files.
  Therefore `npm.cmd run api:check` validates frozen artifact compatibility,
  not the runtime app's parameter/request/response schemas.  Runtime checks
  import `quant_trading.main.app` directly and do not use that adapter.

## Conservatively reconstructed from summaries

- The persistence models, B0--B5 deterministic local services, migration
  baseline `0005_b5_validation_reports_risk`, and G5 migration
  `0006_g5_paper_trading` are reconstructions.  They use portable SQLAlchemy
  types and an isolated SQLite test path, not a recovered historical database
  implementation.
- B0/B1 worker leasing and B2 snapshots are additionally reconstructed from
  the retained closure-script behavior: SQL-backed `queued → claimed →
  running → terminal` tasks, persistent worker heartbeats, expiry recovery,
  and canonical local artifacts are deliberately local-only.  There is no
  external queue, scheduler, market feed, or worker implementation recovered
  verbatim.
- The two explicit `deterministic_fixture` sources produce only tiny,
  deterministic local OHLCV fixture bars.  A clean fixture writes immutable
  staged-then-replaced Parquet/manifest files and DuckDB serves whitelisted,
  stable keyset queries and daily aggregates; the blocked fixture records a
  quality failure and commits neither a snapshot nor a lineage edge.  This is
  not market data and no performance result is claimed.  Query and aggregate
  use the documented request end as their availability-time knowledge bound;
  no undocumented cutoff field is required or used.
- `quant_trading.data.MARKET_BAR_SCHEMA` and `WRITER_PROFILE` are a
  reconstruction from the retained B2 capacity-probe imports and retained
  contract shape.  The worker writes the declared Arrow schema and Parquet
  2.6/Zstandard-level-3/dictionary/statistics/row-group/data-page profile in
  fact; it does not merely describe that profile in a manifest.  `pyarrow`
  24.0.0 was verified in the local system Python and recorded as a reconstructed
  dependency, not as an historical lockfile entry.
- Reconstructed B2 manifests use detached-hash semantics.  The controlled
  disk `manifest.json` is canonical JSON without its own final hash; the SHA-256
  of those exact bytes is persisted and added only to the DB/API manifest.  The
  final snapshot, partition hash/size/row count, and controlled task artifacts
  are revalidated before reuse and before query/download.  A partition artifact
  carries the actual Parquet bytes (base64 only in the text DB compatibility
  column), not a JSON descriptor masquerading as Parquet.
- B1 task recovery is reconstructed with attempt-scoped ownership fencing:
  default worker IDs include hostname, process ID, and random UUID; all
  start/renew/complete/cancel/fail transitions require task, worker, and
  attempt ownership.  A stale worker cannot clear or overwrite a reclaimed
  attempt; a failed terminal fence rolls back the current DB business stage.
- G5 is a local paper-trading boundary: the ten-state order machine, exact-once
  fill IDs, weighted-average accounting, deterministic mock adapter, recovery
  behavior, and daily aggregation were rebuilt from the retained G5
  description.  Reconciliation is observation/difference-only and never
  overwrites an order, broker ID, fill, or cash fact.  Recovery may resolve only
  `UNKNOWN → SUBMITTED` or `UNKNOWN → REJECTED` from an explicit broker receipt;
  claimed fills, partial fills, and cancellations remain UNKNOWN until durable
  local evidence exists.
- G6 safety guards were rebuilt for paper trading only: a persisted
  append-only-audited kill switch, decimal limits, six pre-trade checks,
  unknown-order circuit breaker, and realized-loss tracker.  A sell is
  risk-reducing only when its held quantity covers it (never cost-basis value),
  so short paper positions remain rejected.  They are not an approval of live
  trading.

## Not recoverable or not authorized

- The original lost backend source, historical test corpus, migration source
  before the retained acceptance revision, exact worker implementation, and
  historical production configuration are not recoverable from this workspace.
- No live market-data access, broker credential use, xtquant connection,
  external task queue, external backup operation, or real-money order path was
  restored or authorized.  The `xtquant` adapter is deliberately unavailable
  even if an SDK happens to be present.
- External G6 blockers remain external: extended paper operation, broker
  connectivity validation, alerts, UAT, independent security review, data
  licensing, compliance approval, real account authorization, disaster-recovery
  exercise, production benchmark, and model-promotion evaluation are not
  completed by this recovery.

## Validation facts from this recovery

- Application import and OpenAPI generation succeeded; direct runtime
  comparison found 68 of 68 historical paths and 82 of 82 historical
  path/method/operation-ID triples.  Runtime HTTP tests also cover bearer
  metadata, malformed UUID rejection, paper response validation, fixed-point
  string/null serialization, reconciliation list/detail shape, and data-set
  parent-version lineage.
- Isolated SQLite backend tests run with an already installed system Python:
  `92 passed` using `python -B -m pytest -q -p no:cacheprovider` (the project
  virtual environment lacks `pytest`, so no dependency was installed and the
  verifier was instructed not to create a pytest cache).
- Worker-specific isolated tests cover queue priority/lease recovery,
  cancellation, retry sanitization, canonical UTF-8 artifacts, fixture
  Parquet/hash metadata, clean/blocked quality gates, DuckDB paging/aggregate,
  health heartbeats, and configuration aliases.  The B2 recovery tests also
  verify exact manifest/partition key sets, detached disk hashes, real `PAR1`
  downloads and metadata, frontend-mapper nested fields, offset-aware
  availability filtering, maximum point behavior, bounded fixture requests,
  tamper rejection, and stale-worker fencing.
- Alembic static chain check reported `0007_recovered_worker_queue` as the sole
  head; offline `upgrade head --sql` rendered the reconstructed baseline,
  preserved acceptance revision, G5/G6 paper tables, and local worker tables
  without connecting to a database.
- `npm.cmd run api:check` passed without rewriting `frontend/openapi.json` or
  generated schema files.  Its meaning is limited to the frozen artifact
  compatibility export described above; it is not runtime OpenAPI validation.
- `duckdb==1.5.5` and `pyarrow==24.0.0` are declared in the reconstructed
  runtime requirements and were present in the system Python used for the
  isolated snapshot tests and B2 capacity probe.  The
  existing project virtual environment does not currently contain DuckDB, so
  the snapshot engine is deliberately loaded only when a worker operation
  executes; this keeps the frozen artifact export importable without masking a
  missing runtime dependency during actual snapshot work.  No package was
  installed as part of recovery.
- A later, explicitly authorized locked `npm ci` restored the local toolchain
  without changing `package-lock.json`.  The current frontend command results
  are recorded in the third-phase facts below rather than inferred from this
  earlier incomplete-node-modules observation.

## Second-phase closure facts

- `backend/Dockerfile` and `.dockerignore` are reconstructed container build
  inputs, not recovered historical build files.  They use Python 3.12 slim,
  the existing lockfile, only the runtime package/Alembic metadata, bytecode
  and buffering safeguards, and an unprivileged UID/GID 1000 runtime user.
  The existing compose file has no backend bind mount, so this user choice has
  no identified G2 mount conflict.  Docker CLI and daemon availability were
  checked read-only before the explicitly approved, isolated G2 closeout run.
  That run created only token-scoped resources, then removed its image,
  network, seven containers, and system-temporary root in its `finally`
  cleanup; an exact-name post-run inspection confirmed no residual resource.
  It did not touch an existing container, network, image, volume, or database.
- `frontend/.env.example` is a reconstructed safe local example with Mock API
  as its default and no credential material.  The retained generator's stale
  `backend/src` path was changed to the actual `backend` package root; the
  obsolete `backend/src` injection in `scripts/backup.py` was removed.  A
  current executable-code scan found no remaining `backend/src` reference.
- `scripts/runtime_closeout.py` now names
  `0005_b5_validation_reports_risk` as the reconstructed migration baseline,
  writes and verifies `logical_content_sha256`, expects an empty version list
  immediately after dataset creation, uses the frozen `canceled` spelling,
  and validates a downloaded dataset-partition artifact as UUID-identified
  `PAR1` Parquet bytes with matching hash and size.  It retains its temporary
  database, port, and cleanup guards.  Only offline/import-level coverage was
  run here: no independently verified isolated PostgreSQL test/smoke endpoint
  was supplied, so the destructive full closeout was deliberately not run.
- The mock research-flow and accessibility Playwright specifications were
  reconstructed from the retained memory summary and current UI.  Their
  current execution evidence is recorded in the third-phase facts below; the
  existing workspace `playwright-report`/`test-results` directories predate
  these runs and were not touched.
- A locked `npm ci` reinstall was explicitly authorized after confirming that
  `frontend/node_modules` resolves inside `frontend`.  The first attempt was
  blocked by the host npm cache path; retrying with a system-temporary cache
  installed 106 packages, reported zero audit vulnerabilities, and left
  `package-lock.json` SHA-256 unchanged.  This is an installation side effect,
  not a claim that frontend quality gates passed.
- At the second-phase verification point, backend isolated pytest was `92 passed`
  (with 8 pre-existing deprecation warnings); root `scripts/tests` was
  `8 passed`; Alembic reported sole head `0007_recovered_worker_queue` and
  rendered `upgrade head --sql` offline.  A direct runtime import matched all
  68 frozen paths and all 82 frozen operations, with 90 runtime paths, 109
  runtime operations, BearerAuth, and paper schemas present.  `npm.cmd run
  api:check` passed only in its frozen-artifact sense.
- Remaining current frontend blockers are not repaired here: two retained
  `.mjs` tests use TypeScript-only `import type` syntax, causing `npm test`
  to finish 68 passed / 2 failed and `npm run lint` to fail on the same two
  files; `npm run build` fails because the retained `frontend/index.html` is
  absent.  Those three files and package scripts are outside this phase's
  authorized write set.

## Third-phase verification facts

- `frontend/index.html` is a minimal reconstructed Vite entry (Chinese locale,
  existing favicon, root mount, and `/src/main.tsx` only).  After it was added,
  `npm.cmd run api:check`, `npm.cmd run lint`, and `npm.cmd run build` all
  exited successfully.  Lint retained warnings for unused variables, and build
  emitted the existing large-chunk advisory; neither is represented as a clean
  release approval.
- `npm.cmd test` executed 101 tests: 97 passed and 4 failed.  The earlier
  type-only-import parse errors were removed under this bounded repair.  Three
  B5 failures are existing fixture/assertion-versus-facade mismatches, and the
  B6 module still fails because a top-level `@/api` import is resolved by the
  Node test runner before Vite's alias loader.  Changing those fixtures,
  assertions, test architecture, or application code was outside this phase.
- The reconstructed research-flow E2E exercised the real wizard through the
  submit button.  It did not use a direct route jump.  Contrary to the retained
  fixture premise, the submission navigated to newly created
  `exp-momentum-0043/runs/R-0050` instead of showing the expected duplicate
  dialog for `exp-momentum-0042/runs/R-0041`; the test was intentionally left
  failing rather than bypassing that evidence.
- The reconstructed accessibility E2E ran against the system Edge with its
  serious/critical threshold intact.  It found a serious `color-contrast`
  violation on the home-page `Mock API · 无真实交易` Ant Design tag (3.09:1
  versus 4.5:1).  The relevant application style is outside this phase's
  allowed files, so the test was not weakened or suppressed.
- G2's bounded health validator now accepts exactly
  `live={status: ok}` and `ready={status: ready, database: reachable}`; its
  pure positive and three negative tests are included in the script suite.
  `PYTHONPATH=backend python -B -m pytest -q -p no:cacheprovider scripts/tests`
  passed 12 tests, and the isolated backend suite passed 92 tests with 8
  existing warnings.
- The post-fix, actual token-scoped G2 closeout passed health but failed at the
  next unapproved mismatch: the diagnostic task remained `queued` with
  `attempt_count=0` after the worker container started.  No extra behavior was
  patched.  Its `finally` cleanup reported `all_clean=true`; an independent
  exact-name inspection confirmed that all seven containers, its network,
  image, and system-temporary root were absent.  No existing Docker resource,
  development database, or real trading service was touched.

## Fourth-phase verification facts

- The B5/B6 test repairs, the research-flow selectors, the local environment
  tag contrast colour, and the `python -m quant_trading.worker` entry point are
  bounded reconstructed maintenance changes.  They are not claims to recover
  historical source.  The worker entry-point test invokes only a monkeypatched
  `main` guard and never starts a worker loop.
- `npm.cmd test` now completed `138 passed, 0 failed`; `npm.cmd run api:check`,
  `npm.cmd run lint`, and `npm.cmd run build` also exited successfully.  Lint
  still reports unused-variable warnings in retained test files, and build
  retains its large-chunk advisory.  The lockfile SHA-256 remained
  `AD825376CC8498C30DDE83163485B175F7322C15A862D086374C976ACFE696A4`.
  `api:check` remains a frozen-artifact compatibility check, not a runtime
  OpenAPI equivalence proof.
- A clean system-Edge research-flow run did reach the exact retained duplicate
  branch: `ds-ashare-v3`, `st-momentum-v2`, the submit action, duplicate dialog,
  and `exp-momentum-0042/runs/R-0041`.  It then consistently failed at the
  final approval assertion because `ConfirmModal` did not display its expected
  `操作已完成` success view after `批准并留痕`; no production modal or mock
  behavior was changed or bypassed.
- The system-Edge accessibility run retained its serious/critical gate and
  failed on `/datasets`: the header breadcrumb `a[href="/"]` rendered
  `#8c8c8c` on white (3.36:1).  The locally approved environment tag colour was
  changed to `#237804`, but the breadcrumb style is outside this phase's
  authorized production-file scope, so the violation was neither suppressed
  nor repaired.
- Isolated backend verification completed `94 passed` with 8 existing
  deprecation warnings; isolated `scripts/tests` completed `12 passed`.  G2
  was deliberately not run in this phase because the required preceding E2E
  gates did not both pass.  No Docker resource, development database, live
  broker, or real-money trading path was touched.

## Fifth-phase verification facts

- The mock report-detail facade now preserves the retained status of its detail
  fixture using the same mapping as its list facade: `pending_approval` becomes
  `submitted`, `archived` becomes `deprecated`, and `approved`/`draft` remain
  unchanged.  This is a bounded reconstruction repair; it does not alter the
  retained RP-0101 or RP-0098 mock fixture data.  A Vite-SSR-isolated test
  verifies RP-0101's approved history, RP-0098's approval lifecycle, and both
  `RPT-409` repeat-approval boundaries without adding a reset API.
- Frontend verification completed `139 passed, 0 failed`; frozen-artifact
  `api:check`, lint, and build also exited successfully.  Lint retains the
  existing unused-variable warnings and build retains its large-chunk advisory.
  The lockfile SHA-256 remained
  `AD825376CC8498C30DDE83163485B175F7322C15A862D086374C976ACFE696A4`.
- The system-Edge research flow passed end-to-end through the exact R-0041
  duplicate branch, RP-0101 Markdown export, and the auditor's actual approval
  of pending RP-0098 with the `操作已完成` success view.  The system-Edge axe
  scan passed its unchanged serious/critical gate across `/`, `/datasets`,
  `/experiments`, and `/experiments/new`.
- After those gates passed, an isolated G2 preflight confirmed a newly generated
  token's seven containers, network, image, and temporary root were absent.
  The actual `--pull=false` closeout run used a different token and failed
  fail-closed with `KeyError: 'migration'`; no script or runtime code outside
  this phase's approved files was changed to mask it.  Its `finally` cleanup
  reported all resources removed, and a separate exact-name inspection verified
  all seven containers, the network, image, and temporary root were absent.
  Consequently G2 is not recorded as passing.  No development database, live
  broker, or real-money trading path was used.

## Sixth-phase verification facts

- The bounded G2 repair now obtains the source migration only from the real
  `/api/v1/health/system` response after the existing live/ready checks.  It
  fail-closes unless `status` is `ok`, `database` is `reachable`, and
  `migration.current` and `migration.head` are equal, non-empty strings.  The
  verified source `current` is the sole expected restored `alembic_version`;
  the obsolete `ready["migration"]` access is absent.  This is a maintenance
  repair to reconstructed closeout tooling, not a claim to recover lost source.
- The isolated script suite completed `31 passed`; the isolated backend suite
  completed `94 passed` with 8 existing warnings; no-write compile/import
  checks passed.  Frontend verification remained `139 passed, 0 failed`, with
  frozen-artifact `api:check`, lint, and build succeeding.  Lint retained its
  existing unused-variable warnings and build retained its large-chunk advisory.
  The lockfile SHA-256 remained
  `AD825376CC8498C30DDE83163485B175F7322C15A862D086374C976ACFE696A4`.
  No frontend source changed, so the already-passing system-Edge Research and
  four-route serious/critical accessibility evidence was not rerun.
- A newly generated token was precisely preflighted before the actual
  `--pull=false` G2 execution.  The live/ready/system migration stage no
  longer raised the former `KeyError`; the closeout instead fail-closed later
  at `restored utf8_seed_count=0, expected 1`.  That later PostgreSQL-restore
  mismatch is outside this phase's approved repair boundary and was not
  patched.  The run did not reach a successful restored migration/task/artifact
  completion record.  Its `finally` cleanup reported all seven token-scoped
  containers, network, image, and system temporary root removed; an independent
  exact-name inspection confirmed every one was absent.  No existing Docker
  resource, development database, `.env` value, live broker, or real-money
  trading path was touched.

## Seventh-phase verification facts

- The static seed-name assumption was removed from the reconstructed G2 probe.
  After development-session authentication, the token-isolated source database
  now receives one API-created dataset named `G2 UTF-8 恢复探针 {token}` with
  slug `g2-utf8-probe-{token}` and a token-scoped idempotency key.  It creates
  no dataset version and does not request market data.  The API response ID is
  validated and canonicalized as a UUID before its only SQL use; source and
  restored snapshots both require that same UUID, exact UTF-8 name, and count
  one.  This is bounded reconstructed closeout maintenance, not evidence of
  any missing original seed dataset.
- The source/restore snapshot oracle also requires the verified system-health
  migration, successful diagnostic task and payload, one artifact, and its
  exact SHA-256.  The isolated script suite completed `52 passed`; the backend
  suite completed `94 passed` with 8 existing warnings; no-write compile/import
  checks passed.  Frontend verification remained `139 passed, 0 failed`, with
  frozen-artifact `api:check`, lint, and build succeeding.  The lockfile
  SHA-256 remained `AD825376CC8498C30DDE83163485B175F7322C15A862D086374C976ACFE696A4`.
  No frontend source changed, so the already-passing system-Edge Research and
  four-route serious/critical accessibility evidence was not rerun.
- A preflight token `6aa6f9bf969f` had all seven containers, network, image,
  and temporary root absent.  The actual `--pull=false` G2 execution used the
  separate token `1f3bf0b2e043` and passed.  Its loopback live/ready/system
  responses reported source migration current=head=`0007_recovered_worker_queue`.
  The Worker completed diagnostic task `80b012ed-ae3d-4256-8c27-6f1959d11727`
  on attempt 1, preserving the UTF-8 payload in artifact
  `6a74927c-e609-5d1a-a70a-04d5ebf17684` with SHA-256
  `cbabd5a5fb29d333d25bca5cae39fa1eee05674134f2e33e87b8c308dacc4725`.
  The source and restored snapshots both reported probe
  `4d9b1def-491e-429c-9d3a-4bb96fe9827c`, count 1, and the exact token-scoped
  UTF-8 name; migration, task payload/status, artifact count/hash, and a
  non-empty 75,985-byte dump all matched.  The copied artifact's SHA-256 also
  matched after restore.
- The script `finally` cleanup reported removal of all seven actual-token
  containers, network, image, and system temporary root.  A separate
  exact-name inspection confirmed each was absent.  No existing Docker
  resource, development database, `.env` value, live broker, or real-money
  trading path was touched.
