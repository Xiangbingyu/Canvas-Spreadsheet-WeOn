import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { Modal, Typography, Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { parseExcelFromArrayBuffer } from '@/spreadsheet/excel/excelImport'
import { setWorksheet, store } from '@/spreadsheet/store'

type ImportExcelModalProps = {
  open: boolean
  onClose: () => void
}

export function ImportExcelModal({ open, onClose }: ImportExcelModalProps) {
  const dispatch = useDispatch<typeof store.dispatch>()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
    maxCount: 1,
    beforeUpload: () => false,
    fileList,
    showUploadList: true,
    onChange: ({ fileList: nextList }) => {
      setFileList(nextList.slice(-1))
    },
    onRemove: () => {
      setFileList([])
    },
  }

  const handleImport = async () => {
    const file = fileList[0]?.originFileObj as File | undefined
    // 检查文件是否选择
    if (!file) {
      message.warning('请先选择文件')
      return
    }
    // 检查文件是否为 Excel 文件
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      message.warning('请选择 .xlsx 或 .xls 文件')
      return
    }
    // 读取文件内容
    const buffer = await file.arrayBuffer()
    // 解析文件内容
    const result = parseExcelFromArrayBuffer(buffer)
    // 检查解析结果
    if (!result) {
      message.warning('未解析到工作表')
      return
    }
    dispatch(setWorksheet(result))
    message.success('导入成功')
    setFileList([])
    onClose()
  }

  const handleClose = () => {
    setFileList([])
    onClose()
  }

  return (
    <Modal
      title="导入 Excel"
      open={open}
      onCancel={handleClose}
      onOk={() => void handleImport()}
      okText="导入"
      cancelText="取消"
      destroyOnHidden
      width={520}
    >
      <Typography.Text type="secondary" className="mb-4 block">
        选择本地 Excel 文件（.xlsx / .xls ）导入到当前表格
      </Typography.Text>
      <Upload.Dragger {...uploadProps}>
        <p className="text-[14px] text-[#5f6368]">将文件拖到此处，或点击选择文件</p>
      </Upload.Dragger>
    </Modal>
  )
}
