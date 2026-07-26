import type { ArrangementInfo, ProjectState, ToneBlock } from '../types/music';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export interface ProcessingJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  step: string;
  progress: number;
  error?: string;
  project?: ProjectState;
  tones?: ToneBlock;
  stem_id?: string;
}

export async function checkBackend(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export interface OpenOptions {
  inputFile: File;
  outputDir: string;
  originalPath?: string;
}

export async function createOpenJob(options: OpenOptions): Promise<string> {
  const form = new FormData();
  form.append('input_file', options.inputFile);
  form.append('output_dir', options.outputDir);
  form.append('original_path', options.originalPath || '');
  const response = await fetch(`${API_BASE}/api/jobs/open`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}



export interface OpenLocalOptions {
  mode: 'sloppack' | 'psarc' | 'audio';
  outputDir: string;
}

export interface BatchConvertPsarcOptions {
  outputDir: string;
}

export async function getPreferredOutputDir(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/settings/output-dir`);
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { output_dir?: string };
  return String(data.output_dir ?? '').trim();
}

export async function setPreferredOutputDir(outputDir: string): Promise<string> {
  const form = new FormData();
  form.append('output_dir', outputDir);
  const response = await fetch(`${API_BASE}/api/settings/output-dir`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { output_dir?: string };
  return String(data.output_dir ?? '').trim();
}

export async function browseOutputDir(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/settings/output-dir/browse`, { method: 'POST' });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { output_dir?: string };
  return String(data.output_dir ?? '').trim();
}

export async function getPreferredOutputNamePattern(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/settings/output-name-pattern`);
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { pattern?: string };
  return String(data.pattern ?? '').trim();
}

export async function setPreferredOutputNamePattern(pattern: string): Promise<string> {
  const form = new FormData();
  form.append('pattern', pattern);
  const response = await fetch(`${API_BASE}/api/settings/output-name-pattern`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { pattern?: string };
  return String(data.pattern ?? '').trim();
}

export async function createOpenLocalJob(options: OpenLocalOptions): Promise<string> {
  const form = new FormData();
  form.append('mode', options.mode);
  form.append('output_dir', options.outputDir);
  const response = await fetch(`${API_BASE}/api/jobs/open-local`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function createBatchConvertPsarcLocalJob(options: BatchConvertPsarcOptions): Promise<string> {
  const form = new FormData();
  form.append('output_dir', options.outputDir);
  const response = await fetch(`${API_BASE}/api/jobs/batch-convert-psarc-local`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function createDemucsJob(projectId: string): Promise<string> {
  const form = new FormData();
  form.append('project_id', projectId);
  const response = await fetch(`${API_BASE}/api/jobs/demucs`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function getProcessingJob(jobId: string): Promise<ProcessingJob> {
  const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProcessingJob;
}

export async function loadArrangement(projectId: string, arrangementId: string): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/arrangements/${arrangementId}`);
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function saveProject(project: ProjectState): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${project.id}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function commitProject(project: ProjectState): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${project.id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function discardProject(project: ProjectState): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${project.id}/discard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export interface GpTrackInfo {
  index: number;
  name: string;
  strings: number;
  is_percussion: boolean;
  is_bass: boolean;
  instrument: number;
  notes: number;
}

export async function listGpTracks(file: File): Promise<GpTrackInfo[]> {
  const form = new FormData();
  form.append('gp_file', file);
  const response = await fetch(`${API_BASE}/api/tools/gp/tracks`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as GpTrackInfo[];
}

export async function importArrangement(
  projectId: string,
  file: File,
  instrument: 'guitar' | 'bass',
  name: string,
  gpTrackIndex?: number,
): Promise<ProjectState> {
  const form = new FormData();
  form.append('arrangement_file', file);
  form.append('instrument', instrument);
  form.append('name', name);
  if (Number.isFinite(gpTrackIndex) && (gpTrackIndex as number) >= 0) {
    form.append('gp_track_index', String(gpTrackIndex));
  }
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/arrangements/import`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function exportArrangement(project: ProjectState, arrangementId: string, format: 'midi' | 'musicxml'): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_BASE}/api/projects/${project.id}/arrangements/${arrangementId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, project })
  });
  if (!response.ok) throw new Error(await response.text());
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filename = decodeURIComponent(match?.[1] || match?.[2] || (format === 'midi' ? 'arrangement.mid' : 'arrangement.musicxml'));
  return { blob: await response.blob(), filename };
}

export async function uploadCoverArt(projectId: string, file: File): Promise<{ coverUrl: string; coverPath: string }> {
  const form = new FormData();
  form.append('cover_file', file);
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/cover`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as { coverUrl: string; coverPath: string };
}

export async function replaceArrangement(
  projectId: string,
  arrangementId: string,
  file: File,
  instrument: 'guitar' | 'bass',
  gpTrackIndex?: number,
): Promise<ProjectState> {
  const form = new FormData();
  form.append('arrangement_file', file);
  form.append('instrument', instrument);
  if (Number.isFinite(gpTrackIndex) && (gpTrackIndex as number) >= 0) {
    form.append('gp_track_index', String(gpTrackIndex));
  }
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/arrangements/${arrangementId}/replace`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function deleteArrangement(projectId: string, arrangementId: string): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/arrangements/${arrangementId}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function duplicateArrangement(
  projectId: string,
  arrangementId: string,
  name: string,
): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/arrangements/${arrangementId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function renameArrangement(
  projectId: string,
  arrangementId: string,
  name: string,
): Promise<ProjectState> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/arrangements/${arrangementId}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export async function createLyricsTranscriptionJob(projectId: string, stemId?: string, modelSize = 'medium', language = '', minWordScore = 0.35): Promise<string> {
  const response = await fetch(`${API_BASE}/api/jobs/lyrics/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      stem_id: stemId || null,
      model_size: modelSize,
      language: language.trim() || null,
      min_word_score: minWordScore
    })
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function createLyricsTextSyncJob(
  projectId: string,
  lyricsText: string,
  stemId?: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/jobs/lyrics/text-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      lyrics_text: lyricsText,
      stem_id: stemId || null,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function createStemArrangementJob(
  projectId: string,
  stemId: string,
  arrangementName: string,
  instrument: 'guitar' | 'bass' | 'keys' | 'drums',
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/jobs/stems/to-arrangement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      stem_id: stemId,
      arrangement_name: arrangementName,
      instrument: instrument,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function createStemToneJob(
  projectId: string,
  stemId: string,
  arrangementLabel: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/jobs/stems/to-tones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      stem_id: stemId,
      arrangement_label: arrangementLabel,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json() as { job_id: string };
  return data.job_id;
}

export async function importTextLyricsSync(projectId: string, textOrFile: string | File, stemId?: string): Promise<ProjectState> {
  const form = new FormData();
  if (typeof textOrFile === 'string') {
    form.append('lyrics_text', textOrFile);
  } else {
    form.append('lyrics_file', textOrFile);
  }
  form.append('stem_id', stemId || '');
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/lyrics/import-text-sync`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(await response.text());
  return await response.json() as ProjectState;
}

export function resolveAssetUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}
