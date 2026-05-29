/** Canvas 渲染与 InteractionEngine 用的布局配置 */

export interface RenderConfig {
  rowHeight?: number
  colWidth?: number
  headerHeight?: number
  headerWidth?: number
}

export const DEFAULT_RENDER_CONFIG: Required<RenderConfig> = {
  rowHeight: 26,
  colWidth: 100,
  headerHeight: 24,
  headerWidth: 44,
}

export interface WorksheetConfig {
  rowCount: number
  colCount: number
  defaultRowHeight: number
  defaultColWidth: number
}
