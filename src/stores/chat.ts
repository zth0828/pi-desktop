// 聊天 store 公共出口。
// 实现见 ./chat-core（node-safe 分层，同 lib/chat-types.ts 约定）；
// 窗口首个面板实例见 ./default-chat-store；面板内消费见 pages/Chat/chat-store-context。
export { createChatStore } from './chat-core';
export type {
  ChatEventReporters,
  ChatState,
  ChatStore,
  ChatStoreDeps,
  HostEventSubscriber,
  QueueState,
  RetryState,
  TurnStats,
} from './chat-core';
export type { ChatMessage, ContentBlock, ToolExecution } from '../lib/chat-types';
