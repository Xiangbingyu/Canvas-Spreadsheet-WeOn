const docRealtimeStore = require('../store/docRealtimeStore');

async function ensureDocLoaded(docId) {
  return docRealtimeStore.ensureDocLoaded(docId);
}

async function getRealtimeDoc(docId) {
  return docRealtimeStore.getRealtimeDoc(docId);
}

async function saveRealtimeDoc(docId, nextState = {}) {
  return docRealtimeStore.saveRealtimeDoc(docId, nextState);
}

async function getState(docId) {
  return docRealtimeStore.getState(docId);
}

async function setState(docId, snapshotJson, options = {}) {
  return docRealtimeStore.setState(docId, snapshotJson, options);
}

async function getCurrentSeq(docId) {
  return docRealtimeStore.getCurrentSeq(docId);
}

async function setCurrentSeq(docId, seq, options = {}) {
  return docRealtimeStore.setCurrentSeq(docId, seq, options);
}

async function allocateNextSeq(docId) {
  return docRealtimeStore.allocateNextSeq(docId);
}

async function appendOp(docId, op = {}) {
  return docRealtimeStore.appendOp(docId, op);
}

async function listOps(docId, options = {}) {
  return docRealtimeStore.listOps(docId, options);
}

async function listTrackedDocIds() {
  if (typeof docRealtimeStore.listTrackedDocIds !== 'function') {
    return [];
  }

  return docRealtimeStore.listTrackedDocIds();
}

async function getUserOpState(docId, clientId) {
  return docRealtimeStore.getUserOpState(docId, clientId);
}

async function saveUserOpState(state = {}) {
  return docRealtimeStore.saveUserOpState(state);
}

async function listTrackedUserClientIds(docId) {
  if (typeof docRealtimeStore.listTrackedUserClientIds !== 'function') {
    return [];
  }

  return docRealtimeStore.listTrackedUserClientIds(docId);
}

async function getBarrier(docId) {
  return docRealtimeStore.getBarrier(docId);
}

async function setBarrier(docId, barrier) {
  return docRealtimeStore.setBarrier(docId, barrier);
}

async function closeRuntimeState() {
  if (typeof docRealtimeStore.close === 'function') {
    await docRealtimeStore.close();
  }
}

module.exports = {
  ensureDocLoaded,
  getRealtimeDoc,
  saveRealtimeDoc,
  getState,
  setState,
  getCurrentSeq,
  setCurrentSeq,
  allocateNextSeq,
  appendOp,
  listOps,
  listTrackedDocIds,
  getUserOpState,
  saveUserOpState,
  listTrackedUserClientIds,
  getBarrier,
  setBarrier,
  closeRuntimeState,
};
