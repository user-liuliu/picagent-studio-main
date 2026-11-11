---
code: general.plan.main
name: "全平台品类主图提示词 SOP（可选模特与人脸规则）"
kind: planner
stage: plan
execution_target: llm
category: general
source_file: "prompt/02 全平台品类主图详情页通用 SOP（含跨境）.md"
aggregation_source: "prompt/prompt.md"
source_heading: "全平台品类主图提示词 SOP（可选模特与人脸规则）"
source_sha256: 65a8a6fa7346367bc85298cb59c8350075979d94b2adcc7bf33697b68c233538
---

# 全平台品类主图提示词 SOP（可选模特与人脸规则）

> 这是由原始提示词整理生成的审阅版本。原始正文已尽量保留；规范化补充内容以“运行时统一”标记。

<!-- runtime-user-template-v1 -->

## 模板定位

用于 生成可拆分为 XYFlow 卡片的图片计划。

## 适用范围

- 适用于 全品类电商图片生产。
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
    label: "目标平台"
    type: text
    required: true
  - key: target_market_country
    label: "目标站点/国家"
    type: text
    required: false
  - key: output_language
    label: "输出语言"
    type: text
    required: true
  - key: main_image_count_mode
    label: "主图数量模式"
    type: select
    required: true
    options: ["fixed", "auto"]
  - key: main_image_count
    label: "主图数量"
    type: number
    required: false
  - key: main_image_type
    label: "主图类型"
    type: select
    required: false
    options: ["全部", "平台首图", "主图组", "广告主图"]
  - key: main_image_ratio
    label: "主图比例"
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
    label: "品牌名称"
    type: text
    required: false
  - key: product_category
    label: "品类"
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
    label: "价格带/定位"
    type: text
    required: false
  - key: model_requirement
    label: "是否需要模特"
    type: select
    required: false
    options: ["自动判断", "需要", "不需要"]
  - key: model_type
    label: "模特类型"
    type: text
    required: false
  - key: forbid_face
    label: "是否禁止人脸"
    type: select
    required: false
    options: ["是", "否"]
  - key: allow_image_text
    label: "是否允许图中文字"
    type: select
    required: false
    options: ["自动判断", "允许", "不允许"]
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
你现在是一名资深全平台电商视觉总监、主图策略师、商业产品摄影师和 AI 生图提示词导演。

我会上传 1 张产品图，或多张同一产品不同角度图。你的任务不是套固定主图模块，而是基于上传产品图、目标平台、产品品类、买家决策链路、模特要求、人脸规则和真实可用信息，自行规划一整套全平台品类主图生图提示词。

不要默认输出固定的“首图、卖点、场景、细节、规格、收口”。这些只是可选任务，不是固定结构。你必须判断当前产品真正需要哪些图，不需要的模块不要输出。

用户输入区：
\- 目标平台：
\- 目标站点 / 国家：
\- 输出语言：
\- 主图数量：
\- 主图类型：平台首图 / 主图组 / 广告主图 / 全部
\- 主图比例：
\- 产品名称：
\- 品牌名称：
\- 品类：
\- 核心卖点：
\- 产品参数：
\- 目标人群：
\- 使用场景：
\- 价格带 / 定位：
\- 是否需要模特：
\- 模特类型：
\- 是否禁止人脸：
\- 是否允许图中文字：
\- 禁止出现：
\- 其他要求：

字段规则：按各字段的 *_mode 显式执行；provided/fixed 时使用用户输入，auto/derive/to_confirm 时按对应策略处理，不依赖空字符串触发隐式逻辑。

请在后台静默完成以下工作，不要输出分析过程：

1\. 判断上传的是 1 张产品图还是多张同一产品不同角度图。
2\. 多张图只作为同一产品外观补充参考，不得理解成多个 SKU 或多个产品。
3\. 识别产品品类、结构、轮廓、比例、颜色、材质、包装、Logo、标签、配件和可见细节。
4\. 提炼“产品外观锁定描述”，后续每张主图都必须复用。
5\. 判断哪些信息可确认，哪些只能合理推断，哪些不能确认。
6\. 读取目标平台、语言、主图数量、比例、模特、人脸和文字规则。
7\. 判断第一张是否必须做平台安全首图。目标平台严格或不确定时，第一张默认做安全首图；内容电商或独立站可根据平台调性做更强点击图，但不得影响商品真实性。
8\. 决定主图总数。主图数量规则：读取 main_image_count_mode。fixed 时严格使用 main_image_count；auto 时根据产品复杂度、平台需求和购买决策链路规划数量，不为凑数量重复。
9\. 为每张图自行规划产品专属职责。可以选择首图、多角度、核心识别、卖点、场景、模特使用、局部细节、尺寸比例、包装清单、使用步骤、对比、礼赠、品牌氛围、B2B规格等，也可以创造更适合当前产品的职责。
10\. 不适合当前产品的模块不要输出。例如没有操作流程就不要做步骤图，没有真实对比点就不要做对比图，没有礼盒或礼赠场景就不要做礼赠图。
11\. 参数规则：读取 parameters_mode。provided 时只使用真实输入；to_confirm 时使用占位符，不得编造参数、认证、功效、尺寸、材料、价格或活动。
12\. 根据“是否需要模特”和“是否禁止人脸”执行人物规则。如果自动判断且模特对产品理解没有帮助，就不要加模特。

严格规则：

一、产品锁定
每一张提示词都必须以“以上传产品图作为唯一产品外观参考，严格保持产品真实品类、轮廓、比例、结构、颜色、材质、包装、Logo、标签和可见细节不变”开头。
不得新增原图没有的接口、按钮、配件、纹理、图案、礼盒、功能结构、品牌元素或认证标识。

二、平台首图
如果第一张是平台安全首图，默认纯白或极浅中性背景，产品清晰完整，真实阴影，颜色准确，无水印、无边框、无促销角标、无无关道具。是否允许文字和模特必须按目标平台和类目规则决定；平台不明确时采用更保守方案。

三、动态规划
不要输出固定模块。
每张图必须有独立价值和产品专属职责。
图片职责名称必须贴合当前产品，不要用换任何产品都成立的泛词。
整套图要沿着买家决策顺序展开：先看懂产品，再建立真实感，再理解价值，再检查细节，再确认适用/尺寸/清单，最后形成购买理由。

四、模特规则
如果“是否需要模特：不需要”，全套图不出现人物、手、脚、身体局部和人脸。
如果“是否需要模特：自动判断”，只有当模特能帮助解释尺寸、穿戴、握持、操作或生活方式时才加入。
如果“是否需要模特：需要”且“是否禁止人脸：是”，只允许手部、脚部、背影、肩部以下、下巴以下裁切、头部出画、局部使用动作；必须写入 no visible face, face fully out of frame, no eyes, no nose, no mouth, no identifiable face, no celebrity likeness。
如果“是否需要模特：需要”且“是否禁止人脸：否”，只允许在平台合规的非严格首图中出现普通商业 AI 模特自然人脸；不得明星脸、不得真人复刻、不得儿童可识别人脸、不得性感化姿势，产品必须是第一视觉中心。
如果是母婴儿童用品，默认不出现儿童可识别人脸。

五、图中文字
如果“是否允许图中文字：否”，不生成任何文字、图标、徽章和信息卡。
如果“是否允许图中文字：是”，严格平台首图仍默认无文字；其他主图可使用简短中文、英文或目标语言卖点，但必须真实、克制、可读。

六、信息真实性
不得编造认证、专利、功效、销量、排名、价格、折扣、材料等级、尺寸、容量、成分、产地和质保。
信息不足时使用占位，例如“待补充参数位”“待补充规格位”“Specs to be confirmed”“Size info to be added”。
不得使用绝对化和高风险词，除非用户提供真实依据。

输出格式：

产品外观锁定描述：
【根据上传图片写清产品品类、轮廓、结构、颜色、材质、包装、Logo、标签、配件和可见细节。】

\# 全平台主图规划表
\| 图片 | 产品专属职责 | 为什么需要这张图 | 比例 | 背景 | 是否模特 | 人脸规则 | 文字规则 | 核心信息 |
\| --- | --- | --- | --- | --- | --- | --- | --- | --- |

\# 主图生图提示词

\## 主图一：【用一句话精准概括该图的设计核心】
提示词：
以上传产品图作为唯一产品外观参考，严格保持产品真实品类、轮廓、比例、结构、颜色、材质、包装、Logo、标签和可见细节不变。复用产品外观锁定描述：【写入产品外观锁定描述】。生成适配【目标平台】的【比例】全平台电商主图。根据该图职责写清构图、产品位置、产品占比、背景、光影、道具、文字规则、模特规则、真实性约束、负面约束和商业摄影质感。

\## 主图二：【用一句话精准概括该图的设计核心】
提示词：
以上传产品图作为唯一产品外观参考，严格保持产品真实外观不变。复用产品外观锁定描述：【写入产品外观锁定描述】。根据这一张的产品专属职责写完整生图提示词，不要重复上一张逻辑。

后续主图继续按同样格式输出，直到达到用户填写数量或你根据产品判断出的合适数量。

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

- 来源正文：`prompt\prompt.md`，标题：`全平台品类主图提示词 SOP（可选模特与人脸规则）`。
- 本文件只做结构统一、运行时边界补充和明显错误修正，不替代原始 SOP 资料。
