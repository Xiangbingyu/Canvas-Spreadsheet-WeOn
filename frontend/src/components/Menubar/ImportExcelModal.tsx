import { useEffect, useRef, useState } from 'react'
import { Modal, Typography, Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { Loading } from '@/components/Loading/Loading'
import { ApiError } from '@/services/httpAPI'
import {
  ExcelParseError,
  parseExcelFromBuffer,
  type ParseExcelProgress,
} from '@/spreadsheet/excel/excelImport'
import {
  ChunkUploadError,
  FileUploader,
  isLargeExcelFile,
  uploadLargeExcelFile,
  type ChunkUploadProgress,
  type LargeExcelUploadResult,
} from '@/spreadsheet/upload'
import type { WorkbookImportSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'
import { deriveDocTitleFromFileName } from '@/spreadsheet/utils/deriveDocTitleFromFileName'

export type ImportExcelMeta = {
  fileName: string
}

/** 大文件上传成功后，传给 Menubar 的数据 */
export type LargeExcelUploadMeta = ImportExcelMeta & {
  result: LargeExcelUploadResult
}

type ImportExcelModalProps = {
  open: boolean
  onClose: () => void
  /** 小文件：前端 Worker 解析完 → POST /docs */
  onImport: (workbook: WorkbookImportSnapshot, meta: ImportExcelMeta) => Promise<void>
  /** 大文件（≥5MB）：分片上传 + merge 完成后调用（后端解析在这里接） */
  onLargeFileUploaded?: (meta: LargeExcelUploadMeta) => Promise<void>
  /** 大文件 merge 创建文档时的 createdBy */
  createdBy?: string
}

/** 小文件解析进度（原来的） */
const INITIAL_PARSE_PROGRESS: ParseExcelProgress = {
  phase: 'reading',
  percent: 0,
  message: '准备导入…',
}

/** 大文件上传进度 */
const INITIAL_UPLOAD_PROGRESS: ChunkUploadProgress = {
  phase: 'hashing',
  percent: 0,
  message: '准备上传…',
}

export function ImportExcelModal({
  open,
  onClose,
  onImport,
  onLargeFileUploaded,
  createdBy,
}: ImportExcelModalProps) {
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [importing, setImporting] = useState(false)

  /** 当前走哪条路：parse=小文件本地解析，upload=大文件分片上传 */
  const [mode, setMode] = useState<'parse' | 'upload'>('parse')
  const [parseProgress, setParseProgress] = useState(INITIAL_PARSE_PROGRESS)
  const [uploadProgress, setUploadProgress] = useState(INITIAL_UPLOAD_PROGRESS)

  /** 小文件：取消 Worker 解析 */
  const abortRef = useRef<AbortController | null>(null)
  /** 大文件：取消分片上传 */
  const uploaderRef = useRef<FileUploader | null>(null)

  useEffect(() => {
    if (!importing) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [importing])

  function resetImportSession() {
    abortRef.current?.abort()
    abortRef.current = null
    uploaderRef.current = null
    setImporting(false)
    setMode('parse')
    setParseProgress(INITIAL_PARSE_PROGRESS)
    setUploadProgress(INITIAL_UPLOAD_PROGRESS)
  }

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    beforeUpload: () => false,
    fileList,
    showUploadList: true,
    disabled: importing,
    onChange: ({ fileList: nextList }) => setFileList(nextList.slice(-1)),
    onRemove: () => {
      if (!importing) setFileList([])
    },
  }

  async function cancelImport() {
    if (mode === 'upload') {
      await uploaderRef.current?.cancel()
    }
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

    setImporting(true)

    // ==================== 大文件：分片上传 ====================
    if (isLargeExcelFile(file)) {
      if (!onLargeFileUploaded) {
        message.error('大文件导入未配置，请在 Menubar 传入 onLargeFileUploaded')
        resetImportSession()
        return
      }

      setMode('upload')
      setUploadProgress(INITIAL_UPLOAD_PROGRESS)
      uploaderRef.current = null

      try {
        const result = await uploadLargeExcelFile(file, {
          onProgress: setUploadProgress,
          uploaderRef,
          mergeContext: {
            createdBy: createdBy || 'system',
            title: deriveDocTitleFromFileName(file.name),
            eventId: `evt_import_${crypto.randomUUID()}`,
          },
        })

        await onLargeFileUploaded({ fileName: file.name, result })

        message.success(result.type === 'fast' ? '秒传成功' : '文件上传成功')
        setFileList([])
        onClose()
      } catch (error) {
        if (error instanceof ChunkUploadError) {
          message.error(error.message)
          return
        }
        if (error instanceof ApiError) return
        console.error('[Excel chunk upload]', error)
        message.error('上传失败，请稍后重试')
      } finally {
        resetImportSession()
      }
      return
    }

    // ==================== 小文件：原来的 Worker 解析 ====================
    setMode('parse')
    setParseProgress(INITIAL_PARSE_PROGRESS)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      setParseProgress({ phase: 'reading', percent: 2, message: '正在读取文件…' })
      const buffer = await file.arrayBuffer()
      assertNotAborted(controller.signal)

      const workbook = await parseExcelFromBuffer(buffer, {
        signal: controller.signal,
        onProgress: setParseProgress,
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
      if (error instanceof ApiError) return
      console.error('[Excel import]', error)
      message.error('导入失败，请稍后重试')
    } finally {
      resetImportSession()
    }
  }

  const handleCancel = () => {
    if (importing) {
      void cancelImport()
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

  /** 进度条：大文件用 uploadProgress，小文件用 parseProgress */
  const loadingMessage = mode === 'upload' ? uploadProgress.message : parseProgress.message
  const loadingPercent = mode === 'upload' ? uploadProgress.percent : parseProgress.percent

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
        选择本地 Excel（.xlsx / .xls）。超过 5MB 将自动使用分片上传。
      </Typography.Text>
      <Upload.Dragger {...uploadProps}>
        <p className="text-[14px] text-[#5f6368]">将文件拖到此处，或点击选择文件</p>
      </Upload.Dragger>

      <Loading inline visible={importing} message={loadingMessage} percent={loadingPercent} />
    </Modal>
  )
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('导入已取消', 'AbortError')
  }
}
