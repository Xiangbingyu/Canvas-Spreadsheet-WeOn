import { Modal, Radio, Space, Typography } from 'antd'

type ExportExcelModalProps = {
  open: boolean
  fileName: string
  onClose: () => void
}

export function ExportExcelModal({ open, fileName, onClose }: ExportExcelModalProps) {
  const handleExport = () => {
    // TODO: 接入实际导出逻辑
    onClose()
  }

  return (
    <Modal
      title="导出 Excel"
      open={open}
      onCancel={onClose}
      onOk={handleExport}
      okText="导出"
      cancelText="取消"
      destroyOnHidden
      width={480}
    >
      <Space orientation="vertical" size="middle" className="w-full">
        <Typography.Text type="secondary">将当前表格导出为 Excel 文件（.xlsx）</Typography.Text>

        <div>
          <Typography.Text className="mb-2 block text-[13px]">文件名</Typography.Text>
          <Typography.Text>{fileName || '未命名电子表格'}.xlsx</Typography.Text>
        </div>

        <div>
          <Typography.Text className="mb-2 block text-[13px]">导出范围</Typography.Text>
          <Radio.Group defaultValue="current">
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
