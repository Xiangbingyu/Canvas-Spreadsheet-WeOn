import { Input, Modal } from 'antd'
import { useState } from 'react'

const DEFAULT_TITLE = '未命名表格'

type CreateBlankSheetModalProps = {
  open: boolean
  loading?: boolean
  onClose: () => void
  onConfirm: (title: string) => void
}

export function CreateBlankSheetModal({
  open,
  loading = false,
  onClose,
  onConfirm,
}: CreateBlankSheetModalProps) {
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setTitle(DEFAULT_TITLE)
    }
  }

  function handleOk() {
    const trimmed = title.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  function handleClose() {
    setTitle(DEFAULT_TITLE)
    onClose()
  }

  return (
    <Modal
      title="新建空白表"
      open={open}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      okButtonProps={{ disabled: !title.trim() }}
      onOk={handleOk}
      onCancel={handleClose}
      destroyOnHidden
    >
      <div className="py-2">
        <label className="mb-2 block text-sm text-[#5f6368]">表格标题</label>
        <Input
          value={title}
          maxLength={120}
          placeholder="请输入表格标题"
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={handleOk}
          autoFocus
        />
      </div>
    </Modal>
  )
}
