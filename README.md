# PicAgent Studio · 电商智能生图工作台

PicAgent 桌面端套图工作台独立项目。

当前已建立 Ticket 01 的正式前端应用骨架，后续能力按 `docs/PRD-套图工作台-V1.md` 逐步接入。

## 本地运行

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

可访问路由：

- `/suites/new`
- `/suites/:suiteId`
- `/suites/:suiteId/board`

类型检查与生产构建：

```powershell
npm run typecheck
npm run build
```

## 当前范围

- 桌面端，不做移动端；
- 1–6 张原图上传、白底精修、套图计划、卡片生成和历史版本；
- 生图模型使用环境变量配置的 `gpt-image-2`；
- PostgreSQL 和 MinIO 使用服务器实例；
- 登录界面与权限暂不作为首版工作台开发阻塞项。

## 文档

- [套图工作台 V1 PRD](docs/PRD-套图工作台-V1.md)
- [生图模型配置说明](docs/gpt-image-2.md)
- [原型基准说明](docs/原型基准说明.md)

## 原型

原型入口位于 `prototype/index.html`。后续套图工作台开发以 `prototype/` 中的套图创建首页和套图创作工作台为交互与页面结构基准。
