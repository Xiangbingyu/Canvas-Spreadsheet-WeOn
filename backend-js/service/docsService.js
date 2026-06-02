const docSnapshotCache = require('../cache/docSnapshotCache');
const docMetaCache = require('../cache/docMetaCache');
const userDocsListCache = require('../cache/userDocsListCache');
const idempotencyService = require('../idempotency/idempotencyService');
const { createDocRequestKey } = require('../idempotency/idempotencyKeys');
const { ERROR_CODES } = require('../protocol/errorCodes');
const { isNonEmptyString, isPositiveInteger } = require('../protocol/validators');
const docStore = require('../store/docStore');
const roomUserStore = require('../store/roomUserStore');
const auditService = require('../audit/auditService');
const { normalizeDocSnapshot } = require('../domain/entities/doc');
const realtimeConfig = require('../config/realtimeConfig');
const docRealtimeStore = require('../store/redis/docRealtimeStore');
const docRecoveryService = require('./recovery/docRecoveryService');

// ==================== 公共方法 ====================

// 通用错误对象构造，供当前 service 内部统一抛错使用。
function createServiceError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

// `POST /docs` 的入参规范化与基础校验。
function normalizeCreateDocInput(input = {}) {
  const normalized = {};

  if (input.title === undefined) {
    normalized.title = 'Untitled';
  } else if (typeof input.title === 'string') {
    const trimmedTitle = input.title.trim();

    if (!trimmedTitle) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'title must be a non-empty string');
    }

    normalized.title = trimmedTitle;
  } else {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'title must be a string');
  }

  if (input.createdBy === undefined || input.createdBy === null) {
    normalized.createdBy = null;
  } else if (typeof input.createdBy === 'string') {
    const trimmedCreatedBy = input.createdBy.trim();

    if (!trimmedCreatedBy) {
      throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'createdBy must be a non-empty string');
    }

    normalized.createdBy = trimmedCreatedBy;
  } else {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'createdBy must be a string');
  }

  if (input.eventId === undefined || input.eventId === null) {
    normalized.eventId = null;
  } else if (isNonEmptyString(input.eventId)) {
    normalized.eventId = input.eventId.trim();
  } else {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'eventId must be a non-empty string');
  }

  if (input.snapshot === undefined) {
    normalized.snapshot = undefined;
  } else if (input.snapshot && typeof input.snapshot === 'object' && !Array.isArray(input.snapshot)) {
    normalized.snapshot = input.snapshot;
  } else {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'snapshot must be an object');
  }

  return normalized;
}

// 把 store 层记录转换为 HTTP 返回使用的文档视图。
function toDocView(docRecord) {
  return {
    docId: docRecord.docId,
    title: docRecord.title,
    currentSeq: docRecord.currentSeq,
    createdBy: docRecord.createdBy,
    createdAt: docRecord.createdAt,
    updatedAt: docRecord.updatedAt,
    snapshot: normalizeDocSnapshot(docRecord.snapshotJson, { docId: docRecord.docId }),
  };
}

function toDocMeta(docRecord) {
  return {
    docId: docRecord.docId,
    title: docRecord.title,
    currentSeq: docRecord.currentSeq,
    createdBy: docRecord.createdBy,
    createdAt: docRecord.createdAt,
    updatedAt: docRecord.updatedAt,
  };
}

// 把 store 层记录转换为文档列表项。
function toDocListItem(docRecord, relation) {
  return {
    docId: docRecord.docId,
    title: docRecord.title,
    createdBy: docRecord.createdBy,
    createdAt: docRecord.createdAt,
    updatedAt: docRecord.updatedAt,
    currentSeq: docRecord.currentSeq,
    relation,
  };
}

function uniqueNonEmptyStrings(values = []) {
  return Array.from(
    new Set(
      values.filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim())
    )
  );
}

async function primeDocCaches(docRecord) {
  if (!docRecord) {
    return;
  }

  await Promise.all([
    docSnapshotCache.set(docRecord.docId, toDocView(docRecord)),
    docMetaCache.set(docRecord.docId, toDocMeta(docRecord)),
  ]);
}

async function getValidRememberedCreateDocResponse(record) {
  if (!record || record.status !== 'completed' || !record.response || !record.response.docId) {
    return null;
  }

  const existingDoc = await docStore.getDocState(record.response.docId);
  return existingDoc ? record.response : null;
}

async function getDocMeta(docId) {
  const normalizedDocId = normalizeDocId(docId);
  const cachedMeta = await docMetaCache.get(normalizedDocId);

  if (cachedMeta) {
    return cachedMeta;
  }

  const storedDoc = await docStore.getDocState(normalizedDocId);

  if (!storedDoc) {
    return null;
  }

  await primeDocCaches(storedDoc);
  return toDocMeta(storedDoc);
}

async function invalidateUserDocsListCaches(userIds = []) {
  const normalizedUserIds = uniqueNonEmptyStrings(userIds);

  await Promise.all(
    normalizedUserIds.map((userId) => userDocsListCache.invalidateByUserId(userId))
  );
}

async function getRelatedUserIdsByDoc(docId) {
  const docMeta = await getDocMeta(docId);

  if (!docMeta) {
    return [];
  }

  const roomUsers = await roomUserStore.listByDocId(docId);
  return uniqueNonEmptyStrings([
    docMeta.createdBy,
    ...roomUsers.map((roomUser) => roomUser.clientId),
  ]);
}

async function invalidateDocCaches(docId, options = {}) {
  const { relatedUserIds = null } = options;

  await Promise.all([
    docSnapshotCache.invalidate(docId),
    docMetaCache.invalidate(docId),
  ]);

  const resolvedUserIds = Array.isArray(relatedUserIds)
    ? relatedUserIds
    : await getRelatedUserIdsByDoc(docId);

  await invalidateUserDocsListCaches(resolvedUserIds);
}

// 文档列表统一按最近更新时间倒序返回。
function sortDocsByUpdatedAtDesc(records) {
  return records.sort((left, right) => {
    const updatedAtCompareResult = right.updatedAt.localeCompare(left.updatedAt);

    if (updatedAtCompareResult !== 0) {
      return updatedAtCompareResult;
    }

    return right.docId.localeCompare(left.docId);
  });
}

// 对文档列表做分页。
function paginateRecords(records, page, pageSize) {
  const total = records.length;
  const offset = (page - 1) * pageSize;
  const list = records.slice(offset, offset + pageSize);

  return {
    list,
    page,
    pageSize,
    total,
    hasMore: offset + list.length < total,
  };
}

// ==================== POST /docs ====================

// `POST /docs` 主流程：
// 1. 校验并规范化入参
// 2. 执行基础幂等判断
// 3. 写入 docStore
// 4. 预热文档缓存并失效相关列表缓存
// 5. 记录审计日志
async function createDoc(input = {}) {
  const normalizedInput = normalizeCreateDocInput(input);
  const requestKey = createDocRequestKey(normalizedInput.eventId);
  let hasRetriedAfterDeletingStaleRecord = false;

  while (requestKey) {
    const lockAcquired = await idempotencyService.beginProcessing(requestKey);

    if (lockAcquired) {
      break;
    }

    const remembered = await idempotencyService.waitForCompleted(requestKey);
    const validRememberedResponse = await getValidRememberedCreateDocResponse(remembered);

    if (validRememberedResponse) {
      return validRememberedResponse;
    }

    await idempotencyService.deleteRecord(requestKey);

    if (hasRetriedAfterDeletingStaleRecord) {
      throw createServiceError(ERROR_CODES.INTERNAL_ERROR, 'duplicate request is still processing');
    }

    hasRetriedAfterDeletingStaleRecord = true;
  }

  try {
    const createdDoc = await docStore.createDoc({
      title: normalizedInput.title,
      createdBy: normalizedInput.createdBy,
      snapshotJson: normalizedInput.snapshot,
    });
    const docView = toDocView(createdDoc);

    await primeDocCaches(createdDoc);
    await invalidateUserDocsListCaches([createdDoc.createdBy]);

    await auditService.recordAuditEvent({
      type: 'doc_created',
      docId: createdDoc.docId,
      createdBy: createdDoc.createdBy,
      eventId: normalizedInput.eventId,
      title: createdDoc.title,
    });

    if (requestKey) {
      await idempotencyService.completeProcessing(requestKey, docView);
    }

    return docView;
  } catch (error) {
    if (requestKey) {
      await idempotencyService.deleteRecord(requestKey);
    }

    throw error;
  }
}

// ==================== GET /docs ====================

// `GET /docs` 的查询参数规范化与基础校验。
function normalizeListDocsInput(input = {}) {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  const scope = typeof input.scope === 'string' ? input.scope.trim() : '';
  const page = Number(input.page);
  const pageSize = Number(input.pageSize);

  if (!userId) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'userId must be a non-empty string');
  }

  if (!['created', 'participated', 'all'].includes(scope)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'scope must be one of: created, participated, all');
  }

  if (!isPositiveInteger(page)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'page must be a positive integer');
  }

  if (!isPositiveInteger(pageSize)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'pageSize must be a positive integer');
  }

  if (pageSize > 100) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'pageSize must be less than or equal to 100');
  }

  return {
    userId,
    scope,
    page,
    pageSize,
  };
}

// `GET /docs` 主流程：
// 1. 根据 scope 读取当前用户创建的文档和参与的文档
// 2. 对 all 做去重合并，创建关系优先
// 3. 按更新时间倒序排序
// 4. 返回分页结果
async function listDocsByUser(input = {}) {
  const normalizedInput = normalizeListDocsInput(input);
  const cachedList = await userDocsListCache.get(normalizedInput);

  if (cachedList) {
    return cachedList;
  }

  const allDocs = await docStore.list();
  const createdDocs = [];
  const participatedDocs = [];

  if (normalizedInput.scope === 'created' || normalizedInput.scope === 'all') {
    for (const doc of allDocs) {
      if (doc.createdBy === normalizedInput.userId) {
        createdDocs.push(toDocListItem(doc, 'created'));
      }
    }
  }

  if (normalizedInput.scope === 'participated' || normalizedInput.scope === 'all') {
    const roomUsers = await roomUserStore.listByClientId(normalizedInput.userId);
    const docsById = new Map(allDocs.map((doc) => [doc.docId, doc]));

    for (const roomUser of roomUsers) {
      const doc = docsById.get(roomUser.docId);

      if (!doc || doc.createdBy === normalizedInput.userId) {
        continue;
      }

      participatedDocs.push(toDocListItem(doc, 'participated'));
    }
  }

  if (normalizedInput.scope === 'created') {
    const paginatedResult = paginateRecords(
      sortDocsByUpdatedAtDesc(createdDocs),
      normalizedInput.page,
      normalizedInput.pageSize
    );
    await userDocsListCache.set(normalizedInput, paginatedResult);
    return paginatedResult;
  }

  if (normalizedInput.scope === 'participated') {
    const deduplicatedParticipatedDocs = Array.from(
      new Map(participatedDocs.map((doc) => [doc.docId, doc])).values()
    );

    const paginatedResult = paginateRecords(
      sortDocsByUpdatedAtDesc(deduplicatedParticipatedDocs),
      normalizedInput.page,
      normalizedInput.pageSize
    );
    await userDocsListCache.set(normalizedInput, paginatedResult);
    return paginatedResult;
  }

  const mergedDocsById = new Map();

  for (const doc of createdDocs) {
    mergedDocsById.set(doc.docId, doc);
  }

  for (const doc of participatedDocs) {
    if (!mergedDocsById.has(doc.docId)) {
      mergedDocsById.set(doc.docId, doc);
    }
  }

  const paginatedResult = paginateRecords(
    sortDocsByUpdatedAtDesc(Array.from(mergedDocsById.values())),
    normalizedInput.page,
    normalizedInput.pageSize
  );
  await userDocsListCache.set(normalizedInput, paginatedResult);
  return paginatedResult;
}

// ==================== GET /docs/:docId ====================

// `GET /docs/:docId` 的路径参数规范化与基础校验。
function normalizeDocId(docId) {
  if (!isNonEmptyString(docId)) {
    throw createServiceError(ERROR_CODES.INVALID_PARAMS, 'docId must be a non-empty string');
  }

  return docId.trim();
}

// `GET /docs/:docId` 主流程：
// 1. 先查文档快照缓存
// 2. 未命中再查 docStore
// 3. store 命中后同时回填 snapshot/meta 缓存
async function getDocState(docId) {
  const normalizedDocId = normalizeDocId(docId);
  const cachedDoc = await docSnapshotCache.get(normalizedDocId);

  if (cachedDoc) {
    return cachedDoc;
  }

  const storedDoc = await docStore.getDocState(normalizedDocId);

  if (!storedDoc) {
    throw createServiceError(ERROR_CODES.DOCUMENT_NOT_FOUND, `document not found: ${normalizedDocId}`);
  }

  const docView = toDocView(storedDoc);
  await primeDocCaches(storedDoc);
  return docView;
}

async function getDocStateForWrite(docId, options = {}) {
  const normalizedDocId = normalizeDocId(docId);

  if (realtimeConfig.driver === 'redis') {
    let state = await docRealtimeStore.getState(normalizedDocId);
    if (!state) {
      await docRecoveryService.seedRealtimeFromMysql(normalizedDocId);
      state = await docRealtimeStore.getState(normalizedDocId);
    }
    if (!state) return null;
    return {
      docId: normalizedDocId,
      currentSeq: state.currentSeq,
      snapshotJson: state.snapshotJson,
    };
  }

  return docStore.getDocState(normalizedDocId, options);
}

// Gate 路径：Lua 原子提交，返回 { seq, snapshotJson, event }。不写 MySQL。
async function commitRealtimeOp(docId, { expectedBaseSeq, snapshotJson, event }) {
  const result = await docRealtimeStore.commit(docId, { expectedBaseSeq, snapshotJson, event });
  return result;
}

async function applySetCell(command, options = {}) {
  const { connection = null } = options;
  return docStore.applySetCell(command, { connection });
}

async function applyBatchSetCell(command, options = {}) {
  const { connection = null } = options;
  return docStore.applyBatchSetCell(command, { connection });
}

async function applySetTitle(command, options = {}) {
  const { connection = null } = options;
  return docStore.applySetTitle(command, { connection });
}

async function applyImportSheet(command, options = {}) {
  const { connection = null } = options;
  return docStore.applyImportSheet(command, { connection });
}

async function applyAddSheet(command, options = {}) {
  const { connection = null } = options;
  return docStore.applyAddSheet(command, { connection });
}

async function applySheetStructureChange(command, options = {}) {
  const { connection = null } = options;
  return docStore.applySheetStructureChange(command, { connection });
}

module.exports = {
  createDoc,
  listDocsByUser,
  getDocState,
  getDocStateForWrite,
  commitRealtimeOp,
  getDocMeta,
  applySetCell,
  applyBatchSetCell,
  applySetTitle,
  applyImportSheet,
  applyAddSheet,
  applySheetStructureChange,
  primeDocCaches,
  invalidateDocCaches,
  invalidateUserDocsListCaches,
};
