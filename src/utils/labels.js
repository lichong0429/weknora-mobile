// 文档来源类型的展示名。
// 后端 knowledge.type 的取值直接透出到界面对用户没有意义（file / url / manual / faq），
// 这里统一映射为中文；KBDetail 与 KnowledgeDetail 共用，避免两处各写一份导致文案漂移。
export const SOURCE_LABEL = {
  file: '文件上传',
  url: '网页链接',
  manual: '手动创建',
  faq: 'FAQ'
};

export function sourceLabel(type) {
  return SOURCE_LABEL[type] || type || '未知来源';
}
