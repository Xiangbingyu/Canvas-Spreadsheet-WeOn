import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Modal, Typography, Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { Loading } from '@/components/Loading/Loading'
import {
  ExcelParseError,
  parseExcelFromBuffer,
  type ParseExcelProgress,
} from '@/spreadsheet/excel/excelImport'
import type { WorksheetData } from '@/spreadsheet/model/types'
import type { RootState } from '@/spreadsheet/store'
import { setWorksheet, store, syncActiveSheetCache } from '@/spreadsheet/store'

type ImportExcelModalProps = {
  open: boolean
  onClose: () => void
  /** 解析并写入 Redux 后，由父组件走 WS import_sheet */
  onImport: (worksheet: WorksheetData) => void
}

const INITIAL_PROGRESS: ParseExcelProgress = {
  phase: 'reading',
  percent: 0,
  message: '准备导入…',
}

export function ImportExcelModal({ open, onClose, onImport }: ImportExcelModalProps) {
  const dispatch = useDispatch<typeof store.dispatch>()
  const activeSheet = useSelector((s: RootState) => s.workSheet)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ParseExcelProgress>(INITIAL_PROGRESS)
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
    setProgress(INITIAL_PROGRESS)
  }

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
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
    setProgress(INITIAL_PROGRESS)

    try {
      setProgress({ phase: 'reading', percent: 2, message: '正在读取文件…' })
      const buffer = await file.arrayBuffer()
      assertNotAborted(controller.signal)

      const parsed = await parseExcelFromBuffer(buffer, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      // 导入覆盖当前活动 sheet 内容，保留 tab 的 sheetId / sheetName
      const worksheet: WorksheetData = {
        ...parsed,
        sheetId: activeSheet.sheetId,
        sheetName: activeSheet.sheetName,
      }
      dispatch(setWorksheet(worksheet))
      dispatch(syncActiveSheetCache(worksheet))
      onImport(worksheet)
      message.success('导入成功')
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
      console.error('[Excel import]', error)
      message.error('解析失败，请检查文件是否损坏或过大')
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
        选择本地 Excel 文件（.xlsx / .xls）导入到当前表格；大文件将显示解析进度
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
