import { Button, Spin, Table, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ColumnsType } from 'antd/es/table'
import API, { ApiError } from '@/services/httpAPI'
import type { DocListItem } from '@/services/httpType'

type StartPageProps = {
  onOpenDoc: (docId: string) => void
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

export function StartPage({ onOpenDoc }: StartPageProps) {
  const [docs, setDocs] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadDocs() {
      setLoading(true)
      try {
        const data = await API.listDocs({
          userId: 'system', //后续会分配id的！！
          scope: 'all',
          page: 1,
          pageSize: 50,
        })
        console.log(data)
        if (!cancelled) setDocs(data.list)
      } catch (error) {
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
  }, [])

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
        <Button type="link" onClick={() => onOpenDoc(record.docId)}>
          打开
        </Button>
      ),
    },
  ]

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#f5f7fb] px-6 py-12">
      <div className="w-full max-w-4xl rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <Typography.Title level={4} style={{ margin: 0 }}>
            文档列表
          </Typography.Title>
          <Typography.Text type="secondary">点击文档进入表格</Typography.Text>
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
    </div>
  )
}
