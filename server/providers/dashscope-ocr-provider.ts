import { randomUUID } from "node:crypto";
import type { ImageSource, OcrProvider, OcrTextBlock } from "../image-editor.js";

export class DashScopeOcrProvider implements OcrProvider {
  readonly name = "dashscope-vision-ocr";
  readonly version: string;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly model: string, private readonly timeoutMs = 300_000) { this.version = model; }
  async recognize(source: ImageSource): Promise<{ blocks: OcrTextBlock[] }> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL("chat/completions", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: this.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: "识别图片中所有可读文字。只返回 JSON：{\"blocks\":[{\"id\":\"string\",\"text\":\"string\",\"confidence\":0到1,\"bounds\":{\"x\":0到1,\"y\":0到1,\"width\":0到1,\"height\":0到1},\"rotation\":数字}]}。坐标以图片左上角为原点并归一化。" }, { role: "user", content: [{ type: "text", text: "请进行 OCR，返回所有文字块。" }, { type: "image_url", image_url: { url: `data:${source.mimeType};base64,${source.bytes.toString("base64")}` } }] }] }) });
      if (!response.ok) throw new Error(`OCR_HTTP_${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("OCR_EMPTY_RESPONSE");
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { blocks?: unknown };
      const blocks: OcrTextBlock[] = Array.isArray(parsed.blocks) ? parsed.blocks.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const value = item as Record<string, unknown>; const bounds = value.bounds;
        if (!bounds || typeof bounds !== "object" || typeof value.text !== "string") return [];
        const rect = bounds as Record<string, unknown>; const numbers = [rect.x, rect.y, rect.width, rect.height].map(Number);
        if (numbers.some((number) => !Number.isFinite(number)) || numbers.some((number) => number < 0 || number > 1) || numbers[0] + numbers[2] > 1 || numbers[1] + numbers[3] > 1) return [];
        return [{ id: typeof value.id === "string" ? value.id : `ocr-${index + 1}-${randomUUID()}`, text: value.text, confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)), bounds: { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] }, rotation: Number(value.rotation) || 0 }];
      }) : [];
      return { blocks };
    } catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw new Error("OCR_TIMEOUT"); throw error; }
    finally { clearTimeout(timer); }
  }
}
