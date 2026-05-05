# @kharko/dozor-react

React bindings for [`@kharko/dozor`](https://www.npmjs.com/package/@kharko/dozor) — the session recording SDK for [Dozor](https://github.com/kolia-zamnius/kharko-dozor-dashboard). Free for everyone, forever.

Provides `<DozorProvider>` and `useDozor()` to control the recorder from any React component with reactive state. Compatible with React 18+ and React Server Components (RSC).

📚 **Full reference at [kharko-dozor.vercel.app/documentation/sdk/dozor-react](https://kharko-dozor.vercel.app/documentation/sdk/dozor-react)** — Provider props, hook return shape, every method, edge cases.

## Install

```bash
npm install @kharko/dozor @kharko/dozor-react
# or
pnpm add @kharko/dozor @kharko/dozor-react
# or
yarn add @kharko/dozor @kharko/dozor-react
```

Both packages are required — `@kharko/dozor` is the core SDK, `@kharko/dozor-react` provides the React integration.

## Quick start

Wrap your app (or a subtree) with `<DozorProvider>` and pass options:

```tsx
import { DozorProvider } from "@kharko/dozor-react";

function App() {
  return (
    <DozorProvider
      options={{
        apiKey: "dp_your_public_key",
        endpoint: "https://your-dashboard.com/api/ingest",
      }}
    >
      <YourApp />
    </DozorProvider>
  );
}
```

Recording starts automatically on mount.

## Reading state from any component

```tsx
import { useDozor } from "@kharko/dozor-react";

function StatusIndicator() {
  const dozor = useDozor();

  if (!dozor.isRecording) return null;
  return <div>Recording — {dozor.bufferSize} events buffered</div>;
}
```

`useDozor()` re-renders the consuming component on state changes (`state`, `sessionId`, `isHeld`, `userId`, `bufferSize`). Throws if called outside a `<DozorProvider>`.

## Identify users

```tsx
function LoginForm() {
  const dozor = useDozor();

  async function handleLogin(creds) {
    const user = await login(creds);
    dozor.identify(user.id, { email: user.email, plan: user.plan });
  }
  // ...
}
```

## Conditional recording

Record a session, only ship it if the user does something valuable:

```tsx
<DozorProvider options={{ apiKey: "dp_...", endpoint: "...", hold: true }}>
  <CheckoutFlow />
</DozorProvider>;

function CheckoutFlow() {
  const dozor = useDozor();
  return (
    <>
      <button
        onClick={() => {
          submit();
          dozor.release();
        }}
      >
        Buy
      </button>
      <button onClick={() => dozor.cancel()}>Leave</button>
    </>
  );
}
```

More patterns: [Documentation → SDK → Recipes](https://kharko-dozor.vercel.app/documentation/sdk/recipes).

## Hook return shape

```ts
const dozor = useDozor();

// Reactive state
dozor.state; // "not_initialized" | "idle" | "recording" | "paused" | "stopped"
dozor.sessionId; // string | null
dozor.isRecording; // boolean
dozor.isPaused; // boolean
dozor.isHeld; // boolean
dozor.userId; // string | null
dozor.bufferSize; // number

// Methods (same as core SDK)
dozor.init / start / pause / resume / stop / cancel / hold / release / identify;
```

Full hook reference: [Documentation → SDK → useDozor()](https://kharko-dozor.vercel.app/documentation/sdk/dozor-react/use-dozor).

## TypeScript

```ts
import type { DozorContextValue, DozorContextState, DozorSnapshot, DozorActions } from "@kharko/dozor-react";
import type { DozorOptions, DozorState } from "@kharko/dozor";
```

## Peer dependencies

- `@kharko/dozor` — any version
- `react` — `>=18`

## License

MIT
