<p align="center">
  <a href="./README.md"><b>English</b></a> &middot; <a href="./README.zh.md">简体中文</a>
</p>

# dsh-harbor

A read-only mirror for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins you have installed: what each one **can do**, where they **collide**, and what **changed** since the last scan — with `file:line` evidence for every claim.

Whether to clean anything up is your call. harbor states facts; it does not judge, gate installs, or intercept anything.

## What it is — and what it is not

harbor does one thing: it keeps a running, evidence-backed ledger of the plugins you have installed. The ledger has three columns — the inventory itself (every installed third-party plugin, with a `file:line` citation behind every capability claim), the reconciliation between what each plugin declares and what its code actually does, and the timeline of what changed between scans.

What harbor deliberately does not do is equally part of its design. It does not vet or gate plugins before they are installed — admission control belongs to plugin-marketplace tooling. It does not dive into upstream dependency monitoring; the upstream check covers plugin versions and stops there. It does not perform general code auditing, and it does not intercept, block, or sandbox plugin behavior.

The last of these is not a scope decision but a fact about the host. DSH's Cordis runtime has no capability sandbox: a plugin runs inside the host's main Node realm, with the host's own privileges. harbor can make capabilities **visible**, **detect** them, and **reconcile** them against declarations — but it cannot shut them off. Containing plugin behavior needs support in the DSH loader itself, and the declaration flow below is how that standard gets earned with data instead of argued for in the abstract.

Finally, harbor reports facts, not scores. Its output is always "what was detected, and where the evidence is" — never a risk level, never a quality grade. What a finding means for you is your judgment, not harbor's.

> **Status: `0.1.0-rc.1`, release candidate.** `harbor scan` / `harbor manifest`, the loopback hub routes, the DSH settings panel, and both version axes — cross-profile drift and the opt-in upstream check — all work; runtime-registry evidence is wired but degrades to `available: false` outside a live host. The feature set is complete; what is still early is detector calibration against the wider ecosystem, which is exactly what an rc is for.

## What it looks at

```
~/.dsh/profiles/*                → installed third-party bundles (npm and link: alike)
  ├─ declared    package.json / cordis.patch.yml — what the plugin says about itself
  ├─ runtime     tools / routes / providers / waterfalls actually registered in the host
  ├─ static      subprocess, egress, foreign-config writes — with file:line
  ├─ versions    drift (local, always) + upstream (networked, opt-in)
  └─ snapshot    diff against the previous scan: new versions, new capabilities
        └─ reconciliation: declared dsh.capabilities vs what was detected
```

Capabilities are a fixed set of thirteen — client injection, realm risks, realm copies, global hooks, LLM adapters, subprocesses, network egress, web routes, tool registration, MCP servers, foreign-config writes, credential handling, environment reads. Fixed, so that reports stay comparable and diffable between scans. The authoritative list is [SPEC.md](./SPEC.md) §2; the machine-readable source of truth is `src/scan/detectors.mjs`.

The wording is deliberately neutral: **capability**, not risk. Spawning subprocesses is the whole point of some plugins. The report answers "what can this do", and leaves "should it" to you.

## Versions

harbor answers two version questions and keeps them apart.

**Cross-profile drift** is purely local. The same plugin at different versions across profiles is a fact about this machine, so it is computed on every scan, for free. A `link:` or `file:` install is not counted as the "newest" baseline: a working tree running ahead of its published version is normal, not drift.

**Upstream check** leaves the machine, so it is never part of the default scan. The CLI needs `harbor scan --check-updates`; the panel needs an explicit button press, and the text next to the button says so — it is the only action on that page that leaves your machine. Each result is one of five states:

- **behind** — the registry has a newer version
- **current** — the installed version matches the registry
- **ahead** — the installed version is newer than the registry (a real state on a maintainer's machine)
- **local** — a `link:` / `file:` install, which has no upstream to compare against and is never shown as "up to date"
- **unknown** — the lookup failed

The registry is read from your own `.npmrc` (including `@scope:registry` overrides), never hardcoded to npmjs. Results are cached on disk for six hours.

## Installation

The package is not on the registry yet, so install from a checkout:

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` forwards the rest of its arguments to pnpm inside the profile directory, and `link:` symlinks the profile dependency to this checkout, so rebuilds show up directly. Once `@zseven-w/dsh-harbor` is published, the registry form applies:

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@latest
```

Restart DSH afterwards so the new profile layer is loaded.

The panel appears in DSH's Web UI under **Settings** as the **DSH Harbor** section — the same mirror as the CLI: inventory with evidence, conflicts, versions, and the diff since the last scan. Its **Check for updates** button is the only action on that page that leaves your machine. The panel is part of the plugin's hub half, which mounts only in profiles with a web server; headless setups still get the full CLI.

## Usage

```bash
harbor scan                 # inventory, conflicts, and changes since last scan
harbor scan --check-updates # + opt-in upstream check against the registry (networked)
harbor manifest ./my-plugin # draft a dsh.capabilities block for your own plugin
```

Add `--evidence` to print the `file:line` source of every capability, `--json` for the full machine-readable report, `--no-snapshot` to skip writing the diff baseline.

The scanner is dependency-free and does not need DSH installed, so it also runs in CI.

## For plugin authors

`harbor manifest` reads your plugin the same way it reads everyone else's and drafts a `dsh.capabilities` block for your `package.json`. Once declared, harbor's check becomes **declared vs detected**: capabilities you declared but never use are noise you can trim, and capabilities detected but undeclared are the ones worth explaining. harbor declares its own `dsh.capabilities` too, so the flow can be reproduced on the tool itself: run `harbor manifest .` in this repository.

The convention itself is written down in [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md)). In one line: `dsh.capabilities` is a plain list in `package.json` stating what your plugin's code actually does. Declaring it is cheap and pays twice — audit tooling like harbor can reconcile your words against your code, and the people running your plugin can see you are not hiding anything. Self-check your own declaration at any time with `harbor manifest <dir>`.

## Limits, stated plainly

harbor reads every plugin's source, which makes it the most privileged thing in the room. It appears in its own report.

Once the upstream check is enabled, harbor itself has network-egress capability, and its `dsh.capabilities` declaration already lists it.

## License

MIT
