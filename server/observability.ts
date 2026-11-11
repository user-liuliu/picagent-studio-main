import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startObservation, type LangfuseObservation } from "@langfuse/tracing";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

type Attributes = Record<string, string | number | boolean>;
type Observation = Pick<LangfuseObservation, "updateOtelSpanAttributes" | "end" | "otelSpan">;

const noopObservation: Observation = {
  updateOtelSpanAttributes: () => undefined,
  end: () => undefined,
  otelSpan: undefined as never,
};

let enabled = false;
let captureContent = false;
let processor: LangfuseSpanProcessor | undefined;
let meterProvider: MeterProvider | undefined;
let metrics: ReturnType<typeof createMetrics> | undefined;

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === undefined ? fallback : value === "true";
}

function safeError(error: unknown): { name: string; message: string } {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: String(error) };
}

function createMetrics() {
  const meter = meterProvider!.getMeter("picagent");
  return {
    requests: meter.createCounter("picagent_model_requests_total", { description: "Model requests" }),
    errors: meter.createCounter("picagent_model_errors_total", { description: "Model errors" }),
    inputTokens: meter.createCounter("picagent_model_input_tokens_total", { description: "Input tokens reported by providers" }),
    outputTokens: meter.createCounter("picagent_model_output_tokens_total", { description: "Output tokens reported by providers" }),
    duration: meter.createHistogram("picagent_model_request_duration_ms", { unit: "ms", description: "Model request duration" }),
    imageRequests: meter.createCounter("picagent_image_requests_total", { description: "Image provider requests" }),
    imageDuration: meter.createHistogram("picagent_image_request_duration_ms", { unit: "ms", description: "Image provider request duration" }),
  };
}

export function initializeObservability(): void {
  captureContent = boolEnv("OBSERVABILITY_CAPTURE_CONTENT", false);
  const hasLangfuseKeys = Boolean(process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim());
  enabled = boolEnv("OBSERVABILITY_ENABLED", hasLangfuseKeys);
  if (enabled && hasLangfuseKeys) {
    processor = new LangfuseSpanProcessor({
      exportMode: "immediate",
      ...(process.env.LANGFUSE_BASE_URL?.trim() ? { baseUrl: process.env.LANGFUSE_BASE_URL.trim() } : {}),
    });
    const tracerProvider = new NodeTracerProvider({ spanProcessors: [processor] });
    tracerProvider.register();
  }
  if (boolEnv("OBSERVABILITY_METRICS_ENABLED", true)) {
    const exporter = new PrometheusExporter({
      host: process.env.OBSERVABILITY_METRICS_HOST?.trim() || "0.0.0.0",
      port: Number(process.env.OBSERVABILITY_METRICS_PORT?.trim() || 9464),
      endpoint: "/metrics",
    });
    meterProvider = new MeterProvider({ readers: [exporter] });
    metrics = createMetrics();
  }
}

export function observabilityContent<T>(value: T): T | undefined {
  return captureContent ? value : undefined;
}

export function startGeneration(name: string, input: unknown, metadata: Attributes): Observation {
  if (!enabled) return noopObservation;
  return startObservation(name, {
    input: observabilityContent(input) ?? { captured: false },
    metadata,
  }, { asType: "generation" });
}

export function startTool(name: string, input: unknown, metadata: Attributes): Observation {
  if (!enabled) return noopObservation;
  return startObservation(name, {
    input: observabilityContent(input) ?? { captured: false },
    metadata,
  }, { asType: "tool" });
}

export function finishObservation(observation: Observation, output: unknown, metadata?: Attributes): void {
  observation.updateOtelSpanAttributes({ output: observabilityContent(output) ?? { captured: false }, ...(metadata ? { metadata } : {}) });
  observation.end();
}

export function failObservation(observation: Observation, error: unknown, metadata?: Attributes): void {
  const normalized = safeError(error);
  observation.updateOtelSpanAttributes({
    level: "ERROR",
    statusMessage: normalized.message,
    output: { error: normalized, captured: captureContent },
    ...(metadata ? { metadata } : {}),
  });
  observation.end();
}

export function recordModelSuccess(flow: string, provider: string, model: string, durationMs: number, usage?: { input?: number; output?: number }): void {
  const attrs = { flow, provider, model, status: "success" } as const;
  metrics?.requests.add(1, attrs);
  metrics?.duration.record(durationMs, { flow, provider, model });
  if (usage?.input !== undefined) metrics?.inputTokens.add(usage.input, { provider, model });
  if (usage?.output !== undefined) metrics?.outputTokens.add(usage.output, { provider, model });
}

export function recordModelFailure(flow: string, provider: string, model: string, durationMs: number, errorCode: string): void {
  const attrs = { flow, provider, model, status: "error" } as const;
  metrics?.requests.add(1, attrs);
  metrics?.errors.add(1, { flow, provider, model, error_code: errorCode });
  metrics?.duration.record(durationMs, { flow, provider, model });
}

export function recordImageSuccess(flow: string, provider: string, model: string, durationMs: number): void {
  metrics?.imageRequests.add(1, { flow, provider, model, status: "success" });
  metrics?.imageDuration.record(durationMs, { flow, provider, model });
}

export function recordImageFailure(flow: string, provider: string, model: string, durationMs: number, errorCode: string): void {
  metrics?.imageRequests.add(1, { flow, provider, model, status: "error" });
  metrics?.errors.add(1, { flow, provider, model, error_code: errorCode });
  metrics?.imageDuration.record(durationMs, { flow, provider, model });
}

export function logObservation(event: string, fields: Attributes = {}): void {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields })}\n`);
}

export async function shutdownObservability(): Promise<void> {
  await Promise.allSettled([processor?.forceFlush(), meterProvider?.shutdown()]);
}
