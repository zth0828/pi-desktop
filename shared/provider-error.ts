// 把 pi 透传的供应商错误文本解析成 UI 可用的分类与请求 ID。
// pi 的错误文案由 pi-ai 的 formatProviderError 拼接，形如
// "OpenAI API error (503): {\"message\":...,\"type\":...,\"code\":...}"，
// 也可能只是服务端原始 JSON 或纯文本（Anthropic / Google 协议各不相同），
// 或 SDK 层连接类纯文本（"Connection error." / "Request timed out." /
// "OpenAI Responses stream ended before a terminal response event"）。
// 壳只负责按文本归类做提示，不改动 pi 的错误语义。
// 本模块被 node 侧（electron/services）与 web 侧（src）共用，
// 不得引入 electron / DOM 依赖。
import { HostError } from './host-api/errors';

export type ProviderErrorCategory =
  | 'invalid-key'
  | 'wrong-model'
  | 'upstream'
  | 'rate-limit'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'stream'
  | 'unknown';

/** category → chat.errors.* 下的翻译 key（translation.json 多词 key 用 camelCase，
 *  与 category 的 kebab-case 不同名，必须经此映射取 key）。 */
export const PROVIDER_ERROR_HINT_KEYS: Record<Exclude<ProviderErrorCategory, 'unknown'>, string> = {
  'invalid-key': 'invalidKey',
  'wrong-model': 'wrongModel',
  upstream: 'upstream',
  'rate-limit': 'rateLimit',
  quota: 'quota',
  network: 'network',
  timeout: 'timeout',
  stream: 'stream',
};

export type ProviderErrorInfo = {
  category: ProviderErrorCategory;
  status?: number;
  requestId?: string;
  /** wrong-model 且文本含 "model not found: <provider>/<id>" 时提取的供应商 ID */
  providerId?: string;
  /** 同上；模型 ID 本身可含斜杠（如 openrouter 的 org/model 形式） */
  modelId?: string;
};

const REQUEST_ID_PATTERNS = [
  /request[ _-]?id[=:]\s*([A-Za-z0-9_-]{6,})/i,
  /"request_id"\s*:\s*"([A-Za-z0-9_-]+)"/i,
  /"requestId"\s*:\s*"([A-Za-z0-9_-]+)"/i,
];

function extractRequestId(text: string): string | undefined {
  for (const pattern of REQUEST_ID_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

/** 状态码识别：pi 前缀括号形式（OpenAI API error (503)）、会话落盘形式
 *  （ERR_INVALID_KEY 401: {...}）、行首裸数字（503 Service Unavailable）。 */
function extractStatus(text: string): number | undefined {
  const bracketed = text.match(/\((\d{3})\)/);
  if (bracketed) return Number(bracketed[1]);
  const prefixed = text.match(/(?:^|\s)([45]\d{2}):\s/);
  if (prefixed) return Number(prefixed[1]);
  const leading = text.match(/^(?:HTTP\/[\d.]+\s+)?(\d{3})\s/);
  if (leading) return Number(leading[1]);
  return undefined;
}

/** 从文本里切出第一个完整 JSON 对象（字符串与转义感知的括号配对）。 */
function extractJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** "model not found: <provider>/<modelId>" 形式的引用提取（pi RPC / 壳 setModel 的文案）。
 *  provider 段不含斜杠（第一个斜杠前）；模型 ID 可含斜杠（如 openrouter 的 org/model）。 */
function extractModelRef(text: string): { providerId: string; modelId: string } | undefined {
  const match = text.match(/model not found:\s*([^/\s]+)\/(\S+)/i);
  if (!match) return undefined;
  return { providerId: match[1], modelId: match[2] };
}

export function parseProviderError(message: string): ProviderErrorInfo {
  const status = extractStatus(message);
  const requestId = extractRequestId(message);
  const modelRef = extractModelRef(message);
  const json = extractJsonObject(message);
  const body =
    json && typeof json.error === 'object' && json.error !== null
      ? (json.error as Record<string, unknown>)
      : (json ?? {});
  const bodyMessage = typeof body.message === 'string' ? body.message : '';
  const bodyType = typeof body.type === 'string' ? body.type : '';
  const bodyCode = typeof body.code === 'string' ? body.code : '';
  const haystack = [message, bodyMessage, bodyType, bodyCode].join('\n').toLowerCase();

  let category: ProviderErrorCategory;
  if (status === 401 || /invalid token|invalid api key|api key is invalid|unauthorized/.test(haystack)) {
    category = 'invalid-key';
  } else if (/model_not_found/.test(haystack) || /no available channel/.test(haystack) || /model not found|model does not exist|unknown model/.test(haystack)) {
    category = 'wrong-model';
  } else if (status === 402 || /payment required/.test(haystack) || /usage_limit_reached/.test(haystack) || /usage limit|quota|billing|insufficient_?balance/.test(haystack)) {
    category = 'quota';
  } else if (status === 429 || /rate.?limit|too many requests/.test(haystack)) {
    category = 'rate-limit';
  } else if ((status !== undefined && status >= 500) || /auth_unavailable|no auth available|service temporarily unavailable|temporarily unavailable|bad gateway|internal_server_error|internal server error|server_error|server_is_overloaded|overloaded|upstream/.test(haystack)) {
    category = 'upstream';
  } else if (/connection error|connection failed|connection reset|connection refused|connection closed|econnrefused|econnreset|econnaborted|enotfound|eai_again|fetch failed|unable to connect|network error|network request failed|socket hang up|dns/.test(haystack)) {
    category = 'network';
  } else if (/timed out|timeout|etimedout|deadline exceeded/.test(haystack)) {
    category = 'timeout';
  } else if (/stream ended|stream closed|stream interrupted|unexpected end of|before a terminal|without a terminal|premature close/.test(haystack)) {
    category = 'stream';
  } else {
    category = 'unknown';
  }
  return { category, status, requestId, ...modelRef };
}

/**
 * 启动/切换失败文本的模型可用性分类出口（main 侧 services 共用）：
 * wrong-model → MODEL_UNAVAILABLE HostError（detail 携带供应商/模型 ID，
 * 经 host-invoke dispatcher 透传给渲染层做自救入口）；其余类别返回 undefined，
 * 由调用方按原有错误语义处理。
 */
export function toModelUnavailableError(message: string): HostError | undefined {
  const info = parseProviderError(message);
  if (info.category !== 'wrong-model') return undefined;
  return new HostError('MODEL_UNAVAILABLE', message, {
    providerId: info.providerId,
    modelId: info.modelId,
  });
}
