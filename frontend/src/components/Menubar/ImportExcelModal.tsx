import { useEffect, useRef, useState } from 'react'
import { Modal, Typography, Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { Loading } from '@/components/Loading/Loading'
import { ApiError } from '@/services/httpAPI'
import { ExcelParseError, parseExcelFromBuffer } from '@/spreadsheet/excel/excelImport'
import type { WorkbookImportSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'

export type ImportExcelMeta = {
  fileName: string
}

type ImportExcelModalProps = {
  open: boolean
  onClose: () => void
  onImport: (workbook: WorkbookImportSnapshot, meta: ImportExcelMeta) => Promise<void>
}

export function ImportExcelModal({ open, onClose, onImport }: ImportExcelModalProps) {
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{
    phase: 'reading' | 'converting' | 'building' | 'done'
    percent: number
    message: string
  }>({ phase: 'reading', percent: 0, message: '准备导入…' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!importing) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [importing])

  function resetImportSession() {
    abortRef.current?.abort()
    abortRef.current = null
    setImporting(false)
    setProgress({ phase: 'reading', percent: 0, message: '准备导入…' })
  }

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    beforeUpload: () => false,
    fileList,
    showUploadList: true,
    disabled: importing,
    onChange: ({ fileList: nextList }) => {
      setFileList(nextList.slice(-1))
    },
    onRemove: () => {
      if (!importing) setFileList([])
    },
  }

  function cancelImport() {
    resetImportSession()
  }

  const handleImport = async () => {
    const file = fileList[0]?.originFileObj as File | undefined
    if (!file) {
      message.warning('请先选择文件')
      return
    }
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      message.warning('请选择 .xlsx 或 .xls 文件')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setImporting(true)
    setProgress({ phase: 'reading', percent: 0, message: '准备导入…' })

    try {
      setProgress({ phase: 'reading', percent: 2, message: '正在读取文件…' })
      const buffer = await file.arrayBuffer()
      assertNotAborted(controller.signal)

      const workbook = await parseExcelFromBuffer(buffer, file.name, {
        signal: controller.signal,
        onProgress: setProgress,
      })

      await onImport(workbook, { fileName: file.name })
      message.success(`导入成功，共 ${workbook.sheetOrder.length} 个工作表`)
      setFileList([])
      onClose()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        message.info('已取消导入')
        return
      }
      if (error instanceof ExcelParseError) {
        message.error(error.message)
        return
      }
      if (error instanceof ApiError) {
        return
      }
      console.error('[Excel import]', error)
      message.error('导入失败，请稍后重试')
    } finally {
      resetImportSession()
    }
  }

  const handleCancel = () => {
    if (importing) {
      cancelImport()
      message.info('已取消导入')
      return
    }
    onClose()
  }

  const handleAfterOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetImportSession()
      setFileList([])
    }
  }

  return (
    <Modal
      title="导入 Excel"
      open={open}
      afterOpenChange={handleAfterOpenChange}
      onCancel={handleCancel}
      onOk={() => void handleImport()}
      okText="导入"
      cancelText={importing ? '取消导入' : '取消'}
      okButtonProps={{ disabled: importing }}
      cancelButtonProps={{ disabled: false }}
      destroyOnHidden
      width={520}
      mask={{ closable: !importing }}
    >
      <Typography.Text type="secondary" className="mb-4 block">
        选择本地 Excel 文件（.xlsx / .xls）
      </Typography.Text>
      <Upload.Dragger {...uploadProps}>
        <p className="text-[14px] text-[#5f6368]">将文件拖到此处，或点击选择文件</p>
      </Upload.Dragger>

      <Loading inline visible={importing} message={progress.message} percent={progress.percent} />
    </Modal>
  )
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('导入已取消', 'AbortError')
  }
}
