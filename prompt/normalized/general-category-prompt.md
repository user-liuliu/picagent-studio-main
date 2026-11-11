---
code: general.category-prompt
name: "V1.1 按图片类别生成独立生图提示词"
kind: planner
stage: category_prompt
execution_target: llm
category: general
source_file: "prompt/normalized/general-category-prompt.md"
source_heading: "V1.1 按图片类别生成独立生图提示词"
---

# V1.1 按图片类别生成独立生图提示词

## 模板定位

第二阶段一次只处理一个已确认类别，按 requested_count 返回同数量、职责不同且可单独执行的完整生图提示词。

## 用户输入字段

```yaml
fields:
  - key: platform
    label: "目标平台"
    type: text
    required: true
  - key: output_language
    label: "输出语言"
    type: text
    required: true
  - key: category_code
    label: "图片类别代码"
    type: text
    required: true
  - key: category_name
    label: "图片类别名称"
    type: text
    required: true
  - key: requested_count
    label: "确认生成数量"
    type: number
    required: true
  - key: global_style_card
    label: "已确认全局风格卡"
    type: textarea
    required: true
  - key: approved_fact_refs
    label: "当前类别允许的事实引用"
    type: textarea
    required: true
  - key: approved_facts
    label: "当前类别已确认事实"
    type: textarea
    required: true
  - key: human_supplement
    label: "冻结的补充商品事实"
    type: textarea
    required: false
  - key: reference_image_ids
    label: "当前类别参考图"
    type: textarea
    required: true
  - key: platform_text_rule
    label: "平台文字规则"
    type: textarea
    required: false
  - key: product_name
    label: "产品名称"
    type: text
    required: false
```

## System Prompt

你负责第二阶段的单类别提示词生成。只处理 category_code 指定的已确认类别，不得新增类别、修改 requested_count、重新规划详情总数或重写全局风格卡。每个 item 必须是职责、构图和镜头明显不同的独立图片提示词，不能用一个提示词配 n 个数量。

只使用 `approved_fact_refs` 对应的 `approved_facts`、允许时冻结的 `human_supplement`、`reference_image_ids`、已确认全局风格卡和平台规则。主图类别 `main` 必须使用已确认 `mainAllocation` 的参考图和事实范围，不得回退为全部图片或全部资料。图中文字必须来自确认事实并注明来源；无法确认的参数、配件、尺寸、适配关系、材质、功效和卖点不得编造。每条提示词必须足够完整，可直接交给一次 n=1 的生图请求。

本阶段只返回符合 suite-category-prompt-v1 的 JSON，不输出 Markdown、分析过程或额外字段。

严格按以下规则返回：

1. JSON 根对象就是类别输出对象。禁止返回数组，也禁止包在 `data`、`result`、`category_prompt` 或其他外层字段中。
2. 根对象只能包含 `schemaVersion`、`category`、`items` 三个字段，字段名和大小写必须完全一致。
3. 每个 item 必须包含 `stableId`、`category`、`title`、`purpose`、`referenceImageIds`、`factRefs`、`prompt`、`allowsTextOverlay`、`textContent`、`aspectRatio`、`suggestedParams`，禁止改用 snake_case 或拆成 `subject`、`composition`、`camera`、`style` 等字段。
4. `items` 数量必须严格等于 `requested_count`，每一条是独立完整 prompt。`referenceImageIds` 只能使用输入的参考图 ID；`factRefs` 只能使用输入中允许的事实 ID。

返回形状示例。实际内容必须使用本次输入的类别、数量、图片 ID 与事实 ID：

```json
{
  "schemaVersion": "suite-category-prompt-v1",
  "category": "main",
  "items": [
    {
      "stableId": "main-01",
      "category": "main",
      "title": "图片标题",
      "purpose": "该图承担的职责",
      "referenceImageIds": ["输入中已有的图片 ID"],
      "factRefs": [],
      "prompt": "完整、可独立执行的生图提示词",
      "allowsTextOverlay": "platform_default",
      "textContent": [],
      "aspectRatio": "1:1",
      "suggestedParams": { "size": "1K" }
    }
  ]
}
```

## User Prompt Template

```text
输入原图和白底图：
{{reference_images}}

当前类别配置与已确认事实：
{{dynamic_input}}

请只返回 suite-category-prompt-v1 JSON，items 数量必须等于 requested_count。
```

## Output Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "category", "items"],
  "properties": {
    "schemaVersion": { "const": "suite-category-prompt-v1" },
    "category": { "type": "string" },
    "items": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["stableId", "category", "title", "purpose", "referenceImageIds", "factRefs", "prompt", "allowsTextOverlay", "textContent", "aspectRatio", "suggestedParams"], "properties": { "stableId": { "type": "string" }, "category": { "type": "string" }, "title": { "type": "string" }, "purpose": { "type": "string" }, "referenceImageIds": { "type": "array", "items": { "type": "string" } }, "factRefs": { "type": "array", "items": { "type": "string" } }, "prompt": { "type": "string" }, "allowsTextOverlay": { "enum": ["platform_default", "yes", "no"] }, "textContent": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["text", "source"], "properties": { "text": { "type": "string" }, "source": { "type": "string" } } } }, "aspectRatio": { "type": "string" }, "suggestedParams": { "type": "object", "additionalProperties": true } } } }
  }
}
```

## 运行时约束

- 服务端必须校验返回 category 与请求类别一致，items 数量等于 requested_count，且所有事实引用来自已确认集合。
- 每个 item 物化为一张独立任务卡；生图 provider 固定 n=1。
- 全局风格卡和完整最终 prompt 必须冻结到任务及图片版本快照。
