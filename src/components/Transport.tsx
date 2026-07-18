import { Pause, Play, SkipBack } from 'lucide-react';

interface TransportProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  bpm: number;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${mins}:${secs}.${ms}`;
};

export function Transport({ playing, currentTime, duration, onPlayPause, onSeek, bpm, playbackRate, onPlaybackRateChange }: TransportProps) {
  return (
    <section className="transport panel">
      <button className="iconButton" onClick={() => onSeek(0)} aria-label="Return to start">
        <SkipBack size={18} />
      </button>
      <button className="primaryButton" onClick={onPlayPause}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        className="transportSlider"
        type="range"
        min={0}
        max={duration}
        step={0.01}
        value={currentTime}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <span className="timeReadout">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <label className="speedControl">
        Speed
        <select value={playbackRate} onChange={(event) => onPlaybackRateChange(Number(event.target.value))}>
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </label>
      <span className="badge">{bpm} BPM</span>
    </section>
  );
}
