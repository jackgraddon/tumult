/**
 * The `vue` your bundle builds against — GENERATED, do not edit by hand.
 *
 * Run `pnpm shim` (scripts/gen-vue-shim.mjs) to regenerate it from the
 * installed `vue` package.
 *
 * A plugin must share the HOST's Vue instance — a second copy would break
 * `provide`/`inject` and split reactivity in two. So the build aliases
 * `vue` to this file (see `vite.config.ts`), and the shell puts its own
 * runtime on `globalThis.__tumult.vue` before it imports any plugin.
 *
 * Every export below is a binding to the host's own value, so a compiled
 * single-file component finds the helpers it needs (`openBlock`,
 * `createElementBlock`, `renderList`, `toDisplayString`, …) and the
 * identity-sensitive ones (`Fragment`, `Transition`) are the host's
 * objects, not look-alikes.
 *
 * Import the real `vue` for your TYPES (`import { h } from "vue"` still
 * typechecks — `vue` is a devDependency); at runtime this file is what
 * ships.
 */
import type * as VueRuntime from "vue";

type Bridge = typeof VueRuntime;

let cached: Bridge | undefined;

/** The host's Vue runtime, resolved once and remembered. */
function runtime(): Bridge {
    if (cached) return cached;
    const bridge = (globalThis as { __tumult?: { vue?: unknown } }).__tumult?.vue as
        | Bridge
        | undefined;
    if (!bridge) {
        throw new Error(
            "[tumult] this plugin needs the host's Vue runtime, and the host published none. " +
                "A plugin that contributes a component runs in the trusted lane, where the shell " +
                "installs `globalThis.__tumult.vue` before the bundle is imported.",
        );
    }
    cached = bridge;
    return cached;
}

export const BaseTransition: typeof VueRuntime.BaseTransition = runtime().BaseTransition;
export const BaseTransitionPropsValidators: typeof VueRuntime.BaseTransitionPropsValidators = runtime().BaseTransitionPropsValidators;
export const Comment: typeof VueRuntime.Comment = runtime().Comment;
export const DeprecationTypes: typeof VueRuntime.DeprecationTypes = runtime().DeprecationTypes;
export const EffectScope: typeof VueRuntime.EffectScope = runtime().EffectScope;
export const ErrorCodes: typeof VueRuntime.ErrorCodes = runtime().ErrorCodes;
export const Fragment: typeof VueRuntime.Fragment = runtime().Fragment;
export const KeepAlive: typeof VueRuntime.KeepAlive = runtime().KeepAlive;
export const ReactiveEffect: typeof VueRuntime.ReactiveEffect = runtime().ReactiveEffect;
export const Static: typeof VueRuntime.Static = runtime().Static;
export const Suspense: typeof VueRuntime.Suspense = runtime().Suspense;
export const Teleport: typeof VueRuntime.Teleport = runtime().Teleport;
export const Text: typeof VueRuntime.Text = runtime().Text;
export const TrackOpTypes: typeof VueRuntime.TrackOpTypes = runtime().TrackOpTypes;
export const Transition: typeof VueRuntime.Transition = runtime().Transition;
export const TransitionGroup: typeof VueRuntime.TransitionGroup = runtime().TransitionGroup;
export const TriggerOpTypes: typeof VueRuntime.TriggerOpTypes = runtime().TriggerOpTypes;
export const VueElement: typeof VueRuntime.VueElement = runtime().VueElement;
export const callWithAsyncErrorHandling: typeof VueRuntime.callWithAsyncErrorHandling = runtime().callWithAsyncErrorHandling;
export const callWithErrorHandling: typeof VueRuntime.callWithErrorHandling = runtime().callWithErrorHandling;
export const camelize: typeof VueRuntime.camelize = runtime().camelize;
export const capitalize: typeof VueRuntime.capitalize = runtime().capitalize;
export const cloneVNode: typeof VueRuntime.cloneVNode = runtime().cloneVNode;
export const compile: typeof VueRuntime.compile = runtime().compile;
export const computed: typeof VueRuntime.computed = runtime().computed;
export const createApp: typeof VueRuntime.createApp = runtime().createApp;
export const createBlock: typeof VueRuntime.createBlock = runtime().createBlock;
export const createCommentVNode: typeof VueRuntime.createCommentVNode = runtime().createCommentVNode;
export const createElementBlock: typeof VueRuntime.createElementBlock = runtime().createElementBlock;
export const createElementVNode: typeof VueRuntime.createElementVNode = runtime().createElementVNode;
export const createHydrationRenderer: typeof VueRuntime.createHydrationRenderer = runtime().createHydrationRenderer;
export const createRenderer: typeof VueRuntime.createRenderer = runtime().createRenderer;
export const createSSRApp: typeof VueRuntime.createSSRApp = runtime().createSSRApp;
export const createSlots: typeof VueRuntime.createSlots = runtime().createSlots;
export const createStaticVNode: typeof VueRuntime.createStaticVNode = runtime().createStaticVNode;
export const createTextVNode: typeof VueRuntime.createTextVNode = runtime().createTextVNode;
export const createVNode: typeof VueRuntime.createVNode = runtime().createVNode;
export const customRef: typeof VueRuntime.customRef = runtime().customRef;
export const defineAsyncComponent: typeof VueRuntime.defineAsyncComponent = runtime().defineAsyncComponent;
export const defineComponent: typeof VueRuntime.defineComponent = runtime().defineComponent;
export const defineCustomElement: typeof VueRuntime.defineCustomElement = runtime().defineCustomElement;
export const defineEmits: typeof VueRuntime.defineEmits = runtime().defineEmits;
export const defineExpose: typeof VueRuntime.defineExpose = runtime().defineExpose;
export const defineModel: typeof VueRuntime.defineModel = runtime().defineModel;
export const defineOptions: typeof VueRuntime.defineOptions = runtime().defineOptions;
export const defineProps: typeof VueRuntime.defineProps = runtime().defineProps;
export const defineSSRCustomElement: typeof VueRuntime.defineSSRCustomElement = runtime().defineSSRCustomElement;
export const defineSlots: typeof VueRuntime.defineSlots = runtime().defineSlots;
export const devtools: typeof VueRuntime.devtools = runtime().devtools;
export const effect: typeof VueRuntime.effect = runtime().effect;
export const effectScope: typeof VueRuntime.effectScope = runtime().effectScope;
export const getCurrentInstance: typeof VueRuntime.getCurrentInstance = runtime().getCurrentInstance;
export const getCurrentScope: typeof VueRuntime.getCurrentScope = runtime().getCurrentScope;
export const getCurrentWatcher: typeof VueRuntime.getCurrentWatcher = runtime().getCurrentWatcher;
export const getTransitionRawChildren: typeof VueRuntime.getTransitionRawChildren = runtime().getTransitionRawChildren;
export const guardReactiveProps: typeof VueRuntime.guardReactiveProps = runtime().guardReactiveProps;
export const h: typeof VueRuntime.h = runtime().h;
export const handleError: typeof VueRuntime.handleError = runtime().handleError;
export const hasInjectionContext: typeof VueRuntime.hasInjectionContext = runtime().hasInjectionContext;
export const hydrate: typeof VueRuntime.hydrate = runtime().hydrate;
export const hydrateOnIdle: typeof VueRuntime.hydrateOnIdle = runtime().hydrateOnIdle;
export const hydrateOnInteraction: typeof VueRuntime.hydrateOnInteraction = runtime().hydrateOnInteraction;
export const hydrateOnMediaQuery: typeof VueRuntime.hydrateOnMediaQuery = runtime().hydrateOnMediaQuery;
export const hydrateOnVisible: typeof VueRuntime.hydrateOnVisible = runtime().hydrateOnVisible;
export const initCustomFormatter: typeof VueRuntime.initCustomFormatter = runtime().initCustomFormatter;
export const inject: typeof VueRuntime.inject = runtime().inject;
export const isMemoSame: typeof VueRuntime.isMemoSame = runtime().isMemoSame;
export const isProxy: typeof VueRuntime.isProxy = runtime().isProxy;
export const isReactive: typeof VueRuntime.isReactive = runtime().isReactive;
export const isReadonly: typeof VueRuntime.isReadonly = runtime().isReadonly;
export const isRef: typeof VueRuntime.isRef = runtime().isRef;
export const isRuntimeOnly: typeof VueRuntime.isRuntimeOnly = runtime().isRuntimeOnly;
export const isShallow: typeof VueRuntime.isShallow = runtime().isShallow;
export const isVNode: typeof VueRuntime.isVNode = runtime().isVNode;
export const markRaw: typeof VueRuntime.markRaw = runtime().markRaw;
export const mergeProps: typeof VueRuntime.mergeProps = runtime().mergeProps;
export const nextTick: typeof VueRuntime.nextTick = runtime().nextTick;
export const nodeOps: typeof VueRuntime.nodeOps = runtime().nodeOps;
export const normalizeClass: typeof VueRuntime.normalizeClass = runtime().normalizeClass;
export const normalizeProps: typeof VueRuntime.normalizeProps = runtime().normalizeProps;
export const normalizeStyle: typeof VueRuntime.normalizeStyle = runtime().normalizeStyle;
export const onActivated: typeof VueRuntime.onActivated = runtime().onActivated;
export const onBeforeMount: typeof VueRuntime.onBeforeMount = runtime().onBeforeMount;
export const onBeforeUnmount: typeof VueRuntime.onBeforeUnmount = runtime().onBeforeUnmount;
export const onBeforeUpdate: typeof VueRuntime.onBeforeUpdate = runtime().onBeforeUpdate;
export const onDeactivated: typeof VueRuntime.onDeactivated = runtime().onDeactivated;
export const onErrorCaptured: typeof VueRuntime.onErrorCaptured = runtime().onErrorCaptured;
export const onMounted: typeof VueRuntime.onMounted = runtime().onMounted;
export const onRenderTracked: typeof VueRuntime.onRenderTracked = runtime().onRenderTracked;
export const onRenderTriggered: typeof VueRuntime.onRenderTriggered = runtime().onRenderTriggered;
export const onScopeDispose: typeof VueRuntime.onScopeDispose = runtime().onScopeDispose;
export const onServerPrefetch: typeof VueRuntime.onServerPrefetch = runtime().onServerPrefetch;
export const onUnmounted: typeof VueRuntime.onUnmounted = runtime().onUnmounted;
export const onUpdated: typeof VueRuntime.onUpdated = runtime().onUpdated;
export const onWatcherCleanup: typeof VueRuntime.onWatcherCleanup = runtime().onWatcherCleanup;
export const openBlock: typeof VueRuntime.openBlock = runtime().openBlock;
export const patchProp: typeof VueRuntime.patchProp = runtime().patchProp;
export const popScopeId: typeof VueRuntime.popScopeId = runtime().popScopeId;
export const provide: typeof VueRuntime.provide = runtime().provide;
export const proxyRefs: typeof VueRuntime.proxyRefs = runtime().proxyRefs;
export const pushScopeId: typeof VueRuntime.pushScopeId = runtime().pushScopeId;
export const queuePostFlushCb: typeof VueRuntime.queuePostFlushCb = runtime().queuePostFlushCb;
export const reactive: typeof VueRuntime.reactive = runtime().reactive;
export const readonly: typeof VueRuntime.readonly = runtime().readonly;
export const ref: typeof VueRuntime.ref = runtime().ref;
export const registerRuntimeCompiler: typeof VueRuntime.registerRuntimeCompiler = runtime().registerRuntimeCompiler;
export const render: typeof VueRuntime.render = runtime().render;
export const renderList: typeof VueRuntime.renderList = runtime().renderList;
export const renderSlot: typeof VueRuntime.renderSlot = runtime().renderSlot;
export const resolveComponent: typeof VueRuntime.resolveComponent = runtime().resolveComponent;
export const resolveDirective: typeof VueRuntime.resolveDirective = runtime().resolveDirective;
export const resolveDynamicComponent: typeof VueRuntime.resolveDynamicComponent = runtime().resolveDynamicComponent;
export const resolveTransitionHooks: typeof VueRuntime.resolveTransitionHooks = runtime().resolveTransitionHooks;
export const setBlockTracking: typeof VueRuntime.setBlockTracking = runtime().setBlockTracking;
export const setDevtoolsHook: typeof VueRuntime.setDevtoolsHook = runtime().setDevtoolsHook;
export const setTransitionHooks: typeof VueRuntime.setTransitionHooks = runtime().setTransitionHooks;
export const shallowReactive: typeof VueRuntime.shallowReactive = runtime().shallowReactive;
export const shallowReadonly: typeof VueRuntime.shallowReadonly = runtime().shallowReadonly;
export const shallowRef: typeof VueRuntime.shallowRef = runtime().shallowRef;
export const ssrContextKey: typeof VueRuntime.ssrContextKey = runtime().ssrContextKey;
export const stop: typeof VueRuntime.stop = runtime().stop;
export const toDisplayString: typeof VueRuntime.toDisplayString = runtime().toDisplayString;
export const toHandlerKey: typeof VueRuntime.toHandlerKey = runtime().toHandlerKey;
export const toHandlers: typeof VueRuntime.toHandlers = runtime().toHandlers;
export const toRaw: typeof VueRuntime.toRaw = runtime().toRaw;
export const toRef: typeof VueRuntime.toRef = runtime().toRef;
export const toRefs: typeof VueRuntime.toRefs = runtime().toRefs;
export const toValue: typeof VueRuntime.toValue = runtime().toValue;
export const transformVNodeArgs: typeof VueRuntime.transformVNodeArgs = runtime().transformVNodeArgs;
export const triggerRef: typeof VueRuntime.triggerRef = runtime().triggerRef;
export const unref: typeof VueRuntime.unref = runtime().unref;
export const useAttrs: typeof VueRuntime.useAttrs = runtime().useAttrs;
export const useCssModule: typeof VueRuntime.useCssModule = runtime().useCssModule;
export const useCssVars: typeof VueRuntime.useCssVars = runtime().useCssVars;
export const useHost: typeof VueRuntime.useHost = runtime().useHost;
export const useId: typeof VueRuntime.useId = runtime().useId;
export const useModel: typeof VueRuntime.useModel = runtime().useModel;
export const useSSRContext: typeof VueRuntime.useSSRContext = runtime().useSSRContext;
export const useShadowRoot: typeof VueRuntime.useShadowRoot = runtime().useShadowRoot;
export const useSlots: typeof VueRuntime.useSlots = runtime().useSlots;
export const useTemplateRef: typeof VueRuntime.useTemplateRef = runtime().useTemplateRef;
export const useTransitionState: typeof VueRuntime.useTransitionState = runtime().useTransitionState;
export const vModelCheckbox: typeof VueRuntime.vModelCheckbox = runtime().vModelCheckbox;
export const vModelDynamic: typeof VueRuntime.vModelDynamic = runtime().vModelDynamic;
export const vModelRadio: typeof VueRuntime.vModelRadio = runtime().vModelRadio;
export const vModelSelect: typeof VueRuntime.vModelSelect = runtime().vModelSelect;
export const vModelText: typeof VueRuntime.vModelText = runtime().vModelText;
export const vShow: typeof VueRuntime.vShow = runtime().vShow;
export const version: typeof VueRuntime.version = runtime().version;
export const warn: typeof VueRuntime.warn = runtime().warn;
export const watch: typeof VueRuntime.watch = runtime().watch;
export const watchEffect: typeof VueRuntime.watchEffect = runtime().watchEffect;
export const watchPostEffect: typeof VueRuntime.watchPostEffect = runtime().watchPostEffect;
export const watchSyncEffect: typeof VueRuntime.watchSyncEffect = runtime().watchSyncEffect;
export const withCtx: typeof VueRuntime.withCtx = runtime().withCtx;
export const withDefaults: typeof VueRuntime.withDefaults = runtime().withDefaults;
export const withDirectives: typeof VueRuntime.withDirectives = runtime().withDirectives;
export const withKeys: typeof VueRuntime.withKeys = runtime().withKeys;
export const withMemo: typeof VueRuntime.withMemo = runtime().withMemo;
export const withModifiers: typeof VueRuntime.withModifiers = runtime().withModifiers;
export const withScopeId: typeof VueRuntime.withScopeId = runtime().withScopeId;

// The type names a plugin author reaches for. Types are erased at runtime —
// these exist so `import type { Component } from "vue"` keeps working inside
// the plugin's own sources. (Names that are values as well as types —
// `EffectScope`, `Fragment` — are already bound above, so they are not
// repeated here.)
export type {
    Component,
    ComputedRef,
    CSSProperties,
    MaybeRef,
    Ref,
    ShallowRef,
    VNode,
    WatchOptions,
    WatchSource,
} from "vue";
