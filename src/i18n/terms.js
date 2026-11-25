/**
 * 受保护的专名 / 商标 / 协议前缀片段。
 *
 * 约定：字典里出现这些词时，**所有语言都必须原样保留**。
 * 翻译「WeKnora」为「知识库客户端」或者把「API Key」译成「接口密钥」都是错的 ——
 * 用户会拿这些词去搜文档、对日志、填配置项。
 *
 * 清单来源（不是凭空列的）：
 *  - 产品名 / 通用技术词：WeKnora、API Key、FAQ、Wiki、KaTeX、ZIP
 *  - 代码里实际出现的模型与服务商（见 ModelList.jsx / ModelDetail.jsx 的 provider 下拉）：
 *    Ollama、OpenAI、DeepSeek、Moonshot、Jina、BigModel、SiliconFlow、Hunyuan、qwen
 *  - 网络搜索 Provider（见 Settings.jsx「网络搜索源」）：Google、Bing
 *  - 发布渠道（见 Settings.jsx「应用更新」）：GitHub
 *  - 应用场景里会出现在知识库正文/标题中的材料与单位专名：
 *    MOF、ZIF-8、ZIF-4、PIM-1、6FDA-DAM、Matrimid、Pebax、PDMS
 *    （这些是用户数据，本身不进字典；留在清单里是为了防止将来有人把
 *      它们写进界面文案时被顺手译掉）
 *
 * 注意：`WeKnora` 与 `weknora.example.com` 大小写不同，按**原样**匹配，
 * terms 只用于断言「该词仍在译文里」，不做大小写归一。
 */
export const PROTECTED_TERMS = [
  'WeKnora',
  'API Key',
  'Android Keystore',
  'FAQ',
  'Wiki',
  'KaTeX',
  'ZIP',
  'GitHub',
  'Google',
  'Bing',
  'Ollama',
  'OpenAI',
  'DeepSeek',
  'Moonshot',
  'Jina',
  'BigModel',
  'SiliconFlow',
  'Hunyuan',
  'qwen',
  'MOF',
  'ZIF-8',
  'ZIF-4',
  'PIM-1',
  '6FDA-DAM',
  'Matrimid',
  'Pebax',
  'PDMS'
];

/**
 * 找出某个字符串里出现的受保护专名。
 *
 * @param {string} text 待检查的文案
 * @returns {string[]} 命中（且保持 PROTECTED_TERMS 顺序）的专名列表
 */
export function findProtectedTerms(text) {
  if (typeof text !== 'string' || text === '') return [];
  return PROTECTED_TERMS.filter((term) => text.includes(term));
}
