import { useState } from 'react';
import { Search as SearchIcon, Loader2, BookOpen, AlertCircle, ChevronDown, Sparkles } from 'lucide-react';
import { useAsync } from '../hooks/useApi.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { noticeText } from '../utils/noticeText.js';
import { Search as SearchAPI, KB } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import { clsx } from 'clsx';

function Search() {
  const { t } = useI18n();
  const { data: kbRes } = useAsync(() => KB.list(), []);
  const kbs = extractList(kbRes);

  const [query, setQuery] = useState('');
  const [selectedKBs, setSelectedKBs] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  const toggleKB = (id) => {
    setSelectedKBs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = { query: query.trim() };
      if (selectedKBs.length) {
        payload.knowledge_base_ids = selectedKBs;
      } else if (kbs.length) {
        payload.knowledge_base_ids = kbs.map((k) => k.id);
      }
      if (!payload.knowledge_base_ids?.length) {
        setError({ key: 'search.noKb' });
        return;
      }
      const res = await SearchAPI.knowledge(payload);
      setResults(extractList(res));
    } catch (err) {
      setError({ raw: err.message, fallbackKey: 'search.failed' });
    } finally {
      setLoading(false);
    }
  };

  const scoreColor = (score) => {
    if (score >= 0.9) return 'text-emerald-600';
    if (score >= 0.7) return 'text-brand-600';
    return 'text-ink-muted';
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-[26px] leading-9 font-bold text-ink">{t('search.title')}</h2>
        <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-600">
          <Sparkles className="h-3 w-3" /> {t('search.badge')}
        </span>
      </div>

      <form onSubmit={handleSearch} className="mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-2.5 rounded-[14px] border border-line bg-white px-3.5 shadow-card focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
            <SearchIcon className="h-4 w-4 shrink-0 text-ink-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search.placeholder')}
              className="w-full bg-transparent py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center rounded-[14px] bg-gradient-to-br from-brand-600 to-brand-400 px-4 py-3 text-white shadow-brand-lg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-secondary">{t('search.kbPicker')}</p>
          <div className="flex flex-wrap gap-2">
            {kbs.map((kb) => (
              <button
                key={kb.id}
                type="button"
                onClick={() => toggleKB(kb.id)}
                className={clsx(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedKBs.includes(kb.id)
                    ? 'bg-gradient-to-br from-brand-600 to-brand-400 text-white'
                    : 'bg-white text-ink-secondary shadow-card hover:bg-surface-subtle'
                )}
              >
                {kb.name}
              </button>
            ))}
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mr-1 inline h-4 w-4" /> {noticeText(error, t)}
        </div>
      )}

      {results && results.length === 0 && (
        <div className="py-8 text-center text-sm text-ink-muted">{t('search.noResults')}</div>
      )}

      <div className="space-y-3">
        {results?.map((item, idx) => {
          const isExpanded = expanded[item.id];
          return (
            <div key={item.id} className="rounded-[18px] bg-white p-4 shadow-card">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <span className="truncate text-sm font-semibold text-ink">{item.knowledge_title}</span>
                </div>
                <span className={clsx('ml-2 shrink-0 rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-medium', scoreColor(item.score))}>
                  {t('search.score', { value: item.score?.toFixed(2) })}
                </span>
              </div>
              <p className={isExpanded ? 'text-sm text-ink-secondary' : 'line-clamp-3 text-sm text-ink-secondary'}>
                {item.content}
              </p>
              {item.content?.length > 120 && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  className="mt-2 flex items-center gap-0.5 text-xs font-medium text-brand-600"
                >
                  {isExpanded ? t('common.collapse') : t('common.expand')}
                  <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                </button>
              )}
              <p className="mt-2 text-[11px] text-ink-faint">{item.knowledge_filename}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Search;
