// Compatibility entry for callers that still render the spreadsheet into one canvas.
// Input: render snapshot; output: grid/content/overlay drawn sequentially.

export {
  renderGrid,
  renderGridLayer,
  renderContentLayer,
  renderOverlayLayer,
  type GridSelection,
  type RenderGridOptions,
} from './layerRenderer'
