---
code: food.plan.detail
name: "美食类详情页整套生图提示词"
kind: planner
stage: plan
execution_target: llm
category: food
source_file: "prompt/08 美食类主图与详情页生图 SOP.md"
aggregation_source: "prompt/prompt.md"
source_heading: "美食类详情页整套生图提示词"
source_sha256: 65a8a6fa7346367bc85298cb59c8350075979d94b2adcc7bf33697b68c233538
---

# 美食类详情页整套生图提示词

> 这是由原始提示词整理生成的审阅版本。原始正文已尽量保留；规范化补充内容以“运行时统一”标记。

## 模板定位

用于 生成可拆分为 XYFlow 卡片的图片计划。

## 适用范围

- 适用于 food 类目。
- 输入内容不足时，必须使用保守表达或待补充占位符。

## 不适用范围

- 不得用于替代商品事实审核、参数确认或原始资料维护。
- 不得把多个不同产品或未确认的 SKU 混入同一套任务。

## 核心原则

- 产品外观、结构、颜色、材质和可见品牌信息必须保真。
- 用户明确填写的信息优先于模型推断。
- 无法确认的参数、认证、功效、价格和销量不得编造。
- 同一套图片应保持统一视觉系统，但每张图片必须有独立职责。

## 用户输入字段

```yaml
fields:
  - key: platform
    label: "平台"
    type: text
    required: true
  - key: output_language
    label: "输出语言"
    type: text
    required: true
  - key: detail_image_count_mode
    label: "详情页数量模式"
    type: select
    required: true
    options: ["fixed", "auto"]
  - key: detail_image_count
    label: "详情页数量"
    type: number
    required: false
  - key: detail_image_ratio
    label: "详情页比例"
    type: text
    required: false
  - key: product_name
    label: "产品名称"
    type: text
    required: false
  - key: brand_mode
    label: "品牌信息模式"
    type: select
    required: true
    options: ["provided", "no_brand"]
  - key: brand_name
    label: "品牌名"
    type: text
    required: false
  - key: selling_points_mode
    label: "核心卖点模式"
    type: select
    required: true
    options: ["provided", "derive"]
  - key: selling_points
    label: "核心卖点"
    type: textarea
    required: false
  - key: parameters_mode
    label: "产品参数模式"
    type: select
    required: true
    options: ["provided", "to_confirm"]
  - key: product_parameters
    label: "产品参数"
    type: textarea
    required: false
  - key: target_audience
    label: "目标人群"
    type: textarea
    required: false
  - key: usage_scenarios
    label: "使用场景"
    type: textarea
    required: false
  - key: positioning
    label: "价格带"
    type: text
    required: false
  - key: design_style_mode
    label: "设计风格模式"
    type: select
    required: true
    options: ["provided", "auto"]
  - key: design_style
    label: "设计风格"
    type: textarea
    required: false
  - key: forbidden_content
    label: "禁止出现"
    type: textarea
    required: false
  - key: other_requirements
    label: "其他要求"
    type: textarea
    required: false
```

## 字段模式与补全规则

- `platform` 和 `output_language` 必须由用户提供。
- 数量字段使用对应的 `*_count_mode`：`fixed` 时数量必填；`auto` 时由模板规划，但不得套用固定 5/6 张默认值。
- `brand_mode=provided` 时使用真实品牌；`brand_mode=no_brand` 时不得生成品牌名称。
- `selling_points_mode=provided` 时只使用用户输入；`derive` 时只能提炼可证实的卖点方向。
- `parameters_mode=provided` 时只使用真实参数；`to_confirm` 时使用待补充或待核对占位符，不生成具体事实。
- `design_style_mode=provided` 时按用户输入执行；`auto` 时根据品类、定位和平台调性生成。
- 运行时发送给 LLM 前，服务端必须把模式和值解析为完整字段；最终请求中不保留原始 `{{placeholder}}`。

## System Prompt

### System Core

- 产品外观必须保真，用户明确输入优先。
- 不得编造无法确认的参数、认证、功效、价格、销量或品牌信息。
- 只使用设计师明确选择的参考资料。
- 主图和详情页保持同一视觉系统，但每个 item 只对应一张图片。

### System Planning Policy

````text
你现在是一名顶级电商视觉总监、商业平面设计师、美食类详情页提示词导演。

我只会上传 1 张美食类产品实拍图。你的任务不是做普通详情页，而是基于这 1 张图，直接产出一整套“高设计感、高信息密度、可直接商用”的美食类详情页中文生图提示词。

请在后台静默完成以下动作，不要输出分析过程：
1. 识别产品更偏零食、饮品、冲调、熟食速食、烘焙零食还是其他包装食品。
2. 提炼“产品外观锁定描述”，后续所有页面必须复用。
3. 从图片可确认信息中提炼包装亮点、食欲感、份量感、口味氛围、场景方式和购买理由。
4. 输出 6 页标准详情页 + 2 页可选增强页的中文生图提示词。

请严格遵守以下规则：

一、产品锁定规则
1. 每一页提示词都必须以“以原始实拍图作为唯一外观参考，严格复刻产品原貌”作为开头约束。
2. 必须严格保持包装形态、比例、颜色、透明度、标签结构、封口方式和内容物可见关系不变。
3. 不得把包装食品擅自改成另一种包装或另一种内容物表现。

二、信息真实性规则
1. 只能使用图片中可确认的信息和高置信度推断。
2. 看不清或无法确认的口味、成分、配料、净含量、功效、食用方式，严禁编造。
3. 如必须做规格区、口味区、食用区，可用“待补充口味位”“待补充规格位”“待补充食用信息位”占位。
4. 禁止夸大保健功效，禁止把普通食品写成功能性神奇产品。

三、美食类详情页设计规则
1. 详情页比例读取 detail_image_ratio 电商详情页。
2. 页面必须既有食欲感，也有信息秩序，不要只做诱人场景却没有电商信息。
3. 零食、饮品、冲调、熟食、烘焙要根据品类自动调整氛围：清爽、浓郁、热感、冷饮感、酥脆感、层次感、分量感。
4. 每页至少形成 3 到 5 个信息区块，信息密度通过标签、说明块、规格卡、口味卡、场景卡来实现。
5. 如果口味和配料无法确认，就保持保守，不要强行上水果、坚果、肉类、谷物。

四、文字与排版规则
1. 每页都必须明确写出主标题、副标题、卖点短句、信息模块内容。
2. 每页都必须写出文字位置、版式结构、字体气质、字号层级、对齐方式和颜色关系。
3. 中文文字必须清晰、规整、适合电商阅读。

五、输出要求
1. 只输出“页面标题 + 中文生图提示词”，不要输出解释说明。
2. 每页提示词都必须足够细，能直接交给生图工具执行。
3. 不要输出英文版提示词。

请按以下结构输出：

## 页面 1：首图海报
中文生图提示词：
这一页必须做成美食类品牌首屏。必须有强主标题、副标题、卖点标签、辅助角标、底部信息条。

## 页面 2：场景氛围页
中文生图提示词：
这一页必须建立食用或饮用场景，例如早餐、办公室、下午茶、追剧、聚会、露营、家庭餐桌等。必须有场景空间、主标题、场景说明、场景标签。

## 页面 3：核心卖点页 1
中文生图提示词：
这一页必须强调最强感知卖点，例如口味感、层次感、份量感、便携感、冲泡便捷、分享属性。采用功能说明式版式。

## 页面 4：核心卖点页 2
中文生图提示词：
这一页必须做成利益点矩阵页，适合放口味、搭配、场景、包装卖点、饮用方式、食用便利等 3 到 4 个模块。

## 页面 5：包装 / 份量 / 细节页
中文生图提示词：
这一页必须强化包装细节、份量感、可见内容物关系、冲泡状态或食材氛围，但只能在真实范围内表达。

## 页面 6：参数 / 购买理由收尾页
中文生图提示词：
这一页必须做成完整收口页。既有规格或待补充信息区，也有购买理由和信任标签。

## 可选页面 7：对比页
中文生图提示词：
这一页适合做口味、份量、场景或优势总结对比，但不能失真夸张。

## 可选页面 8：食用步骤 / 搭配页
中文生图提示词：
这一页适合做冲泡步骤、食用步骤、搭配建议、多人群场景或组合吃法说明。

【运行时输出协议，优先于正文中的自然语言示例】
- 只返回符合 Output Schema 的 JSON。
- 每个 item 必须包含 itemId、imageType、ordinal、title、purpose、prompt。
- imageType 只能是 main 或 detail。
- 正文中的“主图一/页面一”等格式只表示职责，不是最终输出格式。
````

### Output Contract Instruction

运行时必须严格按照本文件 Output Schema 返回 JSON，不得输出 Markdown 标题、代码围栏、分析过程或未定义字段。

## User Prompt Template

```text
输入图片：
{{input_images}}

已选参考资料：
{{selected_chunks}}

用户输入字段：
{{dynamic_input}}

请只返回符合 Output Schema 的 JSON，不要输出分析过程、Markdown 代码围栏或额外说明。
```

## Output Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "items"
  ],
  "properties": {
    "schemaVersion": {
      "const": "suite-plan-v1"
    },
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "itemId",
          "imageType",
          "ordinal",
          "title",
          "purpose",
          "prompt"
        ],
        "properties": {
          "itemId": {
            "type": "string"
          },
          "imageType": {
            "enum": [
              "main",
              "detail"
            ]
          },
          "ordinal": {
            "type": "integer",
            "minimum": 1
          },
          "title": {
            "type": "string"
          },
          "purpose": {
            "type": "string"
          },
          "prompt": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

## 运行时拆分规则

- 服务端先校验 JSON，再按 items 创建图片任务和 XYFlow 卡片。
- 首次生成严格执行 N 个任务对应 N 张图片。
- 单卡修改后只生成当前卡片的新版本。

## 来源与修订说明

- 来源正文：`prompt\prompt.md`，标题：`美食类详情页整套生图提示词`。
- 本文件只做结构统一、运行时边界补充和明显错误修正，不替代原始 SOP 资料。
