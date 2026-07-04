import { del, get, post, put, uploadFile } from './client.js';

export const KB = {
  list: (agentId) => get('/knowledge-bases', agentId ? { agent_id: agentId } : {}),
  create: (body) => post('/knowledge-bases', body),
  detail: (id) => get(`/knowledge-bases/${id}`),
  update: (id, body) => put(`/knowledge-bases/${id}`, body),
  remove: (id) => del(`/knowledge-bases/${id}`),
  pin: (id) => put(`/knowledge-bases/${id}/pin`),
  hybridSearch: (id, body) => post(`/knowledge-bases/${id}/hybrid-search`, body)
};

export const Knowledge = {
  list: (kbId, params) => get(`/knowledge-bases/${kbId}/knowledge`, params),
  file: uploadFile,
  url: (kbId, body) => post(`/knowledge-bases/${kbId}/knowledge/url`, body),
  manual: (kbId, body) => post(`/knowledge-bases/${kbId}/knowledge/manual`, body),
  detail: (id) => get(`/knowledge/${id}`),
  update: (id, body) => put(`/knowledge/${id}`, body),
  updateManual: (id, body) => put(`/knowledge/manual/${id}`, body),
  remove: (id) => del(`/knowledge/${id}`),
  reparse: (id) => post(`/knowledge/${id}/reparse`),
  cancelParse: (id) => post(`/knowledge/${id}/cancel-parse`),
  preview: (id) => get(`/knowledge/${id}/preview`),
  search: (params) => get('/knowledge/search', params)
};

export const Search = {
  knowledge: (body) => post('/knowledge-search', body)
};

export const Session = {
  list: (params) => get('/sessions', params),
  create: (body) => post('/sessions', body),
  detail: (id) => get(`/sessions/${id}`),
  update: (id, body) => put(`/sessions/${id}`, body),
  remove: (id) => del(`/sessions/${id}`),
  clearMessages: (id) => del(`/sessions/${id}/messages`),
  pin: (id) => post(`/sessions/${id}/pin`),
  unpin: (id) => del(`/sessions/${id}/pin`),
  stop: (id, messageId) => post(`/sessions/${id}/stop`, { message_id: messageId })
};

export const Message = {
  load: (sessionId, params) => get(`/messages/${sessionId}/load`, params)
};

export const Agent = {
  list: () => get('/agents'),
  detail: (id) => get(`/agents/${id}`),
  create: (body) => post('/agents', body),
  update: (id, body) => put(`/agents/${id}`, body),
  remove: (id) => del(`/agents/${id}`),
  copy: (id) => post(`/agents/${id}/copy`)
};

export const Model = {
  list: () => get('/models'),
  detail: (id) => get(`/models/${id}`),
  create: (body) => post('/models', body),
  update: (id, body) => put(`/models/${id}`, body),
  remove: (id) => del(`/models/${id}`),
  providers: (modelType) => get('/models/providers', modelType ? { model_type: modelType } : {})
};

export const VectorStore = {
  list: () => get('/vector-stores'),
  detail: (id) => get(`/vector-stores/${id}`),
  create: (body) => post('/vector-stores', body),
  update: (id, body) => put(`/vector-stores/${id}`, body),
  remove: (id) => del(`/vector-stores/${id}`),
  test: (body) => post('/vector-stores/test', body),
  testById: (id) => post(`/vector-stores/${id}/test`),
  types: () => get('/vector-stores/types')
};

export const WebSearch = {
  list: () => get('/web-search-providers'),
  detail: (id) => get(`/web-search-providers/${id}`),
  create: (body) => post('/web-search-providers', body),
  update: (id, body) => put(`/web-search-providers/${id}`, body),
  remove: (id) => del(`/web-search-providers/${id}`),
  test: (body) => post('/web-search-providers/test', body),
  testById: (id) => post(`/web-search-providers/${id}/test`),
  types: () => get('/web-search-providers/types'),
  builtinProviders: () => get('/web-search/providers')
};

export const System = {
  info: () => get('/system/info'),
  parserEngines: () => get('/system/parser-engines'),
  checkParserEngine: (body) => post('/system/parser-engines/check', body),
  reconnectDocreader: (body) => post('/system/docreader/reconnect', body),
  storageEngineStatus: () => get('/system/storage-engine-status'),
  checkStorageEngine: (body) => post('/system/storage-engine-check', body)
};

export const Tenant = {
  list: () => get('/tenants'),
  detail: (id) => get(`/tenants/${id}`),
  update: (id, body) => put(`/tenants/${id}`, body),
  getKV: (key) => get(`/tenants/kv/${key}`),
  setKV: (key, body) => put(`/tenants/kv/${key}`, body)
};
