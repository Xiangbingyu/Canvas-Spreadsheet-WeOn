// 影子校验脚本：对比 Redis 实时态与 MySQL 持久层一致性
// 用法：node --env-file=.env scripts/shadowVerify.js

const docStore = require('../store/docStore');
const docRealtimeStore = require('../store/redis/docRealtimeStore');

function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortKeys(obj[k]); return acc; }, {});
}

function diff(a, b, path = 'root') {
  if (typeof a !== typeof b) return `${path}: type mismatch`;
  if (a === null || b === null) return a === b ? null : `${path}: null mismatch`;
  if (typeof a !== 'object') return a === b ? null : `${path}: ${a} !== ${b}`;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return `${path}: key count mismatch`;
  for (const k of keysA) {
    const sub = diff(a[k], b[k], `${path}.${k}`);
    if (sub) return sub;
  }
  return null;
}

async function verify() {
  const docs = await docStore.list();
  let ok = 0, fail = 0;

  for (const doc of docs) {
    const mysqlSeq = doc.currentSeq;
    const mysqlSnapshot = JSON.stringify(doc.snapshotJson);

    const rtState = await docRealtimeStore.getState(doc.docId);
    if (!rtState) {
      console.log(`⏭️  ${doc.docId}: Redis miss (not accessed)`);
      continue;
    }

    if (rtState.currentSeq !== mysqlSeq) {
      console.log(`❌ ${doc.docId}: seq ${rtState.currentSeq} !== ${mysqlSeq}`);
      fail++;
      continue;
    }

    const rtSnapshot = JSON.stringify(sortKeys(rtState.snapshotJson));
    if (rtSnapshot !== JSON.stringify(sortKeys(doc.snapshotJson))) {
      const d = diff(rtState.snapshotJson, doc.snapshotJson, doc.docId);
      console.log(`❌ ${doc.docId}: snapshot diff: ${d}`);
      fail++;
      continue;
    }

    console.log(`✅ ${doc.docId}: seq=${mysqlSeq}`);
    ok++;
  }

  console.log(`\n${ok} ok, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

verify().catch((err) => {
  console.error('verify failed:', err);
  process.exit(1);
});
