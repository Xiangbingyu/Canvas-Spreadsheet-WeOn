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

## 前端路径别名

`frontend` 已配置 `@` 指向 `src` 目录，例如：

```ts
import { Menubar } from '@/components/Menubar/Menubar'
import type { Cell } from '@/spreadsheet/model/types'
```

配置位置：`frontend/vite.config.ts`、`frontend/tsconfig.app.json`。

## 技术栈

**前端**：React 19 · Vite · TypeScript · Tailwind CSS · Redux Toolkit

**后端**：Node.js · Express · ws

## 常见错误：EADDRINUSE（端口被占用）

### 现象

终端里后端报错类似：

```text
Error: listen EADDRINUSE: address already in use :::3000
Failed running 'server.js'
```

前端可能已正常（http://localhost:5173），但**后端起不来**。

### 原因

**3000** 端口已被其他进程占用。常见情况：

- 上次 `pnpm dev` / `pnpm dev:be` 没有关干净
- 本机其他程序占用了 3000

### 处理办法（二选一）

**方式 1：释放 3000 端口（推荐）**

Windows PowerShell：

```powershell
# 查看占用 3000 的进程
netstat -ano | findstr :3000

# 结束进程（将 <PID> 换成上一步最后一列的数字）
taskkill /PID <PID> /F
```

然后重新执行：

```bash
pnpm dev
```

**方式 2：改用其他后端端口**

1. 在 `backend-js/.env` 中设置，例如：`PORT=3001`
2. 同步修改 `frontend/vite.config.ts` 里 proxy 的 `target`，把 `localhost:3000` 改为 `localhost:3001`
3. 再执行 `pnpm dev`

> 只改后端端口而不改 Vite proxy，前端请求仍会打到旧端口，可能出现 404 或 WebSocket 连不上。
