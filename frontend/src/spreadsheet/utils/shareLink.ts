/** 协作分享链接：`/doc/:docId` */
export function buildDocShareUrl(docId: string): string {
  return `${window.location.origin}/doc/${encodeURIComponent(docId)}`
}
