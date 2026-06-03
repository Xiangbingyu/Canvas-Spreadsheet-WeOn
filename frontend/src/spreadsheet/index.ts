// spreadsheet 模块对外导出（业务逻辑，与 React UI 分离）

export * from './model/types'
export type { CellCoord, SelectionRange } from './model/selection'
export type { RenderConfig, WorksheetConfig } from './model/renderConfig'

export { InteractionEngine, hitTest, getCellRect } from './interaction/interactionEngine'
export type {
  InteractionCallbacks,
  CellCompositionEventArgs,
  CellInputChangeEventArgs,
} from './interaction/interaction'

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
  RootState,
  AppDispatch,
} from './store/index'

export type { Viewport } from './render/viewport'
