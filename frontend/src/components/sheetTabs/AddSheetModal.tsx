import { Input, Modal } from 'antd'
import { useState } from 'react'

const DEFAULT_SHEET_NAME = '工作表'

type AddSheetModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: (sheetName: string) => void
}

export function AddSheetModal({ open, onClose, onConfirm }: AddSheetModalProps) {
  const [name, setName] = useState(DEFAULT_SHEET_NAME)
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setName(DEFAULT_SHEET_NAME)
    }
  }

  function handleOk() {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
    onClose()
  }

  return (
    <Modal
      title="添加工作表"
      open={open}
      okText="创建"
      cancelText="取消"
      okButtonProps={{ disabled: !name.trim() }}
      onOk={handleOk}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className="py-2">
        <label className="mb-2 block text-sm text-[#5f6368]">工作表名称（创建后不可修改）</label>
        <Input
          value={name}
          maxLength={60}
          placeholder="请输入工作表名称"
          onChange={(e) => setName(e.target.value)}
          onPressEnter={handleOk}
          autoFocus
        />
      </div>
    </Modal>
  )
}
