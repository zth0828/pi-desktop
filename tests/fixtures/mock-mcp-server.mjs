// 极简 MCP stdio server（E2E fixture）：NDJSON JSON-RPC over stdin/stdout。
// initialize / ping / tools/list / tools/call(ping→pong)，其余 notification 忽略。
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // notification
  switch (msg.method) {
    case 'initialize':
      reply(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp', version: '0.0.1' },
      });
      break;
    case 'ping':
      reply(msg.id, {});
      break;
    case 'tools/list':
      reply(msg.id, {
        tools: [
          {
            name: 'ping',
            description: 'ping → pong',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });
      break;
    case 'tools/call':
      reply(msg.id, { content: [{ type: 'text', text: 'pong' }] });
      break;
    default:
      reply(msg.id, {});
  }
});
