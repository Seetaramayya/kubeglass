# kubeglass

A fast, local Kubernetes dashboard in your browser, in the spirit of Lens. It reads the kubeconfig you already have, so every cluster you can reach with `kubectl` shows up automatically. You don't need to memorize kubectl commands, but each screen shows the equivalent one (with a copy button) so you can learn them as you go.

## Features

- **All your clusters** from `$KUBECONFIG` / `~/.kube/config`, in a Lens-style hotbar. EKS, GKE, AKS, kind, Docker Desktop and anything with an exec auth plugin work out of the box.
- **Cluster overview**: node, pod and workload counts, pod status breakdown, workloads that aren't fully ready, pods needing attention and recent warning events, for the whole cluster or one namespace.
- **Browse**: Nodes, Namespaces, Events, Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, ConfigMaps, Secrets, HPA, Services, Ingresses, PVCs, PVs and StorageClasses. Lists are sortable and searchable (press `/`) and refresh every 5 seconds.
- **Resource usage** (the `kubectl top` equivalent, needs [metrics-server](#resource-usage)):
  - CPU and memory columns on Pods, Nodes, Deployments, StatefulSets and DaemonSets, shown against limits, requests or allocatable.
  - Cluster CPU and memory on the overview, with the top pods by CPU and by memory.
  - A Resource Usage page that totals usage, requests, limits and share of the cluster per namespace or per workload.
  - Trend sparklines covering the last 15 minutes for the cluster, nodes, namespaces and pods.
- **Details drawer**: overview, YAML, events, related pods, resource usage, secret reveal/copy, plus a kubectl cheat sheet for the selected object.
- **Command palette** (`⌘K` / `Ctrl+K`): jump to any view, resource, namespace or cluster.
- **Logs**: live follow, filter with highlighting, previous container, timestamps, tail size and download.
- **Shell**: an interactive terminal into any container (xterm.js).
- **Port forwarding** from a pod or service port to localhost with one click, with a list of active forwards.
- **Safe writes**: delete, scale and rollout restart, each behind a confirmation dialog. On production contexts (name contains `prod`) you must type the resource name to confirm, and opening a shell asks first.
- **Light and dark themes**: follows your OS by default, with a toggle in the sidebar.

## Install and run

Requires Node.js 20+ and whatever auth tools your kubeconfig uses (for example the `aws` CLI for EKS).

```sh
npx kubeglass            # once published to npm
# or from source:
npm install
npm start
```

kubeglass starts on port 7878, or the next free port if that one is busy, and opens your browser automatically.

```
kubeglass --port 9000    # preferred port
kubeglass --no-open      # don't open a browser
kubeglass --dev          # development mode with hot reload
```

## Resource usage

CPU and memory numbers come from the Kubernetes metrics API, the same source as `kubectl top`. That API is served by [metrics-server](https://github.com/kubernetes-sigs/metrics-server), which many clusters (including EKS) don't install by default. Without it, kubeglass says so and everything else keeps working.

To install it:

```sh
# EKS, managed by AWS
aws eks create-addon --cluster-name <name> --addon-name metrics-server

# any cluster
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

kubeglass samples metrics every 15 seconds and keeps 15 minutes of history in memory for the trend lines. Sampling starts when you open a cluster and stops after 5 minutes without anyone viewing it. History resets when kubeglass restarts.

## Security

- The server only listens on `127.0.0.1` and rejects requests whose `Host` isn't localhost (DNS-rebinding protection).
- Each start generates a random session token. Only the login link opened or printed at startup sets the session cookie (HttpOnly, SameSite=Strict), so other websites in your browser can't call the API.
- Cross-origin writes and WebSocket connections are rejected.
- Your kubeconfig and credentials never leave your machine. kubeglass talks directly to your API servers using the official `@kubernetes/client-node`.

## Development

```sh
npm install
npm run dev:server   # backend + Vite with hot reload, on one port
npm run build        # production build into dist/
```

Layout:

| Path | What |
| --- | --- |
| `bin/kubeglass.js` | CLI entry: args, start server, open browser |
| `server/index.js` | Express API, auth, WebSocket routing |
| `server/kube.js` | kubeconfig contexts and generic resource CRUD |
| `server/streams.js` | logs, exec and port-forward |
| `server/metrics.js` | metrics sampler and usage history |
| `shared/kinds.js` | resource kinds known to both server and UI |
| `shared/quantity.js` | Kubernetes CPU and memory quantity parsing |
| `src/` | React UI |

## Roadmap

- Desktop app (Electron) for macOS, Linux and Windows
- Homebrew tap (`brew install <tap>/kubeglass`)
- Custom resources (CRDs)
- YAML edit and apply

## License

Apache-2.0. Copyright 2026 Seeta Ramayya Vadali.
