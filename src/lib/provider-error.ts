// 分类实现已迁至 shared（main 侧 services 与渲染层共用同一份文本归类逻辑），
// 此处仅保留 re-export，现有调用点 import 路径不变。
export {
  parseProviderError,
  toModelUnavailableError,
  type ProviderErrorCategory,
  type ProviderErrorInfo,
} from '@shared/provider-error';
