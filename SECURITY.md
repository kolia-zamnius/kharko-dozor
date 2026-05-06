# Security policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security problems. Instead:

- Use **[GitHub's private security advisory](https://github.com/kolia-zamnius/kharko-dozor-packages/security/advisories/new)** (preferred), or
- Email **kolia@chattyinsights.com** with the subject line `SECURITY — kharko-dozor-packages`.

A useful report typically includes:

- A concise description of the issue and the potential impact.
- Steps to reproduce (or a minimal proof-of-concept).
- Which package + version (e.g. `@kharko/dozor@1.1.0`) and which browser you tested against.
- Your suggested remediation, if any.

You will get an initial acknowledgement within **72 hours** and a substantive reply within **7 days**. The issue will be tracked privately until a fix ships, at which point the reporter is credited in the release notes unless they prefer to stay anonymous.

## Scope

**In scope:**

- The `@kharko/dozor` core SDK — recording engine, transport (`fetch`, gzip via `CompressionStream`, keepalive on unload, retry with backoff), session storage, custom-event markers (`dozor:url` / `dozor:identity`), privacy masking (`data-dozor-mask`, `data-dozor-block`, input/media masking).
- The `@kharko/dozor-react` bindings — `DozorProvider`, `useDozor` hook, `useSyncExternalStore` integration, SSR snapshot handling.
- How the SDK derives URLs (ingest, session cancel) from the configured `endpoint`.
- The `X-Dozor-Public-Key` header handling.
- The keepalive size-trim path (60 KB browser cap).

**Out of scope:**

- The dashboard ingest endpoint and replay UI — report at [`kolia-zamnius/kharko-dozor-dashboard`](https://github.com/kolia-zamnius/kharko-dozor-dashboard/security/advisories/new).
- `rrweb` itself — report at [`rrweb-io/rrweb`](https://github.com/rrweb-io/rrweb/security/advisories/new). The SDK is a thin wrapper; vulnerabilities in DOM serialization, replay, plugin internals belong upstream.
- XSS in a consuming application that lets attackers control DOM the SDK then captures — report to the consuming app.
- A malicious server controlling the configured `endpoint` URL — that is a trust decision the integrator makes when calling `Dozor.init({ endpoint })`.
- Issues that require an already-compromised browser or extension running with elevated privileges.

## Security-relevant defaults

Worth knowing when assessing a report:

- **`endpoint` is required** in `DozorOptions` from v1.1.0 onward — there is no hardcoded fallback. The destination of every batch is fully under integrator control.
- **`apiKey` is a project identifier**, not a user authenticator. It is sent in plaintext via the `X-Dozor-Public-Key` header on every batch — treat it like a Google Analytics tracking ID. Server-side authentication / authorization is the dashboard's responsibility.
- **Privacy defaults**: `privacyMaskInputs: true`, `privacyMaskAttribute: "data-dozor-mask"`, `privacyBlockAttribute: "data-dozor-block"`. Media (`img`, `video`, `audio`, `picture`, `canvas`, `embed`, `object`) is **not** blocked by default — opt-in via `privacyBlockMedia: true`.
- **Session ID** stored in `sessionStorage` (per-tab, cleared on tab close). Falls back to in-memory if `sessionStorage` is unavailable; not persisted across reloads in that case.
- **Console recording is on by default** (`recordConsole: true`) — captures `console.log/warn/error/info/debug`. If the consuming app logs sensitive data, the integrator should opt out via `recordConsole: false`.
- **Transport** uses gzip via the browser-native `CompressionStream` when available; falls back to uncompressed JSON. No custom crypto.
- **Retry policy**: 3 attempts with exponential backoff (1 s, 2 s, 4 s) on network errors and 5xx. 4xx is not retried. Failed batches re-queue to the buffer, capped at 10 000 events — oldest dropped during extended outages.
- **Keepalive flushes** on `beforeunload` are size-capped at 60 KB (browser limit) — oldest events are trimmed if a payload is over the cap.

## Things that would count as a bug

Non-exhaustive — reach out even if you're unsure:

- A way to make the SDK send data to a different endpoint than the one configured in `init()`.
- Bypass of `privacyMaskInputs` / `privacyMaskAttribute` / `privacyBlockAttribute` such that masked content reaches the network.
- The recorder capturing `password`-type inputs even when masking is on.
- The session ID or `apiKey` being readable from another tab/origin via something other than expected `sessionStorage` semantics.
- The retry / re-queue path leaking events from one session into another.
- The keepalive-trim logic causing payloads to exceed the 60 KB browser cap and silently drop.
- The cancel-URL derivation in `Transport.deleteSession` (`endpoint.replace("/ingest", "/sessions/cancel")`) being abusable for SSRF or path traversal against the configured `endpoint`.
- Any path that sends rrweb data without the `X-Dozor-Public-Key` header.
- A ReDoS or unbounded-allocation vector in the recorder's hot path.
