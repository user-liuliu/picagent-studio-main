# 套图工作台 V1.1 真实验收记录

**日期：** 2026-08-26  
**验收 API：** `http://127.0.0.1:3008`  
**验收浏览器：** `http://127.0.0.1:5174`（Vite 代理到 3008，视口 1440×1000）

## 结果

- Ticket 01–05：实现与契约验收通过。
- Ticket 06：真实链路验收通过。
- 全量自动化测试：81/81 通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- Impeccable detector：无新增问题。

## 真实链路

- 原图：`素材/实拍图/鼠标1.jpg`。
- QWEN 结构计划：`dashscope/qwen3.8-27b`，主图 1 张、详情图 3 张。
- 已确认类别：`appearance_angles` 1、`lifestyle_use` 1、`material_detail` 1。
- 类别请求：先记录 4 个旧模板失败，再使用新模板逐类重试；4 类均成功，每类 1 条独立提示词，`retryOfRequestId` 关系可追溯。
- 任务卡：4 张，成功类别独立物化；全局风格卡、参考图和事实引用进入冻结提示词。
- 白底图：真实图片模型 `gpt-image-2`，`n=1`，版本尺寸 1254×1254。
- 主图：真实图片模型 `gpt-image-2`，`n=1`，批次完成，版本 1 持久化，提示词快照和 SHA-256 已保存。
- 旧 V1 兼容：历史方案“耳机亚马逊英国站”仍可通过 API 读取，`phase=legacy_plan`、16 个计划项。

## 桌面 UI

- 结构计划审核显示数量、类别理由、缺失事实和全局风格卡。
- 确认前可增加或删除合法类别；确认后规划输入锁定。
- 确认后显示类别进度、失败重试入口；刷新后从服务端恢复。
- V1.1 类别完成后“开始创作”按钮可用。
- 控制台无业务错误，无横向溢出；响应未暴露密钥、Authorization、base64 或临时 URL。

详细脱敏数据见 [`artifacts/real-qwen-v11-acceptance.json`](../artifacts/real-qwen-v11-acceptance.json)，截图见 [`artifacts/ticket06-v11-review-1440x1000.png`](../artifacts/ticket06-v11-review-1440x1000.png) 和 [`artifacts/real-main-v1.png`](../artifacts/real-main-v1.png)。
