# 规范化提示词目录

> 原始文件保留在 `prompt/`；本目录是本轮清洗后的审阅副本。

| Code | Name | Kind | Stage | Source |
|---|---|---|---|---|
| `general.plan.combined` | 全平台品类主图详情页通用 SOP（含跨境） | `planner` | `plan` | `全平台品类主图详情页通用 SOP（含跨境）` |
| `general.plan.detail` | 平台品类详情页生成（含跨境电商） | `planner` | `plan` | `平台品类详情页生成（含跨境电商）` |
| `general.plan.main` | 全平台品类主图提示词 SOP（可选模特与人脸规则） | `planner` | `plan` | `全平台品类主图提示词 SOP（可选模特与人脸规则）` |
| `general.plan.detail.reverse` | 爆品详情页反推通用SOP（升级版） | `planner` | `plan` | `爆品详情页反推通用SOP（升级版）` |
| `general.plan.main.reverse` | 04 爆品主图反推通用SOP | `planner` | `plan` | `04 爆品主图反推通用SOP` |
| `electronics.plan.combined` | 3C数码类主图与详情页生图 SOP | `planner` | `plan` | `3C数码类主图与详情页生图 SOP` |
| `beauty.plan.main` | 美妆日化类主图整套生图提示词 | `planner` | `plan` | `美妆日化类主图整套生图提示词` |
| `household.plan.main` | 百货杯壶类主图整套生图提示词 | `planner` | `plan` | `百货杯壶类主图整套生图提示词` |
| `household.plan.detail` | 百货杯壶类详情页整套生图提示词 | `planner` | `plan` | `百货杯壶类详情页整套生图提示词` |
| `food.plan.main` | 美食类主图整套生图提示词 | `planner` | `plan` | `美食类主图整套生图提示词` |
| `food.plan.detail` | 美食类详情页整套生图提示词 | `planner` | `plan` | `美食类详情页整套生图提示词` |
| `apparel.plan.detail` | 服饰类详情页整套生图提示词 | `planner` | `plan` | `服饰类详情页整套生图提示词` |
| `furniture.plan.detail` | 家具类详情页整套生图提示词 | `planner` | `plan` | `家具类详情页整套生图提示词` |
| `seafood.plan.main` | 海产品主图提示词 | `planner` | `plan` | `海产品主图提示词` |
| `seafood.plan.detail` | 海产品详情页提示词 | `planner` | `plan` | `海产品详情页提示词` |
| `seafood.plan.combined` | 海产品整套生成提示词 | `planner` | `plan` | `海产品整套生成提示词` |
| `general.base_refine` | 产品图转干净产品底图 | `direct_generation` | `base_refine` | `产品图转干净产品底图返修提示词` |
| `general.repair.product_drift` | 外观跑偏返修 | `repair` | `task_image` | `外观跑品返修` |
| `general.repair.text` | 图中文字错误返修 | `repair` | `task_image` | `文字错误返修` |
| `general.repair.factuality` | 信息真实性返修 | `repair` | `task_image` | `信息虚构返修` |
| `general.repair.design` | 商业设计完成度返修 | `repair` | `task_image` | `设计普通返修` |

## 清洗说明

- 一个运行时模板对应一个文件。
- 原始提示词正文放在 `System Prompt`，动态字段放在 `User Prompt Template`。
- 规划模板统一输出 `suite-plan-v1` JSON，服务端按 `items` 拆成卡片。
- 主图和详情页在同一规划模板中通过 `imageType` 区分；只有工作流不同才拆模板。
- 当前副本未覆盖原始文件，待人工审阅后再决定是否回写或导入数据库。
