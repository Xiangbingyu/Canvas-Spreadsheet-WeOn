import { useState } from 'react'
import { Modal, Radio, Space, Typography, message } from 'antd'
import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'
import {
  exportWorkbookToExcel,
  canPickExportDirectory,
  type ExcelExportScope,
} from '@/spreadsheet/excel/excelExport'
import { sanitizeExcelFileName } from '@/spreadsheet/excel/excelExportExcelJS'

type ExportExcelModalProps = {
  open: boolean
  fileName: string
  onClose: () => void
}

export function ExportExcelModal({ open, fileName, onClose }: ExportExcelModalProps) {
  const [scope, setScope] = useState<ExcelExportScope>('all')
  const [exporting, setExporting] = useState(false)

  const activeSheetId = useSelector((s: RootState) => s.workbook.activeSheetId)
  const sheetOrder = useSelector((s: RootState) => s.workbook.sheetOrder)
  const sheets = useSelector((s: RootState) => s.workbook.sheets)

  const displayFileName = `${sanitizeExcelFileName(fileName)}.xlsx`

  const handleExport = async () => {
    setExporting(true)
    try {
      const result = await exportWorkbookToExcel({
        title: fileName,
        scope,
        activeSheetId,
        sheetOrder,
        sheets,
      })

      if (result === 'cancelled') {
        message.info('已取消导出')
        return
      }

      const folderHint = canPickExportDirectory()
        ? '已保存到所选文件夹'
        : '已下载到浏览器默认下载目录'
      message.success(`${folderHint}：${displayFileName}`)
      onClose()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        message.info('已取消导出')
        return
      }
      console.error('[Excel export]', error)
      message.error('导出失败，请重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title="导出 Excel"
      open={open}
      onCancel={onClose}
      onOk={() => void handleExport()}
      okText="导出"
      cancelText="取消"
      confirmLoading={exporting}
      destroyOnHidden
      width={480}
    >
      <Space orientation="vertical" size="middle" className="w-full">
        <Typography.Text type="secondary">
          将表格导出为 .xlsx。导出时将选择保存文件夹，文件名为文档标题。
        </Typography.Text>

        <div>
          <Typography.Text className="mb-2 block text-[13px]">文件名</Typography.Text>
          <Typography.Text>{displayFileName}</Typography.Text>
        </div>

        <div>
          <Typography.Text className="mb-2 block text-[13px]">导出范围</Typography.Text>
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
            <Space orientation="vertical">
              <Radio value="current">当前工作表</Radio>
              <Radio value="all">所有工作表</Radio>
            </Space>
          </Radio.Group>
        </div>
      </Space>
    </Modal>
  )
}
