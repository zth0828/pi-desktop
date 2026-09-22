/**
 * 清洗 GitHub Release Body，过滤掉仅供 GitHub 网页下载的链接段落与免责指引，
 * 提取出面向应用内展示的纯粹更新内容与变更日志。
 */
export function sanitizeReleaseNotes(text?: string | null): string {
  if (!text) return '';
  let content = text.trim();

  // 1. 匹配并去除以 "### 📥 下载地址" 或 "## 📥 下载地址" 或 "### 下载地址" 开始的下载专区
  //    该区块通常以横线 "---" 或下一个二级/一级标题结束
  content = content.replace(
    /#{1,4}\s*(?:📥\s*)?(?:下载地址|Downloads?|Download)[\s\S]*?(?:(?:\r?\n\s*---\s*\r?\n*)|(?=\r?\n#{1,3}\s(?!#))|$)/gi,
    '',
  ).trim();

  // 2. 去除可能残留在开头的横线分割线
  content = content.replace(/^(?:---\s*\r?\n*)+/, '').trim();

  // 3. 去除可能残留在结尾的横线分割线
  content = content.replace(/(?:\r?\n*\s*---)+$/, '').trim();

  return content;
}
