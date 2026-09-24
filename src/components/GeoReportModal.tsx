import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Play, Loader2, TrendingUp, Bot, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { GeoConfig, GeoResult } from '../types';
import { fetchGeoConfig, fetchGeoPrompts, saveGeoPrompts, fetchGeoResults, runGeoCheck } from '../services/geoService';

interface GeoReportModalProps {
  onClose: () => void;
}

const engineLabel: Record<string, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
};

export const GeoReportModal: React.FC<GeoReportModalProps> = ({ onClose }) => {
  const [config, setConfig] = useState<GeoConfig | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const [c, p, r] = await Promise.all([fetchGeoConfig(), fetchGeoPrompts(), fetchGeoResults()]);
        setConfig(c);
        setPrompts(p);
        setResults(r);
      } catch (e: any) {
        setError(e.message || 'Failed to load GEO data.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleAddPrompt = async () => {
    const clean = newPrompt.trim();
    if (!clean) return;
    const updated = [...prompts, clean];
    setPrompts(updated);
    setNewPrompt('');
    try {
      await saveGeoPrompts(updated);
    } catch (e: any) {
      setError(e.message || 'Failed to save prompt.');
    }
  };

  const handleRemovePrompt = async (idx: number) => {
    const updated = prompts.filter((_, i) => i !== idx);
    setPrompts(updated);
    try {
      await saveGeoPrompts(updated);
    } catch (e: any) {
      setError(e.message || 'Failed to save prompt.');
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const { results: newResults } = await runGeoCheck();
      setResults((prev) => [...newResults, ...prev]);
    } catch (e: any) {
      setError(e.message || 'Failed to run GEO check.');
    } finally {
      setIsRunning(false);
    }
  };

  // --- KPIs ---
  interface EngineStat {
    total: number;
    mentioned: number;
  }
  const kpis = useMemo<{
    byEngine: Record<string, EngineStat>;
    totalChecks: number;
    totalMentions: number;
    overallRate: number;
    lastRun: string | null;
  }>(() => {
    const byEngine: Record<string, EngineStat> = {};
    for (const r of results) {
      if (!byEngine[r.engine]) byEngine[r.engine] = { total: 0, mentioned: 0 };
      byEngine[r.engine].total += 1;
      if (r.mentioned) byEngine[r.engine].mentioned += 1;
    }
    const totalChecks = results.length;
    const totalMentions = results.filter((r) => r.mentioned).length;
    const overallRate = totalChecks > 0 ? Math.round((totalMentions / totalChecks) * 100) : 0;
    const lastRun = results.length > 0 ? results[0].runAt : null;
    return { byEngine, totalChecks, totalMentions, overallRate, lastRun };
  }, [results]);

  const configuredEngines = config ? Object.entries(config.engines).filter(([, on]) => on).map(([e]) => e) : [];
  const noEnginesConfigured = config && configuredEngines.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-xl my-4 sm:my-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-400" />
              GEO / AIO Visibility Report
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Independent checks of what AI engines say about{' '}
              <span className="text-orange-400 font-semibold">{config?.brand || 'the brand'}</span> — not connected
              to Reddit account data.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {isLoading ? (
            <div className="text-center text-slate-500 text-xs py-10">Loading...</div>
          ) : (
            <>
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/40 text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {noEnginesConfigured && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/30 text-amber-400 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    No AI engine is configured yet. Set <code>OPENAI_API_KEY</code> and/or{' '}
                    <code>PERPLEXITY_API_KEY</code> as environment variables on the server, then redeploy.
                  </span>
                </div>
              )}

              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-slate-800/40 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 font-semibold tracking-widest">
                    Overall Mention Rate
                  </span>
                  <div className="mt-2 text-2xl font-mono font-bold text-white">{kpis.overallRate}%</div>
                </div>
                <div className="rounded-xl bg-slate-800/40 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 font-semibold tracking-widest">
                    Total Checks
                  </span>
                  <div className="mt-2 text-2xl font-mono font-bold text-white">{kpis.totalChecks}</div>
                </div>
                <div className="rounded-xl bg-slate-800/40 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 font-semibold tracking-widest">
                    Mentions Found
                  </span>
                  <div className="mt-2 text-2xl font-mono font-bold text-emerald-400">{kpis.totalMentions}</div>
                </div>
                <div className="rounded-xl bg-slate-800/40 p-3.5">
                  <span className="text-[10px] uppercase text-slate-500 font-semibold tracking-widest">
                    Last Run
                  </span>
                  <div className="mt-2 text-xs font-mono text-slate-300">
                    {kpis.lastRun ? new Date(kpis.lastRun).toLocaleString() : '—'}
                  </div>
                </div>
              </div>

              {/* Per-engine breakdown */}
              {Object.keys(kpis.byEngine).length > 0 && (
                <div className="flex flex-wrap gap-4">
                  {Object.keys(kpis.byEngine).map((engine) => {
                    const stat: EngineStat = kpis.byEngine[engine];
                    return (
                      <div key={engine} className="flex items-center gap-2 text-xs">
                        <Bot className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-slate-300 font-medium">{engineLabel[engine] || engine}:</span>
                        <span className="font-mono text-orange-400">
                          {stat.total > 0 ? Math.round((stat.mentioned / stat.total) * 100) : 0}%
                        </span>
                        <span className="text-slate-600">({stat.mentioned}/{stat.total})</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Prompts management */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 mb-2">Test Prompts</h3>
                <p className="text-[11px] text-slate-500 mb-2">
                  Questions a real user might ask an AI assistant, relevant to what {config?.brand || 'the brand'}{' '}
                  does. Each run checks every prompt against every configured engine.
                </p>
                <div className="space-y-1.5 mb-2">
                  {prompts.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-800/60">
                      <span className="text-xs text-slate-300">{p}</span>
                      <button
                        onClick={() => handleRemovePrompt(idx)}
                        className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {prompts.length === 0 && (
                    <p className="text-xs text-slate-600 italic py-2">No prompts yet — add one below.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()}
                    placeholder="e.g. what are the best AI tools for X?"
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-orange-600"
                  />
                  <button
                    onClick={handleAddPrompt}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Run button */}
              <button
                onClick={handleRun}
                disabled={isRunning || prompts.length === 0 || noEnginesConfigured}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isRunning ? 'Running check...' : 'Run GEO Check Now'}
              </button>

              {/* Results log */}
              <div>
                <h3 className="text-xs font-bold text-slate-300 mb-2">Recent Results</h3>
                <div className="space-y-2">
                  {results.slice(0, 30).map((r) => (
                    <div key={r.id} className="p-3 rounded-lg bg-slate-800/30">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          {r.error ? (
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          ) : r.mentioned ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                          )}
                          <span className="text-[10px] font-mono uppercase text-slate-400">
                            {engineLabel[r.engine] || r.engine}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-600 font-mono">
                          {new Date(r.runAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">{r.prompt}</p>
                      {r.error ? (
                        <p className="text-[11px] text-amber-400/80 mt-1">{r.error}</p>
                      ) : r.snippet ? (
                        <p className="text-[11px] text-slate-500 mt-1 italic">"{r.snippet}"</p>
                      ) : (
                        <p className="text-[11px] text-slate-600 mt-1">Not mentioned in the response.</p>
                      )}
                    </div>
                  ))}
                  {results.length === 0 && (
                    <p className="text-xs text-slate-600 italic py-2">No checks run yet.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
