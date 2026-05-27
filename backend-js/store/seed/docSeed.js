const DOC_SEEDS = [
  {
    docId: 'doc_sys_001',
    title: '2026年销售数据表',
    createdBy: 'system',
    currentSeq: 0,
    snapshot: {
      id: 'sheet_20260527_001',
      name: '2026年销售数据表',
      defaultRowHeight: 25,
      defaultColWidth: 100,
      cells: {
        '0:0': { row: 0, col: 0, value: '产品名称', styleId: 'style_header' },
        '0:1': { row: 0, col: 1, value: '销售金额', styleId: 'style_header' },
        '1:1': { row: 1, col: 1, value: '9999.00', styleId: 'style_currency' },
      },
      styles: {
        style_header: {
          fontFamily: '微软雅黑',
          fontSize: 14,
          bold: true,
          color: '#FFFFFF',
          bgColor: '#4472C4',
          hAlign: 'center',
        },
        style_currency: {
          fontFamily: 'Arial',
          fontSize: 12,
          bold: false,
          hAlign: 'right',
        },
      },
      rowCount: 100,
      colCount: 26,
    },
  },
];

module.exports = { DOC_SEEDS };
