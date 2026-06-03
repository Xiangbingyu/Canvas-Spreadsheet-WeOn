import { Input, Modal, Typography } from 'antd'
import { useState } from 'react'

type DisplayNameModalProps = {
  open: boolean
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function DisplayNameModal({ open, onConfirm, onCancel }: DisplayNameModalProps) {
  const [draft, setDraft] = useState('')
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setDraft('')
    }
  }

  function handleOk() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onConfirm(trimmed)
    setDraft('')
  }

  function handleCancel() {
    setDraft('')
    onCancel()
  }

  return (
    <Modal
      title="填写显示名称"
      open={open}
      okText="进入文档"
      cancelText="返回列表"
      okButtonProps={{ disabled: !draft.trim() }}
      onOk={handleOk}
      onCancel={handleCancel}
      maskClosable={false}
      closable={false}
      destroyOnHidden
      width={420}
    >
      <Typography.Text type="secondary" className="mb-3 block">
        请输入你在协同编辑中的显示名称，其他人将看到该名称及头像首字。
      </Typography.Text>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="例如：张三"
        maxLength={32}
        onPressEnter={handleOk}
        autoFocus
      />
    </Modal>
  )
}
