import { GeoConfig, GeoResult } from '../types';

export async function fetchGeoConfig(): Promise<GeoConfig> {
  const res = await fetch('/api/geo/config', { credentials: 'include' });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to load GEO config.');
  return { brand: data.brand, engines: data.engines };
}

export async function fetchGeoPrompts(): Promise<string[]> {
  const res = await fetch('/api/geo/prompts', { credentials: 'include' });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to load prompts.');
  return data.prompts;
}

export async function saveGeoPrompts(prompts: string[]): Promise<void> {
  const res = await fetch('/api/geo/prompts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prompts),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to save prompts.');
}

export async function fetchGeoResults(): Promise<GeoResult[]> {
  const res = await fetch('/api/geo/results', { credentials: 'include' });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to load results.');
  return data.results;
}

export async function runGeoCheck(): Promise<{ resultsAdded: number; results: GeoResult[] }> {
  const res = await fetch('/api/geo/run', { method: 'POST', credentials: 'include' });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Failed to run GEO check.');
  return { resultsAdded: data.resultsAdded, results: data.results };
}
