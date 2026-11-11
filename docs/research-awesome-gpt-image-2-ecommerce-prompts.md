# awesome-gpt-image-2 对电商生图提示词模板的启发

> 调研日期：2026-08-29  
> 仓库快照：`freestylefly/awesome-gpt-image-2` commit `c7d293963b21c60bf338003915438cc5c39dd3ca`（2026-08-28）  
> 范围：仓库自身、仓库链接的源码，以及 OpenAI 官方图片生成文档。本文不把社区案例的宣称等同于 API 已实现能力。

## 1. 结论摘要

1. **这个仓库真正有价值的不是某几条“神提示词”，而是资产组织方式。** 它把社区案例、工业模板、类别/风格/场景标签、Agent skill 和在线试生成放在一条链路里，并试图把散文提示词压缩为结构化协议。
2. **适合电商模板的核心字段非常稳定：** 商品主体、场景、构图、材质、光线、品牌色、准确文案、卖点层级、输出比例、保持项、修改项、禁止项。
3. **仓库展示了图生图语义写法，但网站本身并未实现图生图。** 案例中常写“使用上传图片”“保持瓶身/人脸/背景”，然而站点 API 实际只提交 `prompt`，固定调用单张 `1024x1024`、`quality: low` 的文生图请求。
4. **OpenAI 官方能力比仓库网站实现更完整。** GPT Image 2 官方 API 支持文生图、多图输入、图片编辑、透明蒙版区域编辑和多轮迭代；GPT Image 2 最多可接收 16 张输入图，输入保真度默认且仅为 high。
5. **图中文字需要独立建模。** 仓库最有效的写法是明确“精确字符串 + 位置 + 层级 + 禁止新增文字”，并减少文案数量。官方提示词指南也建议把文字内容、位置、字体和可读性分开说明，但官方仍明确提示复杂文字和精确排版可能失败。
6. **仓库没有 ControlNet。OpenAI 官方 GPT Image 2 API 也没有公开 ControlNet、Canny、Depth、Pose 等参数。** 仓库所说的“结构化控制”是提示词 Schema 和版式约束，不是扩散模型意义上的 ControlNet。
7. **产品化时应把“提示词模板”和“生成能力契约”分开。** 模板可以描述参考图、蒙版和结构条件，但只有 provider 明确支持时才能启用对应输入；否则会出现“提示词写了保持原商品，实际请求却没上传商品图”的假能力。
8. **本地 `imagegen` skill 更像执行规范，而不是模板资产库。** 它补足了输入图片角色、编辑不变量、逐字文字、单变量迭代和输出验收；其中模型参数仍应以当前官方文档和实际 provider 为准，不能把 skill 内的兼容性备注直接当成长期 API 事实。

## 2. 资料可信度分层

本文统一使用三个标签：

- **[仓库明确展示]**：能在仓库数据、源码、README 或 skill 中直接找到。
- **[官方能力]**：OpenAI 官方文档明确支持或明确列出的限制。
- **[产品化推论]**：基于前两类证据，对电商生图工作台的建议，不是仓库或 OpenAI 的原话。

优先级：官方 API 能力 > 仓库实际源码 > 仓库整理的社区案例 > 本文产品化推论。

## 3. 他们是怎么组织提示词资产的

### 3.1 案例层：保留原提示词和来源

**[仓库明确展示]** `data/cases.json` 的案例字段包括：

- `id`、`title`
- 结果图及替代文本
- `sourceLabel`、`sourceUrl`
- 完整 `prompt` 和 `promptPreview`
- `category`、`styles`、`scenes`
- 是否精选、GitHub 定位链接

当前数据文件声明并实际包含 541 条案例，共 13 个类别；其中“商品与电商”42 条。案例 ID 最大到 544，说明中间有 ID 空缺。README 仍写“全部 544 个案例”，与数据文件的 541 不一致，提示模板库需要自动化一致性检查。

### 3.2 模板层：把案例抽象成可填变量

**[仓库明确展示]** `docs/templates.md` 为每类提供：

- 常规模板
- 更适合 Agent 的 JSON 模板
- 某些细分场景模板
- 避坑指南

“商品与电商”常规模板抽象出的字段为：商品、卖点、场景、镜头、材质、灯光、附加元素、输出用途。JSON 示例进一步把内容分成 `product`、`setting`、`copywriting`、`constraints`。

电商避坑规则集中在：

- 材质和灯光要具体，不只写“高级、真实”。
- 促销文字控制在少量核心信息，避免满屏文案。
- 个性化美妆先分析再推荐，不要直接跳到结果图。
- 品牌特征用强调色、细线、字体气质、光影表达，不要只堆 Logo。
- 同一人物的试色矩阵需锁定身份，只改变唇色。

### 3.3 检索层：类别、风格、场景、案例四级匹配

**[仓库明确展示]** skill 的选择顺序是：

1. 模板类别
2. 视觉风格标签
3. 场景标签
4. 最近似的案例

`data/style-library.json` 是共享数据源，当前含 13 类、19 个风格、10 个场景和 22 个模板。网站与 Agent skill 共用它，而 `references/style-library.md` 是由 JSON 生成的可读索引。

商品类模板的元数据不只记录模板正文，还记录：

- `useWhen`：什么请求应使用该模板
- `guidance`：必须遵守的构建规则
- `pitfalls`：常见失败方式
- `exampleCases`：可追溯案例 ID

这比把模板只存成一段 Markdown 更适合产品检索、版本化和 Agent 自动选型。

### 3.4 编译层：统一成固定 Prompt Blocks

**[仓库明确展示]** Agent skill 的最终提示词块为：

- subject and task
- composition and layout
- visual style and materials
- text and label requirements
- aspect ratio and output format
- constraints and negative details

网站源码又细化为：主体、场景、构图、风格、文本、细节、输出、核心约束、需要避免。这说明仓库实际采用的是“模板元数据 -> 统一提示词骨架 -> 可复制提示词”，而不是直接把某条案例全文当模板。

### 3.5 试生成层：当前仅是 prompt-only 文生图

**[仓库明确展示]** 网站允许编辑案例 Prompt、发起生成、保存浏览器结果，并把案例原图与新生成图并排比较。但请求体只有 `caseId` 和 `prompt`。

服务端实际调用：

- provider：`CIYUAN_BASE_URL`（默认 `https://ciyuan.today`）提供的 OpenAI-compatible 接口，并非源码中直接请求 OpenAI 域名
- endpoint：`/v1/images/generations`
- model：`gpt-image-2`
- `n: 1`
- `size: 1024x1024`
- `quality: low`
- `format: jpeg`

因此，网站中的“原图 vs 生成结果”是视觉对比，不代表原图被作为模型输入。案例 Prompt 即使写了“使用上传图”，当前站点也没有上传图片、传多图或传蒙版的代码路径。

另一个资产治理信号是：社区案例中的“JSON Prompt”不一定是可解析 JSON，例如 Case 327 的英文段存在缺少分隔符/括号的片段。产品化模板应通过 Schema 校验后再进入运行时，不应因为外观像 JSON 就直接当结构化数据执行。

### 3.6 本地 imagegen skill：把提示词写法变成执行纪律

**[本地技能明确展示]** `C:\Users\25758\.codex\skills\.system\imagegen\SKILL.md` 和 `references/prompting.md` 最值得吸收的不是某个模型参数，而是以下执行规则：

- 先区分 `generate` 与 `edit`，不要把所有参考图任务都叫图生图。
- 每张输入图都标明角色，例如编辑目标、商品真值、风格参考、构图参考。
- 编辑时显式写出 `change only X; keep Y unchanged`，后续每轮继续重复不变量。
- 图中文字提供逐字文本、字体气质、位置、层级，并禁止额外字符。
- 先生成干净基线，再做一次只改一个变量的迭代。
- 验收不仅看“好不好看”，还看主体、构图、文字准确性、不变量和禁止项。
- Prompt 骨架与执行参数分开：`quality`、mask、输出格式和路径不是视觉场景描述。

**[产品化推论]** `awesome-gpt-image-2` 解决“从案例中选什么模板”，本地 `imagegen` skill 解决“拿到模板后怎样安全执行和迭代”。两者适合组合成：

```text
案例与标签检索
-> 选择模板族
-> 填充业务字段
-> 编译 Prompt Blocks
-> 绑定输入图角色和执行参数
-> 生成
-> 按文字/商品保真/构图/区域污染验收
-> 单变量返修
```

需要注意一个当前差异：本地 skill 的 CLI fallback 说明写着 `gpt-image-2` 不支持 `background=transparent`，而 2026-08-29 读取的 OpenAI 官方模型页和 Image API 指南将透明背景列为 GPT Image 2 能力。产品能力矩阵应优先采用官方当前文档，并用目标 provider 的真实请求做 smoke test；本地 skill 的说法应视为特定 CLI/版本兼容备注，而不是可直接复制的模型永久限制。

## 4. 文生图：适合电商的做法

### 仓库做法

**[仓库明确展示]** 商品提示词通常按以下顺序展开：

1. 定义商品和营销任务，例如主图、Campaign、包装、详情页、物料展架。
2. 定义商品为第一视觉焦点，并说明占比、位置、角度和镜头距离。
3. 具体描述材质、表面、边缘、液体、玻璃、织物等可见物理属性。
4. 固定灯光方向、光型、阴影、反射和背景。
5. 再添加卖点标签、标题或价格，不让文案抢商品。
6. 用禁止项排除错误品牌、杂乱道具、畸形结构、错误文字和不符合品类的风格。

案例 327 的价值在于 JSON 化的商品场景、材质、悬浮元素、文字层和整体氛围；案例 532 的价值在于把六宫格广告拆成全局构图、面板叙事、主商品、角色一致性、光线、材质、色彩、文字和负面约束。

### 官方能力

**[官方能力]** GPT Image 2 支持文生图，可通过 Image API 或 Responses API 使用。官方提示词指南建议：

- 明确图像类型和用途。
- 用可观察的视觉描述替代抽象形容词。
- 对位置、占比、相对关系和层级使用明确语言。
- 把文字内容、版式、风格和约束分开写。
- 首轮先锁定构图，后续再精修文字、材质或局部。

### 产品化推论：文生图模板

```yaml
task:
  asset_type: hero_image | listing_image | detail_banner | campaign | packaging
  channel: amazon | shopify | social | marketplace
product:
  name: ""
  category: ""
  defining_features: []
  materials: []
  finish: ""
  angle: ""
selling_message:
  primary_benefit: ""
  secondary_benefits: []
scene:
  environment: ""
  props: []
composition:
  aspect_ratio: ""
  product_position: ""
  product_frame_share: ""
  camera: ""
lighting:
  key_light: ""
  rim_light: ""
  shadow: ""
brand:
  palette: []
  mood: ""
text:
  exact_strings: []
  placement: []
constraints:
  must_have: []
  must_not_have: []
output:
  background: ""
  format: ""
  quality_target: ""
```

**[产品化推论]** 编译成自然语言时，先写“必须保持/必须出现”，再写风格词；避免把“8K、电影感、高级”等词当成主要控制手段。真正影响电商稳定性的通常是商品识别特征、物理材质、构图和文案边界。

## 5. 图生图与多图参考

### 仓库做法

**[仓库明确展示]** 仓库案例会使用以下语义：

- “使用上传图片/参考照片/attached image”指定身份或商品来源。
- 列出必须保持的具体特征，而不是只说“保持一致”。
- 把参考图职责分开：身份、商品外观、风格、构图或背景。
- 用 `ONLY`、优先级列表、保持项和禁止项减少整体漂移。

典型案例：

- Case 519：保持香水瓶造型、玻璃材质、瓶盖和原标签，只重做周围场景与光影。
- Case 530：只把照片中的人物替换为涂鸦角色，背景、透视、机位和环境对象保持写实。
- Case 543：把旅行照片转成珐琅徽章，但保持景观与人物的原始空间关系。
- Case 353：同一张脸生成多个唇色，要求身份、肤质和光影一致，只改变唇色。

这些案例说明“保持一致”需要拆成可检查的锚点：形状、比例、标签、颜色、纹理、姿态、机位、光线、遮挡关系。

但需强调：**这些是案例 Prompt 的写法，不是该仓库网站已实现的输入能力。**

### 官方能力

**[官方能力]** OpenAI Image API 的 `images.edit` 可接收一张或多张输入图。GPT Image 2 最多支持 16 张输入图，并对所有输入图使用 high input fidelity；官方提示无需再传 `input_fidelity`。

**[官方能力]** Responses API 适合对话式、多轮图片迭代，可以在上下文中继续编辑上一轮图片。Image API 更适合单次生成或单次编辑请求。

### 产品化推论：多图参考要显式分配角色

```yaml
references:
  - id: product_source
    role: identity_and_geometry
    preserve: [silhouette, proportions, label_layout, material, color]
  - id: style_reference
    role: lighting_and_art_direction
    borrow: [palette, contrast, background_treatment]
    do_not_copy: [logo, text, exact_composition]
  - id: scene_reference
    role: camera_and_environment
    borrow: [camera_angle, depth, prop_density]
edit_scope:
  change: [background, supporting_props, campaign_copy]
  preserve: [product_source]
```

**[产品化推论]** 不要只给模型“图 1、图 2、图 3”。UI 和模板中应把每张图标成“商品真值图、人物身份图、风格图、构图图、场景图”，并分别声明可借用内容和禁止复制内容。

## 6. 图中文字

### 仓库做法

**[仓库明确展示]** 仓库里有效的文字控制策略包括：

- 用引号提供精确字符串。
- 明确标题、副标题、角标、标签、价格各自位置和优先级。
- 指明不能翻译、缩写、替换或拼错。
- 指明不要新增其他大号可读文字。
- 控制促销信息数量，商品类模板建议只保留少量核心文案。
- 用版式语言描述文字与商品关系，例如置后、遮挡、环绕、贴标签或底部信息区。

Case 355 是强文字海报的代表：它把“精确标题”设为主视觉，并明确禁止多余板式和无关文字。Case 153 展示了包装标签的字段化替换。Case 519 则把原标签文字列入不可修改项。

### 官方能力与限制

**[官方能力]** 官方提示词指南建议把需渲染的文字用引号标记，并明确位置、字体特征、大小、颜色、层级和不换行要求。

**[官方能力]** 官方同时明确，图片模型仍可能在文字清晰度、精确放置和复杂排版上失败。复杂文字应拆分为更少、更清晰的内容，并通过迭代修正。

### 产品化推论：文字应成为独立数据结构

```yaml
text_policy:
  allow_generated_text: true
  forbid_extra_readable_text: true
text_items:
  - id: headline
    exact: "Silence the World"
    locale: en-US
    max_lines: 1
    position: top_left
    priority: primary
    style: bold_geometric_sans
  - id: price
    exact: "$299"
    max_lines: 1
    position: bottom_right_badge
    priority: secondary
```

**[产品化推论]** 对 SKU、价格、法律声明、成分、认证标志等不可错文字，应增加 OCR/人工验收；高风险场景更稳妥的做法是让模型生成留白和承载区域，再由排版层叠加确定性文字。不要把“模型一般能写字”当成“商业文字一定正确”。

## 7. 局部/区域重绘

### 仓库做法

**[仓库明确展示]** 仓库主要用语义边界实现“局部修改”：

- `Transform ONLY ...`
- 明确 `PRESERVE` 和 `CHANGE` 两张清单
- 指定背景、透视、机位、光线、人物数量、姿态、遮挡关系保持不变
- 用优先级列表告诉模型发生冲突时先保什么

Case 530 是最完整的语义区域编辑范例，但仓库 API 没有发送蒙版，所以它不能证明语义边界在该站点上等价于真实 inpainting。

### 官方能力

**[官方能力]** OpenAI Image API 支持以透明 PNG 蒙版指定编辑区域：蒙版透明处表示要替换的区域，蒙版与第一张输入图尺寸必须一致，且必须包含透明通道。官方建议 Prompt 描述完整的新图，而不只是描述被擦除区域。

**[官方能力]** 蒙版编辑不是像素级硬边界，结果可能不完全遵循蒙版形状。因此仍需把保持项写进 Prompt，并做结果验收。

### 产品化推论：区域编辑模板

```yaml
operation: masked_edit
base_image: product_source
mask:
  semantic_name: background_only
  selected_regions: [background]
preserve:
  - product silhouette and dimensions
  - product label text and logo placement
  - product color and material
  - camera angle and product position
change:
  - replace background with a clean spring studio set
  - add soft mint roses behind, never covering the label
global_result:
  - coherent contact shadow
  - consistent reflections and depth of field
forbid:
  - repainting product pixels
  - changing label text
  - adding extra products
```

**[产品化推论]** 产品 UI 应同时保存“蒙版本身”和“语义区域名”。蒙版决定大致范围，语义规则决定该区域应怎样变化以及相邻区域必须怎样保持。

## 8. ControlNet 与结构控制

### 仓库和官方的真实边界

**[仓库明确展示]** 全仓库未发现 `ControlNet`/`controlnet`。仓库中的“结构化控制”指 Prompt-as-Code、JSON Schema、构图和版式字段。

**[官方能力]** GPT Image 2 的公开 Image API 参数包含 prompt、输入图片、mask、size、quality、background、output format 等，但没有 ControlNet、Canny、Depth、OpenPose、lineart、conditioning scale 等参数。

因此应明确：

- 参考图高保真不是 ControlNet。
- 蒙版局部编辑不是 ControlNet。
- 提示词中的“保持姿态/构图”不是 ControlNet。
- 如果未来某个第三方 provider 支持 ControlNet，那是 provider 专属能力，不能标成 GPT Image 2 原生能力。

### ControlNet 真正控制的是什么

**[一手技术资料]** ControlNet 原论文的核心做法，是在预训练扩散模型之外增加可训练的条件控制分支，同时保留锁定的原模型权重。它接收与画面空间对齐的条件图，例如边缘、深度、人体姿态、分割区域或草图，以更强地约束轮廓、空间关系和姿态。

Hugging Face Diffusers 的官方实现进一步把它落成独立执行输入：

- `control_image`：边缘图、深度图、姿态图等条件图。
- `controlnet_conditioning_scale`：条件影响强度。
- `control_guidance_start` / `control_guidance_end`：条件在去噪过程中的生效区间。
- 多 ControlNet：可同时组合多个条件，但需要 provider、模型和显存真正支持。
- img2img、inpaint 和 ControlNet 是可组合但不同的 pipeline；它们不应在产品模型里合并成一个模糊的“图生图”开关。

### 对电商场景的实际用途

| 条件类型 | 适合控制 | 电商用途 | 不能保证 |
|---|---|---|---|
| Canny / SoftEdge | 外轮廓和主要边线 | 保持包装轮廓、瓶身形状、陈列架结构 | 标签文字、材质、品牌细节完全一致 |
| Depth | 前后关系和空间层次 | 商品与道具的前后层级、室内场景透视 | 精确像素位置和商品身份 |
| Pose / OpenPose | 人体骨架和姿态 | 模特持物姿势、服饰展示动作、同姿态多套图 | 人脸身份、手指、服装细节 |
| Segmentation | 区域类别和版块 | 商品区、背景区、文案区、道具区的大体分区 | 边缘像素完全不泄漏 |
| Lineart / Scribble | 线稿和草图布局 | 包装概念、详情页草图、展架结构探索 | 成品材质和法务文字 |

**[产品化推论]** ControlNet 最适合做“结构稳定器”，不适合承担商品真值、包装文字或品牌授权。商品保真仍需原商品图、明确不变量、结果比对和人工验收。

### 产品化推论：用能力层表达，而不是把参数塞进 Prompt

```yaml
structure_control:
  mode: prompt | reference_image | mask | edge | depth | pose
  provider_support_required: true
  condition_asset_id: null
  preprocessor: null
  preprocessor_params: {}
  strength: null
  guidance_start: null
  guidance_end: null
  preserve_geometry: true
```

**[产品化推论]** 对 GPT Image 2，当前可启用 `prompt`、`reference_image`、`mask`；`edge`、`depth`、`pose` 应显示为不支持或交给其他 provider。即使模板库保留统一字段，编译器也不应把不支持的控制参数伪装成一句自然语言后宣称“已启用 ControlNet”。

若接入支持 ControlNet 的 provider，还应冻结条件图版本、预处理器及其参数、ControlNet 模型版本、conditioning scale、guidance 区间、基础模型、seed、img2img strength 和 mask 版本。否则同一模板无法复现，也无法判断结果差异来自 Prompt 还是控制条件。

## 9. 迭代策略

### 仓库做法

**[仓库明确展示]** README 推荐的流程是：

1. 先用画廊确定输出类型。
2. 找相近案例，复用结构而不是只抄风格词。
3. 回到模板，把业务变量填进通用模板或 JSON 模板。

网站允许编辑案例 Prompt 后试生成，并并排比较原案例图与结果图。这是一个轻量的“参考 -> 改 Prompt -> 再生成”循环，但不是模型上下文中的多轮编辑。

### 官方能力

**[官方能力]** OpenAI 官方推荐将复杂图片分阶段生成和修正。Responses API 支持多轮图片迭代，后续指令可以引用前一轮结果；官方提示每轮尽量用动作导向的修改说明，并重复最重要的保持项。

### 产品化推论：电商迭代应使用“稳定基线 + 本轮差异”

```yaml
baseline_locked:
  - product identity
  - camera angle
  - composition
  - approved copy
current_delta:
  change_only:
    - make rim light softer
    - reduce prop count from five to two
    - move price badge to bottom right
acceptance:
  - label remains unchanged
  - product occupies 55-65 percent of frame
  - no extra readable text
```

建议分轮锁定：

1. **构图轮**：商品位置、角度、占比、留白。
2. **材质轮**：包装、玻璃、金属、织物、液体、阴影。
3. **品牌轮**：色彩、光影、道具密度、气质。
4. **文字轮**：只处理标题、价格、标签和可读性。
5. **局部修复轮**：使用 mask 改错误区域，重复保持项。

## 10. 推荐的电商提示词模板体系

以下均为 **[产品化推论]**，是从仓库和官方文档抽象出的产品结构，并非仓库原模板原文。

### 10.1 公共母模板

```text
任务：[资产类型]，用于[平台/位置/受众]。

商品主体：
- 商品：[名称/品类]
- 必须保持：[形状、比例、颜色、包装、标签、Logo、材质]
- 主视角：[角度、镜头距离、主体占比]

场景与构图：
- 场景：[棚拍/生活方式/概念广告]
- 主体位置：[位置]
- 留白：[为标题/按钮/裁切预留的位置]
- 辅助道具：[数量、位置、与商品关系]

材质与光线：
- 可观察材质细节：[列表]
- 主光：[方向和软硬]
- 轮廓光/反射/接触阴影：[要求]

品牌与文字：
- 品牌调性：[关键词]
- 精确文字：[逐条字符串]
- 文字位置与层级：[逐条说明]
- 不要生成任何额外可读文字

输出：
- 比例：[比例]
- 背景：[透明/纯色/场景]
- 完成度：[商业摄影/电商详情页/社媒 Campaign]

必须避免：
- [错误商品结构]
- [标签或文字变化]
- [无关道具/错误反射/透视/多余商品]
```

### 10.2 图生图附加块

```text
参考图职责：
- 商品图 A：商品身份与几何真值，只能修改[允许项]
- 风格图 B：仅借用色彩、光线和背景处理，不复制商品、Logo 和文字
- 构图图 C：仅借用机位、主体占比和留白结构

保持优先级：商品身份 > 包装文字 > 形状比例 > 材质颜色 > 构图 > 风格。
```

### 10.3 精确文字附加块

```text
只渲染以下可读文字：
1. 主标题："[精确字符串]"，位于[位置]，最多[行数]行。
2. 价格："[精确字符串]"，位于[位置]，不得改变货币符号和小数。
3. 卖点："[精确字符串]"，字号低于主标题。

不要翻译、改写、补全或新增其他可读文字。
```

### 10.4 局部重绘附加块

```text
编辑区域：[蒙版/语义区域名]。
只修改：[修改项]。
必须保持：[未选区的商品、标签、光线连续性、机位、遮挡关系]。
修改后整图应保持：[接触阴影、反射、景深、色温]一致。
```

### 10.5 结构条件附加块

```text
结构输入：[边缘图/深度图/姿态图/布局草图]。
结构职责：[只控制轮廓/空间深度/人物姿态/版块位置]。
允许偏离：[范围]。
不得覆盖：[商品身份、包装文字、品牌色]。
```

注意：最后这一块只有 provider 真正支持对应条件输入时才有效；GPT Image 2 当前不能据此宣称启用了 ControlNet。

## 11. 适合建立的模板分类

**[产品化推论]** 对电商工作台，比按“好看风格”分类更实用的是按任务分类：

| 模板族 | 主要输入 | 核心控制 | 典型验收 |
|---|---|---|---|
| 白底主图 | 商品参考图 | 商品身份、轮廓、居中、阴影 | 无多余物、标签正确、轮廓完整 |
| 场景主图 | 商品图 + 场景要求 | 尺度、接触关系、光线一致 | 商品不变、场景可信 |
| 卖点信息图 | 商品图 + 文案 | 信息层级、引线、局部特写 | 文字可读、指向正确 |
| 详情页横幅 | 商品图 + 品牌规范 | 留白、裁切、标题区 | 安全区正确、多端可裁切 |
| 促销 Campaign | 商品图 + 风格图 | 主视觉、价格/活动信息 | 商品仍是焦点、文案不拥挤 |
| 包装换景 | 包装真值图 | 包装全保持、背景替换 | 标签/Logo/结构零漂移 |
| 多 SKU 套图 | 多个商品图 | 尺寸关系、陈列顺序、一致光线 | SKU 不混淆、数量正确 |
| 局部修复 | 基图 + mask | 仅修改选区 | 非选区稳定、边缘自然 |

## 12. 已知限制与上线前检查

### 来源与版权

**[仓库明确展示]** 仓库说明大量内容来自公开社区，并明确不保证第三方内容可商用。电商生产不能因为案例进入开源仓库就推定拥有商品图、品牌、Logo、人物或提示词的商业授权。

### 模型限制

**[官方能力]** OpenAI 官方列出的图片模型限制包括：

- 复杂请求可能需要更长延迟。
- 精确文字和复杂排版仍可能出错。
- 重复人物或品牌元素的一致性可能漂移。
- 极严格的构图控制可能不能完全满足。
- 蒙版边界不是像素级硬约束。

### 建议验收项

**[产品化推论]** 每张电商图至少检查：

- 商品数量、形状、比例、关键部件是否正确。
- 标签、Logo、价格、SKU 和卖点文字是否逐字正确。
- 商品颜色和材质是否与参考图一致。
- 手、人物、包装、容器、液体和反射是否存在明显生成错误。
- 构图安全区和平台比例是否满足投放位置。
- 未授权品牌、人物、图案或第三方风格是否被带入。
- 局部重绘是否污染未选区。
- 多图参考是否发生身份混合或 SKU 串图。

## 13. 对当前套图工作台最值得吸收的部分

1. **吸收数据结构，不直接复制超长案例。** 用 category/style/scene/useWhen/guidance/pitfalls/exampleCases 管理模板。
2. **把 Prompt 编译器固定成公共块。** 主体、场景、构图、材质、光线、文字、保持项、修改项、禁止项、输出。
3. **给参考图分配职责。** 商品真值、身份、风格、构图、场景不可混成一个“参考图”字段。
4. **把文字和蒙版变成一等输入。** 它们不应只藏在自由文本里。
5. **建立 provider capability matrix。** 文生图、多图、mask、透明背景、结构控制分别声明是否真实支持。
6. **保存模板版本、编译后 Prompt、输入资产和 provider 参数。** 才能复现和比较迭代结果。
7. **模板预览必须展示来源和授权风险。** 社区案例可用于结构研究，不自动获得商业使用权。
8. **沿用现有阶段，不为每种能力新增模板阶段。** `base_refine`、`plan`、`task_image` 继续表达业务阶段；参考图、mask、文字策略和 ControlNet 应是模板输入契约或 provider execution spec。
9. **复用现有快照边界。** 当前工作台已经冻结模板版本、最终 Prompt、输入引用和 provider 摘要；本调研建议是在该快照中补足输入图角色、文字策略、mask/条件图版本和能力检查，不重写现有 P/V 模型。
10. **保留确定性文字叠加决策。** 当前结构计划已有 text-overlay decision；SKU、价格、规格、认证和法务文案优先走确定性排版，模型原生文字用于低风险标题或视觉探索。

当前仓库的 `docs/gpt-image-2.md` 是目标第三方接口说明，不等同于 OpenAI 官方契约。它记录了文生图和多图编辑，但未记录 mask 或 ControlNet 参数；因此现有 provider 在完成真实 smoke test 前，只应声明已验证的能力，不应因为 OpenAI 官方或其他 Diffusers provider 支持就自动开启。

## 14. 一手来源

### awesome-gpt-image-2 仓库

- [README：项目愿景、分类、使用流程、声明](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/README.zh-CN.md)
- [工业级模板与商品电商模板](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/docs/templates.md)
- [Agent skill 工作流](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/agents/skills/gpt-image-2-style-library/SKILL.md)
- [共享风格库数据](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/data/style-library.json)
- [案例数据：Case 153、327、353、355、519、530、532、543](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/data/cases.json)
- [前端模板编译和试生成流程](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/src/main.jsx)
- [服务端 prompt-only 生成实现](https://github.com/freestylefly/awesome-gpt-image-2/blob/c7d293963b21c60bf338003915438cc5c39dd3ca/api/generate-image.js)

### OpenAI 官方资料

- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [Image generation prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Images API: create an image](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [Images API: create an image edit](https://developers.openai.com/api/reference/resources/images/methods/edit)

### ControlNet 一手资料

- [ControlNet 原论文：Adding Conditional Control to Text-to-Image Diffusion Models](https://arxiv.org/abs/2302.05543)
- [Hugging Face Diffusers：ControlNet pipelines](https://huggingface.co/docs/diffusers/en/api/pipelines/controlnet)
- [Hugging Face Diffusers：ControlNet 使用指南](https://huggingface.co/docs/diffusers/en/using-diffusers/controlnet)

### 本地 imagegen skill

- `C:\Users\25758\.codex\skills\.system\imagegen\SKILL.md`
- `C:\Users\25758\.codex\skills\.system\imagegen\references\prompting.md`
- `C:\Users\25758\.codex\skills\.system\imagegen\references\sample-prompts.md`
- `C:\Users\25758\.codex\skills\.system\imagegen\references\image-api.md`
