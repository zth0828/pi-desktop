// Mock OpenAI-compatible server（openai-completions SSE），供 L2 契约测试与 E2E。
// 从 spike 脚本搬入（/tmp/pi-desktop-spikes/mock-openai.mjs），新增 SLOW 模式验证 abort。
// 脚本协议（按最后一条 user 消息分派）：
//   "USE_TOOL_LS" → 第一轮返回 tool_call(bash: ls)，之后回显工具结果
//   "USE_TOOL_EDIT" → 第一轮返回 tool_call(edit: e2e-edit-target.txt alpha→beta)
//   "MCP_SEARCH"/"MCP_CALL" → 驱动 mcp 代理工具
//   "SLOW ..." → 30 个 chunk × 100ms 慢速流（用于 abort 测试）
//   "FLAKE_429" → 首次请求返回 429（触发 pi 自动重试），后续正常 PONG
//   压缩摘要请求（含 "context checkpoint summary"）→ 12 个 chunk × 150ms 慢速流，
//     给 compaction 状态条留出可观测窗口
//   其他 → 流式返回 "PONG"
import http from "node:http";

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

// FLAKE_429 只失败一次（触发 auto_retry_start 后第二次请求成功）
let flaked429 = false;

const server = http.createServer((req, res) => {
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

    if (wantsTool) {
      let toolName = "bash";
      let args = JSON.stringify({ command: "ls" });
      if (lastUser.includes("USE_TOOL_EDIT")) {
        toolName = "edit";
        args = JSON.stringify({
          path: "e2e-edit-target.txt",
          edits: [{ oldText: "alpha", newText: "beta" }],
        });
      } else if (lastUser.includes("MCP_CALL")) {
        toolName = "mcp";
        args = JSON.stringify({ tool: "mockmcp_ping", args: { message: "hello" } });
      } else if (lastUser.includes("MCP_SEARCH")) {
        toolName = "mcp";
        args = JSON.stringify({ search: "ping" });
      }
      send({ role: "assistant", tool_calls: [{ index: 0, id: "call_mock_1", type: "function", function: { name: toolName, arguments: "" } }] });
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
    send({ role: "assistant", content: "" });
    for (const ch of text) send({ content: ch });
    send({}, "stop", { prompt_tokens: 10, completion_tokens: text.length, total_tokens: 10 + text.length });
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(`MOCK_PORT=${server.address().port}`);
});
