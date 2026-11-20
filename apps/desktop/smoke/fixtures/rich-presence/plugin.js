const E = "app.tumult.activity";
const D = ["playing", "listening", "watching", "custom"], S = { name: 128, details: 128, state: 128, emoji: 16 };
function j(r, t) {
  return r === void 0 || typeof r == "string" && r.length <= t;
}
function I(r) {
  if (typeof r != "object" || r === null || Array.isArray(r)) return !1;
  const t = r;
  return !(t.v !== 1 || typeof t.type != "string" || !D.includes(t.type) || typeof t.name != "string" || t.name.trim() === "" || t.name.length > S.name || !j(t.details, S.details) || !j(t.state, S.state) || !j(t.emoji, S.emoji) || t.startedAt !== void 0 && (typeof t.startedAt != "number" || !Number.isFinite(t.startedAt) || t.startedAt < 0));
}
function F(r) {
  const t = { v: 1, type: r.type, name: r.name.trim() }, s = r.details?.trim(), n = r.state?.trim(), o = r.emoji?.trim();
  if (s && (t.details = s), n && (t.state = n), o && (t.emoji = o), r.startedAt !== void 0 && (t.startedAt = r.startedAt), !I(t)) throw new Error("Invalid activity: check the type, the name (1–128 characters) and the field lengths.");
  return t;
}
const ne = {
  playing: "Playing",
  listening: "Listening to",
  watching: "Watching",
  custom: ""
};
function $(r) {
  const t = ne[r.type];
  return t ? `${t} ${r.name}` : r.name;
}
function W(r) {
  const t = $(r);
  return r.emoji ? `${r.emoji} ${t}` : t;
}
function ie(r, t) {
  if (r === void 0 || t < r) return "";
  const s = Math.floor((t - r) / 6e4);
  if (s < 1) return "just now";
  if (s < 60) return `${s}m`;
  const n = Math.floor(s / 60);
  return n < 24 ? `${n}h ${String(s % 60).padStart(2, "0")}m` : `${Math.floor(n / 24)}d ${n % 24}h`;
}
function oe(r) {
  const t = r.trim();
  if (!t) return null;
  if (/^(clear|off|none)$/i.test(t)) return { clear: !0 };
  const [s = "", ...n] = t.split(/\s+/);
  let o = "playing", u = t;
  const p = s.toLowerCase().replace(/^listen(ing)?$/, "listening");
  D.includes(p) && (o = p, u = n.join(" "));
  let d;
  const y = /^(\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\p{Emoji_Modifier}]*)\s+/u.exec(u);
  y && (d = y[1], u = u.slice(y[0].length));
  const [x = "", ...h] = u.split("|"), b = h.join("|").trim(), g = { type: o, name: x, startedAt: Date.now() };
  return b && (g.details = b), d && (g.emoji = d), { clear: !1, input: g };
}
let M;
function e() {
  if (M) return M;
  const r = globalThis.__tumult?.vue;
  if (!r)
    throw new Error(
      "[tumult] this plugin needs the host's Vue runtime, and the host published none. A plugin that contributes a component runs in the trusted lane, where the shell installs `globalThis.__tumult.vue` before the bundle is imported."
    );
  return M = r, M;
}
e().BaseTransition;
e().BaseTransitionPropsValidators;
e().Comment;
e().DeprecationTypes;
e().EffectScope;
e().ErrorCodes;
const ae = e().Fragment;
e().KeepAlive;
e().ReactiveEffect;
e().Static;
e().Suspense;
e().Teleport;
e().Text;
e().TrackOpTypes;
e().Transition;
e().TransitionGroup;
e().TriggerOpTypes;
e().VueElement;
e().callWithAsyncErrorHandling;
e().callWithErrorHandling;
e().camelize;
e().capitalize;
e().cloneVNode;
e().compile;
const C = e().computed;
e().createApp;
e().createBlock;
const k = e().createCommentVNode, m = e().createElementBlock, a = e().createElementVNode;
e().createHydrationRenderer;
e().createRenderer;
e().createSSRApp;
e().createSlots;
e().createStaticVNode;
e().createTextVNode;
const le = e().createVNode;
e().customRef;
e().defineAsyncComponent;
const q = e().defineComponent;
e().defineCustomElement;
e().defineEmits;
e().defineExpose;
e().defineModel;
e().defineOptions;
e().defineProps;
e().defineSSRCustomElement;
e().defineSlots;
e().devtools;
e().effect;
e().effectScope;
e().getCurrentInstance;
e().getCurrentScope;
e().getCurrentWatcher;
e().getTransitionRawChildren;
e().guardReactiveProps;
e().h;
e().handleError;
e().hasInjectionContext;
e().hydrate;
e().hydrateOnIdle;
e().hydrateOnInteraction;
e().hydrateOnMediaQuery;
e().hydrateOnVisible;
e().initCustomFormatter;
e().inject;
e().isMemoSame;
e().isProxy;
e().isReactive;
e().isReadonly;
e().isRef;
e().isRuntimeOnly;
e().isShallow;
e().isVNode;
e().markRaw;
e().mergeProps;
e().nextTick;
e().nodeOps;
const ue = e().normalizeClass;
e().normalizeProps;
e().normalizeStyle;
e().onActivated;
e().onBeforeMount;
const G = e().onBeforeUnmount;
e().onBeforeUpdate;
e().onDeactivated;
e().onErrorCaptured;
const ce = e().onMounted;
e().onRenderTracked;
e().onRenderTriggered;
e().onScopeDispose;
e().onServerPrefetch;
e().onUnmounted;
e().onUpdated;
e().onWatcherCleanup;
const f = e().openBlock;
e().patchProp;
e().popScopeId;
e().provide;
e().proxyRefs;
e().pushScopeId;
e().queuePostFlushCb;
e().reactive;
e().readonly;
const v = e().ref;
e().registerRuntimeCompiler;
e().render;
const de = e().renderList;
e().renderSlot;
e().resolveComponent;
e().resolveDirective;
e().resolveDynamicComponent;
e().resolveTransitionHooks;
e().setBlockTracking;
e().setDevtoolsHook;
e().setTransitionHooks;
e().shallowReactive;
e().shallowReadonly;
e().shallowRef;
e().ssrContextKey;
e().stop;
const w = e().toDisplayString;
e().toHandlerKey;
e().toHandlers;
e().toRaw;
e().toRef;
e().toRefs;
e().toValue;
e().transformVNodeArgs;
e().triggerRef;
const A = e().unref;
e().useAttrs;
e().useCssModule;
e().useCssVars;
e().useHost;
e().useId;
e().useModel;
e().useSSRContext;
e().useShadowRoot;
e().useSlots;
e().useTemplateRef;
e().useTransitionState;
e().vModelCheckbox;
e().vModelDynamic;
e().vModelRadio;
const pe = e().vModelSelect, R = e().vModelText;
e().vShow;
e().version;
e().warn;
e().watch;
e().watchEffect;
e().watchPostEffect;
e().watchSyncEffect;
e().withCtx;
e().withDefaults;
const T = e().withDirectives;
e().withKeys;
e().withMemo;
const me = e().withModifiers;
e().withScopeId;
const P = v(Date.now());
let V = 0, _ = null;
function fe() {
  V += 1, _ === null && (P.value = Date.now(), _ = setInterval(() => P.value = Date.now(), 3e4));
  let r = !1;
  return {
    now: P,
    release() {
      r || (r = !0, V -= 1, V === 0 && _ !== null && (clearInterval(_), _ = null));
    }
  };
}
const ve = ["data-activity-type", "title"], he = {
  key: 0,
  class: "tumult-rp-emoji",
  "aria-hidden": "true"
}, ye = { class: "tumult-rp-headline" }, ge = {
  key: 1,
  class: "tumult-rp-secondary"
}, we = {
  key: 2,
  class: "tumult-rp-elapsed"
}, J = /* @__PURE__ */ q({
  __name: "ActivityLine",
  props: {
    userId: {},
    value: {},
    variant: {}
  },
  setup(r) {
    const t = r, s = fe();
    G(s.release);
    const n = C(() => I(t.value) ? t.value : null), o = C(() => n.value ? ie(n.value.startedAt, s.now.value) : ""), u = C(() => {
      const d = n.value;
      return d ? [d.details, d.state].filter(Boolean).join(" · ") : "";
    }), p = C(() => {
      const d = n.value;
      return d ? [$(d), u.value, o.value].filter(Boolean).join(" — ") : "";
    });
    return (d, y) => n.value ? (f(), m("span", {
      key: 0,
      class: ue(["tumult-rp-activity", `tumult-rp-activity--${r.variant}`]),
      "data-activity-type": n.value.type,
      title: p.value
    }, [
      n.value.emoji ? (f(), m("span", he, w(n.value.emoji), 1)) : k("", !0),
      a("span", ye, w(A($)(n.value)), 1),
      r.variant === "self" && u.value ? (f(), m("span", ge, w(u.value), 1)) : k("", !0),
      o.value ? (f(), m("span", we, w(o.value), 1)) : k("", !0)
    ], 10, ve)) : k("", !0);
  }
}), be = "app.tumult.rich-presence.prefs", N = { mirror: !0, lastMirrored: null };
function Se() {
  const r = /* @__PURE__ */ new Map(), t = {
    getItem: (s) => r.get(s) ?? null,
    setItem: (s, n) => {
      r.set(s, n);
    }
  };
  try {
    const s = globalThis.localStorage;
    return s ? {
      getItem: (n) => {
        try {
          return s.getItem(n);
        } catch {
          return t.getItem(n);
        }
      },
      setItem: (n, o) => {
        try {
          s.setItem(n, o);
        } catch {
          t.setItem(n, o);
        }
      }
    } : t;
  } catch {
    return t;
  }
}
class ke {
  client;
  store;
  supported = null;
  constructor(t, s = Se()) {
    this.client = t, this.store = s;
  }
  prefsKey() {
    const t = this.client.session.get()?.userId ?? "anonymous";
    return `${be}:${t}`;
  }
  prefs() {
    try {
      const t = this.store.getItem(this.prefsKey());
      if (!t) return { ...N };
      const s = JSON.parse(t);
      return {
        mirror: typeof s.mirror == "boolean" ? s.mirror : N.mirror,
        lastMirrored: typeof s.lastMirrored == "string" ? s.lastMirrored : null
      };
    } catch {
      return { ...N };
    }
  }
  savePrefs(t) {
    const s = { ...this.prefs(), ...t };
    return this.store.setItem(this.prefsKey(), JSON.stringify(s)), s;
  }
  /** Cached: the answer does not change within a session. A failure counts as unsupported. */
  profileFieldsSupported() {
    return this.supported ??= this.client.profileFieldsSupported().catch(() => !1), this.supported;
  }
  async setActivity(t) {
    const s = await this.writeProfile(t), { mirrored: n, skippedManual: o } = await this.mirror(W(t));
    if (!s && !n && !o)
      throw new Error("Nothing was written: extended profiles are unsupported here and the status mirror is off.");
    return { profile: s, mirrored: n, skippedManual: o };
  }
  async clearActivity() {
    const t = await this.writeProfile(null), { mirrored: s, skippedManual: n } = await this.mirror(null);
    return { profile: t, mirrored: s, skippedManual: n };
  }
  async writeProfile(t) {
    return await this.profileFieldsSupported() ? (await this.client.setProfileField(E, t), !0) : !1;
  }
  /** `text === null` clears a mirror we own. */
  async mirror(t) {
    const s = this.prefs();
    if (!s.mirror) return { mirrored: !1, skippedManual: !1 };
    const n = this.client.ownPresence.get(), o = n?.statusMessage ?? "";
    if (!(o === "" || o === s.lastMirrored)) return { mirrored: !1, skippedManual: !0 };
    if (t === null && o === "")
      return this.savePrefs({ lastMirrored: null }), { mirrored: !1, skippedManual: !1 };
    const p = n?.presence ?? "online";
    return await this.client.setOwnPresence(p, t ?? ""), this.savePrefs({ lastMirrored: t }), { mirrored: !0, skippedManual: !1 };
  }
}
const Y = /* @__PURE__ */ new WeakMap();
function O(r) {
  let t = Y.get(r);
  return t || (t = new ke(r), Y.set(r, t)), t;
}
function Q(r) {
  try {
    return F({
      type: r.type,
      name: r.name,
      details: r.details,
      state: r.state,
      startedAt: r.startedAt,
      emoji: r.emoji
    });
  } catch {
    return null;
  }
}
function xe(r, t) {
  return r.type === t.type && r.name === t.name && r.details === t.details && r.state === t.state && r.startedAt === t.startedAt && r.emoji === t.emoji;
}
class Ae {
  client;
  /** The native document we last pushed and believe the field still holds. */
  owned = null;
  /** Set once teardown has run, so an in-flight async callback stops. */
  stopped = !1;
  unsubscribed = null;
  teardown = null;
  /** The live native activity. Read by the settings tab; null on the web. */
  current = v(null);
  constructor(t) {
    this.client = t;
  }
  /**
   * Subscribe to the feed and mirror it into the profile field. Returns a
   * disposer (run on the registry's uninstall, or called directly) that stops
   * mirroring and un-subscribes. Idempotent: a second `start` is a no-op that
   * returns the same disposer.
   */
  start(t) {
    const s = () => {
      if (this.teardown === null) return;
      this.teardown = null, this.stopped = !0;
      const n = this.unsubscribed;
      this.unsubscribed = null, n?.();
    };
    return this.teardown ? this.teardown : (this.unsubscribed = t.subscribe((n) => {
      this.stopped || this.onNative(n);
    }), this.teardown = s, s);
  }
  async onNative(t) {
    this.current.value = t;
    const s = this.client.session.get()?.userId;
    if (!s) return;
    const n = O(this.client);
    if (t === null) {
      if (this.owned === null) return;
      const u = this.client.profileField(s, E).get();
      I(u) && xe(u, this.owned) && await n.clearActivity(), this.owned = null;
      return;
    }
    const o = Q(t);
    o !== null && (await n.setActivity(o), this.owned = o);
  }
}
const K = /* @__PURE__ */ new WeakMap();
function X(r) {
  let t = K.get(r);
  return t || (t = new Ae(r), K.set(r, t)), t;
}
const _e = { class: "tumult-rp-settings" }, Ce = {
  key: 0,
  class: "tumult-rp-notice",
  role: "note"
}, Ie = { class: "tumult-rp-field" }, Me = ["disabled"], Te = ["value"], Ee = { class: "tumult-rp-field" }, je = ["maxlength", "disabled"], Re = { class: "tumult-rp-field" }, Pe = ["maxlength", "disabled"], Ve = { class: "tumult-rp-field" }, Ne = ["maxlength", "disabled"], $e = { class: "tumult-rp-actions" }, De = ["disabled"], Fe = ["disabled"], Oe = { class: "tumult-rp-toggle" }, ze = ["checked"], Be = {
  key: 1,
  class: "tumult-rp-message",
  role: "status"
}, Ue = {
  key: 2,
  class: "tumult-rp-error",
  role: "alert"
}, He = { class: "tumult-rp-native" }, Le = {
  key: 0,
  class: "tumult-rp-native-active"
}, Ye = {
  key: 1,
  class: "tumult-rp-native-note"
}, Ke = /* @__PURE__ */ q({
  __name: "ActivitySettings",
  props: {
    client: {},
    close: { type: Function }
  },
  setup(r) {
    const s = r.client, n = O(s), o = v(null), u = v(n.prefs().mirror), p = v("playing"), d = v(""), y = v(""), x = v(""), h = v(!1), b = v(""), g = v(""), Z = X(s), z = C(() => {
      const l = Z.current.value;
      return l ? Q(l) : null;
    }), ee = s.session.get()?.userId ?? "";
    let B = null;
    function U(l) {
      I(l) && (p.value = l.type, d.value = l.name, y.value = l.details ?? "", x.value = l.emoji ?? "");
    }
    ce(async () => {
      o.value = await n.profileFieldsSupported();
      const l = s.session.get()?.userId;
      if (o.value && l) {
        const i = s.profileField(l, E);
        U(i.get());
        const c = i.subscribe(U);
        B = () => c.unsubscribe();
      }
    }), G(() => B?.());
    function te(l) {
      u.value = l.target.checked, n.savePrefs({ mirror: u.value });
    }
    function H(l, i) {
      const c = [];
      return l.profile && c.push(`activity ${i}`), l.mirrored && c.push(`status ${i === "set" ? "updated" : "cleared"}`), l.skippedManual && c.push("your custom status was left as is"), c.length ? c.join("; ") + "." : "Nothing to do.";
    }
    async function L(l) {
      h.value = !0, b.value = "", g.value = "";
      try {
        b.value = await l();
      } catch (i) {
        g.value = i instanceof Error ? i.message : String(i);
      } finally {
        h.value = !1;
      }
    }
    function re() {
      return L(async () => {
        const l = F({
          type: p.value,
          name: d.value,
          details: y.value,
          emoji: x.value,
          startedAt: Date.now()
        }), i = await n.setActivity(l);
        return H(i, "set");
      });
    }
    function se() {
      return L(async () => H(await n.clearActivity(), "cleared"));
    }
    return (l, i) => (f(), m("section", _e, [
      i[10] || (i[10] = a("h2", { class: "tumult-rp-heading" }, "Activity", -1)),
      o.value === !1 ? (f(), m("p", Ce, " Your homeserver does not support extended profiles (MSC4133), so other people cannot see a rich activity. The status-message mirror below is the only output here — keep it on. ")) : k("", !0),
      a("form", {
        class: "tumult-rp-form",
        onSubmit: me(re, ["prevent"])
      }, [
        a("label", Ie, [
          i[4] || (i[4] = a("span", null, "Type", -1)),
          T(a("select", {
            "onUpdate:modelValue": i[0] || (i[0] = (c) => p.value = c),
            disabled: h.value
          }, [
            (f(!0), m(ae, null, de(A(D), (c) => (f(), m("option", {
              key: c,
              value: c
            }, w(c), 9, Te))), 128))
          ], 8, Me), [
            [pe, p.value]
          ])
        ]),
        a("label", Ee, [
          a("span", null, w(p.value === "custom" ? "Text" : "Name"), 1),
          T(a("input", {
            "onUpdate:modelValue": i[1] || (i[1] = (c) => d.value = c),
            maxlength: A(S).name,
            required: "",
            disabled: h.value,
            placeholder: "Chess"
          }, null, 8, je), [
            [R, d.value]
          ])
        ]),
        a("label", Re, [
          i[5] || (i[5] = a("span", null, "Details (optional)", -1)),
          T(a("input", {
            "onUpdate:modelValue": i[2] || (i[2] = (c) => y.value = c),
            maxlength: A(S).details,
            disabled: h.value
          }, null, 8, Pe), [
            [R, y.value]
          ])
        ]),
        a("label", Ve, [
          i[6] || (i[6] = a("span", null, "Emoji (optional)", -1)),
          T(a("input", {
            "onUpdate:modelValue": i[3] || (i[3] = (c) => x.value = c),
            maxlength: A(S).emoji,
            disabled: h.value
          }, null, 8, Ne), [
            [R, x.value]
          ])
        ]),
        a("div", $e, [
          a("button", {
            type: "submit",
            disabled: h.value || !d.value.trim()
          }, "Set activity", 8, De),
          a("button", {
            type: "button",
            disabled: h.value,
            onClick: se
          }, "Clear", 8, Fe)
        ])
      ], 32),
      a("label", Oe, [
        a("input", {
          type: "checkbox",
          checked: u.value,
          onChange: te
        }, null, 40, ze),
        i[7] || (i[7] = a("span", null, ' Also show it as my status message (e.g. "Playing Chess"). A status you typed yourself is never overwritten. ', -1))
      ]),
      b.value ? (f(), m("p", Be, w(b.value), 1)) : k("", !0),
      g.value ? (f(), m("p", Ue, w(g.value), 1)) : k("", !0),
      a("section", He, [
        i[9] || (i[9] = a("h3", { class: "tumult-rp-native-title" }, "Native / RPC activity", -1)),
        z.value ? (f(), m("div", Le, [
          le(J, {
            "user-id": A(ee),
            value: z.value,
            variant: "self"
          }, null, 8, ["user-id", "value"]),
          i[8] || (i[8] = a("p", { class: "tumult-rp-native-note" }, "Mirrored from a native app on your desktop.", -1))
        ])) : (f(), m("p", Ye, " On desktop, a running app — a game, a music player, an editor — can report what it is doing, and it shows here just like your own activity above, wherever your profile appears. A web tab cannot see an operating system, so this stays empty in the browser. "))
      ])
    ]));
  }
}), We = `
.tumult-rp-activity {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
}
.tumult-rp-activity > * { flex: none; }
.tumult-rp-headline,
.tumult-rp-secondary {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tumult-rp-headline { font-weight: var(--weight-semibold); color: var(--text-primary); }
.tumult-rp-activity--row .tumult-rp-headline { font-weight: var(--weight-normal); color: inherit; }
.tumult-rp-elapsed,
.tumult-rp-secondary { color: var(--text-muted); }
.tumult-rp-elapsed { font-variant-numeric: tabular-nums; }

.tumult-rp-settings { display: grid; gap: var(--space-4); color: var(--text-primary); }
.tumult-rp-heading { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-bold); }
.tumult-rp-notice {
    margin: 0;
    padding: var(--space-3);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-inset);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.tumult-rp-form { display: grid; gap: var(--space-3); }
.tumult-rp-field { display: grid; gap: var(--space-1); font-size: var(--text-sm); color: var(--text-secondary); }
.tumult-rp-field input,
.tumult-rp-field select {
    padding: var(--space-2);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-inset);
    color: var(--text-primary);
    font: inherit;
}
.tumult-rp-actions { display: flex; gap: var(--space-2); }
.tumult-rp-actions button {
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
}
.tumult-rp-actions button[type="submit"] { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
.tumult-rp-actions button:hover:not(:disabled) { background: var(--surface-hover); }
.tumult-rp-actions button[type="submit"]:hover:not(:disabled) { background: var(--accent-hover); }
.tumult-rp-actions button:disabled { cursor: default; opacity: 0.6; }
.tumult-rp-toggle { display: flex; gap: var(--space-2); align-items: flex-start; font-size: var(--text-sm); }
.tumult-rp-message { margin: 0; color: var(--text-secondary); font-size: var(--text-sm); }
.tumult-rp-error { margin: 0; color: var(--danger); font-size: var(--text-sm); }

/* The informational native-activity block: a divider, a live-mirrored line (or
   an empty-state note on the web where no feed exists). */
.tumult-rp-native {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: var(--border-width) solid var(--border-default);
}
.tumult-rp-native-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
}
.tumult-rp-native-active { display: grid; gap: var(--space-2); }
.tumult-rp-native-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
}
`, qe = {
  id: "app.tumult.rich-presence",
  name: "Rich Presence",
  version: "0.2.0",
  author: "jackgraddon",
  description: "Discord-style activities (Playing / Listening / Watching) on your profile, shown in member lists and the user bar; on desktop, mirror what native apps are doing.",
  permissions: ["activity-renderers", "commands", "settings-tabs", "styles", "native-activity"],
  minCore: "1.5.0",
  minUI: "1.3.0"
}, Ge = "/activity [playing|listening|watching|custom] [emoji] <name> [| details]  ·  /activity clear", Je = {
  manifest: qe,
  install(r) {
    r.injectStylesheet(We), r.addActivityRenderer({
      id: "app.tumult.rich-presence.activity",
      key: E,
      component: J,
      match: I
    }), r.addSettingsTab({
      id: "app.tumult.rich-presence.settings",
      title: "Activity",
      component: Ke
    }), r.addCommand({
      name: "activity",
      description: "Set or clear your activity (Playing / Listening / Watching)",
      usage: "[type] <name> | clear",
      run: async ({ args: s }) => {
        const n = oe(s);
        if (n === null) throw new Error(`Usage: ${Ge}`);
        const o = O(r.client);
        if (n.clear) {
          await o.clearActivity();
          return;
        }
        const u = F(n.input), p = await o.setActivity(u);
        if (!p.profile && p.skippedManual)
          throw new Error(
            `Extended profiles are unsupported here and your custom status was left alone, so "${W(u)}" was not published.`
          );
      }
    });
    const t = r.nativeActivity();
    return X(r.client).start(t);
  }
};
export {
  Ge as USAGE,
  Je as default,
  qe as manifest,
  Je as plugin
};
