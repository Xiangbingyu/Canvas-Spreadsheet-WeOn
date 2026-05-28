// spreadsheet 模块导出
// 纯业务逻辑，与 React UI 分离

// 数据模型
export * from './model/types'
export type { SelectionRange } from './model/types'

// 交互接口和引擎
export { InteractionEngine } from './engine/interactionEngine'
export type {
  InteractionCallbacks,
  CellCompositionEventArgs,
  CellInputChangeEventArgs,
} from './interaction/interaction'

// Store
export {
  store,
  setWorksheet,
  workSheetReducer,
  selectionReducer,
  setSelectedCell,
  updateCell,
} from './store/index'

export type {
  SelectedCell,
  SelectionState,
  SetSelectedCellPayload,
  UpdateCellPayload,
  RootState,
  AppDispatch,
} from './store/index'

export type { Viewport } from './render/viewport'
