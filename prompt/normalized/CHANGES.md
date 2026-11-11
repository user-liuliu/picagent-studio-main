# 清洗与修订记录

## 本轮处理原则

- 原始 `prompt/*.md` 文件保持不变，规范化结果单独放在本目录。
- 一个运行时模板对应一个 Markdown 文件；教程、工具说明、验收清单不再作为运行时模板正文。
- 主图和详情页默认由同一个规划模板生成，输出中的 `imageType` 用于拆分卡片。
- 白底精修、套图规划、单卡返修分别属于不同阶段，不能互相替换。
- 规划模板统一要求严格 JSON 输出，服务端先校验再创建任务和 XYFlow 卡片。

## 已修正的问题

- 将 `prompt.md` 中的汇总内容拆成 21 个可审阅的运行时模板副本。
- 统一补齐模板元数据：`code`、`kind`、`stage`、`execution_target`、来源信息。
- 统一补齐 `用户输入字段`、`System Prompt`、`User Prompt Template`、`Output Schema` 和运行时拆分规则。
- 合并规划模板补充 `output_mode`：`combined`、`main_only`、`detail_only`。
- 规划输出补充 `itemId`、`imageType`、`ordinal`，避免依赖“主图一”“页面一”等自然语言标题拆分。
- 原文中的自然语言输出示例保留作为设计规则，但明确声明不能覆盖运行时 JSON 协议。
- 将“外观跑品返修”规范化命名为“外观跑偏返修”，将“设计普通返修”规范化命名为“商业设计完成度返修”。
- 海产品规范化模板使用海产品类别名称，不继承原 SOP 中错误的“家具类”标题。

## 尚待审阅的内容

- 各品类正文仍尽量保留原有规则，部分类别的页面数量和模块建议可能存在重复，需要业务确认后再做二次合并。
- 反推类模板当前保留为独立规划模板，是否允许在工作台直接选择，需要产品确认。
- 单卡生图模板的完整字段还可以根据实际 provider 参数继续细化，目前先保留为任务级提示词模板。
- 本目录尚未导入数据库，也未修改运行时代码。

## 第二轮字段与消息分层

- 规划模板的 System Prompt 已分为 `System Core`、`System Planning Policy` 和 `Output Contract Instruction`。
- 原始正文中的七类规划规则仍保留，但数量、品牌、卖点、参数和设计风格改为显式模式字段，不再依赖空字符串触发隐式行为。
- 新增并统一使用：`main_image_count_mode`、`detail_image_count_mode`、`brand_mode`、`selling_points_mode`、`parameters_mode`、`design_style_mode`。
- `fixed` / `provided` 模式读取用户值；`auto` / `derive` 模式由模板策略补全；`to_confirm` 模式只能输出待补充或待核对占位符。
- `platform` 和 `output_language` 在规划模板中改为必填；品牌无资料时使用 `brand_mode=no_brand`，不得自动生成品牌名。
- User Prompt 只保留输入图片、已选 Chunk、动态字段和本次任务指令，不重复 System 规则。
- 包含内部 Markdown 代码块的原始提示词使用四反引号外层，避免 System Prompt 被截断。
- 规划模板正文中的固定页数、固定品牌和“为空时自动处理”表述已尽量替换为模式规则；视觉比例等低风险默认值暂保留为模板策略。
