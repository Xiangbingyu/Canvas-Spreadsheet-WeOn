# backend-js

`backend-js` 是当前项目的后端服务，提供：

- HTTP 接口
- WebSocket 协同接口
- 文档读写、撤销重做、导入、标题修改
- `memory / mysql / redis` 可切换的二期基础设施

## 环境说明

- Node 版本要求见 [package.json](file:///E:/Github/redo/Canvas-Spreadsheet-WeOn/backend-js/package.json)
- 安装依赖：

```bash
npm install
```

- 本目录提供 [`.env.example`](file:///E:/Github/redo/Canvas-Spreadsheet-WeOn/backend-js/.env.example) 作为示例配置
- 如果你要使用 `.env`，请先复制一份：

```bash
Copy-Item .env.example .env
```

## 启动规则

这套后端有一个非常重要的规则：

- **只有显式使用 `--env-file=.env` 启动时，才会读取 `.env`**
- 直接执行 `node server.js` 或 `npm start` 时，**不会自动加载 `.env`**

这意味着：

- 没有 `.env`，并且也没有额外注入环境变量时，默认走 **内存链路**
- 有 `.env` 文件，但启动命令没有带 `--env-file=.env` 时，`.env` **也不会生效**

## 正常启动

### 1. 默认内存态启动

适合首次启动、单机开发、快速验证。

```bash
npm start
```

或：

```bash
node server.js
```

默认行为：

- 端口默认 `3000`
- `STORE_DRIVER=memory`
- `CACHE_DRIVER=memory`
- `RUNTIME_STATE_DRIVER=memory`
- `IDEMPOTENCY_DRIVER=memory`
- `DOC_LOCK_DRIVER=memory`

### 2. 使用 `.env` 启动

适合需要按 `.env` 中的 `mysql + redis` 或自定义端口运行的场景。

```bash
node --env-file=.env server.js
```

如果你使用当前的 [`.env`](file:///E:/Github/redo/Canvas-Spreadsheet-WeOn/backend-js/.env)，则会按文件中的配置启动，例如：

- `PORT=3001`
- `STORE_DRIVER=mysql`
- `CACHE_DRIVER=redis`
- `RUNTIME_STATE_DRIVER=redis`
- `COLLAB_BROADCAST_DRIVER=redis`
- `IDEMPOTENCY_DRIVER=redis`
- `DOC_LOCK_DRIVER=redis`

### 3. 开发模式启动

不加载 `.env` 的监听重启模式：

```bash
npm run dev
```

如果你既想监听重启，又想使用 `.env`，请手动执行：

```bash
node --env-file=.env --watch server.js
```

## 常见启动场景

### 场景一：第一次拉项目，只想先跑起来

直接执行：

```bash
npm start
```

这时默认走内存链路，不依赖 MySQL 和 Redis。

### 场景二：需要验证 MySQL + Redis 形态

先准备 `.env`，再执行：

```bash
node --env-file=.env server.js
```

### 场景三：多实例本机联调

第一实例：

```bash
node --env-file=.env server.js
```

第二实例：

```bash
$env:PORT='3002'; $env:SERVER_ID='server-local-2'; node --env-file=.env server.js
```

注意：

- 多实例时每个实例都应使用不同的 `PORT`
- 多实例时每个实例都应使用不同的 `SERVER_ID`

## 测试方式

## 1. 自动化测试

### 默认测试

以下命令默认**不加载 `.env`**，更接近内存链路：

```bash
npm test
```

```bash
npm run test:ws
```

### Redis / 多实例专项测试

以下命令会显式加载 `.env`：

```bash
npm run test:cache-redis
```

```bash
npm run test:multi-instance
```

### 数据库脚本

以下命令也会显式加载 `.env`：

```bash
npm run db:reset
```

```bash
npm run db:seed
```

## 2. 黑盒接口脚本

项目内置了两套 PowerShell 黑盒脚本，用于直接验证接口是否可用。

### HTTP 接口黑盒

[check-docs-api.ps1](file:///E:/Github/redo/Canvas-Spreadsheet-WeOn/backend-js/scripts/check-docs-api.ps1)

单实例：

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\check-docs-api.ps1 -BaseUrl http://127.0.0.1:3000
```

双实例：

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\check-docs-api.ps1 -BaseUrl http://127.0.0.1:3001 -SecondaryBaseUrl http://127.0.0.1:3002
```

覆盖内容：

- `POST /docs`
- `GET /docs/:docId`
- `GET /docs`
- `POST /docs` 幂等
- 缺失文档 / 非法参数
- 可选跨实例读取与跨实例幂等

### WebSocket 接口黑盒

[check-ws-api.ps1](file:///E:/Github/redo/Canvas-Spreadsheet-WeOn/backend-js/scripts/check-ws-api.ps1)

单实例：

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\check-ws-api.ps1 -BaseUrl http://127.0.0.1:3000 -WsUrl ws://127.0.0.1:3000
```

双实例：

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\check-ws-api.ps1 -BaseUrl http://127.0.0.1:3001 -WsUrl ws://127.0.0.1:3001 -SecondaryBaseUrl http://127.0.0.1:3002 -SecondaryWsUrl ws://127.0.0.1:3002
```

覆盖内容：

- `join`
- `presence`
- `set_cell`
- `undo`
- `redo`
- `set_title`
- `import_sheet`
- `baseSeq` stale / future / barrier 路径
- 切房后旧房操作 `4003`
- 非法消息类型 `4001`
- 可选跨实例广播与跨实例 presence

## 如何判断当前是不是用了 `.env`

最直接的办法就是看启动命令：

- `node server.js` -> **没有使用 `.env`**
- `npm start` -> **没有使用 `.env`**
- `node --env-file=.env server.js` -> **使用了 `.env`**

另一个办法是看启动日志中的端口：

- 如果 [`.env`](file:///E:/Github/redo/Canvas-Spreadsheet-WeOn/backend-js/.env) 配的是 `PORT=3001`
- 但启动日志还是 `Server listening on port 3000`
- 那就说明这次启动**没有真正加载 `.env`**

## 推荐做法

- 单机快速开发：`npm start`
- 本机联调 MySQL + Redis：`node --env-file=.env server.js`
- 多实例本机验证：两个终端分别启动两个实例，并设置不同的 `PORT` / `SERVER_ID`
- 接口验收：优先使用 `check-docs-api.ps1` 和 `check-ws-api.ps1`
