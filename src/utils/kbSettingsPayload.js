/**
 * 知识库设置的请求体构造与保存后校验。
 *
 * 背景（这是本项目踩过的真实事故）：
 * 早期版本把模型配置（embedding_model_id / summary_model_id / vlm_config /
 * indexing_strategy / wiki_config）**平铺**在 `PUT /knowledge-bases/{id}` 的顶层。
 * 但后端该接口的请求体是
 *
 *     UpdateKnowledgeBaseRequest { name, description, config: KnowledgeBaseConfig }
 *
 * 而 `KnowledgeBaseConfig` 只包含 chunking_config / image_processing_config /
 * faq_config / wiki_config / auto_tag_config / profile_config / indexing_strategy
 * —— 模型字段一概不在其中（见 internal/handler/knowledgebase.go 与
 * internal/types/knowledgebase.go）。Go 的 json 解码器默认忽略未知字段，
 * 于是 `name`/`description` 正常落库、接口返回成功、界面提示「保存成功」，
 * 而用户选择的模型一步都没有写入。这是「显示保存成功但实际没勾选上」的根因。
 *
 * 正确契约（与网页端 KnowledgeBaseEditorModal 一致，拆成两次调用）：
 *   1. PUT /knowledge-bases/{id}        基本信息 + config{...}（配置必须嵌套）
 *   2. PUT /initialization/config/{id}  模型与解析配置（camelCase；
 *      其中 vlm_config / asr_config 及其子字段为 snake_case）
 *
 * 本模块只做「请求体构造」与「回读比对」，不依赖 React，便于用
 * scripts/test-kb-settings-payload.mjs 做回归测试锁死契约。
 */

/** 构造 PUT /knowledge-bases/{id} 的请求体。配置必须嵌套在 config 下。 */
export function buildKBUpdateBody({
  name,
  description,
  vectorEnabled,
  keywordEnabled,
  wikiEnabled,
  graphEnabled,
  granularity,
  wikiSynthModelId,
  hasExistingWikiConfig = false
}) {
  const config = {
    indexing_strategy: {
      vector_enabled: Boolean(vectorEnabled),
      keyword_enabled: Boolean(keywordEnabled),
      wiki_enabled: Boolean(wikiEnabled),
      graph_enabled: Boolean(graphEnabled)
    }
  };

  // wiki_config 只在用到时才带：后端语义是「带上即整体替换」，
  // 对无关的知识库不要凭空写入一份空配置。
  if (wikiSynthModelId || hasExistingWikiConfig) {
    config.wiki_config = {
      synthesis_model_id: wikiSynthModelId || '',
      extraction_granularity: granularity || 'standard'
    };
  }

  return { name, description, config };
}

/**
 * 构造 PUT /initialization/config/{id} 的请求体。
 *
 * 必填（后端 binding:"required"）：llmModelId、documentSplitting、multimodal、nodeExtract。
 * documentSplitting 的 strategy / tokenLimit / languages / tableMetadataInstructions
 * 在后端是指针类型：**不提供 = 保持不变，显式空值 = 清空**。因此只在原值存在时
 * 才带上，避免把用户的设置意外清掉。
 */
export function buildModelConfigBody({
  embeddingModelId,
  summaryModelId,
  vlmEnabled,
  vlmModelId,
  chunkingConfig,
  extractConfig
}) {
  const c = chunkingConfig || {};
  const documentSplitting = {
    chunkSize: c.chunk_size ?? 512,
    chunkOverlap: c.chunk_overlap ?? 64,
    separators: c.separators ?? ['\n\n', '\n', '。']
  };
  if (c.strategy !== undefined && c.strategy !== null) {
    documentSplitting.strategy = c.strategy;
  }
  if (c.token_limit !== undefined && c.token_limit !== null) {
    documentSplitting.tokenLimit = c.token_limit;
  }
  if (c.languages !== undefined && c.languages !== null) {
    documentSplitting.languages = c.languages;
  }
  if (c.table_metadata_instructions !== undefined && c.table_metadata_instructions !== null) {
    documentSplitting.tableMetadataInstructions = c.table_metadata_instructions;
  }

  const e = extractConfig || {};
  return {
    // 后端 binding:"required"，空值会被拒绝
    llmModelId: summaryModelId || '',
    embeddingModelId: embeddingModelId || '',
    vlm_config: { enabled: Boolean(vlmEnabled), model_id: vlmModelId || '' },
    documentSplitting,
    multimodal: { enabled: Boolean(vlmEnabled) },
    nodeExtract: {
      enabled: Boolean(e.enabled),
      text: e.text || '',
      tags: e.tags || [],
      nodes: e.nodes || [],
      relations: e.relations || []
    }
  };
}

/**
 * 保存后回读比对，列出服务端**没有接受**的项。
 *
 * 为什么要这一步：旧实现保存成功后直接用本地对象做「乐观更新」并提示成功，
 * 因此「其实没保存」被显示成了「保存成功」。回读比对把这个假成功堵死，
 * 也让将来后端契约再变化时能立刻暴露，而不是静默丢数据。
 */
export function diffModelConfig(fresh, desired) {
  if (!fresh) return ['无法回读知识库（未确认是否保存）'];
  const out = [];

  if ((fresh.summary_model_id || '') !== (desired.summaryModelId || '')) {
    out.push('摘要 / 合成模型');
  }
  if ((fresh.embedding_model_id || '') !== (desired.embeddingModelId || '')) {
    out.push('Embedding 模型');
  }
  if (Boolean(fresh.vlm_config?.enabled) !== Boolean(desired.vlmEnabled)) {
    out.push('图像处理（VLM）开关');
  }
  const vlmModelChanged = Boolean(desired.vlmEnabled)
    && (fresh.vlm_config?.model_id || '') !== (desired.vlmModelId || '');
  if (vlmModelChanged) out.push('VLM 模型');

  const s = fresh.indexing_strategy || {};
  if (Boolean(s.wiki_enabled) !== Boolean(desired.wikiEnabled)) out.push('Wiki 索引');
  if (Boolean(s.vector_enabled) !== Boolean(desired.vectorEnabled)) out.push('向量索引');
  if (Boolean(s.keyword_enabled) !== Boolean(desired.keywordEnabled)) out.push('关键词索引');
  if (Boolean(s.graph_enabled) !== Boolean(desired.graphEnabled)) out.push('知识图谱索引');

  const w = fresh.wiki_config;
  if (desired.hasWikiConfig && w && (w.synthesis_model_id || '') !== (desired.wikiSynthModelId || '')) {
    out.push('Wiki 合成模型');
  }
  return out;
}
