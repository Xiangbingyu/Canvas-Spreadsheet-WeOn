import { Modal, Typography, Upload } from 'antd'
import type { UploadProps } from 'antd'

type ImportExcelModalProps = {
  open: boolean
  onClose: () => void
}

export function ImportExcelModal({ open, onClose }: ImportExcelModalProps) {
  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
    maxCount: 1,
    beforeUpload: () => false,
    showUploadList: true,
  }

  const handleImport = () => {
    // TODO: 接入实际上传与解析逻辑
    onClose()
  }

  return (
    <Modal
      title="导入 Excel"
      open={open}
      onCancel={onClose}
      onOk={handleImport}
      okText="导入"
      cancelText="取消"
      destroyOnHidden
      width={520}
    >
      <Typography.Text type="secondary" className="mb-4 block">
        选择本地 Excel 文件（.xlsx / .xls / .csv）导入到当前表格
      </Typography.Text>
      <Upload.Dragger {...uploadProps}>
        <p className="text-[14px] text-[#5f6368]">将文件拖到此处，或点击选择文件</p>
      </Upload.Dragger>
    </Modal>
  )
}
