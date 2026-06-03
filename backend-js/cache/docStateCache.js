const { deepClone } = require('../utils/clone');

const store = new Map();

module.exports = {
  get(docId) {
    return store.get(docId) || null;
  },

  set(docId, record) {
    store.set(docId, deepClone(record));
  },

  invalidate(docId) {
    store.delete(docId);
  },
};
