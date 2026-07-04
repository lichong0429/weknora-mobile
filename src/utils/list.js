export function extractList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.data?.list)) return result.data.list;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}
