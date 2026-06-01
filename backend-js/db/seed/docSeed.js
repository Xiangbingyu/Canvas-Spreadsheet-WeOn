function headerCell(row, col, value) {
  return { row, col, value, styleId: 'style_header' };
}

function textCell(row, col, value, styleId = null) {
  return { row, col, value, styleId };
}

function currencyCell(row, col, value) {
  return { row, col, value, styleId: 'style_currency' };
}

function statusCell(row, col, value) {
  return { row, col, value, styleId: 'style_status' };
}

function buildBaseStyles(overrides = {}) {
  return {
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
    style_status: {
      fontFamily: '微软雅黑',
      fontSize: 12,
      bold: true,
      color: '#0F766E',
      bgColor: '#CCFBF1',
      hAlign: 'center',
    },
    ...overrides,
  };
}

function workbookFromSheets(sheets, activeSheetId = null) {
  const normalizedSheets = Array.isArray(sheets) ? sheets.filter(Boolean) : [];
  const sheetOrder = normalizedSheets.map((sheet) => sheet.id);
  const resolvedActiveSheetId = (
    typeof activeSheetId === 'string'
    && sheetOrder.includes(activeSheetId)
  )
    ? activeSheetId
    : sheetOrder[0];

  return {
    activeSheetId: resolvedActiveSheetId,
    sheetOrder,
    sheets: Object.fromEntries(
      normalizedSheets.map((sheet) => [sheet.id, sheet])
    ),
  };
}

const DOC_SEEDS = [
  {
    docId: 'doc_sys_001',
    title: '2026年销售数据表',
    createdBy: 'system',
    currentSeq: 0,
    snapshot: workbookFromSheets([
      {
        id: 'sheet_20260527_001',
        name: '2026年销售数据表',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '0:0': headerCell(0, 0, '产品名称'),
          '0:1': headerCell(0, 1, '销售金额'),
          '1:1': currencyCell(1, 1, '9999.00'),
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
      {
        id: 'sheet_20260527_002',
        name: '汇总',
        defaultRowHeight: 25,
        defaultColWidth: 110,
        cells: {
          '0:0': headerCell(0, 0, '指标'),
          '0:1': headerCell(0, 1, '数值'),
          '1:0': textCell(1, 0, '总销售额'),
          '1:1': currencyCell(1, 1, '9999.00'),
        },
        styles: buildBaseStyles(),
        rowCount: 20,
        colCount: 8,
      },
      {
        id: 'sheet_20260527_003',
        name: '区域明细',
        defaultRowHeight: 25,
        defaultColWidth: 100,
        cells: {
          '0:0': headerCell(0, 0, '区域'),
          '0:1': headerCell(0, 1, '销售金额'),
          '1:0': textCell(1, 0, '华东'),
          '1:1': currencyCell(1, 1, '4200.00'),
          '2:0': textCell(2, 0, '华南'),
          '2:1': currencyCell(2, 1, '5799.00'),
        },
        styles: buildBaseStyles(),
        rowCount: 30,
        colCount: 10,
      },
    ]),
  },
  {
    docId: 'doc_sys_002',
    title: '协同排期看板',
    createdBy: 'system',
    currentSeq: 0,
    snapshot: workbookFromSheets([
      {
        id: 'sheet_doc_sys_002_001',
        name: '协同排期看板',
        defaultRowHeight: 28,
        defaultColWidth: 120,
        cells: {
          '0:0': headerCell(0, 0, '任务'),
          '0:1': headerCell(0, 1, '负责人'),
          '0:2': headerCell(0, 2, '截止日期'),
          '0:3': headerCell(0, 3, '状态'),
          '1:0': textCell(1, 0, '补齐 MySQL store'),
          '1:1': textCell(1, 1, '后端组'),
          '1:2': textCell(1, 2, '2026-06-05'),
          '1:3': statusCell(1, 3, '进行中'),
          '2:0': textCell(2, 0, '接入 Redis 运行态'),
          '2:1': textCell(2, 1, '基础设施组'),
          '2:2': textCell(2, 2, '2026-06-12'),
          '2:3': statusCell(2, 3, '待开始'),
        },
        styles: buildBaseStyles({
          style_status: {
            fontFamily: '微软雅黑',
            fontSize: 12,
            bold: true,
            color: '#92400E',
            bgColor: '#FEF3C7',
            hAlign: 'center',
          },
        }),
        rowCount: 50,
        colCount: 10,
      },
      {
        id: 'sheet_doc_sys_002_002',
        name: '里程碑',
        defaultRowHeight: 28,
        defaultColWidth: 140,
        cells: {
          '0:0': headerCell(0, 0, '里程碑'),
          '0:1': headerCell(0, 1, '计划日期'),
          '0:2': headerCell(0, 2, '状态'),
          '1:0': textCell(1, 0, '完成基础建设'),
          '1:1': textCell(1, 1, '2026-06-03'),
          '1:2': statusCell(1, 2, '进行中'),
          '2:0': textCell(2, 0, '完成接口适配'),
          '2:1': textCell(2, 1, '2026-06-10'),
          '2:2': statusCell(2, 2, '待开始'),
        },
        styles: buildBaseStyles(),
        rowCount: 30,
        colCount: 8,
      },
    ]),
  },
  {
    docId: 'doc_sys_003',
    title: '仓库库存台账',
    createdBy: 'system',
    currentSeq: 0,
    snapshot: workbookFromSheets([
      {
        id: 'sheet_doc_sys_003_001',
        name: '仓库库存台账',
        defaultRowHeight: 25,
        defaultColWidth: 110,
        cells: {
          '0:0': headerCell(0, 0, '物料编码'),
          '0:1': headerCell(0, 1, '物料名称'),
          '0:2': headerCell(0, 2, '库存数量'),
          '0:3': headerCell(0, 3, '安全库存'),
          '1:0': textCell(1, 0, 'MAT-001'),
          '1:1': textCell(1, 1, '显示器支架'),
          '1:2': textCell(1, 2, '128'),
          '1:3': textCell(1, 3, '30'),
          '2:0': textCell(2, 0, 'MAT-002'),
          '2:1': textCell(2, 1, '机械键盘'),
          '2:2': textCell(2, 2, '42'),
          '2:3': textCell(2, 3, '20'),
        },
        styles: buildBaseStyles(),
        rowCount: 80,
        colCount: 12,
      },
      {
        id: 'sheet_doc_sys_003_002',
        name: '入库记录',
        defaultRowHeight: 25,
        defaultColWidth: 120,
        cells: {
          '0:0': headerCell(0, 0, '日期'),
          '0:1': headerCell(0, 1, '物料编码'),
          '0:2': headerCell(0, 2, '数量'),
          '1:0': textCell(1, 0, '2026-05-28'),
          '1:1': textCell(1, 1, 'MAT-001'),
          '1:2': textCell(1, 2, '20'),
          '2:0': textCell(2, 0, '2026-05-29'),
          '2:1': textCell(2, 1, 'MAT-002'),
          '2:2': textCell(2, 2, '12'),
        },
        styles: buildBaseStyles(),
        rowCount: 40,
        colCount: 8,
      },
      {
        id: 'sheet_doc_sys_003_003',
        name: '出库记录',
        defaultRowHeight: 25,
        defaultColWidth: 120,
        cells: {
          '0:0': headerCell(0, 0, '日期'),
          '0:1': headerCell(0, 1, '物料编码'),
          '0:2': headerCell(0, 2, '数量'),
          '1:0': textCell(1, 0, '2026-05-30'),
          '1:1': textCell(1, 1, 'MAT-001'),
          '1:2': textCell(1, 2, '8'),
          '2:0': textCell(2, 0, '2026-05-31'),
          '2:1': textCell(2, 1, 'MAT-002'),
          '2:2': textCell(2, 2, '5'),
        },
        styles: buildBaseStyles(),
        rowCount: 40,
        colCount: 8,
      },
    ]),
  },
  {
    docId: 'doc_sys_004',
    title: '周会纪要模板',
    createdBy: 'system',
    currentSeq: 0,
    snapshot: workbookFromSheets([
      {
        id: 'sheet_doc_sys_004_001',
        name: '周会纪要模板',
        defaultRowHeight: 26,
        defaultColWidth: 140,
        cells: {
          '0:0': headerCell(0, 0, '议题'),
          '0:1': headerCell(0, 1, '结论'),
          '0:2': headerCell(0, 2, '责任人'),
          '1:0': textCell(1, 0, '本周风险'),
          '1:1': textCell(1, 1, '确认数据库迁移窗口'),
          '1:2': textCell(1, 2, '项目经理'),
          '2:0': textCell(2, 0, '下周计划'),
          '2:1': textCell(2, 1, '完成 Redis 接入和压测'),
          '2:2': textCell(2, 2, '研发团队'),
        },
        styles: buildBaseStyles({
          style_header: {
            fontFamily: '微软雅黑',
            fontSize: 14,
            bold: true,
            color: '#FFFFFF',
            bgColor: '#6D28D9',
            hAlign: 'center',
          },
        }),
        rowCount: 40,
        colCount: 8,
      },
      {
        id: 'sheet_doc_sys_004_002',
        name: '待办追踪',
        defaultRowHeight: 26,
        defaultColWidth: 130,
        cells: {
          '0:0': headerCell(0, 0, '事项'),
          '0:1': headerCell(0, 1, '负责人'),
          '0:2': headerCell(0, 2, '截止时间'),
          '1:0': textCell(1, 0, '确认发布窗口'),
          '1:1': textCell(1, 1, '运维'),
          '1:2': textCell(1, 2, '2026-06-02'),
          '2:0': textCell(2, 0, '更新接口文档'),
          '2:1': textCell(2, 1, '后端'),
          '2:2': textCell(2, 2, '2026-06-03'),
        },
        styles: buildBaseStyles(),
        rowCount: 30,
        colCount: 8,
      },
    ]),
  },
];

module.exports = { DOC_SEEDS };
