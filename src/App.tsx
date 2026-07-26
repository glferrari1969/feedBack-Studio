import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { demoProject } from "./demo/demoProject";
import type {
  ArrangementInfo,
  MidiNote,
  ProjectState,
  StemTrack,
  SyncPoint,
  ToneBlock,
} from "./types/music";
import { useAnimationFrame } from "./hooks/useAnimationFrame";
import { MainActions } from "./components/MainActions";
import {
  createDemucsJob,
  createLyricsTranscriptionJob,
  createLyricsTextSyncJob,
  createStemArrangementJob,
  createStemToneJob,
  deleteArrangement,
  duplicateArrangement,
  getProcessingJob,
  commitProject,
  discardProject,
  importTextLyricsSync,
  loadArrangement,
  renameArrangement,
  resolveAssetUrl,
} from "./api/backend";
import "./styles.css";


const Transport = lazy(() =>
  import("./components/Transport").then((module) => ({ default: module.Transport })),
);
const WaveformView = lazy(() =>
  import("./components/WaveformView").then((module) => ({ default: module.WaveformView })),
);
const PianoRoll = lazy(() =>
  import("./components/PianoRoll").then((module) => ({ default: module.PianoRoll })),
);
const TabEditor = lazy(() =>
  import("./components/TabEditor").then((module) => ({ default: module.TabEditor })),
);
const ChordDiagram = lazy(() =>
  import("./components/ChordDiagram").then((module) => ({ default: module.ChordDiagram })),
);
const ArrangementSelector = lazy(() =>
  import("./components/ArrangementSelector").then((module) => ({ default: module.ArrangementSelector })),
);
const ArrangementTransferPanel = lazy(() =>
  import("./components/ArrangementTransferPanel").then((module) => ({ default: module.ArrangementTransferPanel })),
);
const AddArrangementPanel = lazy(() =>
  import("./components/AddArrangementPanel").then((module) => ({ default: module.AddArrangementPanel })),
);
const AudioSourceSelector = lazy(() =>
  import("./components/AudioSourceSelector").then((module) => ({ default: module.AudioSourceSelector })),
);
const AudioMixerPanel = lazy(() =>
  import("./components/AudioMixerPanel").then((module) => ({ default: module.AudioMixerPanel })),
);
const ZoomControls = lazy(() =>
  import("./components/ZoomControls").then((module) => ({ default: module.ZoomControls })),
);
const SongMetadataEditor = lazy(() =>
  import("./components/SongMetadataEditor").then((module) => ({ default: module.SongMetadataEditor })),
);
const LyricsEditor = lazy(() =>
  import("./components/LyricsEditor").then((module) => ({ default: module.LyricsEditor })),
);
const LyricsWaveformView = lazy(() =>
  import("./components/LyricsWaveformView").then((module) => ({ default: module.LyricsWaveformView })),
);
const ToneEditor = lazy(() =>
  import("./components/ToneEditor").then((module) => ({ default: module.ToneEditor })),
);
const ToneChainStrip = lazy(() =>
  import("./components/ToneChainStrip").then((module) => ({ default: module.ToneChainStrip })),
);

function LoadingPanel({ label = "Loading..." }: { label?: string }) {
  return <div className="panel lazyPanel"><span className="miniMeta">{label}</span></div>;
}

function inferArrangementKind(
  arrangement?: ArrangementInfo,
): "guitar" | "bass" | null {
  if (!arrangement) return null;
  if (arrangement.type === "guitar" || arrangement.type === "bass")
    return arrangement.type;
  const text =
    `${arrangement.id} ${arrangement.name} ${arrangement.file ?? ""}`.toLowerCase();
  if (text.includes("bass")) return "bass";
  if (
    ["lead", "rhythm", "combo", "guitar", "chitarra"].some((word) =>
      text.includes(word),
    )
  )
    return "guitar";
  if (arrangement.tuning?.length === 4 || arrangement.tuning?.length === 5)
    return "bass";
  if (arrangement.tuning?.length === 6 || arrangement.tuning?.length === 7)
    return "guitar";
  return null;
}

function preferredStemId(
  project: ProjectState,
  arrangement?: ArrangementInfo,
): string | undefined {
  const stems = project.stems.filter((stem) => Boolean(stem.url));
  if (!stems.length) return undefined;
  const full = stems.find(
    (stem) => stem.id === "full" || stem.name.toLowerCase().includes("full"),
  );
  if (full) return full.id;
  const arrangementKind = inferArrangementKind(arrangement);
  if (arrangementKind) {
    const matching = stems.find(
      (stem) => stem.kind === arrangementKind || stem.id === arrangementKind,
    );
    if (matching) return matching.id;
  }
  return (
    stems.find((stem) => stem.kind === "mix" || stem.kind === "full")?.id ??
    stems[0].id
  );
}

function isVocalStem(stem: StemTrack): boolean {
  const lowered = `${stem.id} ${stem.name}`.toLowerCase();
  return stem.kind === "vocals" || lowered.includes("vocal") || lowered.includes("voice");
}

function canGenerateArrangementFromStem(stem: StemTrack): boolean {
  return !isVocalStem(stem) && stem.kind !== "full" && stem.kind !== "mix";
}

function canGenerateTonesFromStem(stem: StemTrack): boolean {
  return (
    !isVocalStem(stem) &&
    stem.kind !== "full" &&
    stem.kind !== "mix" &&
    stem.kind !== "drums" &&
    stem.kind !== "piano"
  );
}

function inferArrangementInstrumentFromStem(
  stem: StemTrack,
): "bass" | "guitar" | "keys" | "drums" {
  const lowered = `${stem.id} ${stem.name}`.toLowerCase();
  if (stem.kind === "bass" || lowered.includes("bass")) return "bass";
  if (stem.kind === "drums" || lowered.includes("drum")) return "drums";
  if (
    stem.kind === "piano" ||
    lowered.includes("piano") ||
    lowered.includes("keys") ||
    lowered.includes("key") ||
    lowered.includes("synth")
  ) {
    return "keys";
  }
  return "guitar";
}

function isFullOggStem(stem: StemTrack): boolean {
  const normalizedUrl = String(stem.url ?? "").toLowerCase();
  const isFullStem =
    stem.id === "full" ||
    stem.kind === "full" ||
    stem.name.toLowerCase().includes("full");
  const isFullOgg = normalizedUrl.includes("full.ogg");
  return isFullStem && isFullOgg;
}

const CHORD_SELECTION_TOLERANCE = 0.02;

type MidiPreviewOscLayer = {
  type: OscillatorType;
  gain: number;
  detune?: number;
  octave?: number;
};

type MidiPreviewPreset = {
  label: string;
  layers: MidiPreviewOscLayer[];
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  highpass: number;
  lowpass: number;
  q: number;
  outputGain: number;
};

type ResolvedMidiPreset = {
  key: string;
  label: string;
  preset: MidiPreviewPreset;
};

const MIDI_PREVIEW_PRESETS: Record<string, MidiPreviewPreset> = {
  clean: {
    label: "Clean sine",
    layers: [{ type: "sine", gain: 1 }],
    attack: 0.005,
    decay: 0.08,
    sustain: 0.85,
    release: 0.06,
    highpass: 28,
    lowpass: 9000,
    q: 0.3,
    outputGain: 0.34,
  },
  piano: {
    label: "Soft piano",
    layers: [
      { type: "triangle", gain: 0.6 },
      { type: "sine", gain: 0.24, octave: 1 },
      { type: "square", gain: 0.16, detune: 4 },
    ],
    attack: 0.003,
    decay: 0.2,
    sustain: 0.32,
    release: 0.16,
    highpass: 60,
    lowpass: 4800,
    q: 0.8,
    outputGain: 0.45,
  },
  pluck: {
    label: "Guitar pluck",
    layers: [
      { type: "sawtooth", gain: 0.62 },
      { type: "triangle", gain: 0.24, octave: -1 },
      { type: "square", gain: 0.14, detune: -5 },
    ],
    attack: 0.002,
    decay: 0.12,
    sustain: 0.18,
    release: 0.08,
    highpass: 80,
    lowpass: 3200,
    q: 1.2,
    outputGain: 0.52,
  },
  lead: {
    label: "Bright lead",
    layers: [
      { type: "sawtooth", gain: 0.5 },
      { type: "square", gain: 0.32, detune: 6 },
      { type: "triangle", gain: 0.18, octave: 1 },
    ],
    attack: 0.004,
    decay: 0.1,
    sustain: 0.62,
    release: 0.11,
    highpass: 90,
    lowpass: 6000,
    q: 0.5,
    outputGain: 0.36,
  },
  pad: {
    label: "Warm pad",
    layers: [
      { type: "triangle", gain: 0.58 },
      { type: "sine", gain: 0.24, detune: -4 },
      { type: "sawtooth", gain: 0.18, detune: 4 },
    ],
    attack: 0.03,
    decay: 0.25,
    sustain: 0.75,
    release: 0.25,
    highpass: 40,
    lowpass: 2600,
    q: 0.7,
    outputGain: 0.32,
  },
  bass: {
    label: "Round bass",
    layers: [
      { type: "triangle", gain: 0.5, octave: -1 },
      { type: "sine", gain: 0.34 },
      { type: "square", gain: 0.16, detune: 2 },
    ],
    attack: 0.006,
    decay: 0.12,
    sustain: 0.5,
    release: 0.12,
    highpass: 24,
    lowpass: 1400,
    q: 0.9,
    outputGain: 0.5,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readToneName(definition: Record<string, unknown>, fallback: string) {
  const candidate =
    definition.Name ?? definition.name ?? definition.Key ?? definition.key;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function countKeywordHits(words: string[], keywords: string[]) {
  let score = 0;
  const compact = words.join(" ");
  keywords.forEach((keyword) => {
    if (keyword.includes(" ")) {
      if (compact.includes(keyword)) score += 1;
      return;
    }
    if (words.some((word) => word.includes(keyword))) score += 1;
  });
  return score;
}

function clampPreset(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getActiveToneNameAtTime(
  tones: ArrangementInfo["tones"],
  time: number,
): string {
  const definitions = Array.isArray(tones?.definitions)
    ? tones.definitions.filter(isRecord)
    : [];
  const fallback =
    (typeof tones?.base === "string" && tones.base.trim())
      ? tones.base.trim()
      : readToneName(definitions[0] ?? {}, "");

  const changes = Array.isArray(tones?.changes)
    ? tones.changes
        .map((change) => ({ t: Number(change.t), name: String(change.name ?? "").trim() }))
        .filter((change) => Number.isFinite(change.t) && change.name)
        .sort((a, b) => a.t - b.t)
    : [];

  let active = fallback;
  for (const change of changes) {
    if (change.t <= time + 0.001) active = change.name;
    else break;
  }
  return active;
}

function resolveActiveToneDefinition(
  tones: ArrangementInfo["tones"],
  time: number,
): Record<string, unknown> | null {
  const definitions = Array.isArray(tones?.definitions)
    ? tones.definitions.filter(isRecord)
    : [];
  if (!definitions.length) return null;

  const activeName = getActiveToneNameAtTime(tones, time);
  const byName = definitions.find(
    (definition, index) =>
      readToneName(definition, `tone_${index + 1}`).toLowerCase() ===
      activeName.toLowerCase(),
  );
  return byName ?? definitions[0];
}

function removeToneFromBlock(
  tones: ArrangementInfo["tones"],
  toneName: string,
): ArrangementInfo["tones"] {
  if (!tones) return tones;
  const target = toneName.trim().toLowerCase();
  if (!target) return tones;

  const definitions = Array.isArray(tones.definitions)
    ? tones.definitions.filter(
        (definition, index) =>
          !isRecord(definition) ||
          readToneName(definition, `Tone ${index + 1}`).trim().toLowerCase() !== target,
      )
    : [];
  const changes = Array.isArray(tones.changes)
    ? tones.changes.filter((change) => String(change.name ?? "").trim().toLowerCase() !== target)
    : [];
  const baseWasDeleted = String(tones.base ?? "").trim().toLowerCase() === target;
  const replacementBase = definitions.length && isRecord(definitions[0])
    ? readToneName(definitions[0], "Tone 1")
    : undefined;

  return {
    ...tones,
    base: baseWasDeleted ? replacementBase : tones.base,
    changes,
    definitions,
  };
}

function mergeGeneratedToneBlock(
  existing: ArrangementInfo["tones"],
  generated: ToneBlock,
): ToneBlock {
  const existingDefinitions = Array.isArray(existing?.definitions)
    ? existing.definitions.filter(isRecord)
    : [];
  const generatedDefinitions = Array.isArray(generated.definitions)
    ? generated.definitions.filter(isRecord)
    : [];
  const generatedNames = new Set(
    generatedDefinitions.map((definition, index) =>
      readToneName(definition, `Tone ${index + 1}`).trim().toLowerCase(),
    ),
  );
  const retainedDefinitions = existingDefinitions.filter(
    (definition, index) =>
      !generatedNames.has(readToneName(definition, `Tone ${index + 1}`).trim().toLowerCase()),
  );

  return {
    ...(existing ?? {}),
    ...generated,
    base: generated.base ?? existing?.base,
    changes: Array.isArray(generated.changes) ? generated.changes : (existing?.changes ?? []),
    definitions: [...retainedDefinitions, ...generatedDefinitions],
  };
}

function collectActiveToneWords(
  tones: ArrangementInfo["tones"],
  time: number,
): string[] {
  const definition = resolveActiveToneDefinition(tones, time);
  if (!definition) return [];

  const words: string[] = [];
  const pushWords = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    words.push(...normalizeWords(value));
  };

  pushWords(definition.Name);
  pushWords(definition.name);
  pushWords(definition.Key);
  pushWords(definition.key);

  const gearRaw = definition.GearList;
  const gearEntries = Array.isArray(gearRaw)
    ? gearRaw
    : isRecord(gearRaw)
      ? Object.values(gearRaw)
      : [];

  gearEntries.forEach((entry) => {
    if (isRecord(entry)) {
      pushWords(entry.Name);
      pushWords(entry.name);
      pushWords(entry.Type);
      pushWords(entry.type);
      pushWords(entry.Key);
      pushWords(entry.key);
      pushWords(entry.Slot);
      pushWords(entry.slot);
      pushWords(entry.Category);
      pushWords(entry.category);
      pushWords(entry.PedalType);
      pushWords(entry.pedalType);
      return;
    }
    pushWords(entry);
  });

  return words;
}

function resolveMidiPreviewPreset(
  presetKey: string,
  arrangementKind: "guitar" | "bass" | null,
  tones: ArrangementInfo["tones"],
  time: number,
): ResolvedMidiPreset {
  if (presetKey !== "auto") {
    const direct = MIDI_PREVIEW_PRESETS[presetKey] ?? MIDI_PREVIEW_PRESETS.pluck;
    return {
      key: presetKey,
      label: direct.label,
      preset: direct,
    };
  }

  const words = collectActiveToneWords(tones, time);
  const distortionScore = countKeywordHits(words, [
    "dist",
    "distortion",
    "fuzz",
    "drive",
    "overdrive",
    "metal",
    "lead",
    "solo",
    "high gain",
    "amp",
  ]);
  const ambientScore = countKeywordHits(words, [
    "reverb",
    "delay",
    "echo",
    "chorus",
    "flanger",
    "phaser",
    "mod",
    "ambient",
    "hall",
    "room",
  ]);
  const cleanScore = countKeywordHits(words, [
    "clean",
    "acoustic",
    "compressor",
    "comp",
    "sparkle",
    "bright clean",
  ]);
  const synthScore = countKeywordHits(words, [
    "synth",
    "keys",
    "keyboard",
    "piano",
    "organ",
    "ep",
  ]);
  const bassScore = countKeywordHits(words, [
    "bass",
    "sub",
    "octaver",
    "low",
    "deep",
  ]);

  let baseKey = arrangementKind === "bass" ? "bass" : "pluck";
  if (bassScore >= 1 || arrangementKind === "bass") baseKey = "bass";
  if (synthScore >= 2) baseKey = words.includes("piano") ? "piano" : "pad";
  if (cleanScore >= 2 && distortionScore <= 1) baseKey = "clean";
  if (ambientScore >= 3 && distortionScore <= 1) baseKey = "pad";
  if (distortionScore >= 3) baseKey = "lead";

  const base = MIDI_PREVIEW_PRESETS[baseKey] ?? MIDI_PREVIEW_PRESETS.pluck;
  const shaped: MidiPreviewPreset = {
    ...base,
    lowpass: clampPreset(
      base.lowpass + ambientScore * 420 - distortionScore * 260,
      900,
      10000,
    ),
    highpass: clampPreset(
      base.highpass + (arrangementKind === "bass" ? -20 : 12),
      20,
      240,
    ),
    sustain: clampPreset(
      base.sustain + ambientScore * 0.06 - distortionScore * 0.04,
      0.14,
      0.9,
    ),
    release: clampPreset(base.release + ambientScore * 0.03, 0.05, 0.5),
    outputGain: clampPreset(
      base.outputGain + distortionScore * 0.03,
      0.2,
      0.68,
    ),
  };

  return {
    key: `auto:${baseKey}`,
    label: `Auto -> ${base.label}`,
    preset: shaped,
  };
}

type ActiveMidiVoice = {
  oscillators: OscillatorNode[];
  nodes: AudioNode[];
};

export default function App() {
  const [project, setProject] = useState<ProjectState>(demoProject);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [lastFrame, setLastFrame] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [committing, setCommitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [deletingArrangement, setDeletingArrangement] = useState(false);
  const [duplicatingArrangement, setDuplicatingArrangement] = useState(false);
  const [renamingArrangement, setRenamingArrangement] = useState(false);
  const [demucsRunning, setDemucsRunning] = useState(false);
  const [demucsStep, setDemucsStep] = useState("");
  const [demucsProgress, setDemucsProgress] = useState(0);
  const [audioStemJobStemId, setAudioStemJobStemId] = useState<string | null>(null);
  const [audioStemJobStep, setAudioStemJobStep] = useState("");
  const [audioStemJobProgress, setAudioStemJobProgress] = useState(0);
  const [toneGenerationRunning, setToneGenerationRunning] = useState(false);
  const [toneGenerationStep, setToneGenerationStep] = useState("");
  const [toneGenerationProgress, setToneGenerationProgress] = useState(0);
  const [saveNotice, setSaveNotice] = useState<{
    title: string;
    message: string;
    detail?: string;
    kind: "working" | "original";
  } | null>(null);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
  const [selectedStemId, setSelectedStemId] = useState<string | undefined>(() =>
    preferredStemId(demoProject),
  );
  const [waveformZoom, setWaveformZoom] = useState(1.4);
  const [tabZoom, setTabZoom] = useState(1.4);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [selectedSyncPointId, setSelectedSyncPointId] = useState<string | null>(
    null,
  );
  type Page = "home" | "metadata" | "audio" | "arrangements" | "lyrics" | "tones";
  const [activePage, setActivePage] = useState<Page>("home");
  const previousPageRef = useRef<Page>("home");
  const [hasProjectLoaded, setHasProjectLoaded] = useState(false);
  const [lyricsZoom, setLyricsZoom] = useState(1.8);
  const [tonesZoom, setTonesZoom] = useState(1.8);
  const [selectedLyricId, setSelectedLyricId] = useState<string | null>(null);
  const [lyricsInputText, setLyricsInputText] = useState("");
  const [lyricsBusy, setLyricsBusy] = useState(false);
  const [lyricsStatus, setLyricsStatus] = useState("");
  const [lyricsProgress, setLyricsProgress] = useState(0);
  const [midiPreviewEnabled, setMidiPreviewEnabled] = useState(false);
  const [midiPreviewVolume, setMidiPreviewVolume] = useState(0.22);
  const [midiPreviewPreset, setMidiPreviewPreset] = useState("auto");
  const midiContextRef = useRef<AudioContext | null>(null);
  const midiMasterGainRef = useRef<GainNode | null>(null);
  const midiVoicesRef = useRef<ActiveMidiVoice[]>([]);
  const midiLastTimeRef = useRef<number | null>(null);
  const midiNoteIndexRef = useRef(0);

  const selectedArrangementId =
    project.selectedArrangementId ?? project.arrangements[0]?.id ?? "mix";
  const selectedArrangement = useMemo(() => {
    return project.arrangements.find(
      (arrangement) => arrangement.id === selectedArrangementId,
    );
  }, [project.arrangements, selectedArrangementId]);

  const editorKind = inferArrangementKind(selectedArrangement);

  const arrangementNotes = useMemo(
    () =>
      project.notes
        .filter((note) => note.trackId === selectedArrangementId)
        .sort((a, b) => a.start - b.start),
    [project.notes, selectedArrangementId],
  );

  const selectedStem = useMemo(() => {
    return (
      project.stems.find((stem) => stem.id === selectedStemId) ??
      project.stems.find((stem) => stem.id === "full") ??
      project.stems.find(
        (stem) => stem.kind === "mix" || stem.kind === "full",
      ) ??
      project.stems[0]
    );
  }, [project.stems, selectedStemId]);

  const selectedAudioUrl = resolveAssetUrl(selectedStem?.url);

  const stemsWithAudio = useMemo(
    () => project.stems.filter((stem) => Boolean(stem.url)),
    [project.stems],
  );

  const hasOnlyFullOggStem = useMemo(() => {
    if (stemsWithAudio.length !== 1) return false;
    const stem = stemsWithAudio[0];
    return isFullOggStem(stem);
  }, [stemsWithAudio]);

  useEffect(() => {
    setToneGenerationStep("");
    setToneGenerationProgress(0);
  }, [project.id]);

  const resolvedMidiPreset = useMemo(
    () =>
      resolveMidiPreviewPreset(
        midiPreviewPreset,
        editorKind,
        selectedArrangement?.tones,
        currentTime,
      ),
    [currentTime, editorKind, midiPreviewPreset, selectedArrangement?.tones],
  );

  useEffect(() => {
    if (
      selectedStemId &&
      project.stems.some((stem) => stem.id === selectedStemId)
    )
      return;
    setSelectedStemId(preferredStemId(project, selectedArrangement));
  }, [project, selectedArrangement, selectedStemId]);

  useEffect(() => {
    const previousPage = previousPageRef.current;
    const enteringLyrics = activePage === "lyrics" && previousPage !== "lyrics";
    if (enteringLyrics) {
      const vocalsStem =
        project.stems.find((stem) => isVocalStem(stem) && Boolean(stem.url)) ??
        project.stems.find((stem) => isVocalStem(stem));
      if (vocalsStem && vocalsStem.id !== selectedStemId) {
        setSelectedStemId(vocalsStem.id);
      }
    }
    previousPageRef.current = activePage;
  }, [activePage, project.stems, selectedStemId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    audio.playbackRate = playbackRate;
    setPlaying(false);
    setCurrentTime(0);
  }, [selectedAudioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const stopMidiVoices = () => {
    const activeVoices = midiVoicesRef.current;
    if (!activeVoices.length) return;
    activeVoices.forEach((voice) => {
      voice.oscillators.forEach((oscillator) => {
        try {
          oscillator.onended = null;
          oscillator.stop();
        } catch {
          // Voice may already be stopped.
        }
      });
      voice.oscillators.forEach((oscillator) => {
        try {
          oscillator.disconnect();
        } catch {
          // Ignore disconnect errors.
        }
      });
      voice.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Ignore disconnect errors.
        }
      });
    });
    midiVoicesRef.current = [];
  };

  const ensureMidiContext = async () => {
    let context = midiContextRef.current;
    if (!context) {
      context = new window.AudioContext();
      const masterGain = context.createGain();
      masterGain.gain.value = midiPreviewVolume;
      masterGain.connect(context.destination);
      midiContextRef.current = context;
      midiMasterGainRef.current = masterGain;
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    return context;
  };

  const playMidiPreviewNote = (note: MidiNote, playheadTime: number) => {
    const context = midiContextRef.current;
    const masterGain = midiMasterGainRef.current;
    if (!context || !masterGain) return;

    const preset = resolvedMidiPreset.preset;

    const elapsed = Math.max(0, playheadTime - note.start);
    const remaining = Math.max(0, note.duration - elapsed);
    if (remaining <= 0.005) return;

    const audibleDuration = Math.max(0.03, remaining / Math.max(playbackRate, 0.01));
    const velocity = Math.max(0.07, Math.min(1, (note.velocity || 96) / 127));
    const peakGain = velocity * preset.outputGain;
    const frequency = 440 * 2 ** ((note.pitch - 69) / 12);

    const mixGain = context.createGain();
    mixGain.gain.value = 1;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = preset.highpass;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = preset.lowpass;
    lowpass.Q.value = preset.q;
    const envelopeGain = context.createGain();

    const attackEnd = context.currentTime + preset.attack;
    const decayEnd = attackEnd + preset.decay;
    const releaseStart = Math.max(decayEnd + 0.005, context.currentTime + audibleDuration);
    const sustainGain = Math.max(0.0001, peakGain * preset.sustain);

    envelopeGain.gain.setValueAtTime(0.0001, context.currentTime);
    envelopeGain.gain.exponentialRampToValueAtTime(peakGain, attackEnd);
    envelopeGain.gain.linearRampToValueAtTime(sustainGain, decayEnd);
    envelopeGain.gain.setValueAtTime(sustainGain, releaseStart);
    envelopeGain.gain.exponentialRampToValueAtTime(
      0.0001,
      releaseStart + preset.release,
    );

    mixGain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(envelopeGain);
    envelopeGain.connect(masterGain);

    const oscillators: OscillatorNode[] = [];
    const nodes: AudioNode[] = [mixGain, highpass, lowpass, envelopeGain];
    const layers = preset.layers.length
      ? preset.layers
      : [{ type: "sine" as OscillatorType, gain: 1 }];

    layers.forEach((layer) => {
      const oscillator = context.createOscillator();
      oscillator.type = layer.type;
      oscillator.frequency.setValueAtTime(
        frequency * 2 ** (layer.octave ?? 0),
        context.currentTime,
      );
      oscillator.detune.setValueAtTime(layer.detune ?? 0, context.currentTime);

      const layerGain = context.createGain();
      layerGain.gain.value = Math.max(0, layer.gain);
      oscillator.connect(layerGain);
      layerGain.connect(mixGain);

      nodes.push(layerGain);
      oscillators.push(oscillator);
    });

    const voice: ActiveMidiVoice = { oscillators, nodes };
    midiVoicesRef.current.push(voice);

    const cleanup = () => {
      midiVoicesRef.current = midiVoicesRef.current.filter((item) => item !== voice);
      voice.oscillators.forEach((oscillator) => {
        try {
          oscillator.disconnect();
        } catch {
          // Ignore disconnect errors.
        }
      });
      voice.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Ignore disconnect errors.
        }
      });
    };

    if (oscillators.length) {
      oscillators[oscillators.length - 1].onended = cleanup;
    }

    oscillators.forEach((oscillator) => {
      oscillator.start(context.currentTime);
      oscillator.stop(releaseStart + preset.release + 0.01);
    });
  };

  const firstNoteIndexAtOrAfter = (time: number) => {
    let low = 0;
    let high = arrangementNotes.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (arrangementNotes[mid].start < time) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const toggleMidiPreview = async () => {
    const next = !midiPreviewEnabled;
    setMidiPreviewEnabled(next);
    if (!next) {
      stopMidiVoices();
      midiLastTimeRef.current = null;
      midiNoteIndexRef.current = 0;
      return;
    }
    try {
      await ensureMidiContext();
    } catch (error) {
      setMidiPreviewEnabled(false);
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    const masterGain = midiMasterGainRef.current;
    const context = midiContextRef.current;
    if (!masterGain || !context) return;
    masterGain.gain.setTargetAtTime(midiPreviewVolume, context.currentTime, 0.01);
  }, [midiPreviewVolume]);

  useEffect(() => {
    stopMidiVoices();
  }, [midiPreviewPreset]);

  useEffect(() => {
    if (activePage !== "arrangements" || !midiPreviewEnabled || !playing) {
      stopMidiVoices();
      midiLastTimeRef.current = null;
      midiNoteIndexRef.current = 0;
      return;
    }

    const previous = midiLastTimeRef.current;
    if (previous === null) {
      midiLastTimeRef.current = currentTime;
      midiNoteIndexRef.current = firstNoteIndexAtOrAfter(
        Math.max(0, currentTime - CHORD_SELECTION_TOLERANCE),
      );
      return;
    }

    const movedBackwards = currentTime < previous - 0.001;
    const jumpedForward = currentTime - previous > 0.35;
    if (movedBackwards || jumpedForward) {
      stopMidiVoices();
      midiLastTimeRef.current = currentTime;
      midiNoteIndexRef.current = firstNoteIndexAtOrAfter(
        Math.max(0, currentTime - CHORD_SELECTION_TOLERANCE),
      );
      return;
    }

    let noteIndex = midiNoteIndexRef.current;
    while (
      noteIndex < arrangementNotes.length &&
      arrangementNotes[noteIndex].start <= currentTime + 0.0005
    ) {
      const candidate = arrangementNotes[noteIndex];
      if (candidate.start > previous + 0.0005) {
        playMidiPreviewNote(candidate, currentTime);
      }
      noteIndex += 1;
    }

    midiNoteIndexRef.current = noteIndex;
    midiLastTimeRef.current = currentTime;
  }, [
    activePage,
    arrangementNotes,
    currentTime,
    midiPreviewEnabled,
    midiPreviewPreset,
    playing,
    playbackRate,
    resolvedMidiPreset,
  ]);

  useEffect(() => {
    return () => {
      stopMidiVoices();
      const context = midiContextRef.current;
      if (context) {
        void context.close();
      }
      midiContextRef.current = null;
      midiMasterGainRef.current = null;
    };
  }, []);

  const seekTo = (time: number) => {
    const next = Math.max(0, Math.min(project.duration, time));
    const audio = audioRef.current;
    if (audio && Number.isFinite(next)) {
      audio.currentTime = next;
    }
    setCurrentTime(next);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !selectedAudioUrl) {
      setPlaying((value) => !value);
      return;
    }
    try {
      if (playing) {
        audio.pause();
        setPlaying(false);
      } else {
        audio.currentTime = currentTime;
        audio.playbackRate = playbackRate;
        await audio.play();
        setPlaying(true);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      setPlaying(false);
    }
  };

  const loadProcessedProject = (nextProject: ProjectState, nextPage?: Page) => {
    const arrangement =
      nextProject.arrangements.find(
        (item) => item.id === nextProject.selectedArrangementId,
      ) ?? nextProject.arrangements[0];
    setProject({ ...nextProject, hasUncommittedChanges: Boolean(nextProject.hasUncommittedChanges) });
    setHasProjectLoaded(true);
    setHasUncommittedChanges(Boolean(nextProject.hasUncommittedChanges));
    setSelectedStemId(preferredStemId(nextProject, arrangement));
    setCurrentTime(0);
    setPlaying(false);
    if (nextPage) setActivePage(nextPage);
  };

  const selectArrangement = async (arrangementId: string) => {
    if (!arrangementId) return;
    try {
      const next = await loadArrangement(project.id, arrangementId);
      loadProcessedProject(next);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteCurrentArrangement = async () => {
    if (!selectedArrangementId) return;
    setDeletingArrangement(true);
    try {
      const next = await deleteArrangement(project.id, selectedArrangementId);
      loadProcessedProject(next);
      setHasUncommittedChanges(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingArrangement(false);
    }
  };

  const duplicateCurrentArrangement = async (name: string) => {
    if (!selectedArrangementId) return;
    setDuplicatingArrangement(true);
    try {
      const next = await duplicateArrangement(project.id, selectedArrangementId, name);
      loadProcessedProject(next);
      setHasUncommittedChanges(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setDuplicatingArrangement(false);
    }
  };

  const renameCurrentArrangement = async (name: string) => {
    if (!selectedArrangementId) return;
    setRenamingArrangement(true);
    try {
      const next = await renameArrangement(project.id, selectedArrangementId, name);
      loadProcessedProject(next);
      setHasUncommittedChanges(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamingArrangement(false);
    }
  };

  const stemFileName = (url?: string) => {
    if (!url) return "";
    const withoutQuery = url.split("?")[0];
    const parts = withoutQuery.split("/");
    return decodeURIComponent(parts[parts.length - 1] || withoutQuery);
  };

  const runDemucsForFullStem = async () => {
    if (!hasOnlyFullOggStem || demucsRunning) return;
    const confirmed = window.confirm(
      "Run Demucs on full.ogg to generate separated stems in the working copy?",
    );
    if (!confirmed) return;

    setDemucsRunning(true);
    setDemucsStep("Queued");
    setDemucsProgress(0);

    try {
      const jobId = await createDemucsJob(project.id);
      for (;;) {
        const job = await getProcessingJob(jobId);
        setDemucsStep(job.step || job.status);
        setDemucsProgress(job.progress || 0);

        if (job.status === "done") {
          if (job.project) {
            loadProcessedProject(job.project, "audio");
          }
          setDemucsStep("Demucs completed. Stems updated in working copy.");
          break;
        }

        if (job.status === "error") {
          throw new Error(job.error || job.step || "Demucs failed");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    } catch (error) {
      setDemucsStep("");
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setDemucsRunning(false);
    }
  };

  const runArrangementGenerationForStem = async (
    stem: StemTrack,
    options: { arrangementName: string; instrument: "bass" | "guitar" | "keys" | "drums" },
  ) => {
    if (audioStemJobStemId) return;
    if (isVocalStem(stem)) {
      alert("Use lyrics recognition for vocal stems.");
      return;
    }

    const cleanedName = options.arrangementName.trim();
    if (!cleanedName) {
      alert("Arrangement name is required.");
      return;
    }

    setAudioStemJobStemId(stem.id);
    setAudioStemJobStep("Queued");
    setAudioStemJobProgress(0);
    try {
      const jobId = await createStemArrangementJob(
        project.id,
        stem.id,
        cleanedName,
        options.instrument,
      );
      for (;;) {
        const job = await getProcessingJob(jobId);
        setAudioStemJobStep(job.step || job.status);
        setAudioStemJobProgress(job.progress || 0);

        if (job.status === "done") {
          if (job.project) {
            loadProcessedProject(job.project, "audio");
          }
          setAudioStemJobStep("Arrangement created from stem.");
          break;
        }

        if (job.status === "error") {
          throw new Error(job.error || job.step || "Stem arrangement generation failed");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    } catch (error) {
      setAudioStemJobStep("");
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setAudioStemJobStemId(null);
    }
  };

  const runLyricsRecognitionForStem = async (stem: StemTrack) => {
    if (audioStemJobStemId) return;
    setAudioStemJobStemId(stem.id);
    setAudioStemJobStep("Queued");
    setAudioStemJobProgress(0);
    try {
      const jobId = await createLyricsTranscriptionJob(project.id, stem.id);
      for (;;) {
        const job = await getProcessingJob(jobId);
        setAudioStemJobStep(job.step || job.status);
        setAudioStemJobProgress(job.progress || 0);

        if (job.status === "done") {
          if (job.project) {
            loadProcessedProject(job.project, "audio");
          }
          setAudioStemJobStep("Lyrics recognition + sync completed.");
          break;
        }

        if (job.status === "error") {
          throw new Error(job.error || job.step || "Lyrics recognition failed");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    } catch (error) {
      setAudioStemJobStep("");
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setAudioStemJobStemId(null);
    }
  };

  const runToneGenerationForSelectedStem = async () => {
    if (toneGenerationRunning) return;
    if (!selectedStem || !canGenerateTonesFromStem(selectedStem)) {
      alert("Select a guitar, bass, or compatible instrument stem first.");
      return;
    }
    if (!selectedArrangement) {
      alert("Select an arrangement before generating tones.");
      return;
    }

    const targetArrangementId = selectedArrangement.id;
    const targetArrangementName = selectedArrangement.name;
    const sourceStemName = selectedStem.name;

    setToneGenerationRunning(true);
    setToneGenerationStep("Queued");
    setToneGenerationProgress(0);
    try {
      const jobId = await createStemToneJob(
        project.id,
        selectedStem.id,
        selectedArrangement?.name ?? "Generated tones",
      );
      for (;;) {
        const job = await getProcessingJob(jobId);
        setToneGenerationStep(job.step || job.status);
        setToneGenerationProgress(job.progress || 0);

        if (job.status === "done") {
          if (!job.tones) throw new Error("Tone generation completed without tone data.");
          setProject((prev) => ({
            ...prev,
            hasUncommittedChanges: true,
            arrangements: prev.arrangements.map((arrangement) =>
              arrangement.id === targetArrangementId
                ? {
                    ...arrangement,
                    tones: mergeGeneratedToneBlock(arrangement.tones, job.tones as ToneBlock),
                  }
                : arrangement,
            ),
          }));
          setHasUncommittedChanges(true);
          setToneGenerationStep(
            `Tones identified from ${sourceStemName} and applied to ${targetArrangementName}. Existing tone definitions were preserved.`,
          );
          break;
        }
        if (job.status === "error") {
          throw new Error(job.error || job.step || "Tone generation failed");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    } catch (error) {
      setToneGenerationStep("");
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setToneGenerationRunning(false);
    }
  };

  const markProjectDirty = () => setHasUncommittedChanges(true);

  const showSaveNotice = (
    title: string,
    message: string,
    detail: string | undefined,
    kind: "working" | "original" = "working",
  ) => setSaveNotice({ title, message, detail, kind });

  const writeToOriginalSloppack = async () => {
    setCommitting(true);
    try {
      const committed = await commitProject({ ...project, hasUncommittedChanges: false });
      setProject(committed);
      setHasUncommittedChanges(false);
      showSaveNotice(
        "Original feedpak updated",
        "The current working copy was written to the original file on disk.",
        committed.sloppackPath ?? committed.originalSloppackPath,
        "original",
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitting(false);
    }
  };

  const discardWorkingChanges = async () => {
    if (!hasUncommittedChanges) return;
    const confirmed = window.confirm(
      "Discard all unsaved working-copy changes and reload the original feedpak from disk?",
    );
    if (!confirmed) return;

    setDiscarding(true);
    try {
      const restored = await discardProject(project);
      const arrangement =
        restored.arrangements.find((item) => item.id === restored.selectedArrangementId) ??
        restored.arrangements[0];
      setProject(restored);
      setHasUncommittedChanges(false);
      setSelectedStemId(preferredStemId(restored, arrangement));
      setCurrentTime(0);
      setPlaying(false);
      alert("Working-copy changes discarded. The project was reloaded from the original feedpak.");
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscarding(false);
    }
  };

  const syncLyricsText = async (textOrFile: string | File, status = "Creating initial lyric sync...") => {
    if (!project.id) return;
    setLyricsBusy(true);
    setLyricsStatus(status);
    setLyricsProgress(0);
    try {
      let updated: ProjectState;
      if (typeof textOrFile === "string") {
        const jobId = await createLyricsTextSyncJob(project.id, textOrFile, selectedStemId);
        for (;;) {
          const job = await getProcessingJob(jobId);
          setLyricsStatus(job.step || job.status);
          setLyricsProgress(job.progress || 0);
          if (job.status === "done") {
            if (!job.project) throw new Error("Lyrics sync completed without an updated project.");
            updated = job.project;
            break;
          }
          if (job.status === "error") {
            throw new Error(job.error || job.step || "Lyrics synchronization failed");
          }
          await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
      } else {
        updated = await importTextLyricsSync(project.id, textOrFile, selectedStemId);
        setLyricsProgress(100);
      }
      setProject({ ...updated, hasUncommittedChanges: true });
      setHasUncommittedChanges(true);
      setLyricsProgress(100);
      setLyricsStatus("Lyrics synchronization completed.");
    } catch (error) {
      setLyricsStatus("");
      setLyricsProgress(0);
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setLyricsBusy(false);
    }
  };

  const resyncCurrentLyrics = async () => {
    const rawLyrics = (project.lyrics ?? [])
      .map((lyric) => String(lyric.w ?? "").trim())
      .filter(Boolean);
    const hasExplicitLineMarkers = rawLyrics.some((text) => text.endsWith("+"));
    const hasCompleteLineEvents = rawLyrics.some((text) => /\s/.test(text));
    if (hasCompleteLineEvents && !hasExplicitLineMarkers) {
      const existingText = rawLyrics
        .map((text) => text.replace(/[+-]$/, "").trim())
        .join("\n");
      await syncLyricsText(existingText, "Re-syncing current lyrics against the selected audio...");
      return;
    }

    const reconstructedLines: string[] = [];
    let currentLine = "";
    let joinsNextToken = false;
    for (const lyric of project.lyrics ?? []) {
      const raw = String(lyric.w ?? "").trim();
      if (!raw) continue;
      const endsLine = raw.endsWith("+");
      const joinsNext = raw.endsWith("-");
      const word = endsLine || joinsNext ? raw.slice(0, -1).trim() : raw;
      if (word) currentLine += `${currentLine && !joinsNextToken ? " " : ""}${word}`;
      joinsNextToken = joinsNext;
      if (endsLine && currentLine) {
        reconstructedLines.push(currentLine);
        currentLine = "";
        joinsNextToken = false;
      }
    }
    if (currentLine) reconstructedLines.push(currentLine);
    const existingText = reconstructedLines.join("\n");
    if (!existingText) {
      alert("There are no lyrics to re-sync yet.");
      return;
    }
    await syncLyricsText(existingText, "Re-syncing current lyrics against the selected audio...");
  };

  useAnimationFrame((frameTime) => {
    if (!playing) {
      setLastFrame(null);
      return;
    }
    const audio = audioRef.current;
    if (audio && selectedAudioUrl) {
      setCurrentTime(Math.min(project.duration, audio.currentTime));
      if (audio.ended || audio.currentTime >= project.duration)
        setPlaying(false);
      return;
    }
    setLastFrame((previous) => {
      if (previous === null) return frameTime;
      const deltaSeconds = ((frameTime - previous) / 1000) * playbackRate;
      setCurrentTime((time) => {
        const next = Math.min(project.duration, time + deltaSeconds);
        if (next >= project.duration) setPlaying(false);
        return next;
      });
      return frameTime;
    });
  }, playing);

  const changeNote = (updatedNote: MidiNote) => {
    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      notes: prev.notes.map((note) =>
        note.id === updatedNote.id ? updatedNote : note,
      ),
    }));
  };

  const selectNote = (noteId: string) => {
    setProject((prev) => {
      const selected = prev.notes.find((note) => note.id === noteId);
      if (!selected) return prev;
      return {
        ...prev,
        notes: prev.notes.map((note) => ({
          ...note,
          selected:
            note.trackId === selected.trackId &&
            Math.abs(note.start - selected.start) <= CHORD_SELECTION_TOLERANCE,
        })),
      };
    });
  };

  const addNotes = (notes: MidiNote[]) => {
    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      notes: [
        ...prev.notes.map((note) => ({ ...note, selected: false })),
        ...notes.map((note, index) => ({ ...note, selected: index === 0 })),
      ],
    }));
  };

  const deleteNote = (noteId: string) => {
    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      notes: prev.notes.filter((note) => note.id !== noteId),
    }));
  };

  const changeSyncPoint = (updatedPoint: SyncPoint) => {
    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      syncPoints: prev.syncPoints
        .map((point) => (point.id === updatedPoint.id ? updatedPoint : point))
        .sort((a, b) => a.time - b.time),
    }));
  };

  const addSyncPointAt = (time = currentTime) => {
    const nextId = crypto.randomUUID();
    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      syncPoints: [
        ...prev.syncPoints,
        {
          id: nextId,
          bar: prev.syncPoints.length + 1,
          beat: 1,
          time: Number(Math.max(0, Math.min(prev.duration, time)).toFixed(3)),
        },
      ].sort((a, b) => a.time - b.time),
    }));
    setSelectedSyncPointId(nextId);
  };

  const changeLyrics = (lyrics: ProjectState["lyrics"], source = "user") => {
    markProjectDirty();
    setProject((prev) => ({ ...prev, lyrics, lyricsSource: source, hasUncommittedChanges: true }));
  };

  const changeArrangementTones = (tones: ArrangementInfo["tones"]) => {
    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      arrangements: prev.arrangements.map((arrangement) =>
        arrangement.id === selectedArrangementId
          ? { ...arrangement, tones }
          : arrangement,
      ),
    }));
  };

  const deleteTone = (toneName: string): boolean => {
    const target = toneName.trim().toLowerCase();
    if (!target) return false;

    const usage = project.arrangements.reduce(
      (summary, arrangement) => {
        const tones = arrangement.tones;
        const references =
          (String(tones?.base ?? "").trim().toLowerCase() === target ? 1 : 0) +
          (tones?.changes ?? []).filter(
            (change) => String(change.name ?? "").trim().toLowerCase() === target,
          ).length;
        return {
          references: summary.references + references,
          arrangements: summary.arrangements + (references > 0 ? 1 : 0),
        };
      },
      { references: 0, arrangements: 0 },
    );

    if (
      usage.references > 0 &&
      !window.confirm(
        `Tone "${toneName}" is used by ${usage.arrangements} arrangement${usage.arrangements === 1 ? "" : "s"} (${usage.references} reference${usage.references === 1 ? "" : "s"}). Delete it and remove every arrangement reference?`,
      )
    ) {
      return false;
    }

    markProjectDirty();
    setProject((prev) => ({
      ...prev,
      hasUncommittedChanges: true,
      arrangements: prev.arrangements.map((arrangement) => ({
        ...arrangement,
        tones: removeToneFromBlock(arrangement.tones, toneName),
      })),
    }));
    return true;
  };

  return (
    <main className="appShell cleanShell">
      <header className="appHeader cleanHeader">
        <div>
          <h1>feedBack Studio</h1>
          <p>
            Import, convert, edit, and synchronize feedpak projects.
          </p>
        </div>
        <nav className="pageMenu" aria-label="Main menu">
          <button
            type="button"
            className={activePage === "home" ? "primaryButton" : "secondaryButton"}
            aria-current={activePage === "home" ? "page" : undefined}
            onClick={() => setActivePage("home")}
          >
            Import / convert
          </button>
          <button
            type="button"
            className={activePage === "metadata" ? "primaryButton" : "secondaryButton"}
            aria-current={activePage === "metadata" ? "page" : undefined}
            onClick={() => setActivePage("metadata")}
            disabled={!hasProjectLoaded}
          >
            Metadata
          </button>
          <button
            type="button"
            className={activePage === "audio" ? "primaryButton" : "secondaryButton"}
            aria-current={activePage === "audio" ? "page" : undefined}
            onClick={() => setActivePage("audio")}
            disabled={!hasProjectLoaded}
          >
            Audio
          </button>
          <button
            type="button"
            className={activePage === "arrangements" ? "primaryButton" : "secondaryButton"}
            aria-current={activePage === "arrangements" ? "page" : undefined}
            onClick={() => setActivePage("arrangements")}
            disabled={!hasProjectLoaded}
          >
            Arrangements
          </button>
          <button
            type="button"
            className={activePage === "lyrics" ? "primaryButton" : "secondaryButton"}
            aria-current={activePage === "lyrics" ? "page" : undefined}
            onClick={() => setActivePage("lyrics")}
            disabled={!hasProjectLoaded}
          >
            Lyrics / karaoke
          </button>
          <button
            type="button"
            className={activePage === "tones" ? "primaryButton" : "secondaryButton"}
            aria-current={activePage === "tones" ? "page" : undefined}
            onClick={() => setActivePage("tones")}
            disabled={!hasProjectLoaded}
          >
            Tones
          </button>
        </nav>
      </header>

      {hasProjectLoaded ? (
        <section className="commitBar commitBarStandalone">
          <div>
            <strong>{hasUncommittedChanges ? "Working copy has changes" : "Original feedpak is up to date"}</strong>
            <span className="miniMeta">Write to original feedpak saves all current edits to the selected file on disk.</span>
          </div>
          <div className="commitActions">
            <button
              type="button"
              className={hasUncommittedChanges ? "dangerButton" : "secondaryButton"}
              onClick={writeToOriginalSloppack}
              disabled={!hasUncommittedChanges || committing || discarding}
              title={project.sloppackPath || project.originalSloppackPath || "Original feedpak target"}
            >
              {committing ? "Writing..." : "Write to original feedpak"}
            </button>
            <button
              type="button"
              className="secondaryButton"
              onClick={discardWorkingChanges}
              disabled={!hasUncommittedChanges || committing || discarding}
              title="Reload the selected original feedpak and remove all working-copy edits"
            >
              {discarding ? "Discarding..." : "Discard changes"}
            </button>
          </div>
        </section>
      ) : null}

      {saveNotice ? (
        <section
          className={`saveNotice ${saveNotice.kind === "original" ? "original" : "working"}`}
          role="status"
          aria-live="polite"
        >
          <div className="saveNoticeIcon" aria-hidden="true">✓</div>
          <div className="saveNoticeCopy">
            <strong>{saveNotice.title}</strong>
            <span>{saveNotice.message}</span>
            {saveNotice.detail ? <code>{saveNotice.detail}</code> : null}
          </div>
          <button
            type="button"
            className="iconButton saveNoticeClose"
            aria-label="Close save notification"
            onClick={() => setSaveNotice(null)}
          >
            ×
          </button>
        </section>
      ) : null}

      <Suspense fallback={<LoadingPanel label="Loading page..." />}>
      {activePage === "home" ? (
        <section className="landingPage">
          <div className="landingHero panel">
            <div className="landingCopy">
              <span className="eyebrow">feedBack Studio project setup</span>
              <h2>Open a feedpak or convert a song package</h2>
              <p>
                Start by opening an existing feedpak, converting a Rocksmith PSARC,
                or creating a new feedpak from an audio file. Once the project is
                ready, feedBack Studio will open the Metadata page first so you can review
                the song information before editing arrangements, tones, or lyrics.
              </p>
              <p className="warningText">
                Convert only Custom DLC that you personally own. Official Rocksmith DLC is
                Ubisoft property and is not permitted for conversion.
              </p>
            </div>
          </div>
          <MainActions
            project={project}
            onProjectReady={(nextProject) => loadProcessedProject(nextProject, "metadata")}
            hideSave
            landing
          />
        </section>
      ) : activePage === "metadata" ? (
        <section className="metadataPage panel">
          <div className="panelHeader">
            <div>
              <h2>Song metadata</h2>
              <span className="miniMeta">
                Edit only the song information stored in the feedpak manifest.
              </span>
            </div>
          </div>
          <Suspense fallback={<LoadingPanel label="Loading metadata editor..." />}>
            <SongMetadataEditor project={project} onChange={(nextProject) => { setProject({ ...nextProject, hasUncommittedChanges: true }); markProjectDirty(); }} />
          </Suspense>
        </section>
      ) : activePage === "audio" ? (
        <section className="audioPage panel">
          <div className="panelHeader withAction">
            <div>
              <h2>Audio</h2>
              <span className="miniMeta">
                List of stems in the current project and Demucs split from full.ogg.
              </span>
            </div>
          </div>

          <div className="audioPageGrid">
            <Suspense fallback={<LoadingPanel label="Loading audio mixer..." />}>
              <AudioMixerPanel
                stems={project.stems}
                duration={project.duration}
                bpm={project.bpm}
              />
            </Suspense>

            <section className="panel audioStemListPanel">
              <div className="panelHeader withAction">
                <span>Stems present</span>
                <span className="miniMeta">{stemsWithAudio.length} file</span>
              </div>
              {stemsWithAudio.length ? (
                <ul className="audioStemList">
                  {stemsWithAudio.map((stem) => {
                    const rowBusy = audioStemJobStemId === stem.id;
                    const rowHasDemucs = isFullOggStem(stem);
                    const rowCanRecognizeLyrics = isVocalStem(stem);
                    const rowCanGenerateArrangement = canGenerateArrangementFromStem(stem);
                    const actionsDisabled = Boolean(audioStemJobStemId);
                    return (
                      <li key={stem.id}>
                        <strong>{stem.name}</strong>
                        <span>{stem.kind}</span>
                        <em>{stemFileName(stem.url)}</em>
                        {rowHasDemucs || rowCanRecognizeLyrics || rowCanGenerateArrangement ? (
                          <div className="audioStemListActions">
                            {rowHasDemucs ? (
                              <button
                                type="button"
                                className="primaryButton"
                                disabled={!hasOnlyFullOggStem || demucsRunning}
                                onClick={() => {
                                  void runDemucsForFullStem();
                                }}
                                title={
                                  hasOnlyFullOggStem
                                    ? "Run Demucs on full.ogg"
                                    : "Demucs is available only when the project contains only full.ogg"
                                }
                              >
                                {demucsRunning ? "Demucs running..." : "Demucs"}
                              </button>
                            ) : null}
                            {rowCanGenerateArrangement ? (
                              <button
                                type="button"
                                className="primaryButton"
                                disabled={actionsDisabled}
                                onClick={() => {
                                  void runArrangementGenerationForStem(stem, {
                                    arrangementName: `${stem.name} auto`,
                                    instrument: inferArrangementInstrumentFromStem(stem),
                                  });
                                }}
                              >
                                {rowBusy ? audioStemJobStep || "Processing..." : "Generate arrangment"}
                              </button>
                            ) : null}
                            {rowCanRecognizeLyrics ? (
                              <button
                                type="button"
                                className="primaryButton"
                                disabled={actionsDisabled}
                                onClick={() => {
                                  void runLyricsRecognitionForStem(stem);
                                }}
                              >
                                {rowBusy ? audioStemJobStep || "Processing..." : "Recognize lyrics"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hint slimHint">No playable audio stems in this project.</p>
              )}

              {hasOnlyFullOggStem ? (
                <p className="hint slimHint">
                  Only full.ogg is available. You can run Demucs to generate separated stems.
                </p>
              ) : (
                <p className="hint slimHint">
                  Demucs is enabled only when the stem list contains only full.ogg.
                </p>
              )}

              {demucsStep ? (
                <div className="jobBox compactJob">
                  <div className="jobTopLine">
                    <strong>{demucsStep}</strong>
                    <span>{demucsProgress}%</span>
                  </div>
                  <div className="progressTrack">
                    <div className="progressFill" style={{ width: `${demucsProgress}%` }} />
                  </div>
                </div>
              ) : null}
              {audioStemJobStep ? (
                <div className="jobBox compactJob">
                  <div className="jobTopLine">
                    <strong>{audioStemJobStep}</strong>
                    <span>{audioStemJobProgress}%</span>
                  </div>
                  <div className="progressTrack">
                    <div className="progressFill" style={{ width: `${audioStemJobProgress}%` }} />
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </section>
      ) : activePage === "lyrics" ? (
        <section className="lyricsPage panel">
          <div className="panelHeader">
            <div>
              <h2>Lyrics / karaoke</h2>
              <span className="miniMeta">
                Edit synchronized lyric events with an audio waveform and draggable markers.
              </span>
            </div>
          </div>

          <audio
            ref={audioRef}
            src={selectedAudioUrl}
            preload="metadata"
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />

          <Transport
            playing={playing}
            currentTime={currentTime}
            duration={project.duration}
            bpm={project.bpm}
            onPlayPause={togglePlayback}
            onSeek={seekTo}
            playbackRate={playbackRate}
            onPlaybackRateChange={setPlaybackRate}
          />

          <div className="lyricsPageGrid">
            <aside className="lyricsSideRail">
              <AudioSourceSelector
                stems={project.stems}
                selectedStemId={selectedStem?.id}
                onSelectStem={setSelectedStemId}
              />
              <div className="panel lyricsImportPanel">
                <div className="panelHeader">
                  <span>Lyrics import / auto-sync</span>
                </div>
                <textarea
                  className="lyricsTextBox"
                  placeholder="Paste lyrics here, then create an initial sync..."
                  value={lyricsInputText}
                  onChange={(event) => setLyricsInputText(event.target.value)}
                />
                <div className="stackedButtonRow">
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={lyricsBusy || !lyricsInputText.trim()}
                    onClick={() => syncLyricsText(lyricsInputText)}
                  >
                    Auto-sync pasted text
                  </button>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={lyricsBusy || !(project.lyrics?.length)}
                    onClick={resyncCurrentLyrics}
                  >
                    Re-sync current lyrics
                  </button>
                  <label className={`secondaryButton fileButton ${lyricsBusy ? "disabled" : ""}`}>
                    Import TXT/LRC
                    <input
                      type="file"
                      accept=".txt,.lrc,text/plain"
                      disabled={lyricsBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void syncLyricsText(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                {lyricsStatus ? (
                  <div className="jobBox compactJob lyricsSyncJob">
                    <div className="jobTopLine">
                      <strong>{lyricsStatus}</strong>
                      <span>{Math.round(lyricsProgress)}%</span>
                    </div>
                    <div className="progressTrack">
                      <div className="progressFill" style={{ width: `${lyricsProgress}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="panel karaokeHelpPanel">
                <div className="panelHeader">
                  <span>Karaoke workflow</span>
                </div>
                <ol className="compactHelpList">
                  <li>Choose the audio source, preferably <strong>vocals.ogg</strong> when available, otherwise <strong>full.ogg</strong>.</li>
                  <li>Use text auto-sync, TXT/LRC import, or re-sync current lyrics to create/correct a first draft.</li>
                  <li>Double-click the waveform to add a lyric marker.</li>
                  <li>Drag a marker to adjust its time.</li>
                  <li>Edit text and duration in the lyric table.</li>
                  <li>Use <strong>Write to original feedpak</strong> to save the finished karaoke track with the rest of the project.</li>
                </ol>
              </div>
            </aside>
            <section className="lyricsMainPane">
              <Suspense fallback={<LoadingPanel label="Loading lyrics tools..." />}>
                <LyricsWaveformView
                duration={project.duration}
                currentTime={currentTime}
                selectedStemName={selectedStem?.name ?? "Audio"}
                selectedStemUrl={selectedStem?.url}
                zoom={lyricsZoom}
                playing={playing}
                lyrics={project.lyrics}
                lyricsSource={project.lyricsSource}
                selectedLyricId={selectedLyricId}
                onSelectLyric={setSelectedLyricId}
                onChangeLyrics={changeLyrics}
                onSeek={seekTo}
                headerControl={
                  <ZoomControls
                    label="Zoom"
                    zoom={lyricsZoom}
                    onZoomChange={setLyricsZoom}
                    min={0.6}
                    max={14}
                  />
                }
              />
              <LyricsEditor
                lyrics={project.lyrics}
                lyricsSource={project.lyricsSource}
                currentTime={currentTime}
                duration={project.duration}
                selectedLyricId={selectedLyricId}
                onSelectLyric={setSelectedLyricId}
                onChange={changeLyrics}
                onSeek={seekTo}
              />
              </Suspense>
            </section>
          </div>
        </section>
      ) : activePage === "tones" ? (
        <section className="tonesPage panel">
          <div className="panelHeader">
            <div>
              <h2>Tones</h2>
              <span className="miniMeta">
                Edit the tone changes, effect chains, parameters, and raw sloppack tone JSON for the selected arrangement.
              </span>
            </div>
          </div>

          <audio
            ref={audioRef}
            src={selectedAudioUrl}
            preload="metadata"
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />

          <div className="tonesPageGrid">
            <aside className="tonesSideRail">
              <ArrangementSelector
                arrangements={project.arrangements}
                selectedId={selectedArrangementId}
                onSelect={selectArrangement}
                onDeleteCurrent={deleteCurrentArrangement}
                onDuplicateCurrent={duplicateCurrentArrangement}
                onRenameCurrent={renameCurrentArrangement}
                deleting={deletingArrangement}
                duplicating={duplicatingArrangement}
                renaming={renamingArrangement}
              />
              <AudioSourceSelector
                stems={project.stems}
                selectedStemId={selectedStem?.id}
                onSelectStem={setSelectedStemId}
              />
              <div className="panel toneGenerationPanel">
                <div className="panelHeader">
                  <span>Automatic tone generation</span>
                </div>
                <div className="toneGenerationBody">
                  <button
                    type="button"
                    className="primaryButton"
                    onClick={() => void runToneGenerationForSelectedStem()}
                    disabled={
                      toneGenerationRunning ||
                      !selectedStem ||
                      !canGenerateTonesFromStem(selectedStem)
                    }
                  >
                    {toneGenerationRunning
                      ? `Generating tones ${Math.round(toneGenerationProgress)}%`
                      : "Generate tones from selected stem"}
                  </button>
                  {toneGenerationStep ? (
                    <div className="toneGenerationStatus">
                      <span>{toneGenerationStep}</span>
                    </div>
                  ) : (
                    <span className="miniMeta">
                      Identifies tones from the stem and applies them to the selected arrangement while preserving existing tone definitions.
                    </span>
                  )}
                </div>
              </div>
            </aside>
            <section className="tonesMainPane">
              <Suspense fallback={<LoadingPanel label="Loading tone editor..." />}>
                <ToneEditor
                tones={selectedArrangement?.tones}
                duration={project.duration}
                currentTime={currentTime}
                onChange={changeArrangementTones}
                onSeek={seekTo}
                selectedStemName={selectedStem?.name ?? "Audio"}
                selectedStemUrl={selectedStem?.url}
                waveformZoom={tonesZoom}
                onWaveformZoomChange={setTonesZoom}
                playing={playing}
                onPlayPause={togglePlayback}
              />
              </Suspense>
              <Suspense fallback={<LoadingPanel label="Loading tone chain..." />}>
                <ToneChainStrip
                tones={selectedArrangement?.tones}
                onChange={changeArrangementTones}
                onDeleteTone={deleteTone}
                />
              </Suspense>
            </section>
          </div>
        </section>
      ) : activePage === "arrangements" ? (
        <>
          <audio
            ref={audioRef}
            src={selectedAudioUrl}
            preload="metadata"
            onLoadedMetadata={(event) => {
              if (!project.duration && event.currentTarget.duration) {
                setCurrentTime(0);
              }
            }}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />

          <Transport
            playing={playing}
            currentTime={currentTime}
            duration={project.duration}
            bpm={project.bpm}
            onPlayPause={togglePlayback}
            onSeek={seekTo}
            playbackRate={playbackRate}
            onPlaybackRateChange={setPlaybackRate}
          />

          <section className="panel midiPreviewBar">
            <label className="midiPreviewToggle">
              <input
                type="checkbox"
                checked={midiPreviewEnabled}
                onChange={() => {
                  void toggleMidiPreview();
                }}
              />
              MIDI preview (Tab sync check)
            </label>
            <label className="midiPreviewToneControl">
              Timbro
              <select
                value={midiPreviewPreset}
                onChange={(event) => setMidiPreviewPreset(event.target.value)}
              >
                <option value="auto">Auto (arrangement + FX chain)</option>
                {Object.entries(MIDI_PREVIEW_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="midiPreviewVolumeControl">
              Volume MIDI
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={midiPreviewVolume}
                onChange={(event) =>
                  setMidiPreviewVolume(Number(event.target.value))
                }
              />
              <span>{Math.round(midiPreviewVolume * 100)}%</span>
            </label>
            <span className="miniMeta">
              Play + MIDI preview: senti audio e tab insieme per verificare il sync. Timbro attivo: {resolvedMidiPreset.label}.
            </span>
          </section>

          <div className="editorGrid">
            <aside className="sidePanel">
              <AudioSourceSelector
                stems={project.stems}
                selectedStemId={selectedStem?.id}
                onSelectStem={setSelectedStemId}
              />
              <ArrangementSelector
                arrangements={project.arrangements}
                selectedId={selectedArrangementId}
                onSelect={selectArrangement}
                onDeleteCurrent={deleteCurrentArrangement}
                onDuplicateCurrent={duplicateCurrentArrangement}
                onRenameCurrent={renameCurrentArrangement}
                deleting={deletingArrangement}
                duplicating={duplicatingArrangement}
                renaming={renamingArrangement}
              />
              <ArrangementTransferPanel
                project={project}
                arrangement={selectedArrangement}
                onProjectReady={loadProcessedProject}
              />
              <AddArrangementPanel
                project={project}
                onProjectReady={loadProcessedProject}
              />
            </aside>

            <section className="mainEditor">
              <WaveformView
                duration={project.duration}
                currentTime={currentTime}
                bpm={project.bpm}
                beatsPerBar={project.meter[0]}
                beatgrid={project.beatgrid}
                tempoMap={project.tempoMap}
                selectedStemName={selectedStem?.name ?? "Audio"}
                selectedStemUrl={selectedStem?.url}
                zoom={waveformZoom}
                playing={playing}
                syncPoints={project.syncPoints}
                selectedSyncPointId={selectedSyncPointId}
                onSeek={seekTo}
                onSelectSyncPoint={setSelectedSyncPointId}
                onChangeSyncPoint={changeSyncPoint}
                onAddSyncPointAt={addSyncPointAt}
                headerControl={
                  <ZoomControls
                    label="Zoom"
                    zoom={waveformZoom}
                    onZoomChange={setWaveformZoom}
                  />
                }
              />
              {editorKind ? (
                <>
                  <TabEditor
                    notes={project.notes}
                    selectedTrackId={selectedArrangementId}
                    arrangementKind={editorKind}
                    duration={project.duration}
                    currentTime={currentTime}
                    tuning={selectedArrangement?.tuning}
                    zoom={tabZoom}
                    syncPoints={project.syncPoints}
                    tones={selectedArrangement?.tones}
                    selectedSyncPointId={selectedSyncPointId}
                    onSelectSyncPoint={setSelectedSyncPointId}
                    onChangeSyncPoint={changeSyncPoint}
                    onAddSyncPointAt={addSyncPointAt}
                    onChangeNote={changeNote}
                    onSelectNote={selectNote}
                    onAddNotes={addNotes}
                    onDeleteNote={deleteNote}
                    onSeek={seekTo}
                    headerControl={
                      <ZoomControls
                        label="Zoom"
                        zoom={tabZoom}
                        onZoomChange={setTabZoom}
                      />
                    }
                    chordDiagram={
                      <ChordDiagram
                        notes={project.notes}
                        arrangement={selectedArrangement}
                        arrangementKind={editorKind}
                        selectedTrackId={selectedArrangementId}
                        currentTime={currentTime}
                      />
                    }
                  />
                </>
              ) : (
                <PianoRoll
                  notes={project.notes}
                  selectedTrackId={selectedArrangementId}
                  duration={project.duration}
                  currentTime={currentTime}
                  zoom={tabZoom}
                  onChangeNote={changeNote}
                  onSelectNote={selectNote}
                  headerControl={
                    <ZoomControls
                      label="Zoom"
                      zoom={tabZoom}
                      onZoomChange={setTabZoom}
                    />
                  }
                />
              )}
            </section>
          </div>
        </>
      ) : null}
      </Suspense>
    </main>
  );
}
