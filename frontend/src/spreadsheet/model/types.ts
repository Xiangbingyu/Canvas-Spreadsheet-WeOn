// 一个单元格的样式信息
export interface Style {
  fontFamily?: string // 字体名称，如 'Arial', '微软雅黑'
  fontSize?: number // 字号大小 (通常单位为 px)
  bold?: boolean // 是否加粗
  italic?: boolean // 是否斜体
  underline?: boolean // 是否有下划线
  color?: string // 字体颜色 (通常为十六进制色值，如 '#FF0000')
  bgColor?: string // 单元格背景色 (如 '#FFFF00')
  hAlign?: 'left' | 'center' | 'right' // 水平对齐方式 (限制为左、中、右)
}
//一个单元格的数据结构
export interface Cell {
  row: number // 行号
  col: number // 列号
  value: string // 单元格内容
  styleId?: string //指向的是样式ID
}
//工作表数据结构
export interface WorksheetData {
  sheetId: string // 工作表id， 如 "01"
  sheetName: string // 底部 Sheet 标签名（创建时设定，不可改）
  defaultRowHeight: number // 默认行高，如 25
  defaultColWidth: number // 默认列宽，如 100
  rowCount: number // 行数，如 20
  colCount: number // 列数，如 10
  styles: Record<string, Style> // 键: 样式ID, 值: 具体的样式对象
  cells: Record<string, Cell> // 键: "r:c"坐标字符串, 值: 单元格数据
}

/** 工作簿数据结构 */
export interface WorkbookData {
  activeSheetId: string
  sheetOrder: string[]
  sheets: Record<string, WorksheetData>
}
