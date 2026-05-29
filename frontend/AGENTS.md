# Frontend AI 协作规范

> **适用范围**：仅 `frontend/`。`backend-js/`、`docs/` 接口实现等不在本文件约束内。  
> **每次会话**：处理任何前端任务前，必须先通读本文并按目录与模块边界执行。

---

## 1. 核心原则

| 原则                   | 说明                                                          |
| ---------------------- | ------------------------------------------------------------- |
| **边界原则**           | 严格限制作业范围：禁止随意新建文件、禁止跨模块改代码。        |
| **各司其职，数据驱动** | 模块之间通过 Redux Store / 类型数据通信，不互相侵入实现细节。 |
| **最小改动**           | 只改与任务直接相关的文件；不重构、不顺手“优化”无关代码。      |

---

## 2. 模块职责与红线

### 2.1 `spreadsheet/render/` — Canvas 渲染

**职责**：只负责「怎么画」。

- 从 Store 读取 `workSheet`、`selection` 等数据（行列、样式、内容、选区坐标）。
- 实现视口、网格线、表头、单元格文字等绘制（`viewport.ts`、`gridRenderer.ts`、`chrome.ts`）。

| 红线 | 禁止                                                                            |
| ---- | ------------------------------------------------------------------------------- |
| R1   | 不得编写或修改「怎么改」的业务逻辑（选中、编辑、撤销、协同发送等）。            |
| R2   | 不得 `dispatch` 业务 action（除渲染所需的只读订阅外，不在 render 内改 Store）。 |
| R3   | 不得为实现交互而去改 `interaction/`、`collab/`、`history/`。                    |

**正确模式**：交互模块更新 Store → 渲染模块订阅 Store 后重绘（如根据 `selection` 高亮边框）。

---

### 2.2 `spreadsheet/interaction/` — 编辑与本地交互

**职责**：只负责「怎么改」与向 Store **提供/更新**数据。

- 例：单元格选中 → `dispatch(setSelectedCell(...))`，提供行列坐标与当前值。
- 后续：编辑态、快捷键、拖拽选区等均放此目录。

| 红线 | 禁止                                                              |
| ---- | ----------------------------------------------------------------- |
| I1   | 不得直接修改 `render/` 下的绘制实现来“顺便”完成交互。             |
| I2   | 不得在交互文件里写 Canvas 绘制代码（`fillRect`、`fillText` 等）。 |
| I3   | 不得绕过 Store 用模块级全局变量保存表格业务状态。                 |

---

### 2.3 `spreadsheet/collab/` — 协同（预留）

**职责**：只负责 WebSocket 连接、消息收发与分发。

- 将远端 operation 转为对 Store 的更新；将本地操作编码后发送。
- 不处理 Canvas 绘制、不实现具体 hitTest。

| 红线 | 禁止                                                  |
| ---- | ----------------------------------------------------- |
| C1   | 不得在 collab 内实现渲染或鼠标命中检测。              |
| C2   | 不得在未与 `docs/` 接口约定一致时私自改 WS 消息结构。 |

---

### 2.4 `spreadsheet/history/` — Undo/Redo（预留）

**职责**：操作历史栈、撤销/重做；消费/产出与业务一致的 Operation。

| 红线 | 禁止                                                                 |
| ---- | -------------------------------------------------------------------- |
| H1   | 不得在历史模块内直接操作 Canvas。                                    |
| H2   | 撤销/重做必须通过 Store action 或统一 operation 管道，不得双写状态。 |

---

### 2.5 `spreadsheet/store/` — 状态管理

**职责**：Redux slice：工作表数据、选区、用户/在线状态等。

- `workSheetStore.ts`：cells、styles、整表替换。
- `selectStore.ts`：当前选中单元格。
- `userStore.ts`：协同相关用户状态。

| 红线 | 禁止                                                                |
| ---- | ------------------------------------------------------------------- |
| S1   | Store 内不得出现 Canvas / DOM 绘制逻辑。                            |
| S2   | 不得把 HTTP/WS 请求写在 reducer 内（放 `services/` 或 `collab/`）。 |

---

### 2.6 `spreadsheet/excel/` — Excel 导入导出

**职责**：`xlsx` 解析 / 导出，产出 `WorksheetData` 或接收 Store 数据写文件。

| 红线 | 禁止                                                                               |
| ---- | ---------------------------------------------------------------------------------- |
| E1   | 解析完成后通过 `setWorksheet` 等 action 写入 Store，不在此模块维护第二份表格状态。 |

---

### 2.7 `spreadsheet/utils/` — 纯工具

**职责**：无业务副作用的纯函数（坐标换算、styleId 生成、快照转换等）。

| 红线 | 禁止                                          |
| ---- | --------------------------------------------- |
| U1   | 不得依赖 React 组件或 Redux；不得发 HTTP/WS。 |

---

### 2.8 `components/` — UI 组件

**职责**：Menubar、Toolbar、FormulaBar、GrideCanvas **容器**、SheetTabs 等界面。

- `GrideCanvas.tsx`：挂载 Canvas、滚动条、**绑定** `interaction` 与 `render` 的胶水层（允许 `useEffect` 订阅 Store 并调用 `renderGrid` / `attachCellSelectInteraction`）。
- 业务逻辑应下沉到 `spreadsheet/`，组件内保持展示与组合。

| 红线 | 禁止                                                               |
| ---- | ------------------------------------------------------------------ |
| CO1  | 不得在 `pages/` 或单个 page 文件里堆砌大量 UI 代码。               |
| CO2  | 新建 UI 必须先建 `components/<模块名>/` 再在 page 中 import 组装。 |

---

### 2.9 `pages/` — 页面组装

**职责**：组合 `components/`，不写复杂业务。

参考：`SpreadsheetPage.tsx` 仅 import 并布局子组件。

| 红线 | 禁止                                                     |
| ---- | -------------------------------------------------------- |
| P1   | 禁止在 page 内实现 Canvas 绘制、Store reducer、WS 逻辑。 |
| P2   | 单文件超过约 80 行且多为 UI 时，必须拆到 `components/`。 |

---

### 2.10 `hooks/` — 自定义 Hooks

**职责**：可复用的 React 逻辑（订阅、防抖、快捷键封装等）。

| 红线 | 禁止                                                                 |
| ---- | -------------------------------------------------------------------- |
| HK1  | 所有自定义 Hook 放在 `hooks/`，并在 `hooks/index.ts` 统一导出。      |
| HK2  | Hook 内不得直接操作 Canvas 上下文；表格核心逻辑仍归 `spreadsheet/`。 |

---

### 2.11 `services/` — HTTP 客户端

**职责**：`httpAPI.ts` 请求封装；`httpType.ts` 放 **与后端接口对应** 的请求/响应类型。

| 红线 | 禁止                                   |
| ---- | -------------------------------------- |
| SV1  | 不得在此实现表格渲染或 Redux reducer。 |
| SV2  | 改接口前先对照 `docs/接口文档.md`。    |

---

### 2.12 `spreadsheet/model/` — 类型定义

**职责**：表格领域与前端专用类型。

| 文件          | 内容                                               |
| ------------- | -------------------------------------------------- |
| `types.ts`    | **仅**基础模型：`Style`、`Cell`、`WorksheetData`。 |
| `mouse.ts`    | 鼠标/命中相关类型（按需创建）。                    |
| `keyboard.ts` | 键盘/快捷键相关类型（按需创建）。                  |
| 其他 `*.ts`   | 按领域拆分，文件头注释说明该文件包含哪类类型。     |

| 红线 | 禁止                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| M1   | 禁止把大量新接口塞进 `types.ts`。                                                                                  |
| M2   | 禁止在 `services/httpType.ts` 与 `model/types.ts` 重复定义相同领域模型（HTTP 专用放 services，表格模型放 model）。 |

---

## 3. 目录结构（必须遵守）

路径别名：`@/` → `frontend/src/`（见 `vite.config.ts`、`tsconfig.app.json`）。

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── eslint.config.js
├── postcss.config.js / tailwind.config.js
├── .env.example
│
└── src/
    ├── main.tsx                 # 入口：Provider、Ant Design 中文、挂载 App
    ├── App.tsx                  # 根视图路由：StartPage ↔ SpreadsheetPage
    ├── index.css                # 全局样式（Tailwind + 布局）
    │
    ├── pages/                   # 【页面层】只组装，不写重逻辑
    │   ├── index.ts
    │   └── SpreadsheetPage.tsx
    │
    ├── components/              # 【UI 层】按功能分子目录
    │   ├── Menubar/
    │   ├── Toolbar/
    │   ├── FormulaBar/
    │   ├── grideCanvas/         # Canvas 容器（胶水层）
    │   ├── sheetTabs/
    │   ├── statusBar/
    │   ├── Loading/
    │   ├── IconButton/
    │   └── startUI/
    │
    ├── hooks/                   # 【Hooks 层】
    │   └── index.ts
    │
    ├── services/                # 【HTTP 层】
    │   ├── httpAPI.ts
    │   └── httpType.ts
    │
    └── spreadsheet/             # 【核心业务】
        ├── model/
        │   ├── types.ts         # Style | Cell | WorksheetData
        │   ├── mouse.ts         # （按需）
        │   └── keyboard.ts      # （按需）
        ├── store/
        │   ├── index.ts
        │   ├── workSheetStore.ts
        │   ├── selectStore.ts
        │   └── userStore.ts
        ├── render/
        │   ├── index.ts
        │   ├── chrome.ts
        │   ├── viewport.ts
        │   └── gridRenderer.ts
        ├── interaction/
        │   └── selectCell.ts
        ├── history/             # （预留）undo/redo
        ├── collab/              # （预留）WebSocket
        ├── excel/
        │   └── excelImport.ts
        └── utils/
            ├── coordinates.ts
            ├── generateStyleId.ts
            └── fromServerSnapshot.ts
```

### 3.1 新建文件规则

| 需求            | 放置位置                                    |
| --------------- | ------------------------------------------- |
| 新 UI 面板/弹窗 | `components/<功能名>/Xxx.tsx`               |
| 新页面          | `pages/XxxPage.tsx` + `pages/index.ts` 导出 |
| 新自定义 Hook   | `hooks/useXxx.ts` + `hooks/index.ts`        |
| 新绘制逻辑      | `spreadsheet/render/`                       |
| 新鼠标/键盘行为 | `spreadsheet/interaction/`                  |
| 新 WS 逻辑      | `spreadsheet/collab/`                       |
| 新撤销重做      | `spreadsheet/history/`                      |
| 新表格领域类型  | `spreadsheet/model/<领域>.ts`               |
| 新后端 DTO 类型 | `services/httpType.ts`                      |
| 新 REST 调用    | `services/httpAPI.ts`                       |

### 3.2 禁止随意创建的路径

- ❌ `src/` 根下散落 `utils.ts`、`helpers/`（通用工具放 `spreadsheet/utils/`）
- ❌ `spreadsheet/` 外新建 `store/`、`render/`
- ❌ 在 `backend-js/` 或仓库根目录改前端业务代码
- ❌ 未经要求新建 `__tests__`、示例脚本、多余 README

---

## 4. 数据流（跨模块协作）

```
用户操作 (鼠标/键盘)
    → interaction/  (hitTest、dispatch)
        → store/    (workSheet | selection | user)
            → render/     (订阅数据，绘制 Canvas)
            → components/ (FormulaBar、Toolbar 等读 Store 展示)
    → collab/       (可选：发/收 WS → dispatch)
    → history/      (可选：记录 operation → 撤销时 dispatch)
```

**AI 必须遵守**：只改数据流上与自己任务相关的环节，不横跨整条链路“一次性改完”。

---

## 5. 技术栈约定（前端）

- React 19 + Vite + TypeScript
- 状态：Redux Toolkit（`spreadsheet/store/`）
- 样式：Tailwind CSS 3.x；组件库 Ant Design 6.x
- HTTP：Axios（`services/httpAPI.ts`）
- Excel：`xlsx`（`spreadsheet/excel/`）
- Node：**22.12.0**（仓库 `.nvmrc`）

开发命令在**仓库根目录**执行：`pnpm dev:fe`、`pnpm lint`、`pnpm build`。

---

## 6. 自动检查（pre-commit / CI）

仓库已配置 **可执行脚本**，提交时若暂存了 `frontend/` 下文件会自动运行；不通过则 **拒绝 commit**。

| 命令                                  | 说明                                             |
| ------------------------------------- | ------------------------------------------------ |
| `pnpm check:fe:agents`                | 在仓库根目录手动跑一遍（推荐改 frontend 后先跑） |
| `pnpm --filter frontend check:agents` | 等价，仅在 frontend 包内执行                     |

脚本位置：`frontend/scripts/check-agents-boundaries.mjs`

当前自动检测项（与上文红线对应）：

- 禁止目录：`spreadsheet/engine/`、`src/helpers/`、`src/utils.ts`、`components/index.ts` 桶文件
- `src/` 根目录不得散落业务 `.ts` 文件
- `pages/*Page.tsx` 不超过 100 行
- `hooks/` 下文件须为 `useXxx.ts`
- `model/types.ts` 仅允许导出 `Style`、`Cell`、`WorksheetData`
- `render/` 不得 import `interaction`、不得 `dispatch` / 定义 slice
- `interaction/` 不得 import `gridRenderer`/`viewport`、不得写 Canvas 绘制 API
- `store/` 不得含 Canvas 绘制代码

接入方式：根目录 `.husky/pre-commit` 在 `lint-staged`（Prettier + ESLint）之后执行上述检查。

如需在 CI 阻断合并，在 workflow 中增加一步：`pnpm check:fe:agents`（与 `pnpm lint`、`pnpm build` 并列）。

---

## 7. AI 执行检查清单

在提交或结束任务前自检：

- [ ] 只修改了 `frontend/` 内文件
- [ ] 新文件落在上表规定的目录
- [ ] 未跨模块（render ↔ interaction ↔ collab）混写职责
- [ ] `model/types.ts` 未被塞入大量新类型
- [ ] `pages/` 未膨胀为“上帝文件”
- [ ] 状态变更通过 Store，渲染跟随数据更新
- [ ] import 使用 `@/` 别名，与现有代码风格一致
- [ ] 本地已执行 `pnpm check:fe:agents` 通过

---

## 8. 参考文档

- 团队协作与目录说明：`docs/` 内课题与开发指南
- 后端接口（只读对照）：`docs/接口文档.md`
- Monorepo 启动：`README.md`（仓库根目录）
