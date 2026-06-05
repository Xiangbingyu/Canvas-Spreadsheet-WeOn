# 1 系统设计

## 1\.1 技术栈

**（1）前端**

- **React \+ TypeScript**：组件化构建 UI，类型约束表格数据与模块边界。

- **Redux Toolkit**：管理工作薄/工作表数据，驱动 Canvas 渲染与编辑。

- **Canvas 2D **：绘制表格。

- **SheetJS（xlsx/xls）**：Excel 导入、导出与解析。

- **Ant Design**：文档列表、弹窗等通用界面。

- **本地持久化：**LocalStorge

**（2）后端**

- **Node\.js（Express）**：提供文档 RESTful API。

- **ws**：WebSocket 协同服务，广播单元格信息变更。

- **MySQL / Redis（可配置）**：文档持久化与实时态缓存，演示环境可先用内存。

**（3）环境部署**

- 仓库根目录 pnpm dev 一键启动前后端。

- 前端本地 Vite（5173），后端 Node 服务（3000）。

## 1\.2 架构设计

电子表格可拆为四个模块，以 Redux Store 为中枢，实现「数据 → 绘制 → 交互 → 协同」解耦

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=MDVkMWJhODU4NTdmZjU2MmU5YmVjNzU2OWQyN2VmMGNfOTVlYWU5ZDY3MGQ1MjAzM2FlMzM2MDQ3YjJiYjMyZThfSUQ6NzY0NzU1ODI1NjU1ODI2MzU0Nl8xNzgwNjYyNjczOjE3ODA3NDkwNzNfVjM)

## 1\.3 关键链路说明

**数据流：**Interaction 用户交互 → Operation 操作 → Store 状态管理更新 → Renderer 渲染 → Canvas更新

**（1）本地编辑链路（Interaction → Store → 渲染）**

1. 用户在 Canvas 区域点击、拖拽或键盘操作，由 Interaction 完成命中检测与选区更新，必要时进入编辑态（DOM 输入层覆盖）。

2. 提交编辑或改样式时，先乐观更新：`dispatch` 写入 Store，界面立即反映（Canvas 通过 Store 订阅触发重绘）。

3. 同时经 Collab 将操作编码为 WebSocket 消息发往服务端；服务端校验、排序后持久化，并在同一文档房间内广播给其他客户端。

4. 本端收到服务端确认或广播后，以服务端数据为准对齐 Store（避免与远端长期不一致）。

**（2）渲染链路（Store → Render Engine → Canvas）**

1. Render Engine 不直接处理用户输入，只订阅 Store 中的工作表数据、选区状态、协同状态（在线成员、远端光标等）。

2. Store 变化后，渲染引擎先判断变更类型（滚动 / 改单元格 / 仅选区 / 协同光标），再决定重绘哪一层 Canvas： grid 层、content 层、overlay 层。

**（3）协同链路（Collab ↔ 房间广播）**

1. 用户打开同一文档并加入协同后，进入同一协同房间；服务端返回文档快照与当前版本号。

2. 本地编辑：Interaction 更新 Store → Collab发送 → 服务端广播 → 其他用户 Collab接收 → `dispatch` 更新 Store → 各端 Render Engine 重绘。

3. 他人光标、在线成员列表等协同态也经 Collab 写入 Store，由 overlay层绘制，无需改动单元格数据本身。

4. 断线重连后补发离线操作，走「LocalStorge → 写 Store/Collab发送 → 重绘」通路。

**（4）Excel 导入链路（Data Model）**

1. 用户选择文件后，Data Model 在 Web Worker 中解析 Excel，生成工作簿快照。

2. 经服务端接口写入后，整表替换 Store 中的工作簿与当前 Sheet。

3. Store 变更触发 Render Engine 全量重绘。
