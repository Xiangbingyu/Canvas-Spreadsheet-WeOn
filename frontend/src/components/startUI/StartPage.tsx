import { Button, Spin, Table, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate } from 'react-router-dom'
import { CreateBlankSheetModal } from '@/components/startUI/CreateBlankSheetModal'
import API, { ApiError } from '@/services/httpAPI'
import type { DocListItem } from '@/services/httpType'

type StartPageProps = {
  userId: string
}

function formatCreatedAt(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`
}

export function StartPage({ userId }: StartPageProps) {
  const navigate = useNavigate()
  const [docs, setDocs] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadDocs() {
      setLoading(true)
      try {
        const data = await API.listDocs({
          userId,
          scope: 'all',
          page: 1,
          pageSize: 50,
        })
        console.log('[GET /docs]', data)
        if (!cancelled) setDocs(data.list)
      } catch (error) {
        console.log('[GET /docs] error', error)
        if (!cancelled) {
          const text =
            error instanceof ApiError ? `${error.message} (code ${error.code})` : '加载文档列表失败'
          message.error(text)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDocs()
    return () => {
      cancelled = true
    }
  }, [userId])

  function handleOpenDoc(docId: string) {
    navigate(`/doc/${encodeURIComponent(docId)}`)
  }

  async function handleCreateBlankSheet(title: string) {
    setCreating(true)
    try {
      const doc = await API.createDoc({ title, createdBy: userId })
      console.log('[POST /docs]', doc)
      setCreateModalOpen(false)
      navigate(`/doc/${encodeURIComponent(doc.docId)}`)
    } catch (error) {
      console.log('[POST /docs] error', error)
      const text =
        error instanceof ApiError ? `${error.message} (code ${error.code})` : '创建文档失败'
      message.error(text)
    } finally {
      setCreating(false)
    }
  }

  const dataSource = useMemo(() => {
    return [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [docs])

  const columns: ColumnsType<DocListItem> = [
    {
      title: '',
      key: 'icon',
      width: 56,
      render: () => <span className="text-[18px]">📄</span>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (title: string) => <Typography.Text strong>{title}</Typography.Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 220,
      render: (createdAt: string) => (
        <Typography.Text type="secondary">{formatCreatedAt(createdAt)}</Typography.Text>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 90,
      render: (_, record) => (
        <Button type="link" onClick={() => handleOpenDoc(record.docId)}>
          打开
        </Button>
      ),
    },
  ]

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#f5f7fb] px-6 py-12">
      <div className="w-full max-w-4xl rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <Typography.Title level={4} style={{ margin: 0 }}>
            文档列表
          </Typography.Title>
          <Button type="primary" disabled={creating} onClick={() => setCreateModalOpen(true)}>
            新建空白表
          </Button>
        </div>

        <Spin spinning={loading}>
          <Table<DocListItem>
            rowKey="docId"
            columns={columns}
            dataSource={dataSource}
            pagination={false}
            locale={{ emptyText: '暂无文档' }}
          />
        </Spin>
      </div>

      <CreateBlankSheetModal
        open={createModalOpen}
        loading={creating}
        onClose={() => setCreateModalOpen(false)}
        onConfirm={(title) => void handleCreateBlankSheet(title)}
      />
    </div>
  )
}
