// 窗口级错误通知：跨组件区域（侧栏 → 主内容区顶部）传递用户可见的失败提示。
// zustand vanilla 保持 node-safe（不引 react），消费侧用 useStore 订阅。
import { createStore } from 'zustand/vanilla';

export type GlobalError = { id: number; text: string };

let nextId = 1;

export const globalErrorsStore = createStore<{
  errors: GlobalError[];
  push: (text: string) => void;
  dismiss: (id: number) => void;
}>((set) => ({
  errors: [],
  push: (text) => set((state) => ({
    // 同文本去重（连点同一次失败不堆叠）；上限 3 条，超出挤掉最旧的
    errors: [
      ...state.errors.filter((e) => e.text !== text),
      { id: nextId++, text },
    ].slice(-3),
  })),
  dismiss: (id) => set((state) => ({
    errors: state.errors.filter((e) => e.id !== id),
  })),
}));

/** 便捷入口：push 一条全局错误（文案由调用方翻译好） */
export function pushGlobalError(text: string): void {
  globalErrorsStore.getState().push(text);
}
