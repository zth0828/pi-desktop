// 会话变更操作（switch/newSession/fork）的串行化互斥。
// switch 等操作有多个 await 点，期间全局 active / runtime 集合可被并发调用交叉改写
// （两个窗口同时 switch 时 activateSessionRuntime 的执行顺序决定最终归属）。
// 按目标 sessionPath 维度排队：同一会话上的操作严格串行，不同会话互不阻塞。

const chains = new Map<string, Promise<unknown>>();

export function serializeSessionOp<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // prev.then(op, op)：前序操作无论成败都放行后续排队者，失败的 chain 不能卡死队列
  const next = prev.then(op, op);
  // 收尾 promise 只负责清理注册表且自吞异常（避免无人消费的 rejection），
  // 调用方拿到的是 next 本身（op 的真实结果）
  const cleanup = next
    .then(() => undefined, () => undefined)
    .then(() => {
      if (chains.get(key) === cleanup) chains.delete(key);
    });
  chains.set(key, cleanup);
  return next;
}
