// Mock OpenAI-compatible server（openai-completions SSE），供 L2 契约测试与 E2E。
// 从 spike 脚本搬入（/tmp/pi-desktop-spikes/mock-openai.mjs），新增 SLOW 模式验证 abort。
// 脚本协议（按最后一条 user 消息分派）：
//   "USE_TOOL_LS" → 第一轮返回 tool_call(bash: ls)，之后回显工具结果
//   "USE_TOOL_EDIT" → 第一轮返回 tool_call(edit: e2e-edit-target.txt alpha→beta)
//   "USE_TOOL_WRITE" → 第一轮返回 tool_call(write: 新建 e2e-new-file.txt)
//   "USE_TOOL_READ_IMAGE" → 第一轮返回 tool_call(read: preview.png)
//   "USE_TOOL_EDIT_WRITE" → 第一轮返回两个并行 tool_call（edit + write 各一）
//   "MCP_SEARCH"/"MCP_CALL" → 驱动 mcp 代理工具
//   "SLOW ..." → 30 个 chunk × 100ms 慢速流（用于 abort 测试）
//   "FLAKE_429" → 首次请求返回 429（触发 pi 自动重试），后续正常 PONG
//   "ECHO_USER" → 回显最后一条 user 消息（@文件 展开断言用）
//   "CACHE_MISS" → 第一轮 usage 全量 cache_write，第二轮零缓存（缓存失效警告断言用）
//   "REASONING_TURN" → 同一 assistant 消息返回 thinking + 最终文本（整回合折叠断言用）
//   压缩摘要请求（含 "context checkpoint summary"）→ 12 个 chunk × 150ms 慢速流，
//     给 compaction 状态条留出可观测窗口
//   其他 → 流式返回 "PONG"
import http from "node:http";

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

// FLAKE_429 只失败一次（触发 auto_retry_start 后第二次请求成功）
let flaked429 = false;

// tool_call id 全局递增：真实 provider 每次调用 id 唯一，mock 不能跨请求复用
// （渲染层 toolExecutions 按 toolCallId  keyed，复用会互相覆盖）
let callSeq = 0;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/models") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>dashboard</body></html>");
    return;
  }
  if (req.method === "GET" && req.url.includes("/api/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [
      {
        key: "qwen/qwen3.5-9b",
        display_name: "Qwen3.5 9B (LM Studio)",
        type: "llm",
        max_context_length: 131072,
        capabilities: { vision: true, reasoning: true },
        loaded_instances: [{ config: { context_length: 262144 } }],
      },
      { key: "nomic-embed", type: "embedding" },
    ] }));
    return;
  }
  if (req.method === "GET" && req.url.includes("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [
      { id: "mock-2" },
      { id: "mock-discovered", context_window: 256000, max_output_tokens: 16384 },
    ] }));
    return;
  }
  // 协议探测回归：站点路由可能返回 200 HTML，不能据此判定 API 可用。
  if (req.method === "POST" && ["/chat/completions", "/responses", "/messages"].includes(req.url)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>dashboard</body></html>");
    return;
  }
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    res.writeHead(404).end("not found");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const msgs = parsed.messages || [];
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    const lastUser = lastUserIdx >= 0 ? JSON.stringify(msgs[lastUserIdx]) : "";
    const hasToolResult = msgs.slice(lastUserIdx + 1).some((m) => m.role === "tool");
    const wantsTool = !hasToolResult && (
      lastUser.includes("USE_TOOL_LS") || lastUser.includes("USE_TOOL_EDIT") ||
      lastUser.includes("USE_TOOL_LONG") || lastUser.includes("USE_TOOL_LINES") ||
      lastUser.includes("USE_TOOL_WRITE") || lastUser.includes("USE_TOOL_READ_IMAGE") || lastUser.includes("USE_TOOL_EDIT_WRITE") ||
      lastUser.includes("MCP_CALL") || lastUser.includes("MCP_SEARCH")
    );

    // 首次 FLAKE_429 返回 429，驱动 pi 的 auto_retry_start（重试后走正常 PONG）
    if (lastUser.includes("FLAKE_429") && !flaked429) {
      flaked429 = true;
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: { message: "429 Too Many Requests: rate limit reached", type: "rate_limit_error" },
      }));
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    // 注意：不能在这里给 req 挂 close → res.end()，POST body 收完即触发 close，
    // 会把慢速 SSE 流提前掐断（abort 场景由各分支自行清理）。

    const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: "mock-1" };
    const send = (delta, finish = null, usage = undefined) => {
      const chunk = { ...base, choices: [{ index: 0, delta, finish_reason: finish }] };
      if (usage) chunk.usage = usage;
      sse(res, chunk);
    };

    // ECHO_USER：回显最后一条 user 消息（断言 @文件 展开后的内容确实到了 provider）
    if (lastUser.includes("ECHO_USER")) {
      const text = "ECHO:" + lastUser.slice(0, 1200);
      send({ role: "assistant", content: "" });
      for (const ch of text) send({ content: ch });
      send({}, "stop", { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Rich markdown fixture: exercises renderer-only presentation without changing pi's protocol.
    if (lastUser.includes("RICH_MARKDOWN")) {
      const text = "# Release plan\n\n- [x] Ship the shell\n- [ ] Add preview polish\n- [ ] Verify dark theme\n\n| Metric | Value |\n| --- | ---: |\n| Tokens | 42 |\n\n> Keep the response readable.\n\n\`\`\`ts\nconst answer = 42;\nif (answer) {\n  console.log(answer);\n}\n\`\`\`\n\n[Open docs](https://example.com/docs)";
      send({ role: "assistant", content: "" });
      for (const ch of text) send({ content: ch });
      send({}, "stop", { prompt_tokens: 12, completion_tokens: text.length, total_tokens: 12 + text.length });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (lastUser.includes("REASONING_TURN")) {
      const text = "FINAL: reasoning complete";
      send({ role: "assistant", reasoning_content: "THOUGHT: inspect the request before answering" });
      for (const ch of text) send({ content: ch });
      send({}, "stop", { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (wantsTool) {
      // 一轮双工具（并行 tool_calls）：edit + write，驱动聚合编辑卡 E2E
      if (lastUser.includes("USE_TOOL_EDIT_WRITE")) {
        const editArgs = JSON.stringify({
          path: "e2e-edit-target.txt",
          edits: [{ oldText: "alpha", newText: "beta" }],
        });
        const writeArgs = JSON.stringify({ path: "e2e-new-file.txt", content: "hello from agent\n" });
        send({ role: "assistant", content: "PROCESS: preparing edits", tool_calls: [
          { index: 0, id: `call_mock_${++callSeq}`, type: "function", function: { name: "edit", arguments: "" } },
          { index: 1, id: `call_mock_${++callSeq}`, type: "function", function: { name: "write", arguments: "" } },
        ] });
        send({ tool_calls: [
          { index: 0, function: { arguments: editArgs } },
          { index: 1, function: { arguments: writeArgs } },
        ] }, "tool_calls", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      let toolName = "bash";
      let args = JSON.stringify({ command: "ls" });
      if (lastUser.includes("USE_TOOL_LONG")) {
        args = JSON.stringify({ command: "node -e \"process.stdout.write('x'.repeat(12000))\"" });
      } else if (lastUser.includes("USE_TOOL_LINES")) {
        args = JSON.stringify({ command: "printf 'line-01\\nline-02\\nline-03\\nline-04\\nline-05\\nline-06\\nline-07\\nline-08\\nline-09\\nline-10\\nline-11\\nline-12\\n'" });
      }
      if (lastUser.includes("USE_TOOL_EDIT")) {
        toolName = "edit";
        args = JSON.stringify({
          path: "e2e-edit-target.txt",
          edits: [{ oldText: "alpha", newText: "beta" }],
        });
      } else if (lastUser.includes("USE_TOOL_WRITE")) {
        toolName = "write";
        args = JSON.stringify({
          path: "e2e-new-file.txt",
          content: "hello from agent\n",
        });
      } else if (lastUser.includes("USE_TOOL_READ_IMAGE")) {
        toolName = "read";
        args = JSON.stringify({ path: "preview.png" });
      } else if (lastUser.includes("MCP_CALL")) {
        toolName = "mcp";
        args = JSON.stringify({ tool: "mockmcp_ping", args: { message: "hello" } });
      } else if (lastUser.includes("MCP_SEARCH")) {
        toolName = "mcp";
        args = JSON.stringify({ search: "ping" });
      }
      send({ role: "assistant", content: `PROCESS: running ${toolName}`, tool_calls: [{ index: 0, id: `call_mock_${++callSeq}`, type: "function", function: { name: toolName, arguments: "" } }] });
      send({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, 5) } }] });
      send({ tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }, "tool_calls",
        { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // pi 压缩/分支摘要的总结请求：慢速流，让 compaction 状态条有可观测窗口
    if (lastUser.includes("context checkpoint summary")) {
      const text = "MOCK_SUMMARY";
      send({ role: "assistant", content: "" });
      let i = 0;
      const timer = setInterval(() => {
        if (i < text.length) {
          send({ content: text[i] });
          i++;
        } else {
          clearInterval(timer);
          send({}, "stop", { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length });
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, 150);
      // 注意：不能挂 req.on("close") 清定时器——POST body 收完即触发 close，
      // 会把慢速流提前掐断（同上方 SLOW 分支注释）。
      return;
    }

    if (lastUser.includes("SLOW")) {
      let i = 0;
      const timer = setInterval(() => {
        if (i === 0) send({ role: "assistant", content: "" });
        if (i < 30) {
          send({ content: `chunk${i} ` });
          i++;
        } else {
          clearInterval(timer);
          send({}, "stop", { prompt_tokens: 10, completion_tokens: 30, total_tokens: 40 });
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, 100);
      req.on("close", () => clearInterval(timer));
      return;
    }

    let text = "PONG";
    if (hasToolResult) {
      const toolMsg = [...msgs].reverse().find((m) => m.role === "tool");
      const c = typeof toolMsg?.content === "string" ? toolMsg.content : JSON.stringify(toolMsg?.content ?? "");
      text = "FINAL:" + c.slice(0, 500);
    }
    // CACHE_MISS：构造缓存失效场景（pi 把 prompt_tokens_details 映射为 cacheRead/cacheWrite）。
    // 第一轮全量 cacheWrite（上报过缓存），第二轮零缓存 → min(prev,cur)-cacheRead = 6000 > 噪声阈值。
    let usage = { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length };
    if (lastUser.includes("CACHE_MISS")) {
      const userTurns = msgs.filter((m) => m.role === "user").length;
      usage = userTurns <= 1
        ? { prompt_tokens: 6000, completion_tokens: 4, total_tokens: 6004,
            prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 6000 } }
        : { prompt_tokens: 6100, completion_tokens: 4, total_tokens: 6104,
            prompt_tokens_details: { cached_tokens: 0 } };
    }
    send({ role: "assistant", content: "" });
    for (const ch of text) send({ content: ch });
    send({}, "stop", usage);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(`MOCK_PORT=${server.address().port}`);
});
