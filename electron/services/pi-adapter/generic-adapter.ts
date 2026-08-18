import type { PiCompatibilityReport } from '@shared/host-api/contract';
import { detectPiCapabilities } from './capabilities';
import type {
  PiAdapterRuntime,
  PiAdapterSession,
  PiPromptInput,
  PiRuntimeAdapter,
  PiRuntimeFactory,
  PiRuntimeOptions,
  PiSdk,
  PiSessionFromServicesOptions,
} from './types';

export function createGenericPiAdapter(input: {
  sdk: PiSdk;
  packageRoot: string;
  packageVersion: string;
  cliPath?: string;
  cliVersion?: string;
  compatibility: PiCompatibilityReport;
}): PiRuntimeAdapter {
  const adapter: PiRuntimeAdapter = {
    packageVersion: input.packageVersion,
    packageRoot: input.packageRoot,
    cliPath: input.cliPath,
    cliVersion: input.cliVersion,
    capabilities: detectPiCapabilities(input.sdk as unknown as Record<string, unknown>),
    compatibility: input.compatibility,
    sdk: input.sdk,

    createEventBus: () => input.sdk.createEventBus(),

    createSessionServices: (options) => input.sdk.createAgentSessionServices(options),

    createSessionFromServices: async (options: PiSessionFromServicesOptions) =>
      input.sdk.createAgentSessionFromServices(options) as never,

    createSessionRuntime: async (factory: PiRuntimeFactory, options: PiRuntimeOptions) => {
      const raw = await input.sdk.createAgentSessionRuntime(factory, options);
      const session = raw.session;
      const required = ['prompt', 'subscribe', 'abort'] as const;
      const missing = required.filter((name) => typeof (session as unknown as Record<string, unknown>)[name] !== 'function');
      if (missing.length > 0) {
        for (const name of missing) {
          adapter.capabilities[name] = false;
          adapter.compatibility.capabilities[name] = false;
        }
        adapter.compatibility.status = 'incompatible';
        adapter.compatibility.missingRequiredCapabilities.push(...missing.filter(
          (name) => !adapter.compatibility.missingRequiredCapabilities.includes(name),
        ));
        throw new Error(`incompatible: session is missing capabilities: ${missing.join(', ')}`);
      }
      return {
        raw,
        session: { raw: session },
        services: raw.services,
      } satisfies PiAdapterRuntime;
    },

    prompt: async (session: PiAdapterSession, prompt: PiPromptInput) => {
      await session.raw.prompt(prompt.text, {
        ...(prompt.images ? { images: prompt.images as never } : {}),
        ...(prompt.streamingBehavior ? { streamingBehavior: prompt.streamingBehavior } : {}),
      });
    },

    subscribe: (session, listener) => session.raw.subscribe(listener as never),

    abort: (session) => session.raw.abort(),

    dispose: (runtime) => runtime.raw.dispose(),
  };
  return adapter;
}
