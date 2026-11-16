import { o as __toESM } from "../_runtime.mjs";
import { q as require_react, x as require_jsx_runtime, y as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { _ as ArrowRight, f as Disc3, r as Unplug, s as Radio } from "../_libs/lucide-react.mjs";
import { d as makeCode, i as cn, n as Wordmark, x as tap } from "./wordmark-D639p3th.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-DK7Pmqpz.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var NOTES = [
	{
		icon: Radio,
		title: "Heard at the same time",
		body: "The room keeps one playhead. Everyone is on the same second."
	},
	{
		icon: Unplug,
		title: "Leaves when you leave",
		body: "A song plays from the browser that added it. Close the tab and it drops out of the queue."
	},
	{
		icon: Disc3,
		title: "The host runs the cue",
		body: "Whoever opens the room can skip, pull a song, or move the line. No account, no storage."
	}
];
function Lobby() {
	const navigate = useNavigate();
	const [name, setName] = (0, import_react.useState)("");
	const [code, setCode] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		const saved = localStorage.getItem("sidea:name");
		if (saved) setName(saved);
	}, []);
	function seat(nextCode) {
		const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 24);
		if (!trimmed) {
			setError("Add your name so the room knows who queued the song.");
			return;
		}
		const room = nextCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
		if (room.length < 4) {
			setError("Room codes are 4 to 6 letters.");
			return;
		}
		localStorage.setItem("sidea:name", trimmed);
		navigate({
			to: "/r/$code",
			params: { code: room }
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "flex items-center justify-between gap-4",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wordmark, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-right text-sm text-mist",
				children: "Files stay on your device"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:py-16",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rise",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium tracking-brand text-brass uppercase",
						children: "A private listening room"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
						className: "mt-3 font-display text-4xl leading-tight font-medium text-cream sm:text-6xl",
						children: ["Same song.", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "block italic text-brass",
							children: "Same second."
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-5 max-w-md text-base text-mist sm:text-lg",
						children: "Drop in MP3s from your own library. Friends in the room hear them with you. Nothing is uploaded — if you disconnect, your songs stop."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-8 grid gap-4",
						children: NOTES.map((note) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "flex gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-brass",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(note.icon, {
									className: "size-4",
									"aria-hidden": "true"
								})
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "block text-sm font-medium text-cream",
								children: note.title
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "mt-0.5 block text-sm text-mist",
								children: note.body
							})] })]
						}, note.title))
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "rise rise-2 lift rounded-card border border-line bg-panel p-5 sm:p-7",
				onSubmit: (event) => {
					event.preventDefault();
					seat(code.trim() ? code : makeCode());
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "block text-sm font-medium text-cream",
						htmlFor: "listener-name",
						children: "Your name"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						id: "listener-name",
						value: name,
						maxLength: 24,
						autoComplete: "nickname",
						placeholder: "What should the room call you?",
						onChange: (event) => {
							setName(event.target.value);
							setError(null);
						},
						className: "mt-2 h-12 w-full rounded-xl border border-line bg-ink px-3 text-base text-cream outline-none placeholder:text-mist"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: cn(tap, "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brass text-base font-medium text-ink"),
						onClick: () => seat(makeCode()),
						children: ["Open a room", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowRight, {
							className: "size-4",
							"aria-hidden": "true"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "my-5 flex items-center gap-3 text-xs tracking-brand text-mist uppercase",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-px flex-1 bg-line" }),
							"or take a seat",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-px flex-1 bg-line" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "block text-sm font-medium text-cream",
						htmlFor: "room-code",
						children: "Room code"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-2 flex gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							id: "room-code",
							value: code,
							maxLength: 6,
							autoCapitalize: "characters",
							autoCorrect: "off",
							spellCheck: false,
							placeholder: "K7MQP",
							onChange: (event) => {
								setCode(event.target.value.toUpperCase());
								setError(null);
							},
							className: "h-12 min-w-0 flex-1 rounded-xl border border-line bg-ink px-3 font-display text-lg tracking-brand text-cream uppercase outline-none placeholder:text-mist placeholder:tracking-brand"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: cn(tap, "h-12 shrink-0 rounded-xl border border-line bg-raised px-4 text-sm font-medium text-cream"),
							onClick: () => seat(code),
							children: "Join"
						})]
					}),
					error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-brass",
						role: "alert",
						children: error
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-mist",
						children: "Share the code after you’re in. Up to eight people, songs under 8 MB."
					})
				]
			})]
		})]
	});
}
var SplitComponent = Lobby;
//#endregion
export { SplitComponent as component };
