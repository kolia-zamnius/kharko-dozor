# Dozor SDK packages

Open-source session recording and replay platform — and a learning project. See what your users actually do — clicks, scrolls, navigation — without video. Lightweight DOM mutation tracking powered by [rrweb](https://github.com/rrweb-io/rrweb). Free for everyone, forever.

Built under the **Kharko** brand, inspired by Kharkiv, Ukraine.

📚 **Documentation**: [kharko-dozor.vercel.app/documentation](https://kharko-dozor.vercel.app/documentation) — full SDK reference, dashboard guide, self-host recipe, architecture deep-dives.

## Packages

| Package                               | Description                                    | README                                         | Docs                                                             |
| ------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| [`@kharko/dozor`](dozor/)             | Framework-agnostic session recording SDK (npm) | [dozor/README.md](dozor/README.md)             | [SDK → @kharko/dozor](https://kharko-dozor.vercel.app/documentation/sdk/dozor) |
| [`@kharko/dozor-react`](dozor-react/) | React Context + hook for `@kharko/dozor` (npm) | [dozor-react/README.md](dozor-react/README.md) | [SDK → @kharko/dozor-react](https://kharko-dozor.vercel.app/documentation/sdk/dozor-react) |

## Dashboard

The web dashboard (Next.js app) lives in a separate repo: [kharko-dozor-dashboard](https://github.com/kolia-zamnius/kharko-dozor-dashboard). Use the [public demo](https://kharko-dozor.vercel.app) to evaluate, then self-host your own.

## Architecture

Modular event-driven SDK with clear separation of concerns:

```
dozor/src/
├── index.ts                  # Public exports
├── types.ts                  # Public types
└── recorder/                 # All implementation
    ├── index.ts              # Dozor — thin Facade/Mediator
    ├── transport.ts          # Network (retry, gzip, keepalive)
    ├── core/                 # Infrastructure
    │   ├── emitter.ts        # Typed event bus (Observer)
    │   └── state-machine.ts  # FSM with transition table (State)
    ├── pipeline/             # Event flow
    │   ├── event-buffer.ts   # Storage + drain (Pipeline)
    │   └── flush-scheduler.ts # Timer + batch flush (Strategy)
    ├── markers/              # rrweb custom-event markers
    │   └── url-tracker.ts    # SPA navigation → `dozor:url` marker + FullSnapshot
    └── browser/              # Browser API integration
        ├── visibility-manager.ts
        ├── session.ts
        └── metadata.ts
```

Modules communicate via typed Emitter — no direct dependencies between them. The Dozor facade wires everything together.

## Stack

TypeScript · rrweb · tsup · pnpm workspaces

## Quick start (local dev)

```bash
git clone https://github.com/kolia-zamnius/kharko-dozor-packages.git
cd kharko-dozor-packages
pnpm install
pnpm build
```

Requires **Node.js 20+** and **pnpm 10+**.

Per-package scripts and contribution conventions: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](LICENSE)
