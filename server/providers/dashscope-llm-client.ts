import { randomUUID } from "node:crypto";
import type { CategoryPromptLlmInput, LlmClient, PlanLlmInput } from "../types.js";
import { failModelArchive, finishModelArchive, startModelArchive } from "../prompt-archive.js";
import { failObservation, finishObservation, logObservation, recordModelFailure, recordModelSuccess, startGeneration } from "../observability.js";

type VisionContent = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export function buildPlanUserContent(input: PlanLlmInput): VisionContent[] {
  const user = {
    dynamicInput: input.dynamicInput,
    humanInput: input.humanInput,
    selectedChunks: input.chunks.map((chunk) => ({ id: chunk.id, version: chunk.version, title: chunk.title, content: chunk.content, fieldValues: chunk.fieldValues })),
    inputImages: input.inputImageIds,
    baseImages: input.baseVersionIds,
    visualReferences: (input.visionImages ?? []).map((image) => ({ id: image.id, sourceKind: image.sourceKind, sourceVersionId: image.sourceVersionId, mimeType: image.mimeType })),
  };
  const renderedUserPrompt = (input.userPromptTemplate?.trim() || "{{dynamic_input}}\n{{selected_chunks}}\n{{input_images}}\n{{base_images}}\n{{visual_references}}")
    .replaceAll("{{dynamic_input}}", JSON.stringify(input.dynamicInput))
    .replaceAll("{{human_input}}", JSON.stringify(input.humanInput))
    .replaceAll("{{selected_chunks}}", JSON.stringify(user.selectedChunks))
    .replaceAll("{{input_images}}", JSON.stringify(input.inputImageIds))
    .replaceAll("{{base_images}}", JSON.stringify(input.baseVersionIds))
    .replaceAll("{{visual_references}}", JSON.stringify(user.visualReferences));
  const platformRules = input.platformProfile ? [
    "平台适配规则（来自平台维护表，优先于泛化平台假设）：",
    `- 平台：${input.platformProfile.name}`,
    `- 主图策略：${input.platformProfile.mainImageStrategy}`,
    `- 主图组策略：${input.platformProfile.galleryStrategy}`,
    `- 文字策略：${input.platformProfile.textStrategy}`,
    `- 模特策略：${input.platformProfile.modelStrategy}`,
  ].join("\n") : "";
  const text = platformRules ? `${renderedUserPrompt}\n\n${platformRules}` : renderedUserPrompt;
  return [
    { type: "text", text },
    ...(input.visionImages ?? []).map((image) => ({ type: "image_url" as const, image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}` } })),
  ];
}

export class DashScopeLlmClient implements LlmClient {
  readonly provider = "dashscope";
  readonly isFake = false;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, readonly model: string, private readonly timeoutMs = 600_000) {}
  async generatePlan(input: PlanLlmInput): Promise<unknown> {
    const startedAt = Date.now();
    const flow = input.flow ?? "plan";
    const requestId = input.requestId ?? randomUUID();
    const observation = startGeneration(`llm.${flow}`, {
      system: input.templateBody,
      user: buildPlanUserContent(input).filter((item) => item.type === "text"),
    }, { flow, provider: this.provider, model: this.model, template_version_id: input.templateVersionId, request_id: requestId });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const system = input.templateBody;
    const userContent = buildPlanUserContent(input);
    const userPrompt = userContent[0].type === "text" ? userContent[0].text : "";
    const archive = await startModelArchive({
      type: input.flow === "category-prompt" ? "multimodal-category-prompt" : "multimodal-plan",
      flow: input.flow === "category-prompt" ? "category-prompt" : "plan",
      requestId,
      provider: this.provider,
      model: this.model,
      request: {
        endpoint: new URL("chat/completions", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`).toString(),
        templateVersionId: input.templateVersionId,
        body: { model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "text", text: userPrompt }, ...(input.visionImages ?? []).map((image, index) => ({ type: "image_url", image_url: { url: `[archive-input-${index + 1}:${image.id}:${image.sourceKind}]` } }))] },
        ] },
      },
      inputFiles: (input.visionImages ?? []).map((image) => ({ label: `${image.id}-${image.sourceKind}`, mimeType: image.mimeType, bytes: image.bytes })),
    });
    let archived = false;
    try {
      const response = await fetch(new URL("chat/completions", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ] }),
      });
      const responseBody = await response.text();
      if (!response.ok) {
        const error = new Error(`LLM_HTTP_${response.status}`);
        await failModelArchive(archive, error, { httpStatus: response.status, body: responseBody });
        archived = true;
        throw error;
      }
      let payload: { choices?: Array<{ message?: { content?: string } }>; [key: string]: unknown };
      try { payload = JSON.parse(responseBody) as typeof payload; }
      catch {
        const error = new Error("LLM_INVALID_HTTP_RESPONSE");
        await failModelArchive(archive, error, { httpStatus: response.status, body: responseBody });
        archived = true;
        throw error;
      }
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        const error = new Error("LLM_EMPTY_RESPONSE");
        await failModelArchive(archive, error, { httpStatus: response.status, payload });
        archived = true;
        throw error;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
      catch {
        const error = new Error("LLM_INVALID_JSON_RESPONSE");
        await failModelArchive(archive, error, { httpStatus: response.status, payload, content });
        archived = true;
        throw error;
      }
      await finishModelArchive(archive, { httpStatus: response.status, payload, content, parsed });
      const usage = payload.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      finishObservation(observation, { content: captureText(content), status: "succeeded" }, { http_status: response.status });
      recordModelSuccess(flow, this.provider, this.model, Date.now() - startedAt, { input: usage?.prompt_tokens, output: usage?.completion_tokens });
      logObservation("model.completed", { request_id: requestId, flow, provider: this.provider, model: this.model, duration_ms: Date.now() - startedAt, status: "success" });
      archived = true;
      return parsed;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        const timeoutError = new Error("LLM_TIMEOUT");
        if (!archived) await failModelArchive(archive, timeoutError);
        failObservation(observation, timeoutError);
        recordModelFailure(flow, this.provider, this.model, Date.now() - startedAt, timeoutError.message);
        logObservation("model.failed", { request_id: requestId, flow, provider: this.provider, model: this.model, duration_ms: Date.now() - startedAt, status: "error", error_code: timeoutError.message });
        throw timeoutError;
      }
      if (!archived) await failModelArchive(archive, error);
      failObservation(observation, error);
      recordModelFailure(flow, this.provider, this.model, Date.now() - startedAt, error instanceof Error ? error.message : "LLM_FAILED");
      logObservation("model.failed", { request_id: requestId, flow, provider: this.provider, model: this.model, duration_ms: Date.now() - startedAt, status: "error", error_code: error instanceof Error ? error.message : "LLM_FAILED" });
      throw error;
    } finally { clearTimeout(timer); }
  }

  async generateCategoryPrompt(input: CategoryPromptLlmInput): Promise<unknown> {
    return this.generatePlan({
      ...input,
      flow: "category-prompt",
      dynamicInput: {
        ...input.dynamicInput,
        category_code: input.categoryCode,
        requested_count: input.requestedCount,
        approved_fact_refs: input.approvedFactRefs,
      },
    });
  }

  async generateReversePrompt(input: { template: { body: string; userPromptTemplate: string; templateVersionId: string }; referenceImageId: string; referenceImage: Buffer; baselineImage?: Buffer; mode: "main" | "detail" }): Promise<unknown> {
    const visionImages = [{ id: input.referenceImageId, sourceKind: "reference", mimeType: "image/jpeg", bytes: input.referenceImage }, ...(input.baselineImage ? [{ id: "series-color-baseline", sourceKind: "series_color_baseline", mimeType: "image/jpeg", bytes: input.baselineImage }] : [])];
    const prompt = (input.template.userPromptTemplate || "请根据当前参考图输出结构化反推提示词。模式：{{mode}}。参考图 ID：{{referenceImageId}}。")
      .replaceAll("{{mode}}", input.mode).replaceAll("{{referenceImageId}}", input.referenceImageId);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    const observation = startGeneration("llm.reverse-prompt", { system: input.template.body, user: prompt, images: visionImages.map(({ id, sourceKind, mimeType, bytes }) => ({ id, sourceKind, mimeType, byteLength: bytes.length })) }, { flow: "reverse-prompt", provider: this.provider, model: this.model, template_version_id: input.template.templateVersionId });
    try {
      const response = await fetch(new URL("chat/completions", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: input.template.body }, { role: "user", content: [{ type: "text", text: prompt }, ...visionImages.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}` } }))] }] }) });
      const body = await response.text(); if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);
      const payload = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }; const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("LLM_EMPTY_RESPONSE");
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      const usage = (payload as unknown as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      finishObservation(observation, { content: captureText(content), status: "succeeded" }, { http_status: response.status });
      recordModelSuccess("reverse-prompt", this.provider, this.model, Date.now() - startedAt, { input: usage?.prompt_tokens, output: usage?.completion_tokens });
      return parsed;
    } catch (error) { const normalized = error instanceof DOMException && error.name === "AbortError" ? new Error("LLM_TIMEOUT") : error; failObservation(observation, normalized); recordModelFailure("reverse-prompt", this.provider, this.model, Date.now() - startedAt, normalized instanceof Error ? normalized.message : "LLM_FAILED"); throw normalized; } finally { clearTimeout(timer); }
  }
}

function captureText(content: string): string | { captured: false } {
  return process.env.OBSERVABILITY_CAPTURE_CONTENT?.trim().toLowerCase() === "true" ? content : { captured: false };
}
