# Canvas-Spreadsheet-WeOn

[![CI](https://github.com/Xiangbingyu/Canvas-Spreadsheet-WeOn/actions/workflows/ci.yml/badge.svg)](https://github.com/Xiangbingyu/Canvas-Spreadsheet-WeOn/actions/workflows/ci.yml)

可演示、可协作、可编辑的在线电子表格。支持上传 Excel → Canvas 渲染 → 单元格编辑 → 样式修改 → 撤销重做 → 多人实时协同。

前后端 monorepo 统一管理（`frontend/` + `backend-js/`）。

## 目录结构

```
Canvas-Spreadsheet-WeOn/
├── package.json              # 根脚本：pnpm dev 一键启动前后端
├── pnpm-workspace.yaml       # pnpm 工作区
├── .nvmrc                    # Node 版本锁定
│
├── frontend/                 # 前端：React + Vite + Canvas
│   ├── src/
│   │   ├── pages/            # 页面组装（StartPage、SpreadsheetPage）
│   │   ├── components/       # UI（Menubar、Toolbar、GrideCanvas、协同状态等）
│   │   ├── hooks/            # 交互、协同、历史等 React Hooks
│   │   ├── services/         # HTTP 客户端（httpAPI、httpType）
│   │   └── spreadsheet/      # 核心业务
│   │       ├── model/        # 领域类型
│   │       ├── store/        # Redux 状态（workbook、选区、协同态）
│   │       ├── render/       # Canvas 渲染（视口、分层绘制）
│   │       ├── interaction/  # 命中检测、选区、编辑交互
│   │       ├── collab/       # WebSocket 协同客户端
│   │       ├── history/      # Undo / Redo 历史栈
│   │       └── excel/        # Excel 导入 / 导出
│   └── .env.example
│
├── backend-js/               # 后端：Express + WebSocket
│   ├── server.js             # HTTP + WS 入口
│   ├── routes/               # REST 路由（docs、health）
│   ├── ws/                   # WebSocket 消息分发与 handlers
│   ├── service/              # 业务服务（协同、单元格、undo/redo 等）
│   ├── store/                # 持久化（memory / mysql 可切换）
│   ├── cache/                # 文档快照与元数据缓存
│   ├── protocol/             # 消息类型、校验、错误码
│   └── public/api-test.html  # 接口手动测试页
│
└── docs/                     # 项目文档（见下节）
```

## 文档

| 文档 | 内容 |
| ---- | ---- |
| [README.md](README.md) | 如何启动、核心能力、演示链接 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构图 + 关键链路说明（渲染、编辑、协同、undo） |
| [docs/COLLAB.md](docs/COLLAB.md) | 协同协议与一致性策略（对应课题要求的 PROTOCOL.md） |
| [docs/PERF.md](docs/PERF.md) | 性能指标与优化记录（可选） |
| [docs/接口文档.md](docs/接口文档.md) | HTTP / WebSocket 接口约定 |
| [docs/课题任务.md](docs/课题任务.md) | 课题背景、P0/P1 验收标准 |

## 演示链接

| 环境     | 地址                  | 说明                   |
| -------- | --------------------- | ---------------------- |
| 本地前端 | http://localhost:5173 | 执行 `pnpm dev` 后访问 |
| 本地后端 | http://localhost:3000 | REST API + WebSocket   |

> 本地前端默认通过 Vite 代理连接本机后端。若需前端连远程后端，在 `frontend/.env` 中配置 `VITE_API_BASE_URL` 与 `VITE_WS_URL`（见 `frontend/.env.example`），然后执行 `pnpm dev:fe`。

## 核心能力

围绕「**上传 → 渲染 → 编辑 → 样式 → 撤销重做 → 协同**」形成完整闭环：

**文档与工作表**

- 文档列表、新建空白表格、修改标题、分享链接协作
- 多工作表（Sheet 标签切换与新建），数据持久化，刷新不丢失

**Excel 导入与导出**

- 上传 `.xlsx` 解析为在线表格（Web Worker 后台解析，不阻塞页面）
- 导出当前文档（含多工作表与基础样式）为 `.xlsx`

**Canvas 表格编辑**

- Canvas 绘制网格与单元格，视口虚拟化，大表流畅滚动
- 单元格选中、双击/公式栏编辑，兼容中文输入法
- 工具栏修改样式：加粗、斜体、下划线、字号、字体颜色、背景色、水平对齐
- 右键增删行列，支持复制粘贴

**撤销与重做**

- 工具栏与快捷键（Ctrl/⌘ + Z、Ctrl/⌘ + Shift + Z）撤销/重做
- 覆盖文字修改、样式变更、行列结构变更

**多人实时协同**

- 至少两人同时编辑同一文档，修改实时同步
- 展示在线成员与协作者选区；断线自动重连与离线操作补发
- 并发修改冲突时以服务端顺序统一结果

**简单公式（基础）**

- 支持以 `=` 开头的简单公式输入与解析

## 快速开始

### 环境要求

| 工具    | 版本                   |
| ------- | ---------------------- |
| Node.js | 22.12.0（见 `.nvmrc`） |
| pnpm    | ≥ 10                   |

### 启动步骤

在**仓库根目录**执行（不要分别在子目录 `npm install`）：

```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量（首次）
cp frontend/.env.example frontend/.env
cp backend-js/.env.example backend-js/.env

# 3. 同时启动前后端
pnpm dev
```

启动后访问 http://localhost:5173 。开发模式下 HTTP/WS 经 Vite 代理转发到 `localhost:3000`，无需额外处理跨域。

### 常用命令

| 命令           | 说明                                          |
| -------------- | --------------------------------------------- |
| `pnpm dev`     | 同时启动前后端                                |
| `pnpm dev:fe`  | 仅前端                                        |
| `pnpm dev:be`  | 仅后端                                        |
| `pnpm build`   | 构建前端                                      |
| `pnpm lint`    | ESLint 检查前端                               |
| `pnpm test:be` | 后端 CI 测试（memory 驱动，无需 Redis/MySQL） |

## 技术栈

**前端**：React 19 · Vite · TypeScript · Redux Toolkit · Tailwind CSS · Ant Design · Canvas

**后端**：Node.js · Express · WebSocket（ws）· MySQL / Redis（可选，默认 memory 驱动）
