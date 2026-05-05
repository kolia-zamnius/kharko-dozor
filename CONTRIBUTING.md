# Contributing

Dozor SDK packages are open source and welcoming to contributions. PRs are reviewed on a best-effort basis.

📚 **API reference + integration patterns**: [kharko-dozor.vercel.app/documentation/sdk](https://kharko-dozor.vercel.app/documentation/sdk) — every option, lifecycle method, edge case. The MDX source lives in the [dashboard repo](https://github.com/kolia-zamnius/kharko-dozor-dashboard); doc-only PRs go there.

## Quick start

```bash
git clone https://github.com/kolia-zamnius/kharko-dozor-packages.git
cd kharko-dozor-packages
pnpm install
pnpm build
```

Requires **Node.js 20+** and **pnpm 10+**.

## Scripts

`package.json` carries CI entries plus per-package shorthand for sub-scope (`build:dozor`, `dev:react`, etc.). One-off ad-hoc runs (coverage, single-test reruns) go through `pnpm -F` / `pnpm exec` directly.

| Command                            | What it does                                              |
| ---------------------------------- | --------------------------------------------------------- |
| `pnpm build`                       | Build all packages (tsup, with type-check)                |
| `pnpm build:dozor`                 | Build `@kharko/dozor` only                                |
| `pnpm build:react`                 | Build `@kharko/dozor-react` only                          |
| `pnpm dev:dozor`                   | Watch mode for `@kharko/dozor`                            |
| `pnpm dev:react`                   | Watch mode for `@kharko/dozor-react`                      |
| `pnpm -F @kharko/<pkg> test`       | Run one package's tests (Vitest, jsdom) — what CI invokes |

Ad-hoc runs:

```bash
pnpm -F @kharko/dozor exec vitest                              # watch-mode tests
pnpm -F @kharko/dozor exec vitest run --coverage               # coverage report
pnpm -F @kharko/dozor exec vitest run src/recorder/transport   # single file
```

Type-check happens via tsup during `pnpm build`. There is no separate lint step. Tests run under jsdom; for behaviour that needs a real browser (CompressionStream, fetch keepalive, real rrweb mutations), smoke-test in a Vite or Next.js app via `pnpm link`.

## Workspace layout

Two packages live as siblings under the repo root:

- `dozor/` — `@kharko/dozor`, the framework-agnostic core SDK (rrweb wrapper, transport, slicing, privacy masking).
- `dozor-react/` — `@kharko/dozor-react`, React Context Provider + `useDozor` hook on top of the core.

`dozor-react` declares `@kharko/dozor` as both `peerDependency` (for npm consumers) and via `workspace:*` in `devDependencies` (for local development).

## Before you open a PR

```bash
pnpm build
pnpm -F @kharko/dozor test
pnpm -F @kharko/dozor-react test
```

CI runs the same set on every PR — iterating after a red CI wastes everyone's time.

If your change touches recording, transport, or privacy masking, also smoke-test it in a small Vite or Next.js app via `pnpm link` against a local checkout. jsdom approximates the browser well, but the real DOM is the final ground truth.

## Branch and PR conventions

- **Direct push to `main` is blocked** by repository ruleset — work on a feature branch.
- **Branch name** is the only post-merge identifier (squash deletes the branch). Pick something short and descriptive: `endpoint-required`, `fix-keepalive-timeout`, `react-store-fix`.
- **PR title must start with `[<branch-name>]`** — verbatim, including brackets. The repo squashes with `squash_merge_commit_title=PR_TITLE`, so the prefix is what survives in `git log`.
- **Squash merge only** — both repo setting and ruleset enforce.
- **Branch auto-deletes on merge.**
- **Required CI**: three checks must go green before merge — `ci` (root `pnpm build`), `test (dozor)`, and `test (dozor-react)` (matrix-driven Vitest runs per package). All defined in `.github/workflows/ci.yml`.

PR title body in conventional-commits style after the prefix:

```
[fix-keepalive-timeout] fix(dozor): cap keepalive payload at 60KB before send
[react-store-fix] fix(react): re-subscribe after deferred init()
[docs-tunnel-vercel] docs(dozor): clarify tunnel setup for Vercel rewrites
```

Scope tags: `dozor`, `react`, `ci`, `docs`, `deps`, `release`, `chore`.

## PR description

Three blocks:

```
## Context
What this is and why. One paragraph or 2–3 bullets.

## Implementation notes
How it was done — libraries, approach, key decisions. Not a diff narration.

## Notes (optional)
Operational reminders outside the diff — what to do before/after merge.
Examples: "Bump peerDependency in dozor-react", "Run npm publish after merge".
Skip if nothing operational is needed — its absence is itself a signal.
```

## Code conventions

- **Strict TypeScript.** No `any`, no `as unknown as`, no `@ts-ignore`. Reach for a discriminated union or a type guard instead.
- **Logger interface, not `console.*`.** Every subsystem accepts a `Logger` in its constructor; pass it through to children. `debug: false` (default) returns a no-op logger — zero production overhead.
- **Disposable for handles.** Anything that allocates timers, listeners, or observers owns a `dispose()` that fully cleans up.
- **Discriminated unions over boolean flags.** Lifecycle state, slice reasons, transport modes — let TypeScript exhaustiveness-check.
- **Public API only via `src/index.ts`.** No deep imports — consumers import from the package root.
- **Versions move in lockstep.** Both packages bump together. A change in core that consumers will see triggers a bump in both, even if the React surface didn't change.
- **No copy/paste between packages.** If two files start to diverge from a shared idea, extract a helper or move it into core and re-export.
- **Stable public surface.** Removing or tightening a published option is a deliberate change — note it in the PR description so the dashboard / downstream consumers can adapt.

## Scope of contributions

Welcomed:

- Bug fixes.
- Improvements to existing patterns (spotted an inconsistency? flag it).
- Performance work in the recorder / transport hot path.
- Privacy masking robustness.
- Documentation — README clarifications, JSDoc, comments where intent isn't obvious. SDK-reference doc edits live in the [dashboard repo](https://github.com/kolia-zamnius/kharko-dozor-dashboard) under `src/app/(docs)/documentation/_content/sdk/`.

Open an **issue first** for:

- New SDK options or new methods on `Dozor`.
- New framework bindings (e.g. `@kharko/dozor-vue`, `@kharko/dozor-svelte`).
- Dependency additions.
- Refactors that touch more than ~20 files.
- Anything that changes the published API surface.

Out of scope (at least for now):

- Test infrastructure (Vitest setup) — being scoped separately.
- Replacing rrweb.
- New transport modes beyond `fetch` + keepalive.
- Built-in session storage backends beyond `sessionStorage` (IndexedDB, etc.).

## Security issues

**Do not open a public issue for security bugs.** See [`SECURITY.md`](./SECURITY.md) for the private-disclosure process.

## Code of conduct

Be kind. Disagree with ideas, not people. English or Ukrainian are both fine in issues and PRs.
