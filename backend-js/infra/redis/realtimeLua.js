// Redis 实时态原子提交脚本。咽喉点 A：CAS baseSeq → INCR seq → 写 state → XADD stream。
// rebase 不在 Lua 内做（涉及读 history range/坐标 transform，留在 JS 层）；
// Lua 只负责"基于已 rebase 后的最终 state 做原子落地 + 分配 seq"。
// 详见 docs/Gate分阶段实施计划.md §1.3。Phase 0 仅提供脚本与封装，不接入写链路。

// KEYS[1]=seqKey KEYS[2]=stateKey KEYS[3]=streamKey
// ARGV[1]=expectedBaseSeq（''=跳过校验） ARGV[2]=newStateJson ARGV[3]=eventJson
// 返回：{ newSeq, streamId } 成功；{ -1, currentSeq } 表示 baseSeq 超前（冲突）。
const COMMIT_SCRIPT = `
  local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
  local expectedBase = ARGV[1]
  if expectedBase ~= '' then
    local base = tonumber(expectedBase)
    if base ~= nil and base > cur then
      return { -1, cur }
    end
  end
  local newSeq = cur + 1
  redis.call('SET', KEYS[1], newSeq)
  redis.call('SET', KEYS[2], ARGV[2])
  local streamId = redis.call('XADD', KEYS[3], newSeq .. '-0', 'event', ARGV[3])
  return { newSeq, streamId }
`;

const COMMIT_CONFLICT = -1;

// evalCommit：在已就绪的 redis client 上执行原子提交。
// client 由调用方（Phase 1 的 docRealtimeStore）注入并保证已连接。
async function evalCommit(client, { seqKey, stateKey, streamKey, expectedBaseSeq, stateJson, eventJson }) {
  const result = await client.eval(COMMIT_SCRIPT, {
    keys: [seqKey, stateKey, streamKey],
    arguments: [
      expectedBaseSeq === null || expectedBaseSeq === undefined ? '' : String(expectedBaseSeq),
      stateJson,
      eventJson,
    ],
  });

  const [first, second] = Array.isArray(result) ? result : [];

  if (Number(first) === COMMIT_CONFLICT) {
    return { ok: false, conflict: true, currentSeq: Number(second) };
  }

  return { ok: true, conflict: false, seq: Number(first), streamId: second };
}

module.exports = {
  COMMIT_SCRIPT,
  COMMIT_CONFLICT,
  evalCommit,
};
