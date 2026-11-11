---
code: general.base_refine
name: "产品图转干净产品底图"
kind: direct_generation
stage: base_refine
execution_target: image_model
category: general
source_file: "prompt/00 全平台品类主图详情页通用 SOP（含跨境）.md"
aggregation_source: "prompt/prompt.md"
source_heading: "产品图转干净产品底图返修提示词"
source_sha256: 65a8a6fa7346367bc85298cb59c8350075979d94b2adcc7bf33697b68c233538
---

# 产品图转干净产品底图

> 这是由原始提示词整理生成的审阅版本。原始正文已尽量保留；规范化补充内容以“运行时统一”标记。

## 模板定位

用于 生成后续生图使用的干净产品底图。

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
  - key: source_image_ids
    label: "输入产品图"
    type: text
    required: true
  - key: background_target
    label: "目标背景"
    type: text
    required: false
    default: "纯白或浅灰白"
```

## 默认值与补全规则

- 空字段由模型根据产品图片、已选参考资料和品类常识补全。
- 设计师已填写的字段不得被自动覆盖。
- 数量、比例、语言等字段为空时，沿用模板正文中的默认规则；没有默认规则时使用平台安全的保守值。

## System Prompt

### System Core

- 保持产品外观、结构、颜色、材质和可见品牌信息真实。
- 只执行当前任务，不重新规划整套图片。
- 未要求修改的内容不得被覆盖。

### Task Policy

````text
请把我上传的产品图精修成适合后续全平台电商主图生图参考的干净产品底图。严格保持产品原本的品类、轮廓、比例、结构、颜色、材质、表面工艺、Logo、标签、包装和可见细节不变。背景处理为干净纯白、浅灰白或极简中性底色，去除杂物、水印、脏污、过曝、阴影混乱和无关元素。不要新增原图没有的按钮、接口、配件、包装、文字、纹理、装饰、功能结构、认证标识或品牌元素。如果上传了多张同一产品不同角度图，只把它们作为同一产品外观补充参考，不要合成不存在的新结构。输出主体完整、边缘清晰、光影自然、真实可信、适合继续用于全平台电商主图生成的产品底图。
````

## User Prompt Template

```text
输入产品图：
{{input_images}}

用户输入字段：
{{dynamic_input}}

请输出一张可供后续生图使用的产品底图。
```

## Output Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "outputType": {
      "const": "image_generation"
    }
  }
}
```

## 运行时拆分规则

- 本模板每次只作用于当前图片任务或当前底图版本。
- 生成结果必须保存为不可变版本，不覆盖历史结果。

## 来源与修订说明

- 来源正文：`prompt\prompt.md`，标题：`产品图转干净产品底图返修提示词`。
- 本文件只做结构统一、运行时边界补充和明显错误修正，不替代原始 SOP 资料。
