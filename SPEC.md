# dsh.capabilities — Declaration Convention for DSH Plugins

Status: community convention (not part of the DSH host API)
Reference implementation: dsh-harbor 0.1.0-rc.2

`dsh.capabilities` lets a plugin author state, in `package.json`, which
capabilities the plugin's code actually uses. The declaration is a fact about
behavior — not a permission request, not a security boundary. The DSH host
does not read or enforce it; the consumer is audit tooling (dsh-harbor),
which reconciles the declaration against static detection.

## 1. Field definition

| Aspect    | Value |
| --------- | ----- |
| Location  | `dsh.capabilities` in the plugin's `package.json` |
| Type      | `string[]` — array of capability ids from §2 |
| Semantics | Declares what the plugin code actually does |

Real declaration from harbor's own `package.json`:

```json
{
  "dsh": {
    "capabilities": [
      "client-injection",
      "env-read",
      "foreign-config",
      "network-egress",
      "web-routes"
    ]
  }
}
```

## 2. Capability vocabulary

The vocabulary lives as data in harbor's source (`CAPABILITIES` in
`src/scan/detectors.mjs`). Each id names one observable behavior. This is
the complete table harbor 0.1.0-rc.2 detects — 13 ids:

| id | Behavior the id stands for (what detection looks for) |
| --- | --- |
| `client-injection` | Injects browser-side modules into the DSH Web UI (`dsh.client` in `package.json`); such modules can access everything on the page |
| `realm-risk` | Puts `@deepseek-ai/*` in `dependencies` instead of `peerDependencies`; installing may pull in duplicate copies |
| `realm-copy` | Ships its own `@deepseek-ai/*` under the plugin's `node_modules` — a direct cause of split Symbol identity |
| `global-hook` | Registers host-level waterfall hooks (`ctx.on('agent/…'|'session/…'|'llm/…')`) that can read — even rewrite — all agent messages; UI events are excluded |
| `llm-adapter` | Registers a model provider (`registerAdapter([…])`); once selected, all model traffic for the session flows through it |
| `subprocess` | Imports `child_process` and calls `spawn`/`exec` (incl. `*Sync`/`File` variants) — launches local processes with the power of the user's shell |
| `network-egress` | Makes outbound requests (`fetch(`, `http(s).request(`, references to `fetch`); the report lists the hostnames it found in the scanned code |
| `web-routes` | Mounts routes on DSH's Web server (`webServer.register(`), usually loopback-bound |
| `tool-registration` | Exposes tools to the model (name+description objects, `*_TOOL_NAME` constants); heuristic — tool names also feed the conflict matrix |
| `mcp-server` | Imports `@modelcontextprotocol/sdk` — serves MCP to hosts outside DSH (Claude Code, Codex, …) |
| `foreign-config` | Reads or writes other software's configuration (paths containing `.claude`/`.codex`/`.gemini`/`.npmrc`); uninstall residue shows up here too |
| `credential-handling` | Contains credential-shaped code (`_authToken`, `api-key`/`api_key`, `Bearer`); heuristic — whether it is reasonable depends on context |
| `env-read` | Reads environment variables (`process.env.X`); the report lists the variable names |

## 3. Reconciliation

harbor compares declaration vs. detection and classifies every id:

- **undeclared** — detected but not declared (under-declared) → status `drift`
- **unused** — declared but not detected (over-declared) → reported, but never
  causes drift: declaring more than you use is conservative and fine
- **unknown** — declared id not in the vocabulary (typo, stale id) → `drift`

Overall status is one of `not-declared` (no field), `match`, `drift`.

Exact rendering in `harbor scan` (Chinese locale):

```text
声明对账: 未声明 dsh.capabilities
声明对账: ✓ 一致（声明宽于实际: <ids>）
声明对账: ⚠ 检出未声明: <ids> | 未知 id: <ids>
```

`harbor manifest` prints `现有声明与检出一致。` on match; on drift it
prints a `与现有声明的差异:` block listing undeclared / unknown ids.

## 4. Unknown capability ids

Current harbor behavior: unknown ids are **reported, not ignored** — they go
into the `unknown` array, force status `drift`, and render as
`未知 id: …`. The report is advisory: drift never makes the command exit
non-zero.

## 5. Self-checking a declaration

```text
node src/cli.mjs manifest <dir>     # in a source checkout
harbor manifest <dir>               # once harbor is installed
```

Prints the number of detected capabilities, a paste-ready `dsh` block, one
review line per capability, and the reconciliation verdict (when a
declaration already exists). Detection is pattern matching: it can
over-report (comments, example code) or under-report (dynamic calls).
Review the per-capability lines before pasting.

**Self-check against your source checkout, not against a published
tarball.** harbor scans author source first and excludes build output
(`dist/`, `build/`, …) and test files — otherwise the report describes the
third-party libraries you bundled, not the code you wrote. When a package
publishes only build output, harbor falls back to scanning it and marks the
whole report `coverage.sourceKind: 'bundled'`: evidence carries a bundled
label and drops to heuristic confidence. Such conclusions are still usable,
but they describe the bundle as a whole — dependencies included — rather
than your own authored behavior.

## 6. Vocabulary evolution

1. New detectors append new ids to `CAPABILITIES`. An id is introduced
   only for a new observable behavior, and its meaning is fixed at
   introduction.
2. Existing ids are never renamed, removed, or redefined. A declaration
   written against today's vocabulary remains valid.
3. Old declarations never become errors. An id an older harbor does not
   detect yet surfaces as `unused` — status stays `match`. An id an older
   harbor does not know surfaces as `unknown` drift — reported, advisory.
   (Both behaviors verified against harbor 0.1.0-rc.2.)
4. harbor's own declaration (§1) is the reference example; it must keep
   reconciling to `match` against itself.
