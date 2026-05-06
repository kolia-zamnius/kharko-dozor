# @kharko/dozor

Lightweight session recording SDK for [Dozor](https://github.com/kolia-zamnius/kharko-dozor-dashboard) — an open-source session replay platform. Free for everyone, forever.

Captures DOM mutations via [rrweb](https://github.com/rrweb-io/rrweb), batches them, compresses with gzip, and ships to your Dozor ingest endpoint. Framework-agnostic — works in any browser app. For React, see [`@kharko/dozor-react`](https://www.npmjs.com/package/@kharko/dozor-react).

📚 **Full reference at [kharko-dozor.vercel.app/documentation/sdk/dozor](https://kharko-dozor.vercel.app/documentation/sdk/dozor)** — every option, lifecycle state, method, and edge case documented.

## Install

```bash
npm install @kharko/dozor
# or pnpm add @kharko/dozor
# or yarn add @kharko/dozor
```

## Quick start

```ts
import { Dozor } from "@kharko/dozor";

Dozor.init({
  apiKey: "dp_your_public_key",
  endpoint: "https://your-dashboard.com/api/ingest",
});
```

That's it. Recording starts immediately, events ship to your endpoint every 60 seconds (or sooner — buffer fill / tab background / page unload).

## Identify the user

```ts
const dozor = Dozor.init({ apiKey: "dp_...", endpoint: "..." });

// later, after sign-in:
dozor.identify("user_123", {
  email: "user@example.com",
  name: "John Doe",
  plan: "pro",
});
```

## Common options

| Option | Default | Purpose |
| --- | :-: | --- |
| `apiKey` | — | **Required.** Project public key (`dp_...`) |
| `endpoint` | — | **Required.** Ingest URL or same-origin tunnel path |
| `flushInterval` | `60000` | ms between automatic flushes |
| `batchSize` | `2000` | Max events buffered before forced flush |
| `autoStart` | `true` | Start recording on `init()` |
| `pauseOnHidden` | `true` | Auto-pause on tab visibility change |
| `privacyMaskInputs` | `true` | Mask input/textarea/select values |
| `privacyBlockMedia` | `false` | Replace media (img/video/audio) with placeholders |
| `recordConsole` | `true` | Capture `console.*` calls |
| `debug` | `false` | `[dozor]`-prefixed verbose console output |

The full options reference (privacy attributes, hold/release semantics, fetch timeout, etc.) lives at [Documentation → SDK → Init & options](https://kharko-dozor.vercel.app/documentation/sdk/dozor/init).

## Privacy

By default, `<input>` / `<textarea>` / `<select>` values are masked with `*`. Mask additional content by adding `data-dozor-mask` (text → asterisks) or `data-dozor-block` (element replaced with same-size placeholder) attributes:

```html
<div data-dozor-mask>John Doe</div>     <!-- recorded as "********" -->
<img data-dozor-block src="..." />       <!-- replaced with placeholder -->
```

Full privacy guide: [Documentation → SDK → Privacy & masking](https://kharko-dozor.vercel.app/documentation/sdk/privacy).

## Lifecycle methods

```ts
dozor.start();   // start recording (when autoStart: false)
dozor.pause();   // pause without ending the session
dozor.resume();  // resume after pause()
dozor.stop();    // end + flush + destroy
dozor.cancel();  // discard buffer + delete session server-side
dozor.hold();    // keep recording, stop transport
dozor.release(); // flush held events, resume transport
```

State machine diagram + full method reference: [Documentation → SDK → Lifecycle](https://kharko-dozor.vercel.app/documentation/sdk/dozor/lifecycle) and [Methods](https://kharko-dozor.vercel.app/documentation/sdk/dozor/methods).

## Tunnel (ad-blocker bypass)

Browser ad-blockers can block requests to known analytics domains. Route SDK traffic through your own server:

```ts
Dozor.init({
  apiKey: "dp_your_key",
  endpoint: "/api/monitor", // same-origin path on your server
});
```

Recipes for Next.js / Express / `rewrites`: [Documentation → SDK → Tunnel pattern](https://kharko-dozor.vercel.app/documentation/sdk/tunnel).

## TypeScript

```ts
import { DOZOR_MARKER_TAG } from "@kharko/dozor";
import type {
  DozorMarkerTag,
  DozorOptions,
  DozorState,
  DozorUrlMarker,
  IngestPayload,
  Logger,
  SessionMetadata,
  UserIdentity,
  UserTraits,
} from "@kharko/dozor";
```

`DOZOR_MARKER_TAG` is the const map of in-stream marker tags (`url` / `identity`) emitted as rrweb custom events (type=5). Use it to detect markers in the event stream without relying on string literals.

Full type reference: [Documentation → SDK → Edge cases](https://kharko-dozor.vercel.app/documentation/sdk/edge-cases#typescript-types).

## Browser support

Chrome 89+, Edge 89+, Firefox 113+, Safari 16.4+. Requires `MutationObserver`, `crypto.randomUUID()`, `fetch` with `keepalive`. `CompressionStream` is optional (graceful fallback to uncompressed JSON).

## Self-hosting

Point the SDK at your own dashboard:

```ts
Dozor.init({ apiKey: "dp_...", endpoint: "https://your-dashboard.com/api/ingest" });
```

Full deployment recipe (Vercel + Neon + Gmail SMTP, ~20 minutes): [Documentation → Self-host](https://kharko-dozor.vercel.app/documentation/self-host).

## License

MIT
