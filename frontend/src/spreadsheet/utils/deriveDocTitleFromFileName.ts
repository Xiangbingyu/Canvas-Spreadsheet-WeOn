const DEFAULT_DOC_TITLE = '未命名表格'

/** 从上传文件名推导文档标题（去掉扩展名） */
export function deriveDocTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, '').trim()
  return base || DEFAULT_DOC_TITLE
}
