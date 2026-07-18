import { useEffect, useMemo, useRef, useState } from "react";
import { resolveAssetUrl } from "../api/backend";
import { useAnimationFrame } from "../hooks/useAnimationFrame";
import type { StemTrack } from "../types/music";
import { Transport } from "./Transport";

interface AudioMixerPanelProps {
  stems: StemTrack[];
  duration: number;
  bpm: number;
}

type PlayableStem = StemTrack & {
  resolvedUrl: string;
};

const MIXABLE_STEM_KINDS = new Set([
  "vocals",
  "drums",
  "bass",
  "guitar",
  "piano",
  "other",
]);

export function AudioMixerPanel({
  stems,
  duration,
  bpm,
}: AudioMixerPanelProps) {
  const playableStems = useMemo<PlayableStem[]>(() => {
    return stems
      .map((stem) => ({
        ...stem,
        resolvedUrl: resolveAssetUrl(stem.url) || "",
      }))
      .filter((stem) => Boolean(stem.resolvedUrl));
  }, [stems]);

  const hasDemucsLikeStems = useMemo(() => {
    return (
      playableStems.length > 1 &&
      playableStems.some((stem) => MIXABLE_STEM_KINDS.has(stem.kind))
    );
  }, [playableStems]);

  const [masterStemId, setMasterStemId] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [mutedStemIds, setMutedStemIds] = useState<string[]>([]);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  const playableSignature = useMemo(
    () => playableStems.map((stem) => `${stem.id}:${stem.resolvedUrl}`).join("|"),
    [playableStems],
  );

  useEffect(() => {
    if (!playableStems.length) {
      setMasterStemId("");
      return;
    }
    if (playableStems.some((stem) => stem.id === masterStemId)) return;
    const preferred =
      playableStems.find((stem) => stem.id === "full" || stem.kind === "full") ||
      playableStems[0];
    setMasterStemId(preferred.id);
  }, [masterStemId, playableStems]);

  useEffect(() => {
    setMutedStemIds((previous) =>
      previous.filter((id) => playableStems.some((stem) => stem.id === id)),
    );
  }, [playableStems]);

  useEffect(() => {
    for (const stem of playableStems) {
      const audio = audioRefs.current[stem.id];
      if (!audio) continue;
      audio.playbackRate = playbackRate;
    }
  }, [playableStems, playbackRate]);

  useEffect(() => {
    for (const stem of playableStems) {
      const audio = audioRefs.current[stem.id];
      if (!audio) continue;
      audio.volume = mutedStemIds.includes(stem.id) ? 0 : 1;
    }
  }, [mutedStemIds, playableStems]);

  useEffect(() => {
    for (const stem of playableStems) {
      const audio = audioRefs.current[stem.id];
      if (!audio) continue;
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setCurrentTime(0);
  }, [playableSignature]);

  useEffect(() => {
    return () => {
      for (const stem of playableStems) {
        const audio = audioRefs.current[stem.id];
        if (!audio) continue;
        audio.pause();
      }
    };
  }, [playableStems]);

  const pauseAll = () => {
    for (const stem of playableStems) {
      const audio = audioRefs.current[stem.id];
      if (!audio) continue;
      audio.pause();
    }
  };

  const seekAll = (time: number) => {
    const clamped = Math.max(0, Math.min(safeDuration, time));
    for (const stem of playableStems) {
      const audio = audioRefs.current[stem.id];
      if (!audio) continue;
      try {
        audio.currentTime = clamped;
      } catch {
        // Ignore seek errors from partially loaded media.
      }
    }
    setCurrentTime(clamped);
  };

  const togglePlayPause = async () => {
    if (!playableStems.length) return;

    if (playing) {
      pauseAll();
      setPlaying(false);
      return;
    }

    for (const stem of playableStems) {
      const audio = audioRefs.current[stem.id];
      if (!audio) continue;
      audio.playbackRate = playbackRate;
      audio.volume = mutedStemIds.includes(stem.id) ? 0 : 1;
      try {
        audio.currentTime = currentTime;
      } catch {
        // Ignore seek errors from partially loaded media.
      }
    }

    const results = await Promise.all(
      playableStems.map(async (stem) => {
        const audio = audioRefs.current[stem.id];
        if (!audio) return false;
        try {
          await audio.play();
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (results.some(Boolean)) {
      setPlaying(true);
    }
  };

  const toggleStemMute = (stemId: string) => {
    setMutedStemIds((previous) =>
      previous.includes(stemId)
        ? previous.filter((id) => id !== stemId)
        : [...previous, stemId],
    );
  };

  const safeDuration = Math.max(1, Number.isFinite(duration) ? duration : 1);

  useAnimationFrame(() => {
    if (!playing) return;
    const masterAudio =
      audioRefs.current[masterStemId] ??
      (playableStems.length ? audioRefs.current[playableStems[0].id] : null);
    if (!masterAudio) return;

    const nextTime = Number.isFinite(masterAudio.currentTime)
      ? Math.max(0, Math.min(safeDuration, masterAudio.currentTime))
      : 0;
    setCurrentTime(nextTime);

    if (masterAudio.ended) {
      pauseAll();
      setPlaying(false);
    }
  }, playing);

  if (!playableStems.length) {
    return (
      <section className="panel audioMixerPanel">
        <div className="panelHeader withAction">
          <span>Audio player / mixer</span>
        </div>
        <p className="hint slimHint">No playable stems available yet.</p>
      </section>
    );
  }

  return (
    <section className="panel audioMixerPanel">
      <div className="panelHeader withAction">
        <span>Audio player / mixer</span>
        <span className="miniMeta">
          {hasDemucsLikeStems
            ? "Demucs stems detected"
            : "Single or non-separated stem set"}
        </span>
      </div>

      <div className="audioMixerBody">
        <Transport
          playing={playing}
          currentTime={currentTime}
          duration={safeDuration}
          onPlayPause={() => {
            void togglePlayPause();
          }}
          onSeek={seekAll}
          bpm={bpm}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
        />

        {hasDemucsLikeStems ? (
          <div className="audioMixerGrid">
            {playableStems.map((stem) => {
              const muted = mutedStemIds.includes(stem.id);
              return (
                <div className="audioMixerRow" key={stem.id}>
                  <div className="audioMixerRowInfo">
                    <strong>{stem.name}</strong>
                    <span>{stem.kind}</span>
                  </div>
                  <div className="audioMixerRowActions">
                    <button
                      type="button"
                      className={muted ? "dangerButton" : "secondaryButton"}
                      onClick={() => toggleStemMute(stem.id)}
                    >
                      {muted ? "Muted" : "Mute"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="hint slimHint">
            Mixer mute controls are enabled when Demucs stems are available.
          </p>
        )}
      </div>

      <div className="audioMixerHidden" aria-hidden="true">
        {playableStems.map((stem) => (
          <audio
            key={stem.id}
            preload="auto"
            src={stem.resolvedUrl}
            ref={(element) => {
              audioRefs.current[stem.id] = element;
            }}
          />
        ))}
      </div>
    </section>
  );
}
