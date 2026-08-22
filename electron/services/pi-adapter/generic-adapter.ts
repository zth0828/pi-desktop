import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PiCompatibilityReport } from '@shared/host-api/contract';
import type {
  PiAdapterNotReadyError,
} from './loader';
import type {
  PiAuthResolution,
  PiBindExtensionsOptions,
  PiCreateRuntimeInput,
  PiEventBusHandle,
  PiEventBusPort,
  PiModelDescriptor,
  PiModelHandle,
  PiModelRuntimeHandle,
  PiPackageManagerHandle,
  PiPackagePort,
  PiPackageRow,
  PiPackageUpdate,
  PiPathPort,
  PiPromptInput,
  PiProviderDescriptor,
  PiProviderPort,
  PiResourcePort,
  PiRuntimeAdapter,
  PiRuntimeHandle,
  PiSessionCatalogPort,
  PiSessionDescriptor,
  PiSessionDocumentHandle,
  PiSessionEntry,
  PiSessionPort,
  PiSessionStats,
  PiSessionTreeNode,
  PiSessionView,
  PiSettingsHandle,
  PiSettingsPort,
  PiTrustPort,
} from './types';
import { detectPiCapabilities, validateSessionCapabilities } from './capabilities';
import type { PiSdk } from './internal-types';

// This file is the only place where values from the upstream SDK cross the adapter boundary.
type AnyRecord = Record<string, any>;

type RawRuntime = AnyRecord;
type RawSession = AnyRecord;
type RawSettings = AnyRecord;
type RawModelRuntime = AnyRecord;
type RawPackageManager = AnyRecord;
type RawSessionManager = AnyRecord;
type RawEventBus = AnyRecord;

type AdapterInput = {
  sdk: PiSdk;
  packageRoot: string;
  packageVersion: string;
  generation: string;
  cliPath?: string;
  cliVersion?: string;
  nodePath?: string;
  nodeVersion?: string;
  npmPath?: string;
  npmVersion?: string;
  npmRoot?: string;
  compatibility: PiCompatibilityReport;
};

type HandleEntry<T> = { identity: string; raw: T };

function identity(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function realError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function packageFile(agentDir: string, name: string): string {
  return join(agentDir, name);
}

function atomicJsonMutation(
  queues: Map<string, Promise<void>>,
  file: string,
  mutate: (doc: AnyRecord) => void,
): Promise<void> {
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    let doc: AnyRecord = {};
    try {
      doc = JSON.parse(readFileSync(file, 'utf8')) as AnyRecord;
    } catch {
      doc = {};
    }
    mutate(doc);
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  });
  queues.set(file, next);
  return next.finally(() => {
    if (queues.get(file) === next) queues.delete(file);
  });
}

export function createGenericPiAdapter(input: AdapterInput): PiRuntimeAdapter {
  const sdk = input.sdk;
  const runtimes = new Map<string, HandleEntry<RawRuntime>>();
  const sessions = new Map<string, HandleEntry<RawSession>>();
  const documents = new Map<string, HandleEntry<RawSessionManager>>();
  const events = new Map<string, HandleEntry<RawEventBus>>();
  const modelRuntimes = new Map<string, HandleEntry<RawModelRuntime>>();
  const models = new Map<string, HandleEntry<AnyRecord>>();
  const settings = new Map<string, HandleEntry<RawSettings>>();
  const packageManagers = new Map<string, HandleEntry<RawPackageManager>>();
  const settingsQueues = new Map<string, Promise<void>>();
  const packageCache = new Map<string, PiPackageManagerHandle>();
  const runtimeCache = new Map<string, PiModelRuntimeHandle>();
  let sequence = 0;

  const getDocument = (handle: PiSessionDocumentHandle): RawSessionManager => {
    const entry = documents.get(handle.identity);
    if (!entry) throw new Error('stale-session-document');
    return entry.raw;
  };
  const documentHandle = (raw: RawSessionManager, file?: string): PiSessionDocumentHandle => {
    const key = identity('session', file ?? `memory:${++sequence}`);
    documents.set(key, { identity: key, raw });
    return {
      identity: key,
      path: file,
      getSessionName: () => raw.getSessionName?.(),
      getCwd: () => raw.getCwd?.() ?? '',
      getLeafId: () => raw.getLeafId?.() ?? null,
      getEntry: (id: string) => raw.getEntry?.(id),
    };
  };

  const sessionView = (raw: RawSession): PiSessionView => {
    const manager = raw.sessionManager as RawSessionManager;
    const managerHandle = documentHandle(manager, raw.sessionFile);
    return {
      sessionId: String(raw.sessionId),
      sessionFile: typeof raw.sessionFile === 'string' ? raw.sessionFile : undefined,
      isStreaming: raw.isStreaming === true,
      isBashRunning: raw.isBashRunning === true,
      isCompacting: raw.isCompacting === true,
      isRetrying: raw.isRetrying === true,
      model: raw.model ? modelDescriptor(raw.model) : undefined,
      thinkingLevel: String(raw.thinkingLevel ?? 'off'),
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      sessionManager: managerHandle,
      extensionRunner: {
        getRegisteredCommands: () => raw.extensionRunner?.getRegisteredCommands?.() ?? [],
        emitUserBash: (value) => raw.extensionRunner?.emitUserBash?.(value),
      },
    };
  };

  const getSessionEntry = (handle: PiSessionPort): RawSession => {
    const entry = sessions.get(handle.view.sessionId);
    if (!entry) throw new Error('stale-runtime');
    return entry.raw;
  };

  const createSessionPort = (raw: RawSession, owner?: RawRuntime, runtimeIdentity?: string): PiSessionPort => {
    const assertCurrent = (): void => {
      if (owner && (owner.session !== raw || (runtimeIdentity && !runtimes.has(runtimeIdentity)))) throw new Error('stale-runtime');
    };
    const sessionId = String(raw.sessionId);
    sessions.set(sessionId, { identity: sessionId, raw });
    const port = {} as PiSessionPort;
    Object.defineProperty(port, 'view', { enumerable: true, get: () => { assertCurrent(); return sessionView(raw); } });
    for (const key of ['sessionId', 'sessionFile', 'isStreaming', 'isBashRunning', 'isCompacting', 'isRetrying', 'model', 'thinkingLevel', 'messages', 'sessionManager', 'extensionRunner']) {
      Object.defineProperty(port, key, { enumerable: true, get: () => { assertCurrent(); return (sessionView(raw) as AnyRecord)[key]; } });
    }
    port.prompt = (value) => { assertCurrent(); return raw.prompt(value.text, {
      ...(value.images ? { images: value.images } : {}),
      ...(value.streamingBehavior ? { streamingBehavior: value.streamingBehavior } : {}),
      ...(value.preflightResult ? { preflightResult: value.preflightResult } : {}),
    }); };
    port.steer = (text) => raw.steer(text);
    port.followUp = (text) => raw.followUp(text);
    port.subscribe = (listener) => raw.subscribe(listener);
    port.abort = () => raw.abort();
    port.abortBash = () => raw.abortBash();
    port.abortCompaction = () => raw.abortCompaction();
    port.abortBranchSummary = () => raw.abortBranchSummary();
    port.abortRetry = () => raw.abortRetry();
    port.compact = (instructions) => raw.compact(instructions);
    port.navigateTree = (targetId, options) => raw.navigateTree(targetId, options);
    port.newSession = async (options) => raw.newSession(options);
    port.switchSession = async (file, options) => raw.switchSession(file, options);
    port.fork = async (entryId, options) => raw.fork(entryId, options);
    port.reload = () => raw.reload();
    port.bindExtensions = (options) => raw.bindExtensions(options as any);
    port.waitForIdle = () => raw.waitForIdle();
    port.setSessionName = (name) => raw.setSessionName(name);
    port.setThinkingLevel = (level) => raw.setThinkingLevel(level);
    port.setModel = async (model) => {
      const entry = models.get(model.identity);
      if (!entry) throw new Error('stale-model');
      await raw.setModel(entry.raw);
    };
    port.exportToHtml = (outputPath) => raw.exportToHtml(outputPath);
    port.getAvailableThinkingLevels = () => {
      const getter = raw.getAvailableThinkingLevels;
      return typeof getter === 'function' ? getter.call(raw) : [];
    };
    port.getSessionStats = () => raw.getSessionStats();
    port.getContextUsage = () => raw.getContextUsage?.();
    port.getEntries = () => raw.sessionManager.getEntries();
    port.getBranch = () => raw.sessionManager.getBranch();
    port.getTree = () => raw.sessionManager.getTree();
    port.buildContextEntries = () => raw.sessionManager.buildContextEntries();
    port.getModelContextMessages = (entry) => sdk.sessionEntryToContextMessages(entry as never);
    port.getSteeringMessages = () => [...raw.getSteeringMessages()];
    port.getFollowUpMessages = () => [...raw.getFollowUpMessages()];
    port.clearQueue = () => raw.clearQueue();
    port.clearAgentQueues = () => raw.agent.clearAllQueues();
    port.executeBash = (command, options) => raw.executeBash(command, undefined, options);
    port.recordBashResult = (command, result, options) => raw.recordBashResult(command, result, options);
    return port;
  };

  const eventBusPort = (raw: RawEventBus): PiEventBusPort => ({
    on: (channel, listener) => {
      raw.on(channel, listener);
      return () => raw.off?.(channel, listener);
    },
  });

  const runtimeHandle = (raw: RawRuntime): PiRuntimeHandle => {
    const key = identity('runtime', `${input.generation}:${++sequence}`);
    runtimes.set(key, { identity: key, raw });
    const event = raw.services?.eventBus ?? raw.services?.resourceLoader?.eventBus;
    const eventKey = identity('event', `${input.generation}:${++sequence}`);
    if (event) events.set(eventKey, { identity: eventKey, raw: event });
    const settingsKey = identity('settings', `${input.generation}:${key}`);
    settings.set(settingsKey, { identity: settingsKey, raw: raw.services.settingsManager });
    const modelKey = identity('model-runtime', `${input.generation}:${key}`);
    modelRuntimes.set(modelKey, { identity: modelKey, raw: raw.services.modelRuntime });
    const handle = {
      identity: key,
      get session() { return createSessionPort(raw.session, raw, key); },
      eventBus: eventBusPort(event ?? sdk.createEventBus()),
      settings: { identity: settingsKey },
      modelRuntime: { identity: modelKey },
      newSession: (options?: unknown) => raw.newSession(options),
      switchSession: (file: string, options?: unknown) => raw.switchSession(file, options),
      fork: (entryId: string, options?: unknown) => raw.fork(entryId, options),
    } as PiRuntimeHandle;
    return handle;
  };

  function modelDescriptor(model: AnyRecord): PiModelDescriptor {
    return {
      provider: String(model.provider ?? ''),
      id: String(model.id ?? ''),
      name: typeof model.name === 'string' ? model.name : undefined,
      api: String(model.api ?? ''),
      reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
      input: Array.isArray(model.input) ? model.input.map(String) : undefined,
      contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
      maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : undefined,
      cost: model.cost,
    };
  }

  const paths: PiPathPort = {
    getAgentDir: () => sdk.getAgentDir(),
    getCliPath: () => undefined,
    ensureTool: async (tool, silent) => {
      const module = await import(pathToFileURL(join(input.packageRoot, 'dist/utils/tools-manager.js')).href);
      return module.ensureTool(tool, silent);
    },
  };

  const sessionsPort: PiSessionCatalogPort = {
    list: (cwd) => sdk.SessionManager.list(cwd),
    listAll: () => sdk.SessionManager.listAll(),
    open: (file) => documentHandle(sdk.SessionManager.open(file), file),
    create: (cwd) => {
      const raw = sdk.SessionManager.create(cwd);
      return documentHandle(raw, raw.getSessionFile?.());
    },
    forkFrom: (file, cwd) => {
      const raw = sdk.SessionManager.forkFrom(file, cwd);
      return documentHandle(raw, raw.getSessionFile?.());
    },
    getEntries: (document) => getDocument(document).getEntries(),
    getBranch: (document) => getDocument(document).getBranch(),
    appendCustomEntry: (document, type, data) => getDocument(document).appendCustomEntry(type, data),
    appendSessionInfo: (document, name) => getDocument(document).appendSessionInfo(name),
    toContextMessages: (entry) => sdk.sessionEntryToContextMessages(entry as never),
  };

  const settingsPort: PiSettingsPort = {
    open: (options = {}) => {
      const cwd = options.cwd ?? process.cwd();
      const agentDir = options.agentDir ?? sdk.getAgentDir();
      const raw = sdk.SettingsManager.create(cwd, agentDir, options.projectTrusted === undefined ? undefined : { projectTrusted: options.projectTrusted });
      const key = identity('settings', `${input.generation}:${cwd}:${agentDir}:${++sequence}`);
      settings.set(key, { identity: key, raw });
      return { identity: key };
    },
    getCompaction: (handle) => getSettings(handle).getCompactionSettings(),
    getRetry: (handle) => getSettings(handle).getRetrySettings(),
    getDefaultModel: (handle) => {
      const raw = getSettings(handle);
      const provider = raw.getDefaultProvider();
      const id = raw.getDefaultModel();
      return provider && id ? { provider, id } : null;
    },
    getDefaultThinking: (handle) => getSettings(handle).getDefaultThinkingLevel() ?? null,
    getDefaultTools: (handle) => getSettings(handle).getDefaultTools() ?? null,
    getBranchSummarySkipPrompt: (handle) => getSettings(handle).getBranchSummarySkipPrompt(),
    isProjectTrusted: (handle) => getSettings(handle).isProjectTrusted(),
    setDefaultModel: (handle, model) => getSettings(handle).setDefaultModelAndProvider(model.provider, model.id),
    setDefaultThinking: (handle, level) => getSettings(handle).setDefaultThinkingLevel(level),
    flush: (handle) => getSettings(handle).flush(),
    reload: (handle) => getSettings(handle).reload(),
    updateJson: async (agentDir, fileName, patch) => {
      const file = packageFile(agentDir, fileName);
      const previous = settingsQueues.get(file) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(async () => {
        if (fileName === 'settings.json') {
          await Promise.all([...settings.values()].map(({ raw }) => raw.flush?.()));
        }
        let doc: AnyRecord = {};
        try { doc = JSON.parse(readFileSync(file, 'utf8')) as AnyRecord; } catch { /* create below */ }
        patch(doc);
        mkdirSync(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
        renameSync(temp, file);
        if (fileName === 'settings.json') await Promise.all([...settings.values()].map(({ raw }) => raw.reload?.()));
        else await Promise.all([...modelRuntimes.values()].map(({ raw }) => raw.refresh?.({ allowNetwork: false })));
      });
      settingsQueues.set(file, next);
      await next.finally(() => { if (settingsQueues.get(file) === next) settingsQueues.delete(file); });
    },
  };
  function getSettings(handle: PiSettingsHandle): RawSettings {
    const entry = settings.get(handle.identity);
    if (!entry) throw new Error('stale-settings');
    return entry.raw;
  }

  const providersPort: PiProviderPort = {
    createRuntime: async (options = {}) => {
      const cwd = options.cwd ?? process.cwd();
      const agentDir = options.agentDir ?? sdk.getAgentDir();
      const key = `${input.generation}:${input.packageRoot}:${input.packageVersion}:${agentDir}:${cwd}`;
      const existing = runtimeCache.get(key);
      if (existing) return existing;
      const raw = await sdk.ModelRuntime.create({
        authPath: join(agentDir, 'auth.json'),
        modelsPath: join(agentDir, 'models.json'),
      });
      const id = identity('model-runtime', key);
      modelRuntimes.set(id, { identity: id, raw });
      const handle = { identity: id };
      runtimeCache.set(key, handle);
      return handle;
    },
    listProviders: (handle) => getModelRuntime(handle).getProviders().map((p: AnyRecord) => ({
      id: p.id,
      name: p.name,
      ...(typeof p.baseUrl === 'string' ? { baseUrl: p.baseUrl } : {}),
      auth: p.auth,
    })),
    getRegisteredProviderIds: (handle) => getModelRuntime(handle).getRegisteredProviderIds(),
    hasConfiguredAuth: (handle, providerId) => getModelRuntime(handle).hasConfiguredAuth(providerId),
    getModels: (handle, providerId) => getModelRuntime(handle).getModels(providerId).map(modelDescriptor),
    getAvailable: async (handle) => (await getModelRuntime(handle).getAvailable()).map(modelDescriptor),
    getModel: (handle, provider, id) => {
      const raw = getModelRuntime(handle).getModel(provider, id);
      if (!raw) return null;
      const key = identity('model', `${handle.identity}:${provider}:${id}`);
      models.set(key, { identity: key, raw });
      return { identity: key, provider, id };
    },
    getAuth: async (handle, value) => {
      const raw = getModelRuntime(handle);
      const auth = await raw.getAuth(typeof value === 'string' ? value : models.get(value.identity)?.raw);
      return auth as PiAuthResolution | null;
    },
    login: (handle, provider, method, callbacks) => getModelRuntime(handle).login(provider, method, {
      prompt: callbacks.prompt,
      notify: callbacks.notify,
    }),
    logout: (handle, provider) => getModelRuntime(handle).logout(provider),
    refresh: (handle, options) => getModelRuntime(handle).refresh(options),
  };
  function getModelRuntime(handle: PiModelRuntimeHandle): RawModelRuntime {
    const entry = modelRuntimes.get(handle.identity);
    if (!entry) throw new Error('stale-model-runtime');
    return entry.raw;
  }

  const packagesPort: PiPackagePort = {
    create: async ({ cwd, agentDir, scope }) => {
      const key = `${input.generation}:${input.packageRoot}:${input.packageVersion}:${agentDir}:${cwd}:${scope}`;
      const existing = packageCache.get(key);
      if (existing) return existing;
      const settingsHandle = settingsPort.open({ cwd, agentDir });
      const raw = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager: getSettings(settingsHandle) as never });
      const id = identity('packages', key);
      packageManagers.set(id, { identity: id, raw });
      const handle = { identity: id };
      packageCache.set(key, handle);
      return handle;
    },
    list: (handle) => getPackageManager(handle).listConfiguredPackages(),
    install: (handle, source) => getPackageManager(handle).installAndPersist(source),
    remove: async (handle, source, local) => {
      const manager = getPackageManager(handle);
      // pi stores user-scoped local sources relative to agentDir, but matches the
      // removal INPUT relative to cwd. When cwd != agentDir the stored relative
      // string resolves to different absolute paths and removeAndPersist finds no
      // match. getInstalledPath resolves the stored local string via the scope's
      // own base dir, yielding the same absolute path pi uses as the settings
      // match key, so removal succeeds regardless of cwd. npm/git sources are
      // stored verbatim and matched by a scope-independent key, so they must be
      // passed through unchanged (getInstalledPath would return their install
      // path, which is not a valid source string).
      const isPackageSource = source.startsWith('npm:') || /^(git:|https?:|ssh:|git@)/.test(source);
      const scopes: Array<'user' | 'project'> = local ? ['project', 'user'] : ['user', 'project'];
      for (const scope of scopes) {
        const resolved = isPackageSource ? source : (manager.getInstalledPath(source, scope) ?? source);
        if (await manager.removeAndPersist(resolved, { local: scope === 'project' })) return true;
      }
      return false;
    },
    update: (handle, source) => getPackageManager(handle).update(source),
    checkUpdates: async (handle) => getPackageManager(handle).checkForAvailableUpdates(),
    onProgress: (handle, listener) => {
      getPackageManager(handle).setProgressCallback(listener);
      return () => getPackageManager(handle).setProgressCallback(undefined);
    },
    invalidate: () => {
      packageCache.clear();
      packageManagers.clear();
    },
  };
  function getPackageManager(handle: PiPackageManagerHandle): RawPackageManager {
    const entry = packageManagers.get(handle.identity);
    if (!entry) throw new Error('stale-package-manager');
    return entry.raw;
  }

  const resourcesPort: PiResourcePort = {
    getSkills: (runtime) => getRuntime(runtime).services.resourceLoader.getSkills().skills,
    getPrompts: (runtime) => getRuntime(runtime).services.resourceLoader.getPrompts().prompts,
    getExtensions: (runtime) => getRuntime(runtime).services.resourceLoader.getExtensions().extensions,
    getThemes: (runtime) => getRuntime(runtime).services.resourceLoader.getThemes().themes,
    reload: (runtime) => getRuntime(runtime).session.reload(),
  };

  const trustPort: PiTrustPort = {
    getProjectTrustStore: () => new sdk.ProjectTrustStore(sdk.getAgentDir()),
    listEntries: async () => {
      const doc = JSON.parse(readFileSync(join(sdk.getAgentDir(), 'trust.json'), 'utf8')) as AnyRecord;
      return Object.entries(doc).flatMap(([path, decision]) => typeof decision === 'boolean' ? [{ path, decision }] : []);
    },
    set: async (path, decision) => { new sdk.ProjectTrustStore(sdk.getAgentDir()).set(path, decision); },
    hasTrustRequiringProjectResources: (cwd) => sdk.hasTrustRequiringProjectResources(cwd),
    resolveProjectTrusted: async (options) => {
      const mod = await import(pathToFileURL(join(input.packageRoot, 'dist/core/project-trust.js')).href);
      return mod.resolveProjectTrusted(options as never);
    },
  };

  const eventBusHandle = (raw: RawEventBus): PiEventBusHandle => {
    const id = identity('event', `${input.generation}:${++sequence}`);
    events.set(id, { identity: id, raw });
    return { identity: id };
  };

  const adapter: PiRuntimeAdapter = {
    metadata: {
      packageVersion: input.packageVersion,
      packageRoot: input.packageRoot,
      cliPath: input.cliPath,
      cliVersion: input.cliVersion,
      nodePath: input.nodePath,
      nodeVersion: input.nodeVersion,
      npmPath: input.npmPath,
      npmVersion: input.npmVersion,
      npmRoot: input.npmRoot,
      generation: input.generation,
    },
    packageVersion: input.packageVersion,
    packageRoot: input.packageRoot,
    cliPath: input.cliPath,
    cliVersion: input.cliVersion,
    capabilities: detectPiCapabilities(sdk as unknown as Record<string, unknown>),
    compatibility: input.compatibility,
    paths,
    runtime: {
      create: (runtimeInput) => adapter.createRuntime(runtimeInput),
      dispose: (runtime) => adapter.dispose(runtime),
      calculateContextTokens: (usage) => sdk.calculateContextTokens(usage as never),
      estimateTokens: (message) => sdk.estimateTokens(message as never),
    },
    sessions: sessionsPort,
    providers: providersPort,
    settings: settingsPort,
    packages: packagesPort,
    resources: resourcesPort,
    trust: trustPort,
    createEventBus: () => eventBusHandle(sdk.createEventBus()),
    eventBus: { on: (channel, listener) => {
      const raw = [...events.values()][0]?.raw ?? sdk.createEventBus();
      raw.on(channel, listener);
      return () => raw.off?.(channel, listener);
    } },
    createRuntime: async (runtimeInput: PiCreateRuntimeInput) => {
      const eventHandle = runtimeInput.eventBus ?? adapter.createEventBus();
      const eventEntry = events.get(eventHandle.identity);
      const eventBus = eventEntry?.raw ?? sdk.createEventBus();
      const agentDir = sdk.getAgentDir();
      const trustStore = new sdk.ProjectTrustStore(agentDir);
      const createFactory = async ({ cwd, sessionManager, sessionStartEvent }: AnyRecord) => {
        const hasTrust = sdk.hasTrustRequiringProjectResources(cwd);
        const cachedTrust = runtimeInput.getProjectTrust?.(cwd);
        const shouldResolveTrust = cachedTrust === undefined && hasTrust;
        const projectTrusted = shouldResolveTrust ? false : (cachedTrust ?? (!hasTrust || trustStore.get(cwd) === true));
        const settingsManager = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted });
        const services = await sdk.createAgentSessionServices({
          cwd,
          agentDir,
          settingsManager,
          resourceLoaderOptions: {
            eventBus: eventBus as never,
            ...(runtimeInput.appendSystemPrompt ? { appendSystemPromptOverride: runtimeInput.appendSystemPrompt } : {}),
            ...(runtimeInput.workspaceBoundary ? {
              extensionFactories: [{
                name: 'pi-desktop-workspace-boundary',
                hidden: true,
                factory: (pi: AnyRecord) => {
                  pi.on('tool_call', (event: AnyRecord, context: AnyRecord) => {
                    if (event.toolName !== 'write' && event.toolName !== 'edit') return;
                    const requested = event.input?.path ?? event.input?.file_path;
                    if (typeof requested !== 'string') return;
                    const target = resolve(context.cwd, requested);
                    const root = resolve(cwd);
                    const child = relative(root, target);
                    if (child === '' || (!child.startsWith('..') && !isAbsolute(child))) return;
                    return { block: true, reason: `Pi Desktop only writes inside the selected workspace (${cwd}).` };
                  });
                },
              }],
            } : {}),
          },
          resourceLoaderReloadOptions: shouldResolveTrust && runtimeInput.resolveTrust ? {
            resolveProjectTrust: async ({ extensionsResult }: AnyRecord) => {
              const trusted = await runtimeInput.resolveTrust!({
                cwd,
                trustStore,
                defaultProjectTrust: sdk.SettingsManager.create(cwd, agentDir).getDefaultProjectTrust(),
                extensionsResult,
                onExtensionError: (message: string) => undefined,
              });
              runtimeInput.setProjectTrust?.(cwd, trusted);
              return trusted;
            },
          } : undefined,
        });
        return {
          ...(await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
          services,
          diagnostics: services.diagnostics,
        };
      };
      const raw = await sdk.createAgentSessionRuntime(createFactory, {
        cwd: runtimeInput.cwd,
        agentDir,
        sessionManager: runtimeInput.sessionPath ? sdk.SessionManager.open(runtimeInput.sessionPath) : sdk.SessionManager.create(runtimeInput.cwd),
      });
      validateSessionCapabilities(adapter.compatibility, raw.session as unknown as Record<string, unknown>);
      if (adapter.compatibility.status === 'incompatible') {
        throw new Error(`incompatible: missing session capabilities ${adapter.compatibility.missingRequiredCapabilities.join(', ')}`);
      }
      return runtimeHandle(raw);
    },
    dispose: (runtime) => {
      const entry = runtimes.get(runtime.identity);
      if (!entry) return;
      entry.raw.dispose();
      runtimes.delete(runtime.identity);
    },
  };
  function getRuntime(handle: PiRuntimeHandle): RawRuntime {
    const entry = runtimes.get(handle.identity);
    if (!entry) throw new Error('stale-runtime');
    return entry.raw;
  }
  return adapter;
}

export type { PiSdk };