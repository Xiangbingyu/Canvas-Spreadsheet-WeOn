/** xlsx-js-style 单元格样式对象（OpenXML 子集） */

/** #RRGGBB → xlsx ARGB（无前缀 #，带 FF alpha） */
function hexToXlsxRgb(hex) {
  const raw = String(hex).replace(/^#/, '').toUpperCase();
  if (raw.length === 6) return `FF${raw}`;
  if (raw.length === 8) return raw;
  return `FF${raw.padStart(6, '0').slice(0, 6)}`;
}

/** 快照 Style → xlsx-js-style 的 cell.s */
function styleToXlsxCellStyle(style) {
  if (!style || typeof style !== 'object') return undefined;

  const xlsxStyle = {};
  const font = {};

  if (style.fontFamily) font.name = style.fontFamily;
  if (style.fontSize != null) font.sz = style.fontSize;
  if (style.bold) font.bold = true;
  if (style.italic) font.italic = true;
  if (style.underline) font.underline = true;
  if (style.color) font.color = { rgb: hexToXlsxRgb(style.color) };

  if (Object.keys(font).length > 0) {
    xlsxStyle.font = font;
  }

  if (style.bgColor) {
    xlsxStyle.fill = {
      patternType: 'solid',
      fgColor: { rgb: hexToXlsxRgb(style.bgColor) },
    };
  }

  if (style.hAlign) {
    xlsxStyle.alignment = {
      horizontal: style.hAlign,
      vertical: 'center',
    };
  }

  if (!xlsxStyle.font && !xlsxStyle.fill && !xlsxStyle.alignment) {
    return undefined;
  }

  return xlsxStyle;
}

module.exports = {
  hexToXlsxRgb,
  styleToXlsxCellStyle,
};
