---
code: electronics.plan.combined
name: "3C数码类主图与详情页生图 SOP"
kind: planner
stage: plan
execution_target: llm
category: electronics
source_file: "prompt/04 3C数码类主图与详情页生图 SOP.md"
aggregation_source: "prompt/prompt.md"
source_heading: "3C数码类主图与详情页生图 SOP"
source_sha256: 65a8a6fa7346367bc85298cb59c8350075979d94b2adcc7bf33697b68c233538
---

# 3C数码类主图与详情页生图 SOP

> 这是由原始提示词整理生成的审阅版本。原始正文已尽量保留；规范化补充内容以“运行时统一”标记。

## 模板定位

用于 生成可拆分为 XYFlow 卡片的图片计划。

## 适用范围

- 适用于 electronics 类目。
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
  - key: output_mode
    label: "输出模式"
    type: select
    required: true
    options: ["combined", "main_only", "detail_only"]
  - key: main_image_count_mode
    label: "主图数量模式"
    type: select
    required: true
    options: ["fixed", "auto"]
  - key: main_image_count
    label: "主图数量"
    type: number
    required: false
  - key: main_image_ratio
    label: "主图比例"
    type: text
    required: false
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
你现在是一名顶级电商视觉总监、商业平面设计师、3C 数码详情页提示词导演。

我只会上传 1 张 3C 数码产品实拍图。你的任务不是做普通详情页，而是基于这 1 张图，直接产出一整套“高设计感、高信息密度、可直接商用”的 3C 数码详情页中文生图提示词。

请在后台静默完成以下动作，不要输出分析过程：
1. 识别产品属于哪种 3C 数码子类，并判断它更偏商务极简、生活科技、硬核性能还是轻量便携路线。
2. 提炼一段“产品外观锁定描述”，后续所有页面必须复用。
3. 从图片可确认信息中提炼可做视觉化的卖点、细节、场景、功能和理性说明信息。
4. 输出 6 页标准详情页 + 2 页可选增强页的中文生图提示词。

请严格遵守以下规则：

一、产品锁定规则
1. 每一页提示词都必须以“以原始实拍图作为唯一外观参考，严格复刻产品原貌”作为开头约束。
2. 必须严格保持产品的品类、轮廓、结构、比例、颜色、材质表现、表面工艺不变。
3. 不得新增原图中不存在的接口、按钮、发光件、图案、部件和结构。
4. 允许切换镜头、角度和场景，但不能把产品改造成另一个款式。

二、信息真实性规则
1. 只能使用图片中可确认的信息和高置信度推断。
2. 看不清或无法确认的续航、功率、协议、参数、认证、芯片、版本，不得编造。
3. 如果页面必须展示参数，可使用“待补充参数位”“待补充规格位”“待补充连接信息位”占位。
4. 所有卖点要尽量写成利益点，但不得脱离真实产品外观瞎编性能。

三、3C 数码详情页设计规则
1. 详情页比例读取 detail_image_ratio 电商详情页。
2. 页面要像成熟品牌的完成态设计稿，不能是“产品居中 + 一行标题 + 空背景”的普通 AI 图。
3. 允许使用参数网格、界面元素、兼容设备、结构解构、图标栏、芯片式信息卡、能量流、信号线、波纹、光束等科技语言。
4. 每页至少形成 3 到 5 个信息区块，信息密度通过模块化排版实现，不靠长段文字。
5. 页面之间必须有职责区分，不能只是换背景。

四、文字与排版规则
1. 每页都必须明确写出主标题、副标题、卖点短句、信息模块内容。
2. 每页都必须写出文字位置、版式结构、字体气质、字号层级、对齐方式、字距、行距和颜色关系。
3. 中文文字必须清晰、可读、排版规整。
4. 如果产品偏硬核科技，字体和背景可以更有力量；如果偏商务极简，排版要更克制。

五、输出要求
1. 只输出“页面标题 + 中文生图提示词”，不要输出解释说明。
2. 每页提示词都必须足够细，能直接交给生图工具执行。
3. 不要输出英文版提示词。

请按以下结构输出：

## 页面 1：首图海报
中文生图提示词：
这一页必须做成 3C 品牌首屏海报。必须有强主标题、副标题、卖点标签、辅助徽章、底部信息条，画面要有第一眼冲击力。

## 页面 2：场景导入页
中文生图提示词：
这一页必须建立 3C 产品的使用场景，比如办公、通勤、游戏、桌面、户外、学习等。必须有场景空间、主标题、场景说明、2 到 4 个场景标签。

## 页面 3：核心卖点页 1
中文生图提示词：
这一页必须强调最强卖点，采用功能说明式版式。优先用产品主体或局部放大 + 3 到 5 个细节标注 + 数据块 / 图标 / 说明面板的结构。

## 页面 4：核心卖点页 2
中文生图提示词：
这一页必须做成信息矩阵页，适合放连接能力、便携性、操控体验、收纳关系、外观亮点、兼容关系等。必须有 3 到 4 个独立信息模块。

## 页面 5：细节 / 结构 / 参数页
中文生图提示词：
这一页必须强化结构、材质、接口、仓体、细节工艺或参数感。可以采用主细节特写 + 辅助窗口 + 参数块 + 引导线说明。

## 页面 6：参数 / 购买理由收尾页
中文生图提示词：
这一页必须做成完整收口页。既有规整参数区，也有购买理由和信任标签。如果参数不足，就用待补充占位，但版式必须完整高级。

## 可选页面 7：对比页
中文生图提示词：
这一页必须做成强对比感页面。可以做前后代际、不同模式、不同场景表现或优势总结，但不能是简单拼图。

## 可选页面 8：使用步骤 / 设备联动页
中文生图提示词：
这一页必须做成流程化或联动化信息页。适合展示开盖连接、设备切换、佩戴步骤、使用流程、场景切换等。

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

- 来源正文：`prompt\prompt.md`，标题：`3C数码类主图与详情页生图 SOP`。
- 本文件只做结构统一、运行时边界补充和明显错误修正，不替代原始 SOP 资料。
