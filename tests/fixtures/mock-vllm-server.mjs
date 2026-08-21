// Mock vLLM OpenAI 兼容服务器（E2E：探测识别 vLLM + 思考控制配置写库断言）。
// 行为对齐 vLLM 的 OpenAI 兼容层：
//   GET /version            → {"version":"vllm-<版本>"}（vLLM serve 在根路径暴露）
//   GET /v1/models          → vLLM 风格 {data:[{id, object:"model", owned_by:"vllm",
//                               supported_endpoint_types:["chat"]}]}
//   GET /api/v1/models      → 404（LM Studio 原生端点，vLLM 没有）
//   POST /v1/chat/completions → 流式；接受 chat_template_kwargs.enable_thinking，
//     enable_thinking=false 时无 reasoning；=true/缺失时带 reasoning + 答案。
//     reasoning_effort 一律 400（vLLM 的 Qwen3 chat template 不认该参数）。
// 脚本协议：最后一条 user 消息以 "VLLM_CHAT:" 开头时返回其后的文本。
import http from 'node:http';

const PORT = Number(process.env.MOCK_VLLM_PORT ?? 0);
const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/version') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: 'vllm-0.9.2' }));
    return;
  }
  if (req.method === 'GET' && req.url.includes('/api/v1/models')) {
    res.writeHead(404).end('not found');
    return;
  }
  if (req.method === 'GET' && req.url.includes('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: 'qwen/qwen3.8-27b', object: 'model', owned_by: 'vllm', supported_endpoint_types: ['chat'] },
        { id: 'deepseek-v3.2', object: 'model', owned_by: 'vllm', supported_endpoint_types: ['chat'] },
      ],
    }));
    return;
  }
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body); } catch { /* fallthrough */ }
      // vLLM 的 Qwen3 chat template 不读 reasoning_effort，发送直接 400。
      if ('reasoning_effort' in payload) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: "Invalid 'reasoning_effort' value (vllm mock)" } }));
        return;
      }
      const kwargs = payload.chat_template_kwargs ?? {};
      const thinking = kwargs.enable_thinking !== false;
      const last = Array.isArray(payload.messages) && payload.messages.length > 0
        ? payload.messages[payload.messages.length - 1]
        : { content: '' };
      const text = typeof last.content === 'string'
        ? last.content.replace(/^VLLM_CHAT:\s*/, '')
        : String(last.content?.[0]?.text ?? '');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      if (thinking) {
        sse(res, { id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { reasoning_content: 'Thinking about it...' }, finish_reason: null }] });
      }
      sse(res, { id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      sse(res, { id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      res.end('data: [DONE]\n\n');
    });
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`MOCK_VLLM_PORT=${port}`);
});
