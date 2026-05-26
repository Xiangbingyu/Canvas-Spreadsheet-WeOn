# Canvas-Spreadsheet-WeOn

前后端放在同一仓库（monorepo）中统一管理。

## 目录结构

```
Canvas-Spreadsheet-WeOn/
├── package.json           # 根脚本：一键启动前后端
├── pnpm-workspace.yaml    # pnpm 工作区定义
├── docs/                  # 需求、接口
├── frontend/              # React + Vite + TypeScript
└── backend-js/            # Express + WebSocket
```

## 环境要求

| 工具    | 版本                   |
| ------- | ---------------------- |
| Node.js | 22.12.0（见 `.nvmrc`） |
| pnpm    | ≥ 10                   |

安装 Node 后建议执行：

```bash
corepack enable
corepack prepare pnpm@10.33.4 --activate
```

## 快速开始

在**仓库根目录**执行（不要分别在子目录用 npm install）：

```bash
# 1. 安装全部依赖
pnpm install

# 2. 复制环境变量示例（首次）
cp frontend/.env.example frontend/.env
cp backend-js/.env.example backend-js/.env

# 3. 同时启动前后端
pnpm dev
```

| 服务     | 地址                  |
| -------- | --------------------- |
| 前端     | http://localhost:5173 |
| 后端 API | http://localhost:3000 |

开发时前端通过 Vite proxy 转发 `/docs` `/health` `/ws` 到后端，无需处理跨域。

## 常用命令

在根目录执行：

| 命令          | 说明            |
| ------------- | --------------- |
| `pnpm dev`    | 同时启动前后端  |
| `pnpm dev:fe` | 仅前端          |
| `pnpm dev:be` | 仅后端          |
| `pnpm build`  | 构建前端        |
| `pnpm lint`   | ESLint 检查前端 |

## 技术栈

**前端**：React 19 · Vite · TypeScript · Tailwind CSS · Redux Toolkit

**后端**：Node.js · Express · ws
