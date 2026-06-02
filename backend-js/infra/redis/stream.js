// Redis Stream 薄封装：XADD / XREADGROUP / XACK / XTRIM / XRANGE。
// Phase 0 仅提供命令封装；消费组创建、消费循环在 Phase 1+2 的 worker 中编排。
// 所有方法接受一个已就绪的 redis client（由调用方注入）。

// 确保消费组存在（幂等）。MKSTREAM 让流不存在时一并创建。
async function ensureGroup(client, { streamKey, group, startId = '0' }) {
  try {
    await client.xGroupCreate(streamKey, group, startId, { MKSTREAM: true });
  } catch (error) {
    // BUSYGROUP：消费组已存在，视为成功。
    if (!String(error && error.message).includes('BUSYGROUP')) {
      throw error;
    }
  }
}

async function add(client, { streamKey, id = '*', event }) {
  return client.xAdd(streamKey, id, { event });
}

async function readGroup(client, { streamKey, group, consumer, count, blockMs }) {
  const options = {};
  if (Number.isInteger(count) && count > 0) {
    options.COUNT = count;
  }
  if (Number.isInteger(blockMs) && blockMs >= 0) {
    options.BLOCK = blockMs;
  }

  return client.xReadGroup(group, consumer, [{ key: streamKey, id: '>' }], options);
}

async function ack(client, { streamKey, group, ids }) {
  const idList = Array.isArray(ids) ? ids : [ids];
  if (idList.length === 0) {
    return 0;
  }
  return client.xAck(streamKey, group, idList);
}

// 读取 (fromSeq, toSeq] 区间事件，供 rebase 读近段历史。
// seq 与 stream id 对齐（XADD 用 `{seq}-0`），故用 exclusive start `({fromSeq}-0` 之后。
async function rangeBySeq(client, { streamKey, fromSeq, toSeq }) {
  const start = `(${fromSeq}-0`;
  const end = `${toSeq}-0`;
  return client.xRange(streamKey, start, end);
}

// 保留 checkpoint 之后 + 至少最近 retainCount 条（近似裁剪，MINID 更精确时由调用方算 id）。
async function trimToCount(client, { streamKey, retainCount }) {
  return client.xTrim(streamKey, 'MAXLEN', retainCount, { strategyModifier: '~' });
}

module.exports = {
  ensureGroup,
  add,
  readGroup,
  ack,
  rangeBySeq,
  trimToCount,
};
