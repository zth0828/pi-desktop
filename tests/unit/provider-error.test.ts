import { describe, expect, it } from 'vitest';
import { parseProviderError, toModelUnavailableError } from '../../src/lib/provider-error';

describe('parseProviderError', () => {
  it('401 → invalid-key，并提取 request id', () => {
    const info = parseProviderError(
      'OpenAI API error (401): {"code":"","message":"Invalid token (request id: 202608200646490268733188268d9d6FgctFa43)","type":"new_api_error"}',
    );
    expect(info.category).toBe('invalid-key');
    expect(info.status).toBe(401);
    expect(info.requestId).toBe('202608200646490268733188268d9d6FgctFa43');
  });

  it('真实 o-ai.me 响应实录（2026-08-20）→ invalid-key + request id', () => {
    const info = parseProviderError(
      '{"error":{"code":"","message":"Invalid token (request id: 202608200912448121196998268d9d6z5sjDT7t)","type":"new_api_error"}}',
    );
    expect(info.category).toBe('invalid-key');
    expect(info.status).toBeUndefined(); // 裸 JSON 响应不带状态码前缀
    expect(info.requestId).toBe('202608200912448121196998268d9d6z5sjDT7t');
  });

  it('真实 o-ai.me 错误实录：server_is_overloaded（服务器过载）→ upstream', () => {
    const info = parseProviderError(
      'Error Code server_is_overloaded: Our servers are currently overloaded. Please try again later.',
    );
    expect(info.category).toBe('upstream');
    expect(info.status).toBeUndefined();
  });

  it('真实 o-ai.me 错误实录：402 Payment Required → quota', () => {
    const info = parseProviderError(
      'OpenAI API error (402): {"message":"Payment Required","type":"invalid_request_error","param":"","code":null}',
    );
    expect(info.category).toBe('quota');
    expect(info.status).toBe(402);
  });

  it('纯文本 Internal Server Error → upstream', () => {
    expect(parseProviderError('Internal Server Error').category).toBe('upstream');
  });

  it('503 model_not_found（分组无渠道）→ wrong-model', () => {
    const info = parseProviderError(
      'OpenAI API error (503): {"error":{"code":"model_not_found","message":"No available channel for model gpt-4o-mini under group 特惠分组 (distributor) (request id: 202608200648504431362498268d9d6vETrdtOQ)","type":"new_api_error"}}',
    );
    expect(info.category).toBe('wrong-model');
    expect(info.requestId).toBe('202608200648504431362498268d9d6vETrdtOQ');
  });

  it('503 auth_unavailable（上游认证失效）→ upstream', () => {
    const info = parseProviderError(
      'OpenAI API error (503): {"message":"auth_unavailable: no auth available (providers=codex, model=gpt-5.5)","type":"server_error","param":"","code":"internal_server_error"}',
    );
    expect(info.category).toBe('upstream');
    expect(info.requestId).toBeUndefined();
  });

  it('503 Service temporarily unavailable → upstream', () => {
    const info = parseProviderError(
      'OpenAI API error (503): {"error":{"message":"Service temporarily unavailable","type":"api_error","param":"","code":null}}',
    );
    expect(info.category).toBe('upstream');
    expect(info.status).toBe(503);
  });

  it('429 usage_limit_reached → quota', () => {
    const info = parseProviderError(
      'OpenAI API error (429): {"error":{"message":"The usage limit has been reached","type":"usage_limit_reached","param":"","code":null}}',
    );
    expect(info.category).toBe('quota');
  });

  it('429 Rate limit exceeded → rate-limit', () => {
    const info = parseProviderError(
      'OpenAI API error (429): {"error":{"message":"Rate limit exceeded","type":"bad_response_status_code","param":"","code":"bad_response_status_code"}}',
    );
    expect(info.category).toBe('rate-limit');
  });

  it('纯文本 401 → invalid-key', () => {
    expect(parseProviderError('401 Unauthorized: invalid api key').category).toBe('invalid-key');
  });

  it('会话落盘前缀 401: {...} → invalid-key（含 new_api_error 不误判 upstream）', () => {
    const info = parseProviderError(
      'ERR_INVALID_KEY 401: {"code":"","message":"Invalid token (request id: 202608200646490268733188268d9d6FgctFa43)","type":"new_api_error"}',
    );
    expect(info.category).toBe('invalid-key');
    expect(info.status).toBe(401);
    expect(info.requestId).toBe('202608200646490268733188268d9d6FgctFa43');
  });

  it('纯文本 503 → upstream', () => {
    expect(parseProviderError('503 Service Temporarily Unavailable').category).toBe('upstream');
  });

  it('无法识别的内容 → unknown，不误报', () => {
    expect(parseProviderError('Request failed with status code 500 in my own code').category).toBe('unknown');
    expect(parseProviderError('something went wrong').category).toBe('unknown');
  });

  it('model not found 文本 → wrong-model 并提取 provider/model（模型 ID 可含斜杠）', () => {
    const simple = parseProviderError('model not found: openai/gpt-5.5');
    expect(simple.category).toBe('wrong-model');
    expect(simple.providerId).toBe('openai');
    expect(simple.modelId).toBe('gpt-5.5');

    const slashed = parseProviderError('Model not found: openrouter/moonshotai/kimi-k2.6');
    expect(slashed.category).toBe('wrong-model');
    expect(slashed.providerId).toBe('openrouter');
    expect(slashed.modelId).toBe('moonshotai/kimi-k2.6');
  });

  it('wrong-model 但文本不含 provider/id 引用（如网关 503 分组无渠道）时不提取', () => {
    const info = parseProviderError(
      'OpenAI API error (503): {"error":{"code":"model_not_found","message":"No available channel for model gpt-4o-mini under group 特惠分组"}}',
    );
    expect(info.category).toBe('wrong-model');
    expect(info.providerId).toBeUndefined();
    expect(info.modelId).toBeUndefined();
  });
});

describe('toModelUnavailableError（main 侧启动/切换失败分类出口）', () => {
  it('wrong-model 文本 → MODEL_UNAVAILABLE HostError，detail 带供应商/模型 ID', () => {
    const error = toModelUnavailableError('model not found: openai/gpt-5.5');
    expect(error).toBeInstanceOf(Error);
    expect(error?.name).toBe('HostError');
    expect(error?.code).toBe('MODEL_UNAVAILABLE');
    expect(error?.message).toBe('model not found: openai/gpt-5.5');
    expect(error?.detail).toEqual({ providerId: 'openai', modelId: 'gpt-5.5' });
  });

  it('非模型类错误（invalid-key / quota / unknown）返回 undefined', () => {
    expect(toModelUnavailableError('OpenAI API error (401): invalid token')).toBeUndefined();
    expect(toModelUnavailableError('OpenAI API error (402): payment required')).toBeUndefined();
    expect(toModelUnavailableError('something went wrong')).toBeUndefined();
  });
});
