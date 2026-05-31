# Canvas 在线电子表格 — 字节前端训练营

## 项目目标
可演示、可编辑、可协同的 Canvas 电子表格。上传 Excel → Canvas 渲染 → 单元格编辑 → 工具栏改样式 → undo/redo → 多人协同。

## 技术栈
React 18 + Vite + TypeScript + Redux Toolkit + Canvas 2D + WebSocket (ws) + SheetJS + Tailwind CSS + Ant Design

## 周期
4 周：W1 渲染 → W2 编辑/样式 → W3 undo/协同 → W4 打磨

## 团队分工
| 人 | 角色 | 负责 |
|----|------|------|
| YJY (我) | 协同模块 | CollabClient + useCollab + 协议 + Redux store |
| dsx (堵世轩) | FE Owner | Redux 数据模型、类型系统、选区 store |
| xby (Xiangbingyu) | 后端 | WebSocket 服务、undo/redo、幂等、文档 CRUD |
| Denghongjiang | Canvas 渲染 | GrideCanvas、gridRenderer、虚拟滚动 |
| xiaobai497 (卢晓玲) | UI | Menubar、Toolbar、StatusBar、SheetTabs |

## 我的分支
`feature/yjy-collaboration`

## 我做了什么

### 协同模块（`frontend/src/spreadsheet/collab/` + `model/`）
| 文件 | 作用 |
|------|------|
| `model/collabProtocol.ts` | 12 种 WS 消息的 TypeScript 类型 + 错误码（含 baseSeq/set_title/4090） |
| `collab/CollabClient.ts` | WS 全双工通信核心：connect/receive/send/幂等去重/乱序暂存/断线重连/sendQueue 握手缓存 |
| `collab/snapshotConverter.ts` | snapshot cells Record→Map 转换、cell key 解析工具 |
| `collab/index.ts` | 统一导出 |

### React Hook（`frontend/src/hooks/`）
| 文件 | 作用 |
|------|------|
| `useCollab.ts` | CollabClient ↔ Redux 桥：setCell 自动补 baseSeq、setTitle、4090 冲突提示 |

### Redux Store
| 文件 | 改动 |
|------|------|
| `store/userStore.ts` | 空占位 → collabSlice（docId/clientId/docTitle/users/currentSeq/connectionStatus）|
| `store/index.ts` | 注册 collabReducer + 导出 setDocTitle 等 action |

### 本地调试（不进 git，本地保留）
- `frontend/src/spreadsheet/collab/LocalStubServer_test.ts`
- `frontend/src/spreadsheet/collab/CollabTestPanel.tsx`

## 还没做 / 待定

### 等别人对接
- 在线用户列表 UI 未实现（数据已在 Redux `state.collab.users`）
- title_updated 后 Menubar 读 `collab.docTitle`（dsx）
- 彩色光标提醒未实现（P1）

### P1（见 P1计划.md）
- 离线编辑持久化 + 补发
- 编辑框不同颜色 UI 实时显示避免冲突
- 服务器部署后联机测试
- 连接/在线用户 UI（下方状态栏）
- 多用户协作 UI（和堵世轩对）
- 更好的协同策略：悲观锁→乐观锁（和 xby 讨论）

### 待定
- 后端悲观锁是否改乐观锁（和 xby 协商）

## 协同核心概念
- **seq**：服务端分配的全服自增序号，所有客户端按 seq 顺序 apply → 最终一致
- **baseSeq**：客户端发起修改时看到的文档版本号，后端做版本校验。baseSeq == currentSeq 无冲突；baseSeq < currentSeq 尝试 rebase；中间有 import_sheet 则 4090
- **applyOrdered**：消息乱序到达时暂存到 pendingOps，等前面补齐后顺序消费
- **幂等去重**：发送者收 reply+broadcast 两条同 seq 消息，靠 seenSeqs 跳过

## 启动方式
```bash
# 后端
cd backend-js && npm run dev     # → localhost:3000

# 前端
cd frontend && npm run dev       # → localhost:5173
```

## 文档
所有设计文档在 `ignore_协同实现/`：
- `协同流程.md` — 完整协同链路（6 阶段，带代码行号）
- `P0实现说明.md` — P0 要求逐项对照
- `5.31改动.md` — 5.31 代码改动详情（权威）
- `5.31合并冲突升级（配合后端）+改bug.md` — 后端变更 + 前端改动计划
- `5.31对接说明.md` — 给 dsx 和卢晓玲的对接说明
- `P1计划.md` — 后续优化计划
- `接口文档 5.31.md` — 最新后端接口文档
- `worklog.md` — 开发日志
- `进度汇报.md` — 进度汇报
