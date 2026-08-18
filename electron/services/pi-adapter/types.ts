import type {
  AgentSession,
  AgentSessionRuntime,
  CreateAgentSessionRuntimeFactory,
  EventBus,
} from '@earendil-works/pi-coding-agent';
import type { PiCapabilities, PiCompatibilityReport } from '@shared/host-api/contract';

export type PiSdk = typeof import('@earendil-works/pi-coding-agent');
export type PiSession = AgentSession;
export type PiRuntime = AgentSessionRuntime;
export type PiRuntimeFactory = CreateAgentSessionRuntimeFactory;
export type PiSessionServices = Awaited<ReturnType<PiSdk['createAgentSessionServices']>>;
export type PiSessionFromServicesOptions = Parameters<PiSdk['createAgentSessionFromServices']>[0];
export type PiRuntimeOptions = Parameters<PiSdk['createAgentSessionRuntime']>[1];

export type PiPromptInput = {
  text: string;
  images?: unknown[];
  streamingBehavior?: 'steer' | 'followUp';
};

export type PiAdapterSession = {
  readonly raw: PiSession;
};

export type PiAdapterRuntime = {
  readonly raw: PiRuntime;
  readonly session: PiAdapterSession;
  readonly services: PiRuntime['services'];
};

export interface PiRuntimeAdapter {
  readonly packageVersion: string;
  readonly packageRoot: string;
  readonly cliPath?: string;
  readonly cliVersion?: string;
  readonly capabilities: PiCapabilities;
  readonly compatibility: PiCompatibilityReport;
  readonly sdk: PiSdk;

  createEventBus(): EventBus;
  createSessionServices(options: Parameters<PiSdk['createAgentSessionServices']>[0]): Promise<PiSessionServices>;
  createSessionFromServices(options: PiSessionFromServicesOptions): Promise<{
    session: PiSession;
    services: PiSessionServices;
    diagnostics?: unknown;
    [key: string]: unknown;
  }>;
  createSessionRuntime(
    factory: PiRuntimeFactory,
    options: PiRuntimeOptions,
  ): Promise<PiAdapterRuntime>;
  prompt(session: PiAdapterSession, input: PiPromptInput): Promise<void>;
  subscribe(session: PiAdapterSession, listener: (event: unknown) => void): () => void;
  abort(session: PiAdapterSession): Promise<void>;
  dispose(runtime: PiAdapterRuntime): void;
}
