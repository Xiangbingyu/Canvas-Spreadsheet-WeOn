const cacheConfig = require('../config/cacheConfig');

function withPrefix(...parts) {
  return [cacheConfig.keyPrefix, ...parts].join(':');
}

function docSnapshotKey(docId) {
  return withPrefix('doc', 'snapshot', docId);
}

function docMetaKey(docId) {
  return withPrefix('doc', 'meta', docId);
}

function userDocsListPrefix(userId) {
  return withPrefix('user', 'docs', userId);
}

function userDocsListKey({ userId, scope, page, pageSize }) {
  return withPrefix('user', 'docs', userId, scope, page, pageSize);
}

function docSeqKey(docId) {
  return withPrefix('doc', 'seq', docId);
}

function histEntryKey(docId, seq) {
  return withPrefix('hist', docId, seq);
}

function histDocPrefix(docId) {
  return withPrefix('hist', docId) + ':';
}

module.exports = {
  docSnapshotKey,
  docMetaKey,
  userDocsListPrefix,
  userDocsListKey,
  docSeqKey,
  histEntryKey,
  histDocPrefix,
};
