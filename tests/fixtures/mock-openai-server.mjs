// Mock OpenAI-compatible server（openai-completions SSE），供 L2 契约测试与 E2E。
// 从 spike 脚本搬入（/tmp/pi-desktop-spikes/mock-openai.mjs），新增 SLOW 模式验证 abort。
// 脚本协议（按最后一条 user 消息分派）：
//   "USE_TOOL_LS" → 第一轮返回 tool_call(bash: ls)，之后回显工具结果
//   "MCP_SEARCH"/"MCP_CALL" → 驱动 mcp 代理工具
//   "SLOW ..." → 30 个 chunk × 100ms 慢速流（用于 abort 测试）
//   其他 → 流式返回 "PONG"
import http from "node:http";

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

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
      lastUser.includes("USE_TOOL_LS") || lastUser.includes("MCP_CALL") || lastUser.includes("MCP_SEARCH")
    );

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
      if (lastUser.includes("MCP_CALL")) {
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
