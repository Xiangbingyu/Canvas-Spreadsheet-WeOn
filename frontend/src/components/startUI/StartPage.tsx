import { Button, Spin, Table, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ColumnsType } from 'antd/es/table'
import { useDispatch } from 'react-redux'
import API, { ApiError } from '@/services/httpAPI'
import type { DocListItem } from '@/services/httpType'
import { setWorksheet } from '@/spreadsheet/store'
import { setDocSession } from '@/spreadsheet/store/userStore'
import { fromServerSnapshot } from '@/spreadsheet/utils/fromServerSnapshot'

type StartPageProps = {
  userId: string
  onEnterSheet: () => void
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

export function StartPage({ userId, onEnterSheet }: StartPageProps) {
  const dispatch = useDispatch()
  const [docs, setDocs] = useState<DocListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openingDocId, setOpeningDocId] = useState<string | null>(null)

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

  async function handleOpenDoc(docId: string) {
    setOpeningDocId(docId)
    try {
      const doc = await API.getDoc(docId)
      console.log('[GET /docs/:docId]', doc)
      dispatch(setWorksheet(fromServerSnapshot(doc.snapshot)))
      dispatch(setDocSession({ docId: doc.docId, clientId: userId }))
      onEnterSheet()
    } catch (error) {
      console.log('[GET /docs/:docId] error', error)
      const text =
        error instanceof ApiError ? `${error.message} (code ${error.code})` : '加载文档失败'
      message.error(text)
    } finally {
      setOpeningDocId(null)
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
        <Button
          type="link"
          loading={openingDocId === record.docId}
          disabled={openingDocId !== null && openingDocId !== record.docId}
          onClick={() => void handleOpenDoc(record.docId)}
        >
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
