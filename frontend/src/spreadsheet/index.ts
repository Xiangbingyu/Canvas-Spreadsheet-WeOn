// spreadsheet 模块导出
// 纯业务逻辑，与 React UI 分离

// 数据模型
export * from './model/types'

// 交互接口和引擎
export { InteractionEngine } from './engine/interactionEngine'
export type { InteractionCallbacks } from './interaction/interaction'
export { CompositionHandler } from './engine/completionHandler'
