const storeConfig = require('../config/storeConfig');
const { execute, withTransaction } = require('../db/mysql');

const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

const queue = [];
let running = false;
let drainResolvers = [];

function isMysql() {
  return storeConfig.driver === 'mysql';
}

async function flush() {
  if (running || queue.length === 0) return;
  running = true;

  const batch = queue.splice(0, BATCH_SIZE);

  let attempts = 0;
  while (attempts < MAX_RETRIES) {
    try {
      await withTransaction(async (conn) => {
        for (const item of batch) {
          if (item.type === 'applySetCell') {
            const { docId, snapshotJson, seq, updatedAt } = item.data;
            await conn.execute(
              'UPDATE doc SET snapshot_json = CAST(? AS JSON), current_seq = ?, updated_at = ? WHERE doc_id = ?',
              [JSON.stringify(snapshotJson), seq, new Date(updatedAt), docId]
            );
          } else if (item.type === 'appendHistory') {
            const d = item.data;
            await conn.execute(
              `INSERT INTO history (
                doc_id, seq, base_seq, client_id, op_type, target_sheet_id,
                target_row, target_col, old_value_json, new_value_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
              [
                d.docId, d.seq, d.baseSeq ?? null, d.clientId, d.opType,
                d.targetSheetId ?? null, d.targetRow ?? null, d.targetCol ?? null,
                JSON.stringify(d.oldValueJson ?? null),
                JSON.stringify(d.newValueJson ?? null),
                new Date(d.createdAt || Date.now()),
              ]
            );
          }
        }
      });
      break;
    } catch (err) {
      attempts += 1;
      if (attempts >= MAX_RETRIES) {
        console.error('[asyncWriteQueue] batch failed after retries:', err.message, batch);
      }
    }
  }

  running = false;

  if (queue.length > 0) {
    setImmediate(flush);
  } else {
    const resolvers = drainResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

module.exports = {
  enqueue(item) {
    if (!isMysql()) return;
    queue.push(item);
    setImmediate(flush);
  },

  start() {
    // no-op: flush is triggered on enqueue via setImmediate
  },

  drain() {
    if (!isMysql() || (!running && queue.length === 0)) return Promise.resolve();
    return new Promise((resolve) => drainResolvers.push(resolve));
  },
};
