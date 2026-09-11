<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<h1 align="center">DSH Harbor</h1>

<p align="center">
  <strong>Evidence-first governance for the DeepSeek Harness plugins already installed on your machine.</strong><br />
  <sub>Capability Inventory &bull; Declared vs Detected &bull; Runtime Attribution &bull; Conflict Detection &bull; Version Drift &bull; Change Timeline &bull; Upgrade Preflight</sub>
</p>

<p align="center">
  <sub>npm: <code>@zseven-w/dsh-harbor</code> &middot; Current plugin release: <code>0.1.0-rc.3</code> &middot; Tested with DSH <code>0.1.5-rc.2</code></sub>
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md">한국어</a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

<p align="center">
  <a href="https://github.com/ZSeven-W/dsh-harbor/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ZSeven-W/dsh-harbor/ci.yml?label=CI" alt="CI" /></a>
  <a href="https://github.com/ZSeven-W/dsh-harbor/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ZSeven-W/dsh-harbor?color=64748b" alt="License" /></a>
</p>

<br />

<p align="center">
  <img src="./docs/images/dsh-harbor-overview.png" alt="DSH Harbor light-theme overview — runtime evidence, route attribution, versions, and scan changes" width="100%" />
</p>
<p align="center"><sub>The Harbor settings page in DSH light mode — live runtime registries, profile-scoped attribution, local version truth, and the change baseline.</sub></p>

## Why DSH Harbor

DSH plugins run in the host's Node realm with the same local permissions as DSH itself. Harbor does not pretend this can be solved with a score or a badge: it keeps a read-only, evidence-backed ledger of what is installed, what each plugin declares, what its code and live host actually expose, where plugins collide, and what changed since the previous scan.

<table>
<tr>
<td width="50%">

### 🔎 Capability Inventory

Harbor scans every installed third-party bundle across DSH profiles and reports a fixed 13-capability vocabulary. Source findings carry `file:line` evidence; manifest, filesystem, and runtime facts state their origin explicitly.

</td>
<td width="50%">

### 🤝 Declared vs Detected

Plugins may declare `dsh.capabilities` in `package.json`. Harbor reconciles the declaration against detection, exposes missing and unknown ids, and fails closed on malformed declarations instead of letting one bad package break the whole report.

</td>
</tr>
<tr>
<td width="50%">

### 🟢 Runtime Attribution

Inside a live DSH host, Harbor enumerates tools, providers, and routes, then attributes them only to plugins installed in the active profile. Missing host registries remain visible as coverage gaps rather than empty proof.

</td>
<td width="50%">

### ⚠️ Conflict Detection

The ledger finds same-profile tool names, route prefixes, provider ids, client-module ids, and order-sensitive message hooks. A quoted route used by a client does not make that client the route owner.

</td>
</tr>
<tr>
<td width="50%">

### 🧭 Two Version Axes

Cross-profile drift is local and always offline. The optional upstream check is separate, explicit, registry-aware, credential-redacted, and cached for six hours. `link:` and `file:` installs never masquerade as current registry versions.

</td>
<td width="50%">

### 🕰️ Change Timeline

Snapshots track additions, removals, version transitions, profile moves, capability changes, and claim changes. Even two artifacts exchanging profiles are reported as concrete per-profile transitions.

</td>
</tr>
<tr>
<td width="50%">

### 🛫 Upgrade Preflight

Before you move DSH to a new version, Harbor installs that exact version into its own cache, then import-probes every installed plugin against it in a child process, checks `dsh.client.inject` ids against the target's client module graph, and checks host peer ranges. The answer is per profile: boots after the upgrade, or blocked — by which plugin, with the real link-time error.

</td>
<td width="50%">

### 🧷 One Settings Check

The only user-settings check with a known upgrade casualty: when a built-in agent preset is renamed (`code` → `ptc` in DSH 0.1.2) the stored `agent-presets.default` is not migrated and every new session fails. Preflight reports the stale value against the target's preset list.

</td>
</tr>
</table>

## How it works

```text
~/.dsh/profiles/*
  ├─ installed package + provenance
  │    registry artifact | link: working tree | file: snapshot
  ├─ declared
  │    package.json + cordis.patch.yml
  ├─ static
  │    bounded source scan + file:line evidence
  ├─ runtime (when loaded inside DSH)
  │    tools + providers + routes + profile-scoped attribution
  ├─ versions
  │    local cross-profile drift + opt-in registry check
  └─ snapshot
       additions + removals + version/profile/capability/claim changes
```

The CLI and the settings page consume the same scan core. The default path is offline. Only `harbor scan --check-updates`, `harbor preflight`, or the panel's **Check for updates** / **Upgrade preflight** actions contact a registry.

### Upgrade preflight

```sh
harbor preflight --list                 # dist-tags, recent versions, locally cached host trees
harbor preflight --dsh next             # or a concrete version: --dsh 0.1.5-rc.2
harbor preflight --dsh 0.1.5-rc.2 --json
```

What runs, in order:

1. The target is resolved (a dist-tag needs one registry request) and `@deepseek-ai/dsh@<version>` is installed into `<state dir>/hosts/<version>` with `npm install -g --prefix`. A completed install is reused; the global npm prefix and your profiles are never written.
2. Every installed third-party plugin's server entry is imported in a fresh `node` child. A `module.register` resolve hook rewrites `@deepseek-ai/*` imports to the target tree, so the plugin links against the version under evaluation while its own dependencies keep resolving from its real install. Missing packages and removed exports fail at link time and are reported verbatim — the DSH loader is fail-loud, so one such plugin blocks the whole profile.
3. `dsh.client.inject` / `external` ids are checked against the packages in the target that declare a web client module (DSH ≥ 0.1.5 skips unknown ids silently, so this never errors on its own). Host peer ranges are matched with npm's prerelease rule.
4. `agent-presets.default` from `settings.yaml` is checked against the target's built-in presets.

Verdicts are per plugin (**blocks boot** / **loads** / **unresolvable** / **not probed**) and per profile; peer-range and dead-inject findings are advisories and never change a verdict. *Unresolvable* means the plugin's own dependency could not be found — a packaging problem, not a host problem. Exit code 3 means at least one profile would not boot. Node ≥ 20.6 is required for the resolve hook.

Outside a profile — in CI, or for a package you have not installed — name the subjects explicitly:

```sh
harbor preflight --dsh next --plugin .                        # this repository (build it first)
harbor preflight --dsh next --pack @scope/some-plugin@1.2.3   # fetched from the registry, deps installed with scripts disabled
```

### Contract diff between two DSH versions

```sh
harbor host-diff --from 0.1.1-rc.2 --to 0.1.5-rc.1
```

Installs both versions into the cache and reports what a plugin could have depended on that moved: packages added/removed, web client modules added/removed, built-in presets, and — by importing each official package's entry in a child — every export name added or removed per package. This is the machine-readable changelog the release notes do not carry; the `settingsNamespace` removal that broke plugins on 0.1.5 shows up here as an export removal in `@deepseek-ai/dsh-settings`. Exit code 3 when anything was removed.

### GitHub Action

Plugin authors can run the same preflight on every pull request and every night against the `next` dist-tag:

```yaml
- uses: actions/checkout@v4
- run: pnpm install --frozen-lockfile && pnpm run build   # the built server entry is what gets probed
- uses: ZSeven-W/dsh-harbor@v0.1.0-rc.3
  with:
    dsh: next        # version or dist-tag; default latest
```

The job fails with exit code 3 when the plugin would block boot, warns on stale declarations (`fail-on-advisories: true` turns those into failures), writes a job summary, and uploads the JSON report. The target host tree is cached per DSH version.

### Ecosystem board and release watch

This repository also runs two scheduled workflows: an hourly watch on `@deepseek-ai/dsh` dist-tags that commits a `host-diff` for every tag move, and a nightly board that import-probes every npm package declaring `dsh.bundle` or `dsh.client` (about 4,500 at the time of writing) against the current `next`, incrementally — only plugins whose latest version changed are re-probed, and a full run happens when a DSH dist-tag moves. Results are published as a static page and a JSON index under `board/`. Probing executes each package's module top level in a disposable CI runner; that scan never runs on a user's machine, where preflight only touches plugins the user installed.

## Evidence you can inspect

<p align="center">
  <img src="./docs/images/dsh-harbor-evidence.png" alt="DSH Harbor light-theme plugin card with an expanded file:line Web route finding" width="100%" />
</p>
<p align="center"><sub>Expand any capability pill to inspect its tier, detail, and source evidence — here the Web route registration resolves to <code>src/hub/index.mjs:212</code>.</sub></p>

| Tier | What Harbor actually knows |
| --- | --- |
| `declared` | A manifest or filesystem fact, such as client injection or an on-disk realm copy. |
| `runtime` | A registry entry observed in the active DSH host. |
| `static` | A source behavior matched with inspectable `file:line` evidence. |
| `heuristic` | A pattern-based inference that deserves human review. |

Harbor reports facts, not a risk score. Spawning a subprocess may be the entire purpose of a plugin; the useful question is whether that capability is visible, declared, attributable, and expected.

## Install into DSH

DSH is a separate package. Install the tested host version if you do not already have it:

```sh
npm install -g @deepseek-ai/dsh@latest
```

For local development, install the current checkout into a Web profile and restart DSH once:

```sh
dsh plugin --profile web add link:/path/to/dsh-harbor
dsh web
```

For a registry install, use the prerelease `next` tag:

```sh
dsh plugin --profile web add @zseven-w/dsh-harbor@next
dsh web
```

Open **Settings → DSH Harbor**. The panel mounts only in profiles with a Web server; the CLI remains usable in headless and CI environments.

### Verify the installation

```sh
curl http://127.0.0.1:3080/_dsh/dsh-harbor/ping
pnpm --dir ~/.dsh/profiles/web exec harbor --version
```

A healthy ping reports four mounted Harbor routes. The package executable is profile-scoped: installing into `web` does not place `harbor` on your global shell `PATH`.

## CLI

```sh
harbor scan
harbor scan --evidence
harbor scan --json --no-snapshot
harbor scan --json --check-updates
harbor manifest ./my-plugin
harbor preflight --dsh next
```

Invocation choices:

```sh
# installed in the web profile
pnpm --dir ~/.dsh/profiles/web exec harbor scan

# source checkout
node /path/to/dsh-harbor/src/cli.mjs scan

# one-off registry run after publication
pnpm dlx @zseven-w/dsh-harbor@next scan
```

`--help` and `--version` are side-effect free. Human-readable output strips terminal control sequences from untrusted package metadata; JSON preserves the original machine data. `--no-snapshot` prevents baseline writes.

## Capability vocabulary

| Surface | Capability ids |
| --- | --- |
| UI and host routes | `client-injection`, `web-routes` |
| Agent and model surface | `tool-registration`, `llm-adapter`, `global-hook`, `mcp-server` |
| Machine and data access | `subprocess`, `network-egress`, `env-read`, `credential-handling`, `foreign-config` |
| Module-realm integrity | `realm-risk`, `realm-copy` |

The full, stable definitions and declaration rules live in [SPEC.md](./SPEC.md) and [SPEC.zh.md](./SPEC.zh.md). Authors can draft the `capabilities` member to merge into an existing `dsh` object:

```sh
harbor manifest /path/to/my-plugin
```

Always review the draft. Detection is deliberately conservative and pattern based; dynamic calls can be missed, and examples or dead code can look live.

## Version and snapshot semantics

- **Cross-profile drift** compares actual installed registry artifacts. `link:` working trees and `file:` snapshots stay visible but do not define the registry baseline.
- **Upstream checks** read your npm registry configuration, keep cache entries isolated by registry and package name, redact credentials from errors, and return `behind`, `current`, `ahead`, `local`, or `unknown`.
- **Snapshots** live under `~/.config/dsh-harbor/` and track profile membership as well as artifact identity, so profile swaps and upgrades cannot disappear behind deduplication.

## Trust model and limits

- Harbor is a **read-only mirror**, not a sandbox, installer gate, or policy engine.
- The default scan never contacts the network. The upstream check is the sole networked panel action.
- Source, manifest, and freshness reads are bounded, regular-file-only, and no-follow; skipped or over-limit coverage is surfaced.
- Runtime waterfall dispatch modes are not enumerable in the current host API, so Harbor marks that runtime evidence as unavailable instead of guessing.
- Static analysis can produce false positives and false negatives. Evidence is for review, not blind enforcement.

## Develop and verify

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build:client
npm run smoke:pack
```

The test runner is compatible with Node 20 and Windows. CI covers Node 20/24 on Ubuntu and Windows. `smoke:pack` packs the real payload, installs it with plain npm in an empty directory, imports the public entry, runs the installed CLI, and checks required files and modes.

## Ecosystem

- [DSH Android](https://github.com/ZSeven-W/dsh-android) — a live Android emulator or USB device inside a conversation
- [DSH Crew](https://github.com/ZSeven-W/dsh-crew) — dispatch work to DSH agents from Claude Code, Codex, Antigravity, and Grok
- [DSH iOS](https://github.com/ZSeven-W/dsh-ios) — a live iOS Simulator or USB-connected iPhone inside a conversation
- [DSH Noema](https://github.com/ZSeven-W/dsh-noema) — durable, inspectable long-term memory for DSH
- [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) — inspect and edit real OpenPencil design documents inside a conversation

## License

[MIT](./LICENSE) — Copyright (c) 2026 ZSeven-W
