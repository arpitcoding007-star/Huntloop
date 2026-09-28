(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["chunks/1q96_modules_@sentry_opentelemetry_build_esm_asyncContextStrategy-jD8YWNDU_0s5o26l.js",
"[project]/node_modules/@sentry/opentelemetry/build/esm/asyncContextStrategy-jD8YWNDU.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "A",
    ()=>startSpan,
    "B",
    ()=>startSpanManual,
    "C",
    ()=>suppressTracing,
    "D",
    ()=>withActiveSpan,
    "E",
    ()=>wrapClientClass,
    "F",
    ()=>wrapContextManagerClass,
    "G",
    ()=>wrapSamplingDecision,
    "H",
    ()=>buildContextWithSentryScopes,
    "I",
    ()=>SENTRY_SCOPES_CONTEXT_KEY,
    "J",
    ()=>SENTRY_TRACE_STATE_CHILD_IGNORED,
    "S",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_GRAPHQL_OPERATION,
    "a",
    ()=>SentryPropagator,
    "b",
    ()=>SentrySampler,
    "c",
    ()=>SentrySpanProcessor,
    "d",
    ()=>SentryTracerProvider,
    "e",
    ()=>applyOtelSpanData,
    "f",
    ()=>backfillStreamedSpanDataFromOtel,
    "g",
    ()=>continueTrace,
    "h",
    ()=>enhanceDscWithOpenTelemetryRootSpanName,
    "i",
    ()=>getActiveSpan,
    "j",
    ()=>getRequestSpanData,
    "k",
    ()=>getScopesFromContext,
    "l",
    ()=>getSentryResource,
    "m",
    ()=>getSpanKind,
    "n",
    ()=>getTraceContextForScope,
    "o",
    ()=>isSentryRequestSpan,
    "p",
    ()=>openTelemetrySetupCheck,
    "q",
    ()=>setOpenTelemetryContextAsyncContextStrategy,
    "r",
    ()=>setupEventContextTrace,
    "s",
    ()=>setIsSetup,
    "t",
    ()=>spanHasAttributes,
    "u",
    ()=>spanHasEvents,
    "v",
    ()=>spanHasKind,
    "w",
    ()=>spanHasName,
    "x",
    ()=>spanHasParentId,
    "y",
    ()=>spanHasStatus,
    "z",
    ()=>startInactiveSpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/context-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/trace/span_kind.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/context/context.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/trace/trace_flags.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/propagation-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$invalid$2d$span$2d$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/trace/invalid-span-constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/trace/status.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/api/build/esm/trace/spancontext-utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/url.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/version.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$weakRef$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/weakRef.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$isSentryRequestUrl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/isSentryRequestUrl.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/trace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/lru.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracePropagationTargets$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/tracePropagationTargets.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/tracing.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeMathRandom__as__$5f$INTERNAL_safeMathRandom$3e$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript) <export safeMathRandom as _INTERNAL_safeMathRandom>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/handleCallbackErrors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript) <export safeDateNow as _INTERNAL_safeDateNow>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debounce$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/debounce.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/measurement.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$exports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/exports.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$spanKind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/spanKind.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$captureSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/spans/captureSpan.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$hasSpanStreamingEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/spans/hasSpanStreamingEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/defaultScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/logSpans.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/should-ignore-span.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sampling$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/sampling.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__$5f$setSpanForScope__as__$5f$INTERNAL_setSpanForScope$3e$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript) <export _setSpanForScope as _INTERNAL_setSpanForScope>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/tracing/sentryNonRecordingSpan.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/conventions/dist/attributes.mjs [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/sdk-trace/build/esm/Sampler.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$baggage$2f$propagation$2f$W3CBaggagePropagator$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/core/build/esm/baggage/propagation/W3CBaggagePropagator.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/core/build/esm/trace/suppress-tracing.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$platform$2f$browser$2f$sdk$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@opentelemetry/core/build/esm/platform/browser/sdk-info.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
const SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE = "sentry.parentIsRemote";
const SEMANTIC_ATTRIBUTE_SENTRY_GRAPHQL_OPERATION = "sentry.graphql.operation";
function getParentSpanId(span) {
    if ("parentSpanId" in span) {
        return span.parentSpanId;
    } else if ("parentSpanContext" in span) {
        return span.parentSpanContext?.spanId;
    }
    return void 0;
}
function spanHasAttributes(span) {
    const castSpan = span;
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isObjectLike"])(castSpan.attributes);
}
function spanHasKind(span) {
    const castSpan = span;
    return typeof castSpan.kind === "number";
}
function spanHasStatus(span) {
    const castSpan = span;
    return !!castSpan.status;
}
function spanHasName(span) {
    const castSpan = span;
    return !!castSpan.name;
}
function spanHasParentId(span) {
    const castSpan = span;
    return !!getParentSpanId(castSpan);
}
function spanHasEvents(span) {
    const castSpan = span;
    return Array.isArray(castSpan.events);
}
function getRequestSpanData(span) {
    if (!spanHasAttributes(span)) {
        return {};
    }
    const maybeUrlAttribute = span.attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["URL_FULL"]] || span.attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_URL"]];
    const data = {
        url: maybeUrlAttribute,
        // eslint-disable-next-line typescript/no-deprecated
        "http.method": span.attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_REQUEST_METHOD"]] || span.attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_METHOD"]]
    };
    if (!data["http.method"] && data.url) {
        data["http.method"] = "GET";
    }
    try {
        if (typeof maybeUrlAttribute === "string") {
            const url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseUrl"])(maybeUrlAttribute);
            data.url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSanitizedUrlString"])(url);
            if (url.search) {
                data["http.query"] = url.search;
            }
            if (url.hash) {
                data["http.fragment"] = url.hash;
            }
        }
    } catch  {}
    return data;
}
function wrapClientClass(ClientClass) {
    class OpenTelemetryClient extends ClientClass {
        constructor(...args){
            super(...args);
        }
        /** Get the OTEL tracer. */ get tracer() {
            if (this._tracer) {
                return this._tracer;
            }
            const name = "@sentry/opentelemetry";
            const version = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"];
            const tracer = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getTracer(name, version);
            this._tracer = tracer;
            return tracer;
        }
        /**
     * @inheritDoc
     */ async flush(timeout) {
            const provider = this.traceProvider;
            await provider?.forceFlush();
            return super.flush(timeout);
        }
    }
    return OpenTelemetryClient;
}
function getSpanKind(span) {
    if (spanHasKind(span)) {
        return span.kind;
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL;
}
const SENTRY_TRACE_HEADER = "sentry-trace";
const SENTRY_BAGGAGE_HEADER = "baggage";
const SENTRY_TRACE_STATE_DSC = "sentry.dsc";
const SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING = "sentry.sampled_not_recording";
const SENTRY_TRACE_STATE_URL = "sentry.url";
const SENTRY_TRACE_STATE_SAMPLE_RAND = "sentry.sample_rand";
const SENTRY_TRACE_STATE_SAMPLE_RATE = "sentry.sample_rate";
const SENTRY_TRACE_STATE_CHILD_IGNORED = "sentry.ignored";
const SENTRY_TRACE_STATE_SEGMENT_IGNORED = "sentry.segment_ignored";
const SENTRY_SCOPES_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])("sentry_scopes");
const SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])("sentry_fork_isolation_scope");
const SENTRY_FORK_SET_SCOPE_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])("sentry_fork_set_scope");
const SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])("sentry_fork_set_isolation_scope");
const SCOPE_CONTEXT_FIELD = "_scopeContext";
function getScopesFromContext(context) {
    return context.getValue(SENTRY_SCOPES_CONTEXT_KEY);
}
function setScopesOnContext(context, scopes) {
    return context.setValue(SENTRY_SCOPES_CONTEXT_KEY, scopes);
}
function setContextOnScope(scope, context) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(scope, SCOPE_CONTEXT_FIELD, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$weakRef$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makeWeakRef"])(context));
}
function getContextFromScope(scope) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$weakRef$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["derefWeakRef"])(scope[SCOPE_CONTEXT_FIELD]);
}
function isSentryRequestSpan(span) {
    if (!spanHasAttributes(span)) {
        return false;
    }
    const { attributes } = span;
    const httpUrl = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_URL"]] || attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["URL_FULL"]];
    if (!httpUrl) {
        return false;
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$isSentryRequestUrl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSentryRequestUrl"])(httpUrl.toString(), (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])());
}
function getSamplingDecision(spanContext) {
    const { traceFlags, traceState } = spanContext;
    const sampledNotRecording = traceState ? traceState.get(SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING) === "1" : false;
    if (traceFlags === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED) {
        return true;
    }
    if (sampledNotRecording) {
        return false;
    }
    const dscString = traceState ? traceState.get(SENTRY_TRACE_STATE_DSC) : void 0;
    const dsc = dscString ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(dscString) : void 0;
    if (dsc?.sampled === "true") {
        return true;
    }
    if (dsc?.sampled === "false") {
        return false;
    }
    return void 0;
}
function getSampledForPropagation(span, client) {
    const spanContext = span.spanContext();
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
    const samplingDecision = getSamplingDecision(spanContext);
    if (samplingDecision !== void 0) {
        return samplingDecision;
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsIgnored"])(rootSpan)) {
        return false;
    }
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])(client?.getOptions()) || spanContext.isRemote || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsSentrySpan"])(rootSpan)) {
        return void 0;
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsSampled"])(span);
}
function inferSpanData(spanName, attributes, kind) {
    const httpMethod = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_REQUEST_METHOD"]] || attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_METHOD"]];
    if (httpMethod) {
        return descriptionForHttpMethod({
            attributes,
            name: spanName,
            kind
        }, httpMethod);
    }
    const dbSystem = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DB_SYSTEM_NAME"]] || attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DB_SYSTEM"]];
    const opIsCache = typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] === "string" && attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]].startsWith("cache.");
    if (dbSystem && !opIsCache) {
        return descriptionForDbSystem({
            attributes,
            name: spanName
        });
    }
    const customSourceOrRoute = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === "custom" ? "custom" : "route";
    const rpcService = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["RPC_SERVICE"]];
    if (rpcService) {
        return {
            ...getUserUpdatedNameAndSource(spanName, attributes, "route"),
            op: "rpc"
        };
    }
    const messagingSystem = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["MESSAGING_SYSTEM"]];
    if (messagingSystem) {
        return {
            ...getUserUpdatedNameAndSource(spanName, attributes, customSourceOrRoute),
            op: "message"
        };
    }
    const faasTrigger = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["FAAS_TRIGGER"]];
    if (faasTrigger) {
        return {
            ...getUserUpdatedNameAndSource(spanName, attributes, customSourceOrRoute),
            op: faasTrigger.toString()
        };
    }
    return {
        op: void 0,
        description: spanName,
        source: "custom"
    };
}
function parseSpanDescription(span) {
    let attributes;
    let name;
    if (spanHasAttributes(span)) {
        attributes = span.attributes;
        name = spanHasName(span) ? span.name : "<unknown>";
    } else {
        const json = typeof span.spanContext === "function" ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span) : void 0;
        attributes = json?.data || {};
        name = spanHasName(span) ? span.name : json?.description || "<unknown>";
    }
    const kind = getSpanKind(span);
    return inferSpanData(name, attributes, kind);
}
function descriptionForDbSystem({ attributes, name }) {
    const userDefinedName = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    if (typeof userDefinedName === "string") {
        return {
            op: "db",
            description: userDefinedName,
            source: attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] || "custom"
        };
    }
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === "custom") {
        return {
            op: "db",
            description: name,
            source: "custom"
        };
    }
    const statement = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DB_STATEMENT"]];
    const description = statement ? statement.toString() : name;
    return {
        op: "db",
        description,
        source: "task"
    };
}
function descriptionForHttpMethod({ name, kind, attributes }, httpMethod) {
    const opParts = [
        "http"
    ];
    switch(kind){
        case __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].CLIENT:
            opParts.push("client");
            break;
        case __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER:
            opParts.push("server");
            break;
    }
    if (attributes["sentry.http.prefetch"]) {
        opParts.push("prefetch");
    }
    const { urlPath, url, query, fragment, hasRoute } = getSanitizedUrl(attributes, kind);
    if (!urlPath) {
        return {
            ...getUserUpdatedNameAndSource(name, attributes),
            op: opParts.join(".")
        };
    }
    const graphqlOperationsAttribute = attributes[SEMANTIC_ATTRIBUTE_SENTRY_GRAPHQL_OPERATION];
    const baseDescription = `${httpMethod} ${urlPath}`;
    const inferredDescription = graphqlOperationsAttribute ? `${baseDescription} (${getGraphqlOperationNamesFromAttribute(graphqlOperationsAttribute)})` : baseDescription;
    const inferredSource = hasRoute || urlPath === "/" ? "route" : "url";
    const data = {};
    if (url) {
        data.url = url;
    }
    if (query) {
        data["http.query"] = query.slice(1);
    }
    if (fragment) {
        data["http.fragment"] = fragment.slice(1);
    }
    const isClientOrServerKind = kind === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].CLIENT || kind === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER;
    const origin = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]] || "manual";
    const isManualSpan = !`${origin}`.startsWith("auto");
    const alreadyHasCustomSource = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === "custom";
    const customSpanName = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    const useInferredDescription = !alreadyHasCustomSource && customSpanName == null && (isClientOrServerKind || !isManualSpan);
    const { description, source } = useInferredDescription ? {
        description: inferredDescription,
        source: inferredSource
    } : getUserUpdatedNameAndSource(name, attributes);
    return {
        op: opParts.join("."),
        description,
        source,
        data
    };
}
function getGraphqlOperationNamesFromAttribute(attr) {
    if (Array.isArray(attr)) {
        const sorted = attr.slice().sort();
        if (sorted.length <= 5) {
            return sorted.join(", ");
        } else {
            return `${sorted.slice(0, 5).join(", ")}, +${sorted.length - 5}`;
        }
    }
    return `${attr}`;
}
function getSanitizedUrl(attributes, kind) {
    const httpTarget = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_TARGET"]];
    const httpUrl = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_URL"]] || attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["URL_FULL"]];
    const httpRoute = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_ROUTE"]];
    const parsedUrl = typeof httpUrl === "string" ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseUrl"])(httpUrl) : void 0;
    const url = parsedUrl ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSanitizedUrlString"])(parsedUrl) : void 0;
    const query = parsedUrl?.search || void 0;
    const fragment = parsedUrl?.hash || void 0;
    if (typeof httpRoute === "string") {
        return {
            urlPath: httpRoute,
            url,
            query,
            fragment,
            hasRoute: true
        };
    }
    if (kind === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER && typeof httpTarget === "string") {
        return {
            urlPath: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripUrlQueryAndFragment"])(httpTarget),
            url,
            query,
            fragment,
            hasRoute: false
        };
    }
    if (parsedUrl) {
        return {
            urlPath: url,
            url,
            query,
            fragment,
            hasRoute: false
        };
    }
    if (typeof httpTarget === "string") {
        return {
            urlPath: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripUrlQueryAndFragment"])(httpTarget),
            url,
            query,
            fragment,
            hasRoute: false
        };
    }
    return {
        urlPath: void 0,
        url,
        query,
        fragment,
        hasRoute: false
    };
}
function getUserUpdatedNameAndSource(originalName, attributes, fallbackSource = "custom") {
    const source = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] || fallbackSource;
    const description = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    if (description && typeof description === "string") {
        return {
            description,
            source
        };
    }
    return {
        description: originalName,
        source
    };
}
function enhanceDscWithOpenTelemetryRootSpanName(client) {
    client.on("createDsc", (dsc, rootSpan)=>{
        if (!rootSpan) {
            return;
        }
        const jsonSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(rootSpan);
        const attributes = jsonSpan.data;
        const source = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]];
        const sampled = getSampledForPropagation(rootSpan, client);
        if (sampled === false) {
            delete dsc.transaction;
        } else if (jsonSpan.description) {
            const { description } = parseSpanDescription(rootSpan);
            if (source !== "url" && description) {
                dsc.transaction = description;
            }
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
            dsc.sampled = sampled == void 0 ? void 0 : String(sampled);
        }
    });
}
function getActiveSpan() {
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getActiveSpan();
}
const DEBUG_BUILD = typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__;
class TraceState {
    constructor(){
        this._internalState = /* @__PURE__ */ new Map();
    }
    /** @inheritDoc */ set(key, value) {
        const next = this._clone();
        if (next._internalState.has(key)) {
            next._internalState.delete(key);
        }
        next._internalState.set(key, value);
        return next;
    }
    /** @inheritDoc */ unset(key) {
        const next = this._clone();
        next._internalState.delete(key);
        return next;
    }
    /** @inheritDoc */ get(key) {
        return this._internalState.get(key);
    }
    /** @inheritDoc */ serialize() {
        return Array.from(this._internalState.keys()).reverse().map((key)=>`${key}=${this._internalState.get(key)}`).join(",");
    }
    _clone() {
        const next = new TraceState();
        next._internalState = new Map(this._internalState);
        return next;
    }
}
function makeTraceState({ dsc, sampled }) {
    const dscString = dsc ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dynamicSamplingContextToSentryBaggageHeader"])(dsc) : void 0;
    const traceStateBase = new TraceState();
    const traceStateWithDsc = dscString ? traceStateBase.set(SENTRY_TRACE_STATE_DSC, dscString) : traceStateBase;
    return sampled === false ? traceStateWithDsc.set(SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING, "1") : traceStateWithDsc;
}
const setupElements = /* @__PURE__ */ new Set();
function openTelemetrySetupCheck() {
    return Array.from(setupElements);
}
function setIsSetup(element) {
    setupElements.add(element);
}
class SentryPropagator extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$baggage$2f$propagation$2f$W3CBaggagePropagator$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["W3CBaggagePropagator"] {
    constructor(){
        super();
        setIsSetup("SentryPropagator");
        this._urlMatchesTargetsMap = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["LRUMap"](100);
    }
    /**
   * @inheritDoc
   */ inject(context2, carrier, setter) {
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isTracingSuppressed"])(context2)) {
            DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log("[Tracing] Not injecting trace data for url because tracing is suppressed.");
            return;
        }
        const activeSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context2);
        const url = activeSpan && getCurrentURL(activeSpan);
        const { tracePropagationTargets, propagateTraceparent } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])()?.getOptions() || {};
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracePropagationTargets$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldPropagateTraceForUrl"])(url, tracePropagationTargets, this._urlMatchesTargetsMap)) {
            DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log("[Tracing] Not injecting trace data for url because it does not match tracePropagationTargets:", url);
            return;
        }
        const existingBaggageHeader = getExistingBaggage(carrier);
        const existingSentryTraceHeader = getExistingSentryTrace(carrier);
        let baggage = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].getBaggage(context2) || __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].createBaggage({});
        const { dynamicSamplingContext, traceId, spanId, sampled } = getInjectionData(context2);
        if (existingBaggageHeader) {
            const baggageEntries = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseBaggageHeader"])(existingBaggageHeader);
            if (baggageEntries) {
                Object.entries(baggageEntries).forEach(([key, value])=>{
                    if (!existingSentryTraceHeader && key.startsWith(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BAGGAGE_KEY_PREFIX"])) {
                        return;
                    }
                    baggage = baggage.setEntry(key, {
                        value
                    });
                });
            }
        }
        if (!existingSentryTraceHeader && dynamicSamplingContext) {
            baggage = Object.entries(dynamicSamplingContext).reduce((b, [dscKey, dscValue])=>{
                if (dscValue) {
                    return b.setEntry(`${__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BAGGAGE_KEY_PREFIX"]}${dscKey}`, {
                        value: dscValue
                    });
                }
                return b;
            }, baggage);
        }
        if (!existingSentryTraceHeader && traceId && traceId !== __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$invalid$2d$span$2d$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["INVALID_TRACEID"]) {
            setter.set(carrier, SENTRY_TRACE_HEADER, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSentryTraceHeader"])(traceId, spanId, sampled));
            if (propagateTraceparent) {
                setter.set(carrier, "traceparent", (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceparentHeader"])(traceId, spanId, sampled));
            }
        }
        super.inject(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].setBaggage(context2, baggage), carrier, setter);
    }
    /**
   * @inheritDoc
   */ extract(context2, carrier, getter) {
        const maybeSentryTraceHeader = getter.get(carrier, SENTRY_TRACE_HEADER);
        const baggage = getter.get(carrier, SENTRY_BAGGAGE_HEADER);
        const sentryTrace = maybeSentryTraceHeader ? Array.isArray(maybeSentryTraceHeader) ? maybeSentryTraceHeader[0] : maybeSentryTraceHeader : void 0;
        return ensureScopesOnContext(getContextWithRemoteActiveSpan(context2, {
            sentryTrace,
            baggage
        }));
    }
    /**
   * @inheritDoc
   */ fields() {
        return [
            SENTRY_TRACE_HEADER,
            SENTRY_BAGGAGE_HEADER,
            "traceparent"
        ];
    }
}
function getInjectionData(context2, options = {}) {
    const span = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context2);
    if (span?.spanContext().isRemote) {
        const spanContext = span.spanContext();
        const dynamicSamplingContext2 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span);
        return {
            dynamicSamplingContext: dynamicSamplingContext2,
            traceId: spanContext.traceId,
            spanId: void 0,
            sampled: getSamplingDecision(spanContext)
        };
    }
    if (span) {
        const spanContext = span.spanContext();
        const dynamicSamplingContext2 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span);
        return {
            dynamicSamplingContext: dynamicSamplingContext2,
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            sampled: getSampledForPropagation(span, options.client)
        };
    }
    const scope = options.scope || getScopesFromContext(context2)?.scope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const client = options.client || (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const propagationContext = scope.getPropagationContext();
    const dynamicSamplingContext = client ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromScope"])(client, scope) : void 0;
    return {
        dynamicSamplingContext,
        traceId: propagationContext.traceId,
        spanId: propagationContext.propagationSpanId,
        sampled: propagationContext.sampled
    };
}
function getContextWithRemoteActiveSpan(ctx, { sentryTrace, baggage }) {
    const propagationContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagationContextFromHeaders"])(sentryTrace, baggage);
    const { traceId, parentSpanId, sampled, dsc } = propagationContext;
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const incomingDsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(baggage);
    if (!parentSpanId || client && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldContinueTrace"])(client, incomingDsc?.org_id)) {
        return ctx;
    }
    const spanContext = generateRemoteSpanContext({
        traceId,
        spanId: parentSpanId,
        sampled,
        dsc
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpanContext(ctx, spanContext);
}
function continueTraceAsRemoteSpan(ctx, options, callback) {
    const ctxWithSpanContext = ensureScopesOnContext(getContextWithRemoteActiveSpan(ctx, options));
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctxWithSpanContext, callback);
}
function ensureScopesOnContext(ctx) {
    const scopes = getScopesFromContext(ctx);
    const newScopes = {
        // If we have no scope here, this is most likely either the root context or a context manually derived from it
        // In this case, we want to fork the current scope, to ensure we do not pollute the root scope
        scope: scopes ? scopes.scope : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().clone(),
        isolationScope: scopes ? scopes.isolationScope : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])()
    };
    return setScopesOnContext(ctx, newScopes);
}
function getExistingBaggage(carrier) {
    try {
        const baggage = carrier[SENTRY_BAGGAGE_HEADER];
        return Array.isArray(baggage) ? baggage.join(",") : baggage;
    } catch  {
        return void 0;
    }
}
function getExistingSentryTrace(carrier) {
    try {
        return carrier[SENTRY_TRACE_HEADER];
    } catch  {
        return void 0;
    }
}
function getCurrentURL(span) {
    const spanData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span).data;
    const urlAttribute = spanData[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_URL"]] || spanData[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["URL_FULL"]];
    if (typeof urlAttribute === "string") {
        return urlAttribute;
    }
    const urlTraceState = span.spanContext().traceState?.get(SENTRY_TRACE_STATE_URL);
    if (urlTraceState) {
        return urlTraceState;
    }
    return void 0;
}
function generateRemoteSpanContext({ spanId, traceId, sampled, dsc }) {
    const traceState = makeTraceState({
        dsc,
        sampled
    });
    const spanContext = {
        traceId,
        spanId,
        isRemote: true,
        traceFlags: sampled ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].NONE,
        traceState
    };
    return spanContext;
}
function _startSpan(options, callback, autoEnd) {
    const tracer = getTracer();
    const { name, parentSpan: customParentSpan } = options;
    const wrapper = getActiveSpanWrapper(customParentSpan);
    return wrapper(()=>{
        const activeCtx = getContext(options.scope, options.forceTransaction);
        const missingRequiredParent = options.onlyIfParent && !__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(activeCtx);
        const ctx = missingRequiredParent ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["suppressTracing"])(activeCtx) : activeCtx;
        if (missingRequiredParent) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])()?.recordDroppedEvent("no_parent_span", "span");
        }
        const spanOptions = getSpanOptions(options);
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
            const suppressedCtx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isTracingSuppressed"])(ctx) ? ctx : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["suppressTracing"])(ctx);
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(suppressedCtx, ()=>{
                return tracer.startActiveSpan(name, spanOptions, suppressedCtx, (span)=>{
                    patchSpanEnd(span);
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(activeCtx, ()=>{
                        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["handleCallbackErrors"])(()=>callback(span), ()=>{
                            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span).status === void 0) {
                                span.setStatus({
                                    code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].ERROR
                                });
                            }
                        }, autoEnd ? ()=>span.end() : void 0);
                    });
                });
            });
        }
        return tracer.startActiveSpan(name, spanOptions, ctx, (span)=>{
            patchSpanEnd(span);
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["handleCallbackErrors"])(()=>callback(span), ()=>{
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span).status === void 0) {
                    span.setStatus({
                        code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].ERROR
                    });
                }
            }, autoEnd ? ()=>span.end() : void 0);
        });
    });
}
function startSpan(options, callback) {
    return _startSpan(options, callback, true);
}
function startSpanManual(options, callback) {
    return _startSpan(options, (span)=>callback(span, ()=>span.end()), false);
}
function startInactiveSpan(options) {
    const tracer = getTracer();
    const { name, parentSpan: customParentSpan } = options;
    const wrapper = getActiveSpanWrapper(customParentSpan);
    return wrapper(()=>{
        const activeCtx = getContext(options.scope, options.forceTransaction);
        const missingRequiredParent = options.onlyIfParent && !__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(activeCtx);
        let ctx = missingRequiredParent ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["suppressTracing"])(activeCtx) : activeCtx;
        if (missingRequiredParent) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])()?.recordDroppedEvent("no_parent_span", "span");
        }
        const spanOptions = getSpanOptions(options);
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
            ctx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isTracingSuppressed"])(ctx) ? ctx : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["suppressTracing"])(ctx);
        }
        const span = tracer.startSpan(name, spanOptions, ctx);
        patchSpanEnd(span);
        return span;
    });
}
function withActiveSpan(span, callback) {
    const newContextWithActiveSpan = span ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), span) : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].deleteSpan(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active());
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(newContextWithActiveSpan, ()=>callback((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])()));
}
function getTracer() {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    return client?.tracer || __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getTracer("@sentry/opentelemetry", __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]);
}
function getSpanOptions(options) {
    const { startTime, attributes, kind, op, links } = options;
    const fixedStartTime = typeof startTime === "number" ? ensureTimestampInMilliseconds(startTime) : startTime;
    return {
        attributes: op ? {
            [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
            ...attributes
        } : attributes,
        kind,
        links,
        startTime: fixedStartTime
    };
}
function ensureTimestampInMilliseconds(timestamp) {
    const isMs = timestamp < 9999999999;
    return isMs ? timestamp * 1e3 : timestamp;
}
function patchSpanEnd(span) {
    const originalEnd = span.end.bind(span);
    span.end = (endTime)=>{
        return originalEnd(typeof endTime === "number" ? ensureTimestampInMilliseconds(endTime) : endTime);
    };
}
function getContext(scope, forceTransaction) {
    const ctx = getContextForScope(scope);
    const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(ctx);
    if (!parentSpan) {
        return ctx;
    }
    if (!forceTransaction) {
        return ctx;
    }
    const ctxWithoutSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].deleteSpan(ctx);
    const { spanId, traceId } = parentSpan.spanContext();
    const sampled = getSamplingDecision(parentSpan.spanContext());
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(parentSpan);
    const dsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(rootSpan);
    const traceState = makeTraceState({
        dsc,
        sampled
    });
    const spanOptions = {
        traceId,
        spanId,
        isRemote: true,
        traceFlags: sampled ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].NONE,
        traceState
    };
    const ctxWithSpanContext = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpanContext(ctxWithoutSpan, spanOptions);
    return ctxWithSpanContext;
}
function getContextForScope(scope) {
    if (scope) {
        const ctx = getContextFromScope(scope);
        if (ctx) {
            return ctx;
        }
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
}
function continueTrace(options, callback) {
    return continueTraceAsRemoteSpan(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), options, callback);
}
function startNewTrace(callback) {
    const traceId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])();
    const spanId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])();
    const spanContext = {
        traceId,
        spanId,
        isRemote: true,
        traceFlags: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].NONE
    };
    const ctxWithTrace = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpanContext(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), spanContext);
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctxWithTrace, ()=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().setPropagationContext({
            traceId,
            sampleRand: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeMathRandom__as__$5f$INTERNAL_safeMathRandom$3e$__["_INTERNAL_safeMathRandom"])()
        });
        return callback();
    });
}
function getTraceContextForScope(client, scope) {
    const ctx = getContextFromScope(scope);
    const span = ctx && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(ctx);
    const traceContext = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceContext"])(span) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getTraceContextFromScope"])(scope);
    const dynamicSamplingContext = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromScope"])(client, scope);
    return [
        dynamicSamplingContext,
        traceContext
    ];
}
function getActiveSpanWrapper(parentSpan) {
    return parentSpan !== void 0 ? (callback)=>{
        return withActiveSpan(parentSpan, callback);
    } : (callback)=>callback();
}
function suppressTracing(callback) {
    const ctx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["suppressTracing"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active());
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx, callback);
}
function isTracingSuppressed(scope) {
    const ctx = scope ? getContextFromScope(scope) : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
    return ctx ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isTracingSuppressed"])(ctx) : false;
}
function setupEventContextTrace(client) {
    client.on("preprocessEvent", (event)=>{
        const span = getActiveSpan();
        if (!span || event.type === "transaction") {
            return;
        }
        event.contexts = {
            trace: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceContext"])(span),
            ...event.contexts
        };
        const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
        event.sdkProcessingMetadata = {
            dynamicSamplingContext: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(rootSpan),
            ...event.sdkProcessingMetadata
        };
        return event;
    });
}
function buildContextWithSentryScopes(context, activeContext) {
    const span = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
    let effectiveContext;
    if (span?.spanContext().traceState?.get(SENTRY_TRACE_STATE_CHILD_IGNORED) === "1") {
        const contextWithoutSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].deleteSpan(context);
        const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(activeContext);
        effectiveContext = parentSpan ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(contextWithoutSpan, parentSpan) : contextWithoutSpan;
    } else {
        effectiveContext = context;
    }
    const currentScopes = getScopesFromContext(effectiveContext);
    const currentScope = currentScopes?.scope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const currentIsolationScope = currentScopes?.isolationScope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
    const shouldForkIsolationScope = effectiveContext.getValue(SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY) === true;
    const scope = effectiveContext.getValue(SENTRY_FORK_SET_SCOPE_CONTEXT_KEY);
    const isolationScope = effectiveContext.getValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY);
    const newCurrentScope = scope || currentScope.clone();
    const newIsolationScope = isolationScope || (shouldForkIsolationScope ? currentIsolationScope.clone() : currentIsolationScope);
    const scopes = {
        scope: newCurrentScope,
        isolationScope: newIsolationScope
    };
    const ctx1 = setScopesOnContext(effectiveContext, scopes);
    const ctx2 = ctx1.deleteValue(SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY).deleteValue(SENTRY_FORK_SET_SCOPE_CONTEXT_KEY).deleteValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY);
    setContextOnScope(newCurrentScope, ctx2);
    return ctx2;
}
function wrapContextManagerClass(ContextManagerClass) {
    class SentryContextManager extends ContextManagerClass {
        constructor(...args){
            super(...args);
            setIsSetup("SentryContextManager");
        }
        /**
     * Overwrite with() of the original AsyncLocalStorageContextManager
     * to ensure we also create new scopes per context.
     */ with(context, fn, thisArg, ...args) {
            const ctx2 = buildContextWithSentryScopes(context, this.active());
            return super.with(ctx2, fn, thisArg, ...args);
        }
        /**
     * Gets underlying AsyncLocalStorage and symbol to allow lookup of scope.
     */ getAsyncLocalStorageLookup() {
            return {
                // @ts-expect-error This is on the base class, but not part of the interface
                asyncLocalStorage: this._asyncLocalStorage,
                contextSymbol: SENTRY_SCOPES_CONTEXT_KEY
            };
        }
    }
    return SentryContextManager;
}
function groupSpansWithParents(spans) {
    const nodeMap = /* @__PURE__ */ new Map();
    for (const span of spans){
        createOrUpdateSpanNodeAndRefs(nodeMap, span);
    }
    return Array.from(nodeMap, function([_id, spanNode]) {
        return spanNode;
    });
}
function getLocalParentId(span) {
    const parentIsRemote = span.attributes[SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE] === true;
    return !parentIsRemote ? getParentSpanId(span) : void 0;
}
function createOrUpdateSpanNodeAndRefs(nodeMap, span) {
    const id = span.spanContext().spanId;
    const parentId = getLocalParentId(span);
    if (!parentId) {
        createOrUpdateNode(nodeMap, {
            id,
            span,
            children: []
        });
        return;
    }
    const parentNode = createOrGetParentNode(nodeMap, parentId);
    const node = createOrUpdateNode(nodeMap, {
        id,
        span,
        parentNode,
        children: []
    });
    parentNode.children.push(node);
}
function createOrGetParentNode(nodeMap, id) {
    const existing = nodeMap.get(id);
    if (existing) {
        return existing;
    }
    return createOrUpdateNode(nodeMap, {
        id,
        children: []
    });
}
function createOrUpdateNode(nodeMap, spanNode) {
    const existing = nodeMap.get(spanNode.id);
    if (existing?.span) {
        return existing;
    }
    if (existing && !existing.span) {
        existing.span = spanNode.span;
        existing.parentNode = spanNode.parentNode;
        return existing;
    }
    nodeMap.set(spanNode.id, spanNode);
    return spanNode;
}
const canonicalGrpcErrorCodesMap = {
    "1": "cancelled",
    "2": "unknown_error",
    "3": "invalid_argument",
    "4": "deadline_exceeded",
    "5": "not_found",
    "6": "already_exists",
    "7": "permission_denied",
    "8": "resource_exhausted",
    "9": "failed_precondition",
    "10": "aborted",
    "11": "out_of_range",
    "12": "unimplemented",
    "13": "internal_error",
    "14": "unavailable",
    "15": "data_loss",
    "16": "unauthenticated"
};
const isStatusErrorMessageValid = (message)=>{
    return Object.values(canonicalGrpcErrorCodesMap).includes(message);
};
function mapStatus(span) {
    const attributes = spanHasAttributes(span) ? span.attributes : {};
    const status = spanHasStatus(span) ? span.status : void 0;
    if (status) {
        if (status.code === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].OK) {
            return {
                code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_OK"]
            };
        } else if (status.code === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].ERROR) {
            if (typeof status.message === "undefined") {
                const inferredStatus2 = inferStatusFromAttributes(attributes);
                if (inferredStatus2) {
                    return inferredStatus2;
                }
            }
            if (status.message && isStatusErrorMessageValid(status.message)) {
                return {
                    code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                    message: status.message
                };
            } else {
                return {
                    code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                    message: "internal_error"
                };
            }
        }
    }
    const inferredStatus = inferStatusFromAttributes(attributes);
    if (inferredStatus) {
        return inferredStatus;
    }
    if (status?.code === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].UNSET) {
        return {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_OK"]
        };
    } else {
        return {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
            message: "unknown_error"
        };
    }
}
function inferStatusFromAttributes(attributes) {
    const httpCodeAttribute = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_RESPONSE_STATUS_CODE"]] || attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_STATUS_CODE"]];
    const grpcCodeAttribute = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["RPC_GRPC_STATUS_CODE"]];
    const numberHttpCode = typeof httpCodeAttribute === "number" ? httpCodeAttribute : typeof httpCodeAttribute === "string" ? parseInt(httpCodeAttribute) : void 0;
    if (typeof numberHttpCode === "number") {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSpanStatusFromHttpCode"])(numberHttpCode);
    }
    if (typeof grpcCodeAttribute === "string") {
        return {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
            message: canonicalGrpcErrorCodesMap[grpcCodeAttribute] || "unknown_error"
        };
    }
    return void 0;
}
const MAX_SPAN_COUNT = 1e3;
const DEFAULT_TIMEOUT = 300;
const SENT_SPANS_MAX_SIZE = 1e4;
class SentrySpanExporter {
    constructor(options){
        this._finishedSpanBucketSize = options?.timeout || DEFAULT_TIMEOUT;
        this._finishedSpanBuckets = new Array(this._finishedSpanBucketSize).fill(void 0);
        this._lastCleanupTimestampInS = Math.floor((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__["_INTERNAL_safeDateNow"])() / 1e3);
        this._spansToBucketEntry = /* @__PURE__ */ new WeakMap();
        this._sentSpans = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["LRUMap"](SENT_SPANS_MAX_SIZE);
        this._debouncedFlush = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debounce$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debounce"])(this.flush.bind(this), 1, {
            maxWait: 100
        });
    }
    /**
   * Export a single span.
   * This is called by the span processor whenever a span is ended.
   */ export(span) {
        const currentTimestampInS = Math.floor((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__["_INTERNAL_safeDateNow"])() / 1e3);
        if (this._lastCleanupTimestampInS !== currentTimestampInS) {
            let droppedSpanCount = 0;
            this._finishedSpanBuckets.forEach((bucket, i)=>{
                if (bucket && bucket.timestampInS <= currentTimestampInS - this._finishedSpanBucketSize) {
                    droppedSpanCount += bucket.spans.size;
                    this._finishedSpanBuckets[i] = void 0;
                }
            });
            if (droppedSpanCount > 0) {
                DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`SpanExporter dropped ${droppedSpanCount} spans because they were pending for more than ${this._finishedSpanBucketSize} seconds.`);
            }
            this._lastCleanupTimestampInS = currentTimestampInS;
        }
        const currentBucketIndex = currentTimestampInS % this._finishedSpanBucketSize;
        const currentBucket = this._finishedSpanBuckets[currentBucketIndex] || {
            timestampInS: currentTimestampInS,
            spans: /* @__PURE__ */ new Set()
        };
        this._finishedSpanBuckets[currentBucketIndex] = currentBucket;
        currentBucket.spans.add(span);
        this._spansToBucketEntry.set(span, currentBucket);
        const localParentId = getLocalParentId(span);
        if (!localParentId || this._sentSpans.get(localParentId)) {
            this._debouncedFlush();
        }
    }
    /**
   * Try to flush any pending spans immediately.
   * This is called internally by the exporter (via _debouncedFlush),
   * but can also be triggered externally if we force-flush.
   */ flush() {
        const finishedSpans = this._finishedSpanBuckets.flatMap((bucket)=>bucket ? Array.from(bucket.spans) : []);
        const sentSpans = this._maybeSend(finishedSpans);
        const sentSpanCount = sentSpans.size;
        const remainingOpenSpanCount = finishedSpans.length - sentSpanCount;
        DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`SpanExporter exported ${sentSpanCount} spans, ${remainingOpenSpanCount} spans are waiting for their parent spans to finish`);
        for (const span of sentSpans){
            this._sentSpans.set(span.spanContext().spanId, 1);
            const bucketEntry = this._spansToBucketEntry.get(span);
            if (bucketEntry) {
                bucketEntry.spans.delete(span);
            }
        }
        this._debouncedFlush.cancel();
    }
    /**
   * Clear the exporter.
   * This is called when the span processor is shut down.
   */ clear() {
        this._finishedSpanBuckets = this._finishedSpanBuckets.fill(void 0);
        this._sentSpans.clear();
        this._debouncedFlush.cancel();
    }
    /**
   * Send the given spans, but only if they are part of a finished transaction.
   *
   * Returns the sent spans.
   * Spans remain unsent when their parent span is not yet finished.
   * This will happen regularly, as child spans are generally finished before their parents.
   * But it _could_ also happen because, for whatever reason, a parent span was lost.
   * In this case, we'll eventually need to clean this up.
   */ _maybeSend(spans) {
        const grouped = groupSpansWithParents(spans);
        const sentSpans = /* @__PURE__ */ new Set();
        const rootNodes = this._getCompletedRootNodes(grouped);
        for (const root of rootNodes){
            const span = root.span;
            sentSpans.add(span);
            const transactionEvent = createTransactionForOtelSpan(span);
            if (root.parentNode && this._sentSpans.get(root.parentNode.id)) {
                const traceData = transactionEvent.contexts?.trace?.data;
                if (traceData) {
                    traceData["sentry.parent_span_already_sent"] = true;
                }
            }
            const spans2 = transactionEvent.spans || [];
            let hasGenAiSpans = false;
            for (const child of root.children){
                if (createAndFinishSpanForOtelSpan(child, spans2, sentSpans)) {
                    hasGenAiSpans = true;
                }
            }
            transactionEvent.spans = spans2.length > MAX_SPAN_COUNT ? spans2.sort((a, b)=>a.start_timestamp - b.start_timestamp).slice(0, MAX_SPAN_COUNT) : spans2;
            if (hasGenAiSpans) {
                transactionEvent.sdkProcessingMetadata = {
                    ...transactionEvent.sdkProcessingMetadata,
                    hasGenAiSpans: true
                };
            }
            const measurements = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timedEventsToMeasurements"])(span.events);
            if (measurements) {
                transactionEvent.measurements = measurements;
            }
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$exports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["captureEvent"])(transactionEvent);
        }
        return sentSpans;
    }
    /** Check if a node is a completed root node or a node whose parent has already been sent */ _nodeIsCompletedRootNodeOrHasSentParent(node) {
        return !!node.span && (!node.parentNode || !!this._sentSpans.get(node.parentNode.id));
    }
    /** Get all completed root nodes from a list of nodes */ _getCompletedRootNodes(nodes) {
        return nodes.filter((node)=>this._nodeIsCompletedRootNodeOrHasSentParent(node));
    }
}
function parseSpan(span) {
    const attributes = span.attributes;
    const origin = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]];
    const op = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]];
    const source = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]];
    return {
        origin,
        op,
        source
    };
}
function createTransactionForOtelSpan(span) {
    const { op, description, data, origin = "manual", source } = getSpanData(span);
    const capturedSpanScopes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(span);
    const sampleRate = span.attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]];
    const attributes = {
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: source,
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]]: sampleRate,
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: origin,
        ...data,
        ...removeSentryAttributes(span.attributes)
    };
    const { links } = span;
    const { traceId: trace_id, spanId: span_id } = span.spanContext();
    const parent_span_id = getParentSpanId(span);
    const status = mapStatus(span);
    const traceContext = {
        parent_span_id,
        span_id,
        trace_id,
        data: attributes,
        origin,
        op,
        status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getStatusMessage"])(status),
        // As per protocol, span status is allowed to be undefined
        links: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertSpanLinksForEnvelope"])(links)
    };
    const statusCode = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_RESPONSE_STATUS_CODE"]];
    const responseContext = typeof statusCode === "number" ? {
        response: {
            status_code: statusCode
        }
    } : void 0;
    const transactionEvent = {
        contexts: {
            trace: traceContext,
            otel: {
                resource: span.resource.attributes
            },
            ...responseContext
        },
        spans: [],
        start_timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(span.startTime),
        timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(span.endTime),
        transaction: description,
        type: "transaction",
        sdkProcessingMetadata: {
            capturedSpanScope: capturedSpanScopes.scope,
            capturedSpanIsolationScope: capturedSpanScopes.isolationScope,
            sampleRate,
            dynamicSamplingContext: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span)
        },
        ...source && {
            transaction_info: {
                source
            }
        }
    };
    return transactionEvent;
}
function createAndFinishSpanForOtelSpan(node, spans, sentSpans) {
    const span = node.span;
    if (span) {
        sentSpans.add(span);
    }
    const shouldDrop = !span;
    if (shouldDrop) {
        let hasGenAiSpans2 = false;
        node.children.forEach((child)=>{
            if (createAndFinishSpanForOtelSpan(child, spans, sentSpans)) {
                hasGenAiSpans2 = true;
            }
        });
        return hasGenAiSpans2;
    }
    const span_id = span.spanContext().spanId;
    const trace_id = span.spanContext().traceId;
    const parentSpanId = getParentSpanId(span);
    const { attributes, startTime, endTime, links } = span;
    const { op, description, data, origin = "manual" } = getSpanData(span);
    const allData = {
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: origin,
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
        ...removeSentryAttributes(attributes),
        ...data
    };
    const status = mapStatus(span);
    const spanJSON = {
        span_id,
        trace_id,
        data: allData,
        description,
        parent_span_id: parentSpanId,
        start_timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(startTime),
        // This is [0,0] by default in OTEL, in which case we want to interpret this as no end time
        timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(endTime) || void 0,
        status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getStatusMessage"])(status),
        // As per protocol, span status is allowed to be undefined
        op,
        origin,
        measurements: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timedEventsToMeasurements"])(span.events),
        links: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertSpanLinksForEnvelope"])(links)
    };
    spans.push(spanJSON);
    let hasGenAiSpans = !!op?.startsWith("gen_ai.");
    node.children.forEach((child)=>{
        if (createAndFinishSpanForOtelSpan(child, spans, sentSpans)) {
            hasGenAiSpans = true;
        }
    });
    return hasGenAiSpans;
}
function getSpanData(span) {
    const { op: definedOp, source: definedSource, origin } = parseSpan(span);
    const { op: inferredOp, description, source: inferredSource, data: inferredData } = parseSpanDescription(span);
    const op = definedOp || inferredOp;
    const source = definedSource || inferredSource;
    const data = {
        ...inferredData,
        ...getData(span)
    };
    return {
        op,
        description,
        source,
        origin,
        data
    };
}
function removeSentryAttributes(data) {
    const cleanedData = {
        ...data
    };
    delete cleanedData[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]];
    delete cleanedData[SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE];
    delete cleanedData[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    return cleanedData;
}
function getData(span) {
    const attributes = span.attributes;
    const data = {};
    if (span.kind !== __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL) {
        data["otel.kind"] = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"][span.kind];
    }
    const maybeHttpStatusCodeAttribute = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_STATUS_CODE"]];
    if (maybeHttpStatusCodeAttribute) {
        data[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_RESPONSE_STATUS_CODE"]] = maybeHttpStatusCodeAttribute;
    }
    const requestData = getRequestSpanData(span);
    if (requestData.url) {
        data.url = requestData.url;
    }
    if (requestData["http.query"]) {
        data["http.query"] = requestData["http.query"].slice(1);
    }
    if (requestData["http.fragment"]) {
        data["http.fragment"] = requestData["http.fragment"].slice(1);
    }
    return data;
}
function backfillStreamedSpanDataFromOtel(spanJSON, hint) {
    const attributes = spanJSON.attributes ?? {};
    const kind = hint?.spanKind ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$spanKind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_KIND"].INTERNAL;
    const { op, description, source, data } = inferSpanData(spanJSON.name, attributes, kind);
    spanJSON.name = description;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$captureSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeSetSpanJSONAttributes"])(spanJSON, {
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: source,
        // If nothing in the chain previously set an origin, we now default it to 'manual'
        // For transactions, this is done in the SpanExporter.
        // TODO (v11): Remove this again once we fully moved away from OTel's TracerProvider.
        // at this point, we use `SentrySpan` everywhere, which defaults its origin to 'manual'.
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_ORIGIN"]]: "manual",
        ...data
    });
    if (kind !== __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$spanKind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_KIND"].INTERNAL) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$captureSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeSetSpanJSONAttributes"])(spanJSON, {
            "otel.kind": (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$spanKind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanKindToName"])(kind)
        });
    }
}
class SentrySpanProcessor {
    constructor(options){
        this._unsubscribePreprocessSpan = void 0;
        setIsSetup("SentrySpanProcessor");
        this._exporter = new SentrySpanExporter(options);
        this._client = options?.client ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
        if (this._client && (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$hasSpanStreamingEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpanStreamingEnabled"])(this._client)) {
            this._unsubscribePreprocessSpan = this._client.on("preprocessSpan", backfillStreamedSpanDataFromOtel);
        }
    }
    /**
   * @inheritDoc
   */ async forceFlush() {
        this._exporter.flush();
    }
    /**
   * @inheritDoc
   */ async shutdown() {
        this._unsubscribePreprocessSpan?.();
        this._exporter.clear();
    }
    /**
   * @inheritDoc
   */ onStart(span, parentContext) {
        const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(parentContext);
        let scopes = getScopesFromContext(parentContext);
        if (parentSpan && !parentSpan.spanContext().isRemote) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addChildSpanToSpan"])(parentSpan, span);
        }
        if (parentSpan?.spanContext().isRemote) {
            span.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE, true);
        }
        if (parentContext === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["ROOT_CONTEXT"]) {
            scopes = {
                scope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultCurrentScope"])(),
                isolationScope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultIsolationScope"])()
            };
        }
        if (scopes) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setCapturedScopesOnSpan"])(span, scopes.scope, scopes.isolationScope);
        }
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["logSpanStart"])(span);
        this._client?.emit("spanStart", span);
    }
    /** @inheritDoc */ onEnd(span) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["logSpanEnd"])(span);
        this._client?.emit("spanEnd", span);
        if (this._client && (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$hasSpanStreamingEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpanStreamingEnabled"])(this._client)) {
            this._client.emit("afterSpanEnd", span);
        } else {
            this._exporter.export(span);
        }
    }
}
class SentrySampler {
    constructor(client){
        this._client = client;
        this._isSpanStreaming = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$hasSpanStreamingEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpanStreamingEnabled"])(client);
        setIsSetup("SentrySampler");
    }
    /** @inheritDoc */ shouldSample(context, traceId, spanName, spanKind, spanAttributes, _links) {
        const options = this._client.getOptions();
        const { ignoreSpans } = options;
        const parentSpan = getValidSpan(context);
        const parentContext = parentSpan?.spanContext();
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])(options)) {
            return wrapSamplingDecision({
                decision: void 0,
                context,
                spanAttributes
            });
        }
        const maybeSpanHttpMethod = spanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_METHOD"]] || spanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_REQUEST_METHOD"]];
        if (spanKind === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].CLIENT && maybeSpanHttpMethod && (!parentSpan || parentContext?.isRemote)) {
            if (!this._isSpanStreaming) {
                this._client.recordDroppedEvent("no_parent_span", "span");
                return wrapSamplingDecision({
                    decision: void 0,
                    context,
                    spanAttributes
                });
            }
        }
        const parentSampled = parentSpan ? getParentSampled(parentSpan, traceId, spanName) : void 0;
        const isRootSpan = !parentSpan || parentContext?.isRemote;
        if (!isRootSpan) {
            if (this._isSpanStreaming) {
                if (parentSampled) {
                    if (ignoreSpans?.length) {
                        const { description: inferredChildName, op: childOp } = inferSpanData(spanName, spanAttributes, spanKind);
                        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldIgnoreSpan"])({
                            description: inferredChildName,
                            op: spanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] ?? childOp,
                            attributes: spanAttributes
                        }, ignoreSpans)) {
                            this._client.recordDroppedEvent("ignored", "span");
                            return wrapSamplingDecision({
                                decision: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD,
                                context,
                                spanAttributes,
                                ignoredChildSpan: true
                            });
                        }
                    }
                }
                if (!parentSampled) {
                    const parentSegmentIgnored = parentContext?.traceState?.get(SENTRY_TRACE_STATE_SEGMENT_IGNORED) === "1";
                    this._client.recordDroppedEvent(parentSegmentIgnored ? "ignored" : "sample_rate", "span");
                }
            }
            return wrapSamplingDecision({
                decision: parentSampled ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].RECORD_AND_SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD,
                context,
                spanAttributes
            });
        }
        const { description: inferredSpanName, data: inferredAttributes, op } = inferSpanData(spanName, spanAttributes, spanKind);
        const mergedAttributes = {
            ...inferredAttributes,
            ...spanAttributes
        };
        if (op) {
            mergedAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] = op;
        }
        if (this._isSpanStreaming && ignoreSpans?.length && (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldIgnoreSpan"])({
            description: inferredSpanName,
            op: mergedAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] ?? op,
            attributes: mergedAttributes
        }, ignoreSpans)) {
            this._client.recordDroppedEvent("ignored", "span");
            return wrapSamplingDecision({
                decision: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD,
                context,
                spanAttributes,
                ignoredSegmentSpan: true
            });
        }
        const mutableSamplingDecision = {
            decision: true
        };
        this._client.emit("beforeSampling", {
            spanAttributes: mergedAttributes,
            spanName: inferredSpanName,
            parentSampled,
            parentContext
        }, mutableSamplingDecision);
        if (!mutableSamplingDecision.decision) {
            return wrapSamplingDecision({
                decision: void 0,
                context,
                spanAttributes
            });
        }
        const { isolationScope } = getScopesFromContext(context) ?? {};
        const dscString = parentContext?.traceState ? parentContext.traceState.get(SENTRY_TRACE_STATE_DSC) : void 0;
        const dsc = dscString ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(dscString) : void 0;
        const sampleRand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(dsc?.sample_rand) ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeMathRandom__as__$5f$INTERNAL_safeMathRandom$3e$__["_INTERNAL_safeMathRandom"])();
        const [sampled, sampleRate, localSampleRateWasApplied] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sampling$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["sampleSpan"])(options, {
            name: inferredSpanName,
            attributes: mergedAttributes,
            normalizedRequest: isolationScope?.getScopeData().sdkProcessingMetadata.normalizedRequest,
            parentSampled,
            parentSampleRate: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(dsc?.sample_rate)
        }, sampleRand);
        const method = `${maybeSpanHttpMethod}`.toUpperCase();
        if (method === "OPTIONS" || method === "HEAD") {
            DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Not sampling span because HTTP method is '${method}' for ${spanName}`);
            return wrapSamplingDecision({
                decision: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD,
                context,
                spanAttributes,
                sampleRand,
                downstreamTraceSampleRate: 0
            });
        }
        if (!sampled && // We check for `parentSampled === undefined` because we only want to record client reports for spans that are trace roots (ie. when there was incoming trace)
        parentSampled === void 0) {
            DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log("[Tracing] Discarding root span because its trace was not chosen to be sampled.");
            this._client.recordDroppedEvent("sample_rate", this._isSpanStreaming ? "span" : "transaction");
        }
        return {
            ...wrapSamplingDecision({
                decision: sampled ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].RECORD_AND_SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD,
                context,
                spanAttributes,
                sampleRand,
                downstreamTraceSampleRate: localSampleRateWasApplied ? sampleRate : void 0
            }),
            attributes: {
                // We set the sample rate on the span when a local sample rate was applied to better understand how traces were sampled in Sentry
                [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]]: localSampleRateWasApplied ? sampleRate : void 0
            }
        };
    }
    /** Returns the sampler name or short description with the configuration. */ toString() {
        return "SentrySampler";
    }
}
function getParentSampled(parentSpan, traceId, spanName) {
    const parentContext = parentSpan.spanContext();
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSpanContextValid"])(parentContext) && parentContext.traceId === traceId) {
        if (parentContext.isRemote) {
            const parentSampled2 = getSamplingDecision(parentSpan.spanContext());
            DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Inheriting remote parent's sampled decision for ${spanName}: ${parentSampled2}`);
            return parentSampled2;
        }
        const parentSampled = getSamplingDecision(parentContext);
        DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Inheriting parent's sampled decision for ${spanName}: ${parentSampled}`);
        return parentSampled;
    }
    return void 0;
}
function wrapSamplingDecision({ decision, context, spanAttributes, sampleRand, downstreamTraceSampleRate, ignoredChildSpan, ignoredSegmentSpan }) {
    let traceState = getBaseTraceState(context, spanAttributes);
    if (downstreamTraceSampleRate !== void 0) {
        traceState = traceState.set(SENTRY_TRACE_STATE_SAMPLE_RATE, `${downstreamTraceSampleRate}`);
    }
    if (sampleRand !== void 0) {
        traceState = traceState.set(SENTRY_TRACE_STATE_SAMPLE_RAND, `${sampleRand}`);
    }
    if (ignoredChildSpan) {
        traceState = traceState.set(SENTRY_TRACE_STATE_CHILD_IGNORED, "1");
    }
    if (ignoredSegmentSpan) {
        traceState = traceState.set(SENTRY_TRACE_STATE_SEGMENT_IGNORED, "1");
    }
    if (decision == void 0) {
        return {
            decision: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD,
            traceState
        };
    }
    if (decision === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$sdk$2d$trace$2f$build$2f$esm$2f$Sampler$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD) {
        return {
            decision,
            traceState: traceState.set(SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING, "1")
        };
    }
    return {
        decision,
        traceState
    };
}
function getBaseTraceState(context, spanAttributes) {
    const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
    const parentContext = parentSpan?.spanContext();
    let traceState = parentContext?.traceState || new TraceState();
    const url = spanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_URL"]] || spanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["URL_FULL"]];
    if (url && typeof url === "string") {
        traceState = traceState.set(SENTRY_TRACE_STATE_URL, url);
    }
    return traceState;
}
function getValidSpan(context) {
    const span = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
    return span && (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSpanContextValid"])(span.spanContext()) ? span : void 0;
}
function applyOtelSpanData(span, options = {}) {
    const spanJSON = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span);
    const attributes = spanJSON.data;
    const kind = span.kind ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL;
    const mayInferSource = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanShouldInferOtelSource"])(span);
    const hasCustomSpanName = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]] !== void 0;
    const canInferSource = mayInferSource && !hasCustomSpanName && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanSourceWasExplicitlySet"])(span);
    const attributesForInference = canInferSource && attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === "custom" ? {
        ...attributes,
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: void 0
    } : attributes;
    const inferred = inferSpanData(spanJSON.description || "<unknown>", attributesForInference, kind);
    if (kind !== __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL && attributes["otel.kind"] === void 0) {
        span.setAttribute("otel.kind", __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"][kind]);
    }
    if (inferred.op && attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] === void 0) {
        span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"], inferred.op);
    }
    const shouldApplyInferredSource = inferred.source !== void 0 && inferred.source !== "custom" && (options.finalizeStatus || inferred.source !== "url") && (spanJSON.parent_span_id === void 0 || kind === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER);
    if (shouldApplyInferredSource && (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === void 0 || canInferSource)) {
        span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"], inferred.source);
    }
    if (inferred.data) {
        Object.entries(inferred.data).forEach(([key, value])=>{
            if (value !== void 0 && attributes[key] === void 0) {
                span.setAttribute(key, value);
            }
        });
    }
    if (options.finalizeStatus) {
        applyOtelCompatibilityAttributes(span, attributes);
        const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
        applyOtelSpanStatus(span, attributes, spanJSON.status, !!client && (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spans$2f$hasSpanStreamingEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpanStreamingEnabled"])(client));
    }
    if (mayInferSource && inferred.description !== spanJSON.description && (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] !== "custom" || canInferSource)) {
        span.updateName(inferred.description);
    }
}
function applyOtelSpanKind(span, kind) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(span, "kind", kind ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL);
}
function applyOtelSpanStatus(span, attributes, status, spanStreamingEnabled) {
    if (status === void 0) {
        span.setStatus(inferStatusFromAttributes(attributes) || {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_OK"]
        });
        return;
    }
    if (!spanStreamingEnabled && status !== "ok" && !isStatusErrorMessageValid(status)) {
        span.setStatus({
            code: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
            message: "internal_error"
        });
    }
}
function applyOtelCompatibilityAttributes(span, attributes) {
    const legacyHttpStatusCode = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_STATUS_CODE"]];
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_RESPONSE_STATUS_CODE"]] === void 0 && legacyHttpStatusCode !== void 0) {
        span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_RESPONSE_STATUS_CODE"], legacyHttpStatusCode);
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["HTTP_RESPONSE_STATUS_CODE"]] = legacyHttpStatusCode;
    }
}
class SentryTracer {
    /** @inheritdoc */ startSpan(name, options = {}, ctx) {
        const parentContext = ctx || __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        const parentSpan = options.root ? void 0 : __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(parentContext);
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$trace$2f$suppress$2d$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isTracingSuppressed"])(parentContext)) {
            return this._createNonRecordingSpan(parentSpan);
        }
        const span = this._startSentrySpan(name, options, parentSpan, ctx !== void 0);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["markSpanAsTracerProviderSpan"])(span);
        applyOtelSpanKind(span, options.kind);
        if (options.attributes?.[__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === void 0) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["markSpanForOtelSourceInference"])(span);
        }
        applyOtelSpanData(span);
        return span;
    }
    startActiveSpan(name, optionsOrFn, contextOrFn, fn) {
        const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
        const ctx = typeof contextOrFn === "function" || contextOrFn === void 0 ? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active() : contextOrFn;
        const callback = typeof optionsOrFn === "function" ? optionsOrFn : typeof contextOrFn === "function" ? contextOrFn : fn;
        const span = this.startSpan(name, options, ctx);
        const capturedIsolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(span).isolationScope;
        const withCapturedIsolationScope = (contextToFork)=>capturedIsolationScope ? contextToFork.setValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY, capturedIsolationScope) : contextToFork;
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsIgnored"])(span) && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(ctx)) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(withCapturedIsolationScope(ctx), ()=>callback(span));
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(withCapturedIsolationScope(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(ctx, span)), ()=>{
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__$5f$setSpanForScope__as__$5f$INTERNAL_setSpanForScope$3e$__["_INTERNAL_setSpanForScope"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])(), span);
            return callback(span);
        });
    }
    _startSentrySpan(name, options, parentSpan, hasExplicitContext) {
        const sentryOptions = {
            name,
            attributes: options.attributes,
            links: options.links,
            startTime: options.startTime
        };
        if (options.root) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["startNewTrace"])(()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_startInactiveSpan"])({
                    ...sentryOptions,
                    parentSpan: null
                }));
        }
        if (parentSpan?.spanContext().isRemote) {
            return this._startRootSpanWithRemoteParent(sentryOptions, parentSpan);
        }
        if (parentSpan) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_startInactiveSpan"])({
                ...sentryOptions,
                parentSpan
            });
        }
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["startNewTrace"])(()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_startInactiveSpan"])({
                ...sentryOptions,
                parentSpan: hasExplicitContext ? null : void 0
            }));
    }
    _startRootSpanWithRemoteParent(options, parentSpan) {
        const { spanId, traceId, traceState } = parentSpan.spanContext();
        const dsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(parentSpan);
        const sampleRand = typeof dsc.sample_rand === "string" ? Number(dsc.sample_rand) : void 0;
        const hasIncomingDsc = !!traceState?.get(SENTRY_TRACE_STATE_DSC);
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])((scope)=>{
            scope.setPropagationContext({
                traceId,
                parentSpanId: spanId,
                sampled: getSamplingDecision(parentSpan.spanContext()),
                dsc: hasIncomingDsc ? dsc : void 0,
                sampleRand: typeof sampleRand === "number" && !Number.isNaN(sampleRand) ? sampleRand : (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeMathRandom__as__$5f$INTERNAL_safeMathRandom$3e$__["_INTERNAL_safeMathRandom"])()
            });
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__$5f$setSpanForScope__as__$5f$INTERNAL_setSpanForScope$3e$__["_INTERNAL_setSpanForScope"])(scope, void 0);
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_startInactiveSpan"])({
                ...options,
                parentSpan: null
            });
        });
    }
    _createNonRecordingSpan(parentSpan) {
        const span = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]({
            traceId: parentSpan?.spanContext().traceId
        });
        if (parentSpan) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addChildSpanToSpan"])(parentSpan, span);
        }
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setCapturedScopesOnSpan"])(span, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])(), (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])());
        return span;
    }
}
class SentryTracerProvider {
    constructor(options = {}){
        this._tracers = /* @__PURE__ */ new Map();
        this.resource = options.resource;
    }
    /** @inheritdoc */ getTracer(name, version, options) {
        const key = JSON.stringify([
            name,
            version,
            options
        ]);
        const cachedTracer = this._tracers.get(key);
        if (cachedTracer) {
            return cachedTracer;
        }
        const tracer = new SentryTracer();
        this._tracers.set(key, tracer);
        return tracer;
    }
    /** Compatibility with SDK tracer providers. */ forceFlush() {
        return Promise.resolve();
    }
    /** Compatibility with SDK tracer providers. */ shutdown() {
        return Promise.resolve();
    }
}
const ATTR_TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language";
const ATTR_TELEMETRY_SDK_NAME = "telemetry.sdk.name";
const ATTR_TELEMETRY_SDK_VERSION = "telemetry.sdk.version";
const SEMRESATTRS_SERVICE_NAMESPACE = "service.namespace";
class SentryResource {
    constructor(attributes){
        this._attributes = attributes;
    }
    get attributes() {
        return this._attributes;
    }
    merge(other) {
        if (!other) {
            return this;
        }
        return new SentryResource({
            ...this._attributes,
            ...other.attributes
        });
    }
    getRawAttributes() {
        return Object.entries(this._attributes);
    }
}
function parseOtelResourceAttributes(raw) {
    if (!raw) {
        return {};
    }
    const result = {};
    for (const pair of raw.split(",")){
        const eq = pair.indexOf("=");
        if (eq === -1) {
            continue;
        }
        const key = pair.substring(0, eq).trim();
        const value = pair.substring(eq + 1).trim();
        if (key) {
            try {
                result[key] = decodeURIComponent(value);
            } catch  {
                result[key] = value;
            }
        }
    }
    return result;
}
function getSentryResource(serviceNameFallback) {
    const env = typeof process !== "undefined" ? process.env : {};
    const otelServiceName = env.OTEL_SERVICE_NAME;
    const otelResourceAttrs = parseOtelResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
    return new SentryResource({
        // Lowest priority: Sentry defaults
        // eslint-disable-next-line typescript/no-deprecated
        [SEMRESATTRS_SERVICE_NAMESPACE]: "sentry",
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SERVICE_NAME"]]: serviceNameFallback,
        // OTEL_RESOURCE_ATTRIBUTES overrides defaults (including service.name and service.namespace)
        ...otelResourceAttrs,
        // OTEL_SERVICE_NAME explicitly overrides service.name
        ...otelServiceName ? {
            [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SERVICE_NAME"]]: otelServiceName
        } : {},
        // Highest priority: Sentry SDK telemetry attrs (cannot be overridden by env vars)
        [__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$conventions$2f$dist$2f$attributes$2e$mjs__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SERVICE_VERSION"]]: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"],
        [ATTR_TELEMETRY_SDK_LANGUAGE]: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$platform$2f$browser$2f$sdk$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_INFO"][ATTR_TELEMETRY_SDK_LANGUAGE],
        [ATTR_TELEMETRY_SDK_NAME]: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$platform$2f$browser$2f$sdk$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_INFO"][ATTR_TELEMETRY_SDK_NAME],
        [ATTR_TELEMETRY_SDK_VERSION]: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$core$2f$build$2f$esm$2f$platform$2f$browser$2f$sdk$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_INFO"][ATTR_TELEMETRY_SDK_VERSION]
    });
}
function getTraceData({ span, scope, client, propagateTraceparent } = {}) {
    let ctx = (scope && getContextFromScope(scope)) ?? __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
    if (span) {
        const { scope: scope2 } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(span);
        ctx = scope2 && getContextFromScope(scope2) || __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), span);
    }
    const { traceId, spanId, sampled, dynamicSamplingContext } = getInjectionData(ctx, {
        scope,
        client
    });
    const traceData = {
        "sentry-trace": (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSentryTraceHeader"])(traceId, spanId, sampled),
        baggage: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dynamicSamplingContextToSentryBaggageHeader"])(dynamicSamplingContext)
    };
    if (propagateTraceparent) {
        traceData.traceparent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceparentHeader"])(traceId, spanId, sampled);
    }
    return traceData;
}
function setOpenTelemetryContextAsyncContextStrategy(options) {
    function getScopes() {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        const scopes = getScopesFromContext(ctx);
        if (scopes) {
            return scopes;
        }
        return {
            scope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultCurrentScope"])(),
            isolationScope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultIsolationScope"])()
        };
    }
    function withScope(callback) {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx, ()=>{
            return callback(getCurrentScope());
        });
    }
    function withSetScope(scope, callback) {
        const ctx = getContextFromScope(scope) || __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx.setValue(SENTRY_FORK_SET_SCOPE_CONTEXT_KEY, scope), ()=>{
            return callback(scope);
        });
    }
    function withIsolationScope(callback) {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx.setValue(SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY, true), ()=>{
            return callback(getIsolationScope());
        });
    }
    function withSetIsolationScope(isolationScope, callback) {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx.setValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY, isolationScope), ()=>{
            return callback(getIsolationScope());
        });
    }
    function getCurrentScope() {
        return getScopes().scope;
    }
    function getIsolationScope() {
        return getScopes().isolationScope;
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setAsyncContextStrategy"])({
        withScope,
        withSetScope,
        withSetIsolationScope,
        withIsolationScope,
        getCurrentScope,
        getIsolationScope,
        startSpan,
        startSpanManual,
        startInactiveSpan,
        getActiveSpan,
        suppressTracing,
        isTracingSuppressed,
        getTraceData,
        continueTrace,
        startNewTrace,
        // The types here don't fully align, because our own `Span` type is narrower
        // than the OTEL one - but this is OK for here, as we now we'll only have OTEL spans passed around
        withActiveSpan,
        getTracingChannelBinding: options?.getTracingChannelBinding
    });
}
;
}),
"[project]/node_modules/@sentry/opentelemetry/build/esm/asyncContextStrategy-jD8YWNDU.js [instrumentation-edge] (ecmascript) <export k as getScopesFromContext>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getScopesFromContext",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$opentelemetry$2f$build$2f$esm$2f$asyncContextStrategy$2d$jD8YWNDU$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["k"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$opentelemetry$2f$build$2f$esm$2f$asyncContextStrategy$2d$jD8YWNDU$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/opentelemetry/build/esm/asyncContextStrategy-jD8YWNDU.js [instrumentation-edge] (ecmascript)");
}),
"[project]/node_modules/@sentry/opentelemetry/build/esm/asyncContextStrategy-jD8YWNDU.js [instrumentation-edge] (ecmascript) <export o as isSentryRequestSpan>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isSentryRequestSpan",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$opentelemetry$2f$build$2f$esm$2f$asyncContextStrategy$2d$jD8YWNDU$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["o"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$sentry$2f$opentelemetry$2f$build$2f$esm$2f$asyncContextStrategy$2d$jD8YWNDU$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@sentry/opentelemetry/build/esm/asyncContextStrategy-jD8YWNDU.js [instrumentation-edge] (ecmascript)");
}),
]);

//# sourceMappingURL=1q96_modules_%40sentry_opentelemetry_build_esm_asyncContextStrategy-jD8YWNDU_0s5o26l.js.map