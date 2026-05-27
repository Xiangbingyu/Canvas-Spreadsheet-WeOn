const DOC_SEEDS = [
  {
    docId: 'doc_sys_001',
    title: '示例表格',
    createdBy: 'system',
    currentSeq: 0,
    snapshot: {
      cells: {
        '1:1': { value: '姓名', style: {} },
        '1:2': { value: '分数', style: {} },
        '2:1': { value: '张三', style: {} },
        '2:2': { value: '95',   style: {} },
        '3:1': { value: '李四', style: {} },
        '3:2': { value: '87',   style: {} },
      },
      styles: {},
      rowCount: 3,
      colCount: 2,
    },
  },
];

module.exports = { DOC_SEEDS };
