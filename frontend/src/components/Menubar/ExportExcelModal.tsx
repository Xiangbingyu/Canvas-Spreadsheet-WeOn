import { useState } from 'react'
import { Modal, Radio, Space, Typography, message } from 'antd'
import { useSelector } from 'react-redux'
import type { RootState } from '@/spreadsheet/store'
import { downloadDocExcel, type ExcelExportScope } from '@/services/exportAPI'

type ExportExcelModalProps = {
  open: boolean
  fileName: string
  onClose: () => void
}

export function ExportExcelModal({ open, fileName, onClose }: ExportExcelModalProps) {
  const [scope, setScope] = useState<ExcelExportScope>('all')
  const [exporting, setExporting] = useState(false)

  const docId = useSelector((s: RootState) => s.collab.docId)
  const activeSheetId = useSelector((s: RootState) => s.workbook.activeSheetId)

  const handleExport = async () => {
    if (!docId) {
      message.warning('请先打开文档')
      return
    }

    setExporting(true)
    try {
      const savedFileName = await downloadDocExcel({
        docId,
        scope,
        activeSheetId: scope === 'current' ? activeSheetId : undefined,
      })
      message.success(`已下载：${savedFileName}`)
      onClose()
    } catch (error) {
      console.error('[Excel export]', error)
      message.error(error instanceof Error ? error.message : '导出失败，请重试')
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
          将文档导出为 .xlsx，由服务端根据当前保存的数据生成文件。
        </Typography.Text>

        <div>
          <Typography.Text className="mb-2 block text-[13px]">文件名</Typography.Text>
          <Typography.Text>{fileName.trim() || '未命名表格'}.xlsx</Typography.Text>
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
