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
  gemini: 'Gemini',
};

const engineColor: Record<string, string> = {
  chatgpt: '#fb923c', // orange
  perplexity: '#60a5fa', // blue
  gemini: '#34d399', // emerald
};

type TimeRangeKey = '7d' | '30d' | '90d' | 'all';
const timeRangeOptions: { key: TimeRangeKey; label: string; days: number | null }[] = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'All', days: null },
];

interface RunPoint {
  runId: string;
  runAt: string;
  total: number;
  mentioned: number;
  byEngine: Record<string, { total: number; mentioned: number }>;
}

export const GeoReportModal: React.FC<GeoReportModalProps> = ({ onClose }) => {
  const [config, setConfig] = useState<GeoConfig | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('30d');

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

  // Results within the selected time window (KPIs, chart, and the results
  // log below all respect this filter).
  const filteredResults = useMemo(() => {
    const opt = timeRangeOptions.find((o) => o.key === timeRange);
    if (!opt || opt.days === null) return results;
    const cutoff = Date.now() - opt.days * 24 * 60 * 60 * 1000;
    return results.filter((r) => new Date(r.runAt).getTime() >= cutoff);
  }, [results, timeRange]);

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
    for (const r of filteredResults) {
      if (!byEngine[r.engine]) byEngine[r.engine] = { total: 0, mentioned: 0 };
      byEngine[r.engine].total += 1;
      if (r.mentioned) byEngine[r.engine].mentioned += 1;
    }
    const totalChecks = filteredResults.length;
    const totalMentions = filteredResults.filter((r) => r.mentioned).length;
    const overallRate = totalChecks > 0 ? Math.round((totalMentions / totalChecks) * 100) : 0;
    const lastRun = results.length > 0 ? results[0].runAt : null; // always show the true last run, unfiltered
    return { byEngine, totalChecks, totalMentions, overallRate, lastRun };
  }, [filteredResults, results]);

  // --- Trend: one point per run, within the selected time window ---
  const trend = useMemo<RunPoint[]>(() => {
    const byRun = new Map<string, RunPoint>();
    for (const r of filteredResults) {
      if (!byRun.has(r.runId)) {
        byRun.set(r.runId, { runId: r.runId, runAt: r.runAt, total: 0, mentioned: 0, byEngine: {} });
      }
      const entry = byRun.get(r.runId)!;
      entry.total += 1;
      if (r.mentioned) entry.mentioned += 1;
      if (!entry.byEngine[r.engine]) entry.byEngine[r.engine] = { total: 0, mentioned: 0 };
      entry.byEngine[r.engine].total += 1;
      if (r.mentioned) entry.byEngine[r.engine].mentioned += 1;
    }
    return Array.from(byRun.values()).sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());
  }, [filteredResults]);

  const engineKeysInTrend = useMemo(() => {
    const keys = new Set<string>();
    trend.forEach((t) => Object.keys(t.byEngine).forEach((k) => keys.add(k)));
    return Array.from(keys);
  }, [trend]);

  // --- Build SVG line-chart geometry for the trend above ---
  const chart = useMemo(() => {
    const width = 600;
    const height = 160;
    const padX = 8;
    const padY = 14;
    const n = trend.length;

    const xFor = (i: number) => (n <= 1 ? width / 2 : padX + (i * (width - padX * 2)) / (n - 1));
    const yFor = (rate: number) => height - padY - (rate / 100) * (height - padY * 2);

    const overallPoints = trend.map((t, i) => ({
      x: xFor(i),
      y: yFor(t.total > 0 ? (t.mentioned / t.total) * 100 : 0),
    }));
    const overallPath = overallPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const enginePaths = engineKeysInTrend.map((engine) => {
      const points = trend.map((t, i) => {
        const stat = t.byEngine[engine];
        const rate = stat && stat.total > 0 ? (stat.mentioned / stat.total) * 100 : null;
        return { x: xFor(i), rate };
      });
      const segments: string[] = [];
      let started = false;
      for (const p of points) {
        if (p.rate === null) {
          started = false;
          continue;
        }
        segments.push(`${started ? 'L' : 'M'}${p.x.toFixed(1)},${yFor(p.rate).toFixed(1)}`);
        started = true;
      }
      return { engine, path: segments.join(' ') };
    });

    return { width, height, overallPath, overallPoints, enginePaths };
  }, [trend, engineKeysInTrend]);

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

              {/* Trend chart with time-range filter */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-slate-300">Mention Rate Over Time</h3>
                  <div className="flex items-center gap-1">
                    {timeRangeOptions.map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setTimeRange(opt.key)}
                        className={`px-2 py-1 text-[10px] font-mono font-semibold rounded transition-colors ${
                          timeRange === opt.key
                            ? 'bg-orange-600 text-white'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {trend.length === 0 ? (
                  <div className="rounded-lg bg-slate-800/30 py-8 text-center text-xs text-slate-600 italic">
                    No runs in this time range yet.
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-800/30 p-3">
                    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="w-full h-40" preserveAspectRatio="none">
                      {/* Gridlines at 0/50/100% */}
                      {[0, 50, 100].map((pct) => {
                        const y = chart.height - 14 - (pct / 100) * (chart.height - 28);
                        return (
                          <g key={pct}>
                            <line x1={0} y1={y} x2={chart.width} y2={y} stroke="#1e293b" strokeWidth={1} />
                            <text x={2} y={y - 2} fontSize={9} fill="#475569" fontFamily="monospace">
                              {pct}%
                            </text>
                          </g>
                        );
                      })}

                      {/* Per-engine lines (thin) */}
                      {chart.enginePaths.map(({ engine, path }) =>
                        path ? (
                          <path
                            key={engine}
                            d={path}
                            fill="none"
                            stroke={engineColor[engine] || '#64748b'}
                            strokeWidth={1.5}
                            strokeOpacity={0.55}
                          />
                        ) : null
                      )}

                      {/* Overall mention-rate line (bold) */}
                      <path d={chart.overallPath} fill="none" stroke="#f97316" strokeWidth={2.5} />
                      {chart.overallPoints.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#f97316" />
                      ))}
                    </svg>

                    <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-slate-800/60">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-2.5 h-0.5 bg-orange-500 inline-block"></span>
                        <span className="text-slate-400">Overall</span>
                      </div>
                      {engineKeysInTrend.map((engine) => (
                        <div key={engine} className="flex items-center gap-1.5 text-[10px]">
                          <span
                            className="w-2.5 h-0.5 inline-block opacity-60"
                            style={{ backgroundColor: engineColor[engine] || '#64748b' }}
                          ></span>
                          <span className="text-slate-400">{engineLabel[engine] || engine}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

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
