/**
 * 知识库设置请求体的回归测试。
 *
 * 锁死的目标（曾经的真实事故）：
 *   - 配置必须嵌套在 `config` 下，不能平铺在顶层（平铺会被 Go 的 json
 *     解码器静默忽略 → 界面提示保存成功但实际没保存）
 *   - 模型字段不得出现在 PUT /knowledge-bases 的请求体里（该接口不接受）
 *   - 必须另外产出 PUT /initialization/config 的请求体，且 llmModelId 非空
 *   - documentSplitting 的三个指针字段只在原值存在时才带上（否则会清空用户设置）
 *   - 回读比对必须能识别出「服务端没接受」
 */
import {
  buildKBUpdateBody,
  buildModelConfigBody,
  diffModelConfig
} from '../src/utils/kbSettingsPayload.js';

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function checkTrue(name, cond, detail = '') {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

// ---------------- 1) PUT /knowledge-bases/{id} 的请求体 ----------------
const base = {
  name: 'KB-A',
  description: 'desc',
  vectorEnabled: true,
  keywordEnabled: true,
  wikiEnabled: true,
  graphEnabled: false,
  granularity: 'standard',
  wikiSynthModelId: 'wiki-model',
  hasExistingWikiConfig: true
};
const kbBody = buildKBUpdateBody(base);

check('配置嵌套在 config 下（不是平铺）',
  Object.keys(kbBody).sort(), ['config', 'description', 'name']);
check('indexing_strategy 位于 config 内',
  kbBody.config.indexing_strategy,
  { vector_enabled: true, keyword_enabled: true, wiki_enabled: true, graph_enabled: false });
check('wiki_config 位于 config 内',
  kbBody.config.wiki_config,
  { synthesis_model_id: 'wiki-model', extraction_granularity: 'standard' });

// 负向断言：这些字段一旦出现在顶层，就是当年那个 bug 的形状
for (const forbidden of ['embedding_model_id', 'summary_model_id', 'vlm_config', 'indexing_strategy', 'wiki_config']) {
  checkTrue(`顶层不得出现 ${forbidden}`, !(forbidden in kbBody),
    `顶层键: ${Object.keys(kbBody).join(',')}`);
}

// 未使用 wiki 的知识库不应被写入一份空 wiki_config
const kbBodyNoWiki = buildKBUpdateBody({ ...base, wikiSynthModelId: '', hasExistingWikiConfig: false });
checkTrue('无 wiki 配置时不写 wiki_config', !('wiki_config' in kbBodyNoWiki.config));

// ---------------- 2) PUT /initialization/config/{id} 的请求体 ----------------
const modelBody = buildModelConfigBody({
  embeddingModelId: 'emb-1',
  summaryModelId: 'qa-1',
  vlmEnabled: true,
  vlmModelId: 'vlm-1',
  chunkingConfig: { chunk_size: 800, chunk_overlap: 100, separators: ['\n', '。'] },
  extractConfig: { enabled: false, tags: ['t1'] }
});

check('llmModelId 使用 camelCase', modelBody.llmModelId, 'qa-1');
check('embeddingModelId 使用 camelCase', modelBody.embeddingModelId, 'emb-1');
check('vlm_config 键名为 snake_case', modelBody.vlm_config, { enabled: true, model_id: 'vlm-1' });
check('multimodal.enabled 跟随 VLM 开关', modelBody.multimodal, { enabled: true });
check('documentSplitting 映射分块配置',
  [modelBody.documentSplitting.chunkSize, modelBody.documentSplitting.chunkOverlap,
    modelBody.documentSplitting.separators],
  [800, 100, ['\n', '。']]);
check('nodeExtract 为必填结构且透传 tags', modelBody.nodeExtract.tags, ['t1']);
checkTrue('缺少分块配置时给出默认值',
  modelBody.documentSplitting.chunkSize > 0 && modelBody.documentSplitting.chunkOverlap >= 0,
  JSON.stringify(modelBody.documentSplitting));

// 指针字段：原值缺失时不得带上（带上 = 清空用户设置）
checkTrue('strategy 原值缺失时不发送', !('strategy' in modelBody.documentSplitting));
checkTrue('tokenLimit 原值缺失时不发送', !('tokenLimit' in modelBody.documentSplitting));
checkTrue('languages 原值缺失时不发送', !('languages' in modelBody.documentSplitting));

const modelBodyWithPtr = buildModelConfigBody({
  summaryModelId: 'qa-1',
  embeddingModelId: 'emb-1',
  chunkingConfig: { strategy: 'auto', token_limit: 512, languages: ['zh'], table_metadata_instructions: 'x' }
});
check('原值存在时透传 strategy/tokenLimit/languages', [
  modelBodyWithPtr.documentSplitting.strategy,
  modelBodyWithPtr.documentSplitting.tokenLimit,
  modelBodyWithPtr.documentSplitting.languages,
  modelBodyWithPtr.documentSplitting.tableMetadataInstructions
], ['auto', 512, ['zh'], 'x']);

// ---------------- 3) 回读比对 ----------------
const desired = {
  summaryModelId: 'qa-1', embeddingModelId: 'emb-1',
  vlmEnabled: true, vlmModelId: 'vlm-1',
  vectorEnabled: true, keywordEnabled: true, wikiEnabled: true, graphEnabled: false,
  hasWikiConfig: true, wikiSynthModelId: 'wiki-model'
};
check('全部保存成功时无差异', diffModelConfig({
  summary_model_id: 'qa-1',
  embedding_model_id: 'emb-1',
  vlm_config: { enabled: true, model_id: 'vlm-1' },
  indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: true, graph_enabled: false },
  wiki_config: { synthesis_model_id: 'wiki-model' }
}, desired), []);

// 这正是用户遇到的问题：模型没被存进去，必须被判为「未接受」
const undetected = diffModelConfig({
  summary_model_id: '',
  embedding_model_id: '',
  vlm_config: { enabled: false },
  indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: false, graph_enabled: false },
  wiki_config: null
}, desired);
checkTrue('模型未落库时被判为未接受', undetected.includes('摘要 / 合成模型'), JSON.stringify(undetected));
checkTrue('模型未落库时 Embedding 也被判出', undetected.includes('Embedding 模型'));
checkTrue('VLM 开关未落库时被判出', undetected.includes('图像处理（VLM）开关'));
checkTrue('索引开关未落库时被判出', undetected.includes('Wiki 索引'));
checkTrue('回读为空时给出明确提示',
  diffModelConfig(null, desired).length === 1 && diffModelConfig(null, desired)[0].includes('无法回读'));

// 关掉 VLM 时不应误报 VLM 模型差异
checkTrue('VLM 关闭时不比对 VLM 模型',
  !diffModelConfig(
    { summary_model_id: 'qa-1', embedding_model_id: 'emb-1', vlm_config: { enabled: false },
      indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: true, graph_enabled: false },
      wiki_config: { synthesis_model_id: 'wiki-model' } },
    { ...desired, vlmEnabled: false, vlmModelId: '' }
  ).includes('VLM 模型'));

console.log();
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`全部通过（${pass} 项）`);
