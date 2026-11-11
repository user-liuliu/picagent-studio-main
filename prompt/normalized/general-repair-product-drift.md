---
code: general.repair.product_drift
name: "外观跑偏返修"
kind: repair
stage: task_image
execution_target: image_model
category: general
source_file: "prompt/00 全平台品类主图详情页通用 SOP（含跨境）.md"
aggregation_source: "prompt/prompt.md"
source_heading: "外观跑品返修"
source_sha256: 65a8a6fa7346367bc85298cb59c8350075979d94b2adcc7bf33697b68c233538
---

# 外观跑偏返修

> 这是由原始提示词整理生成的审阅版本。原始正文已尽量保留；规范化补充内容以“运行时统一”标记。

## 模板定位

用于 对单张图片进行定向返修。

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
    label: "参考产品图"
    type: text
    required: true
  - key: previous_image_version_id
    label: "上一版图片版本"
    type: text
    required: false
  - key: repair_focus
    label: "返修重点"
    type: textarea
    required: false
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
请基于上一版重新生成，但必须严格回到用户上传产品图的真实外观。保持产品品类、轮廓、比例、结构、颜色、材质、Logo、包装和可见细节不变。删除上一版中新增的错误部件、错误纹理、错误配件、错误文字或不存在的结构。可以优化背景、光影和版式，但不能改变产品本身。
````

## User Prompt Template

```text
原始产品图：
{{input_images}}

上一版图片：
{{previous_image}}

用户输入字段：
{{dynamic_input}}

请只修正返修重点，保留未要求修改的产品外观、构图和视觉系统。
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

- 来源正文：`prompt\prompt.md`，标题：`外观跑品返修`。
- 本文件只做结构统一、运行时边界补充和明显错误修正，不替代原始 SOP 资料。
