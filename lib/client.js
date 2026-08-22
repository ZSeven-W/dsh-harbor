window.__ModuleLoader__.load({ id: "@zseven-w/dsh-harbor", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var CLIENT_BUILD_ID = "1472268dbbffae23";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_dom = require("react-dom");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/index.tsx
const inject = ["slots", "locale"];
const API = "/_dsh/dsh-harbor";
const MAX_CLAIM_ITEMS = 8;
const COPY = {
	zh: {
		label: "DSH Harbor",
		title: "DSH Harbor",
		intro: "已安装第三方插件的能力清单：每项能力都带 file:line 证据，跨插件冲突与自上次扫描以来的变化一并列出。只读镜像——陈述事实，不下结论。",
		rescan: "重新扫描",
		scanning: "扫描中…",
		loading: "加载中…",
		conflicts: "冲突",
		clash: "撞车",
		orderSensitive: "顺序敏感",
		versions: "版本",
		versionsAgree: "各 profile 版本一致",
		latestPublished: (newest) => `已发布最新 ${newest}`,
		local: "本地",
		localFile: "本地 file",
		checkUpdates: "检查上游更新",
		checkingUpdates: "检查中…",
		checkUpdatesHint: "这是本页唯一会离开你这台机器的动作",
		upToDate: "已是最新",
		aheadOfRegistry: "本机比上游新",
		localInstall: "本地安装，无上游可比",
		lookupFailed: "查询失败",
		checkedAt: (t, hosts) => `检查于 ${t} · ${hosts}`,
		changes: "变化",
		firstRun: "首次扫描，已建立基线。",
		noChanges: "自上次扫描以来无变化。",
		since: (t) => `自上次扫描（${t}）:`,
		plugins: "插件",
		noPlugins: "未检测到第三方插件。",
		noMatches: "没有符合筛选条件的插件。",
		filterAll: "全部插件",
		filterDrift: "声明不一致",
		filterNotDeclared: "未声明",
		filterMatch: "声明一致",
		installs: "安装位置",
		claims: "工具 · 路由 · Provider",
		tools: "工具",
		routes: "路由",
		providers: "Provider",
		hooks: "消息钩子",
		caps: "能力",
		noCaps: "未检出能力。",
		bundled: "结论基于产物推断",
		recNotDeclared: "未声明 dsh.capabilities",
		recMatch: "声明与检出一致",
		recUnused: (list) => `（声明宽于实际：${list}）`,
		recDrift: "声明与检出不一致",
		recUndeclared: (list) => `检出未声明：${list}`,
		recUnknown: (list) => `未知 id：${list}`,
		evidenceOmitted: (n) => `…另有 ${n} 处`,
		noEvidence: "该项无 file:line 证据（来自声明或目录检查）。",
		scannedAt: (t, dir) => `扫描于 ${t} · ${dir}`,
		tier: {
			declared: "声明",
			runtime: "运行时",
			static: "源码",
			heuristic: "启发式"
		},
		kind: {
			"tool-name": "工具名",
			"route-base": "路由前缀",
			"provider-id": "Provider ID",
			"client-module-id": "客户端模块 ID",
			"order-sensitive": "顺序敏感"
		},
		kindNotes: {
			"tool-name": "多个插件注册同名工具，后装载者覆盖先装载者，模型只会看到其中一个。",
			"route-base": "多个插件声明同一路由前缀，后注册者抢占该路径，先注册者静默失效。",
			"provider-id": "多个插件注册同一 provider id，会话选中后流量只会经过其中一个适配器。",
			"client-module-id": "多个插件注入同一客户端模块 id，页面加载时后者覆盖前者。",
			"order-sensitive": "多个插件挂载同一消息路径事件，加载顺序决定谁先改写消息，行为随安装顺序变化。"
		},
		changeTypes: {
			added: "新增",
			removed: "移除",
			version: "版本变更",
			"capability-added": "新增能力",
			"capability-removed": "移除能力",
			"claims-changed": "claims 变更"
		},
		staleHub: "本 DSH 实例还在跑旧版插件，缺少该接口 —— 重启 DSH 后再试",
		emptyResponse: (path, status) => `${path} → HTTP ${status}，响应为空`,
		badJson: (path, body) => `${path} → 非 JSON 响应: ${body}`,
		bannerHubStale: "harbor 的扫描代码已更新，但运行中的 DSH 仍在使用启动时载入的旧版本。请重启 DSH，否则本页显示的结论可能不完整。",
		bannerPanelStale: "本页面用的是旧版界面代码，请刷新页面。"
	},
	en: {
		label: "DSH Harbor",
		title: "DSH Harbor",
		intro: "A capability inventory of your installed third-party plugins — every capability with file:line evidence, cross-plugin conflicts, and what changed since the last scan. Read-only: harbor states facts, never verdicts.",
		rescan: "Rescan",
		scanning: "Scanning…",
		loading: "Loading…",
		conflicts: "Conflicts",
		clash: "clash",
		orderSensitive: "order-sensitive",
		versions: "Versions",
		versionsAgree: "All profiles agree",
		latestPublished: (newest) => `latest published ${newest}`,
		local: "local",
		localFile: "local file",
		checkUpdates: "Check for updates",
		checkingUpdates: "Checking…",
		checkUpdatesHint: "The only action on this page that leaves your machine",
		upToDate: "up to date",
		aheadOfRegistry: "ahead of registry",
		localInstall: "local install, no upstream",
		lookupFailed: "lookup failed",
		checkedAt: (t, hosts) => `Checked ${t} · ${hosts}`,
		changes: "Changes",
		firstRun: "First scan — baseline established.",
		noChanges: "Nothing changed since the last scan.",
		since: (t) => `Since last scan (${t}):`,
		plugins: "Plugins",
		noPlugins: "No third-party plugins detected.",
		noMatches: "No plugins match the filter.",
		filterAll: "All plugins",
		filterDrift: "Drifting declarations",
		filterNotDeclared: "Not declared",
		filterMatch: "In sync",
		installs: "Installed at",
		claims: "Tools · routes · providers",
		tools: "Tools",
		routes: "Routes",
		providers: "Providers",
		hooks: "Message hooks",
		caps: "Capabilities",
		noCaps: "No capabilities detected.",
		bundled: "Conclusions inferred from build output",
		recNotDeclared: "no dsh.capabilities declared",
		recMatch: "declaration matches detection",
		recUnused: (list) => ` (declared but unused: ${list})`,
		recDrift: "declaration drifts from detection",
		recUndeclared: (list) => `Detected but undeclared: ${list}`,
		recUnknown: (list) => `Unknown ids: ${list}`,
		evidenceOmitted: (n) => `…${n} more`,
		noEvidence: "No file:line evidence for this item (manifest / filesystem finding).",
		scannedAt: (t, dir) => `Scanned ${t} · ${dir}`,
		tier: {
			declared: "declared",
			runtime: "runtime",
			static: "static",
			heuristic: "heuristic"
		},
		kind: {
			"tool-name": "tool name",
			"route-base": "route prefix",
			"provider-id": "provider id",
			"client-module-id": "client module id",
			"order-sensitive": "order-sensitive"
		},
		kindNotes: {
			"tool-name": "Several plugins register the same tool name; the later loader wins and the model only ever sees one of them.",
			"route-base": "Several plugins declare the same route prefix; the later registration takes the path and the earlier one silently stops working.",
			"provider-id": "Several plugins register the same provider id; once selected in a session, traffic goes through only one adapter.",
			"client-module-id": "Several plugins inject the same client module id; on page load the later one overwrites the earlier one.",
			"order-sensitive": "Several plugins hook the same message-path event; load order decides who rewrites messages first, so behaviour depends on install order."
		},
		changeTypes: {
			added: "added",
			removed: "removed",
			version: "version",
			"capability-added": "capability added",
			"capability-removed": "capability removed",
			"claims-changed": "claims changed"
		},
		staleHub: "This DSH instance is still running an older build of the plugin and lacks this route — restart DSH and retry",
		emptyResponse: (path, status) => `${path} → HTTP ${status}, empty response`,
		badJson: (path, body) => `${path} → non-JSON response: ${body}`,
		bannerHubStale: "harbor's scanner has been updated, but the running DSH still uses the copy it loaded at boot. Restart DSH — until then this page may be quietly incomplete.",
		bannerPanelStale: "This page is running an older build of the panel. Reload the page."
	}
};
const S = {
	section: {
		margin: "8px 0 -2px",
		fontSize: 13,
		fontWeight: 600,
		opacity: .9
	},
	group: {
		margin: "4px 0 -3px",
		fontSize: 12,
		opacity: .55
	},
	block: {
		border: "1px solid rgba(128,128,128,0.22)",
		borderRadius: 10,
		padding: "11px 14px 13px",
		display: "flex",
		flexDirection: "column",
		gap: 10
	},
	blockGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		gap: "12px 14px",
		alignItems: "end"
	},
	btn: {
		padding: "4px 12px",
		borderRadius: 6,
		border: "1px solid rgba(128,128,128,0.35)",
		background: "transparent",
		color: "inherit",
		cursor: "pointer",
		fontSize: 12.5
	},
	input: {
		padding: "3px 8px",
		borderRadius: 5,
		border: "1px solid rgba(128,128,128,0.35)",
		background: "transparent",
		color: "inherit",
		fontSize: 12.5
	},
	chip: (on) => ({
		fontSize: 11.5,
		padding: "1px 8px",
		borderRadius: 99,
		border: "1px solid",
		borderColor: on ? "rgba(63,185,80,0.5)" : "rgba(128,128,128,0.35)",
		color: on ? "#3fb950" : "inherit",
		opacity: on ? 1 : .55
	}),
	mono: {
		fontFamily: "ui-monospace, Menlo, monospace",
		fontSize: 12,
		fontVariantNumeric: "tabular-nums"
	}
};
const TIER_STYLE = {
	declared: {
		background: "rgba(74,158,255,0.20)",
		borderColor: "rgba(74,158,255,0.60)"
	},
	runtime: {
		background: "rgba(74,158,255,0.14)",
		borderColor: "rgba(74,158,255,0.45)"
	},
	static: {
		background: "rgba(74,158,255,0.09)",
		borderColor: "rgba(74,158,255,0.32)"
	},
	heuristic: {
		background: "rgba(128,128,128,0.08)",
		borderColor: "rgba(128,128,128,0.28)"
	}
};
const CLASH = "#f85149";
const DRIFT = "#d29922";
const UPDATE_STATUS_ORDER = [
	"behind",
	"current",
	"ahead",
	"local",
	"unknown"
];
function CustomSelect({ value, options, onChange, minWidth }) {
	const [open, setOpen] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		if (!open) return;
		const close = () => setOpen(null);
		const onKey = (e) => {
			if (e.key === "Escape") close();
		};
		const t = setTimeout(() => document.addEventListener("mousedown", close), 0);
		document.addEventListener("keydown", onKey);
		return () => {
			clearTimeout(t);
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	const current = options.find((o) => o.value === value);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		style: {
			...S.input,
			display: "flex",
			alignItems: "center",
			gap: 6,
			cursor: "pointer",
			minWidth: minWidth ?? 92,
			width: "100%",
			boxSizing: "border-box",
			justifyContent: "space-between"
		},
		onClick: (e) => {
			const r = e.currentTarget.getBoundingClientRect();
			const up = window.innerHeight - r.bottom < 240;
			setOpen({
				left: r.left,
				top: r.bottom + 4,
				bottom: window.innerHeight - r.top + 4,
				width: Math.max(r.width, 130),
				up
			});
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			children: current?.label ?? value
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				opacity: .5,
				fontSize: 10
			},
			children: "▾"
		})]
	}), open && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: {
			position: "fixed",
			left: open.left,
			...open.up ? { bottom: open.bottom } : { top: open.top },
			minWidth: open.width,
			zIndex: 9999,
			background: "Canvas",
			color: "CanvasText",
			border: "1px solid rgba(128,128,128,0.3)",
			borderRadius: 8,
			boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
			padding: 4,
			maxHeight: 240,
			overflowY: "auto"
		},
		onMouseDown: (e) => e.stopPropagation(),
		children: options.map((o) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			onClick: () => {
				onChange(o.value);
				setOpen(null);
			},
			style: {
				padding: "5px 10px",
				borderRadius: 5,
				cursor: "pointer",
				fontSize: 12.5,
				whiteSpace: "nowrap",
				background: o.value === value ? "rgba(128,128,128,0.16)" : "transparent",
				display: "flex",
				justifyContent: "space-between",
				gap: 12,
				alignItems: "center"
			},
			onMouseEnter: (e) => {
				e.currentTarget.style.background = "rgba(128,128,128,0.24)";
			},
			onMouseLeave: (e) => {
				e.currentTarget.style.background = o.value === value ? "rgba(128,128,128,0.16)" : "transparent";
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: o.label ?? o.value }), o.value === value && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: {
					opacity: .6,
					fontSize: 11
				},
				children: "✓"
			})]
		}, o.value))
	}), document.body)] });
}
function fmtTime(iso) {
	if (!iso) return "?";
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
/**
* Change details are rendered server-side in zh (e.g. "新增能力：客户端注入").
* In the en UI, swap the capability labels via the fetched table and strip the
* zh prefixes — the change-type label already carries the meaning.
*/
function localizeDetail(detail, type, zh, caps) {
	if (zh || !detail) return detail;
	let d = detail;
	for (const c of caps ?? []) {
		const zhLabel = c?.label?.zh;
		if (zhLabel) d = d.split(zhLabel).join(c.label.en);
	}
	return d.replace(/新增能力：/g, "").replace(/移除能力：/g, "").replace(/claims 变更：/g, "").replace(/版本 /g, "v").replace(/工具 /g, "tool ").replace(/路由 /g, "route ").replace(/、/g, ", ").replace(/，/g, ", ");
}
function HarborPanel({ ctx }) {
	const locale = (0, react.useSyncExternalStore)((notify) => ctx.on("locale/change", notify), () => ctx.locale.getLocale().active, () => ctx.locale.getLocale().active);
	const zh = locale === "zh";
	const copy = COPY[zh ? "zh" : "en"];
	const [report, setReport] = (0, react.useState)(null);
	const [freshness, setFreshness] = (0, react.useState)(null);
	const [caps, setCaps] = (0, react.useState)(null);
	const [busy, setBusy] = (0, react.useState)(false);
	const [notice, setNotice] = (0, react.useState)("");
	const [updates, setUpdates] = (0, react.useState)(null);
	const [checking, setChecking] = (0, react.useState)(false);
	const [updateError, setUpdateError] = (0, react.useState)("");
	const [expanded, setExpanded] = (0, react.useState)(null);
	const [filter, setFilter] = (0, react.useState)("all");
	/**
	* The panel is served from disk on every load, but the hub's routes are
	* registered at instance boot — after an upgrade the new UI can call a route
	* the running instance does not have yet, which answers 404/405 with an empty
	* body. Report that as "restart DSH" instead of a JSON parse error.
	*/
	const readJson = (0, react.useCallback)(async (res, path) => {
		const text = await res.text();
		if (text === "") throw new Error(res.status === 404 || res.status === 405 ? `${copy.staleHub}（${path} → HTTP ${res.status}）` : copy.emptyResponse(path, res.status));
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(copy.badJson(path, text.slice(0, 160)));
		}
	}, [copy]);
	/** Every request carries the active locale: the panel is the authority on it
	* (DSH's setting may be unset), and the hub localizes its own strings from it. */
	const withLang = (0, react.useCallback)((path) => `${API}${path}${path.includes("?") ? "&" : "?"}lang=${locale === "zh" ? "zh" : "en"}`, [locale]);
	const get = (0, react.useCallback)(async (path) => readJson(await fetch(withLang(path), { cache: "no-store" }), path), [readJson, withLang]);
	const refresh = (0, react.useCallback)(async (force) => {
		setBusy(true);
		try {
			const r = await get(force ? "/report?refresh=1" : "/report");
			if (r.ok) {
				setReport(r.report ?? null);
				setFreshness(r.freshness ?? null);
				setNotice("");
			}
		} catch (e) {
			setNotice(String(e?.message ?? e));
		}
		try {
			const c = await get("/capabilities");
			if (c.ok) setCaps(c.capabilities ?? []);
		} catch {}
		setBusy(false);
	}, [get]);
	/** The one networked action on this page. Runs only on an explicit click —
	* never from useEffect — and reuses get/withLang so it carries the locale.
	* If the running instance predates this route, readJson reports "restart DSH". */
	const checkUpdates = (0, react.useCallback)(async () => {
		setChecking(true);
		setUpdateError("");
		setUpdates(null);
		try {
			const r = await get("/updates");
			if (r.ok) setUpdates(r.updates ?? null);
			else setUpdateError(String(r.error ?? ""));
		} catch (e) {
			setUpdateError(String(e?.message ?? e));
		}
		setChecking(false);
	}, [get]);
	(0, react.useEffect)(() => {
		refresh(false);
	}, [refresh]);
	/** Capability labels, notes and tiers come from the hub's /capabilities
	* table; fall back to the raw id when the instance predates that route. */
	const capById = (id) => caps?.find((c) => c.id === id);
	const capLabel = (id) => capById(id)?.label?.[zh ? "zh" : "en"] ?? id;
	const capNote = (id) => capById(id)?.note ?? "";
	const recChip = (p) => {
		const rec = p.reconciliation ?? { status: "not-declared" };
		if (rec.status === "not-declared") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				fontSize: 11,
				padding: "1px 8px",
				borderRadius: 99,
				border: "1px solid rgba(128,128,128,0.35)",
				opacity: .75,
				whiteSpace: "nowrap"
			},
			children: copy.recNotDeclared
		});
		if (rec.status === "match") {
			const unused = (rec.unused ?? []).map(capLabel).join(", ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: {
					fontSize: 11,
					padding: "1px 8px",
					borderRadius: 99,
					border: "1px solid rgba(128,128,128,0.35)",
					opacity: .75,
					whiteSpace: "nowrap"
				},
				title: unused ? copy.recUnused(unused) : void 0,
				children: [
					"✓ ",
					copy.recMatch,
					unused ? copy.recUnused(unused) : ""
				]
			});
		}
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			style: {
				fontSize: 11,
				padding: "1px 8px",
				borderRadius: 99,
				border: "1px solid rgba(210,153,34,0.65)",
				color: DRIFT,
				whiteSpace: "nowrap"
			},
			children: ["⚠ ", copy.recDrift]
		});
	};
	const evidenceBlock = (p, id) => {
		const finding = p.capabilities?.[id];
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				border: "1px solid rgba(128,128,128,0.22)",
				borderRadius: 8,
				padding: "8px 12px",
				background: "rgba(128,128,128,0.05)",
				display: "flex",
				flexDirection: "column",
				gap: 3
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 11.5,
						display: "flex",
						gap: 6,
						alignItems: "baseline",
						flexWrap: "wrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { fontWeight: 600 },
							children: capLabel(id)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { opacity: .55 },
							children: copy.tier[finding?.tier] ?? finding?.tier
						}),
						capNote(id) !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { opacity: .65 },
							children: capNote(id)
						})
					]
				}),
				(finding?.details ?? []).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11.5,
						opacity: .75
					},
					children: finding.details.join("；")
				}),
				(finding?.evidence ?? []).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11.5,
						opacity: .5
					},
					children: copy.noEvidence
				}) : (finding?.evidence ?? []).map((ev, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...S.mono,
						fontSize: 11.5,
						display: "flex",
						gap: 10,
						alignItems: "baseline",
						lineHeight: 1.5
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							opacity: .55,
							whiteSpace: "nowrap",
							flexShrink: 0
						},
						children: [
							ev.file,
							":",
							ev.line
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							whiteSpace: "pre-wrap",
							wordBreak: "break-all",
							opacity: .9
						},
						children: ev.excerpt
					})]
				}, i)),
				!!finding?.omitted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11,
						opacity: .5
					},
					children: copy.evidenceOmitted(finding.omitted)
				})
			]
		});
	};
	const pluginCard = (p) => {
		const rec = p.reconciliation ?? { status: "not-declared" };
		const capIds = Object.keys(p.capabilities ?? {});
		const claimRows = [
			[copy.tools, p.claims?.toolNames ?? []],
			[copy.routes, p.claims?.routeBases ?? []],
			[copy.providers, p.claims?.providerIds ?? []],
			[copy.hooks, p.hooks ?? []]
		];
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: S.block,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "baseline",
						gap: 8,
						flexWrap: "wrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontWeight: 600,
								fontSize: 13.5
							},
							children: p.name
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								...S.mono,
								fontSize: 11.5,
								opacity: .65
							},
							children: ["@", p.version]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
						recChip(p)
					]
				}),
				rec.status === "drift" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 11.5,
						color: DRIFT,
						opacity: .95,
						marginTop: -6
					},
					children: [
						rec.undeclared?.length ? copy.recUndeclared(rec.undeclared.map(capLabel).join(", ")) : "",
						rec.undeclared?.length && rec.unknown?.length ? " · " : "",
						rec.unknown?.length ? copy.recUnknown(rec.unknown.join(", ")) : ""
					]
				}),
				!!p.description && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11.5,
						opacity: .6,
						marginTop: -6
					},
					children: p.description
				}),
				p.coverage?.sourceAvailable === false && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 11.5,
						opacity: .7,
						marginTop: -6
					},
					children: ["ⓘ ", copy.bundled]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: S.group,
					children: copy.installs
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexWrap: "wrap",
						marginTop: -4
					},
					children: (p.installs ?? []).map((it, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						title: it.spec,
						style: {
							...S.mono,
							fontSize: 11.5,
							display: "inline-flex",
							alignItems: "center",
							gap: 4
						},
						children: [
							it.profile,
							"#",
							it.position,
							it.linked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 9,
									border: "1px solid rgba(128,128,128,0.4)",
									borderRadius: 3,
									padding: "0 3px",
									opacity: .65
								},
								children: it.spec?.startsWith("file:") ? "file" : "link"
							})
						]
					}, i))
				}),
				claimRows.some(([, v]) => v.length) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: S.group,
					children: copy.claims
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 3,
						marginTop: -4
					},
					children: claimRows.filter(([, v]) => v.length).map(([label, values]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 6,
							flexWrap: "wrap",
							alignItems: "baseline"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									opacity: .55,
									whiteSpace: "nowrap"
								},
								children: label
							}),
							values.slice(0, MAX_CLAIM_ITEMS).map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									...S.mono,
									fontSize: 11.5
								},
								children: v
							}, v)),
							values.length > MAX_CLAIM_ITEMS && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								title: values.slice(MAX_CLAIM_ITEMS).join(", "),
								style: {
									fontSize: 11,
									opacity: .55
								},
								children: ["+", values.length - MAX_CLAIM_ITEMS]
							})
						]
					}, label))
				})] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: S.group,
					children: copy.caps
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 6,
						marginTop: -4
					},
					children: [capIds.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 11.5,
							opacity: .5
						},
						children: copy.noCaps
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							flexWrap: "wrap",
							gap: 6
						},
						children: capIds.map((id) => {
							const key = `${p.dir}\u0000${id}`;
							const open = expanded === key;
							const tier = p.capabilities[id]?.tier;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								title: capNote(id),
								onClick: () => setExpanded(open ? null : key),
								style: {
									fontSize: 11.5,
									padding: "1px 8px",
									borderRadius: 99,
									border: "1px solid",
									background: "transparent",
									color: "inherit",
									cursor: "pointer",
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									...TIER_STYLE[tier] ?? TIER_STYLE.heuristic,
									...open ? { borderColor: "rgba(74,158,255,0.9)" } : {}
								},
								children: [capLabel(id), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 9.5,
										opacity: .6
									},
									children: copy.tier[tier] ?? tier
								})]
							}, id);
						})
					}), expanded && expanded.startsWith(`${p.dir}\u0000`) && evidenceBlock(p, expanded.slice(p.dir.length + 1))]
				})
			]
		}, p.dir);
	};
	/** Per-row status text for the upstream check, coloured only for "behind". */
	const updateStatus = (r) => {
		if (r.status === "behind") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			style: { color: DRIFT },
			children: ["→ ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: S.mono,
				children: r.latest
			})]
		});
		if (r.status === "current") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: { opacity: .6 },
			children: copy.upToDate
		});
		if (r.status === "ahead") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: { opacity: .6 },
			children: copy.aheadOfRegistry
		});
		if (r.status === "local") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: { opacity: .6 },
			children: copy.localInstall
		});
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: { opacity: .6 },
			children: copy.lookupFailed
		}), !!r.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				fontSize: 11,
				opacity: .55
			},
			children: r.error
		})] });
	};
	const matches = (p) => {
		if (filter === "all") return true;
		const s = p.reconciliation?.status;
		if (filter === "drift") return s === "drift";
		if (filter === "not-declared") return s === "not-declared";
		return s === "match";
	};
	const plugins = report?.plugins ?? [];
	const shown = plugins.filter(matches);
	const versionDrift = report?.versionDrift ?? [];
	const profilesByIdentity = new Map((report?.plugins ?? []).map((p) => [p.identity, (p.installs ?? []).map((i) => i.profile)]));
	const sortedUpdateResults = [...updates?.results ?? []].sort((a, b) => {
		const ai = UPDATE_STATUS_ORDER.indexOf(a.status);
		const bi = UPDATE_STATUS_ORDER.indexOf(b.status);
		return (ai < 0 ? UPDATE_STATUS_ORDER.length : ai) - (bi < 0 ? UPDATE_STATUS_ORDER.length : bi);
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			fontSize: 13,
			lineHeight: 1.55
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "flex-start",
					gap: 12
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 4,
						flex: 1,
						minWidth: 0
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 19,
							fontWeight: 600,
							marginBottom: -2
						},
						children: copy.title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { opacity: .75 },
						children: copy.intro
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					style: {
						...S.btn,
						flexShrink: 0
					},
					disabled: busy,
					onClick: () => void refresh(true),
					children: busy ? copy.scanning : copy.rescan
				})]
			}),
			freshness && (freshness.hubStale === true || typeof CLIENT_BUILD_ID === "string" && typeof freshness.clientBuildId === "string" && CLIENT_BUILD_ID !== freshness.clientBuildId) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 6
				},
				children: [freshness.hubStale === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						border: "1px solid rgba(210,153,34,0.65)",
						color: DRIFT,
						borderRadius: 8,
						padding: "7px 12px",
						fontSize: 12,
						display: "flex",
						gap: 8,
						alignItems: "baseline"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "⚠" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.bannerHubStale })]
				}), typeof CLIENT_BUILD_ID === "string" && typeof freshness.clientBuildId === "string" && CLIENT_BUILD_ID !== freshness.clientBuildId && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						border: "1px solid rgba(210,153,34,0.65)",
						color: DRIFT,
						borderRadius: 8,
						padding: "7px 12px",
						fontSize: 12,
						display: "flex",
						gap: 8,
						alignItems: "baseline"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "⚠" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.bannerPanelStale })]
				})]
			}),
			report === null && busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { opacity: .55 },
				children: copy.loading
			}),
			notice !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 12,
					opacity: .8,
					whiteSpace: "pre-wrap"
				},
				children: notice
			}),
			report && (report.conflicts ?? []).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: S.section,
				children: copy.conflicts
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				children: (report.conflicts ?? []).map((c) => {
					const clash = c.severity === "clash";
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...S.block,
							gap: 6,
							...clash ? {
								borderColor: "rgba(248,81,73,0.55)",
								background: "rgba(248,81,73,0.06)"
							} : {}
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: {
											fontSize: 12.5,
											fontWeight: 600,
											color: clash ? CLASH : void 0
										},
										children: [
											clash ? "⚠" : "ⓘ",
											" ",
											copy.kind[c.kind] ?? c.kind
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: {
											...S.mono,
											fontSize: 12.5,
											opacity: .9
										},
										children: [
											"\"",
											c.key,
											"\""
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 10.5,
											opacity: .55,
											border: "1px solid rgba(128,128,128,0.3)",
											borderRadius: 99,
											padding: "0 6px"
										},
										children: clash ? copy.clash : copy.orderSensitive
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: { fontSize: 12 },
								children: (c.owners ?? []).map((o) => `${o.name}（${(o.profiles ?? []).join(", ")}）`).join(" vs ")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 11.5,
									opacity: .75
								},
								children: copy.kindNotes[c.kind] ?? c.note ?? ""
							})
						]
					}, `${c.kind}\u0000${c.key}`);
				})
			})] }),
			report && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: S.section,
					children: copy.versions
				}),
				versionDrift.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12.5,
						opacity: .55
					},
					children: copy.versionsAgree
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 8
					},
					children: versionDrift.map((d) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...S.block,
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "baseline",
								gap: 8,
								flexWrap: "wrap"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontWeight: 600,
									fontSize: 13
								},
								children: d.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11.5,
									opacity: .65
								},
								children: copy.latestPublished(d.newest)
							})]
						}), (d.rows ?? []).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6,
								flexWrap: "wrap"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										...S.mono,
										fontSize: 11.5,
										color: row.behind ? DRIFT : void 0
									},
									children: row.version
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										opacity: .6
									},
									children: (row.profiles ?? []).join(", ")
								}),
								row.kind === "link" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 9,
										border: "1px solid rgba(128,128,128,0.4)",
										borderRadius: 3,
										padding: "0 3px",
										opacity: .65
									},
									children: copy.local
								}),
								row.kind === "file" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 9,
										border: "1px solid rgba(128,128,128,0.4)",
										borderRadius: 3,
										padding: "0 3px",
										opacity: .65
									},
									children: copy.localFile
								})
							]
						}, row.version))]
					}, d.name))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						style: S.btn,
						disabled: checking,
						onClick: () => void checkUpdates(),
						children: checking ? copy.checkingUpdates : copy.checkUpdates
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 11,
							opacity: .55
						},
						children: copy.checkUpdatesHint
					})]
				}),
				updateError !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						opacity: .8,
						whiteSpace: "pre-wrap"
					},
					children: updateError
				}),
				updates && sortedUpdateResults.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						...S.block,
						gap: 6
					},
					children: sortedUpdateResults.map((r, i) => {
						const profiles = profilesByIdentity.get(r.identity);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 8,
								alignItems: "baseline",
								flexWrap: "wrap",
								fontSize: 12.5
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { fontWeight: 500 },
									children: r.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										...S.mono,
										fontSize: 11.5,
										opacity: .75
									},
									children: r.installed
								}),
								profiles?.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										opacity: .6
									},
									children: [
										"[",
										profiles.join(", "),
										"]"
									]
								}) : null,
								updateStatus(r)
							]
						}, r.identity ?? r.name ?? i);
					})
				}),
				updates && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11,
						opacity: .55
					},
					children: copy.checkedAt(fmtTime(updates.checkedAt), (updates.registryHosts ?? []).join(", "))
				})
			] }),
			report && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: S.section,
					children: copy.changes
				}),
				report.snapshot?.firstRun ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12.5,
						opacity: .75
					},
					children: copy.firstRun
				}) : (report.snapshot?.changes ?? []).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12.5,
						opacity: .55
					},
					children: copy.noChanges
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...S.block,
						gap: 6
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 11,
							opacity: .55
						},
						children: copy.since(report.snapshot?.previousScanAt ?? "?")
					}), (report.snapshot?.changes ?? []).map((c, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							alignItems: "baseline",
							flexWrap: "wrap",
							fontSize: 12.5
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									opacity: .6,
									whiteSpace: "nowrap"
								},
								children: copy.changeTypes[c.type] ?? c.type
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { fontWeight: 500 },
								children: c.plugin
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { opacity: .75 },
								children: localizeDetail(c.detail ?? "", c.type, zh, caps)
							})
						]
					}, i))]
				}),
				report.snapshot?.warning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 11.5,
						opacity: .6
					},
					children: report.snapshot.warning
				})
			] }),
			report && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "baseline",
					gap: 10
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...S.section,
							flexShrink: 0,
							whiteSpace: "nowrap"
						},
						children: copy.plugins
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							width: 150,
							flexShrink: 0
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CustomSelect, {
							value: filter,
							onChange: setFilter,
							minWidth: 150,
							options: [
								{
									value: "all",
									label: copy.filterAll
								},
								{
									value: "drift",
									label: copy.filterDrift
								},
								{
									value: "not-declared",
									label: copy.filterNotDeclared
								},
								{
									value: "match",
									label: copy.filterMatch
								}
							]
						})
					})
				]
			}), shown.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { opacity: .55 },
				children: plugins.length === 0 ? copy.noPlugins : copy.noMatches
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 10
				},
				children: shown.map(pluginCard)
			})] }),
			report && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 11,
					opacity: .5,
					marginTop: -2
				},
				children: copy.scannedAt(fmtTime(report.scannedAt), report.profilesDir ?? "")
			})
		]
	});
}
function apply(ctx) {
	ctx.slots.inject("settings.section", () => {
		return ctx.slots.register({
			name: "settings.section",
			id: "dsh-harbor",
			order: 66,
			label: () => COPY[ctx.locale.getLocale().active === "zh" ? "zh" : "en"].label
		}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HarborPanel, { ctx }));
	});
}
//#endregion
exports.apply = apply;
exports.inject = inject;

return module.exports; } });
//__HARBOR_CLIENT_BUILD__=1472268dbbffae23
