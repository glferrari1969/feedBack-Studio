from __future__ import annotations

import json
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


DRUM_TAB_ARRANGEMENT_ID = "__drum_tab__"


@dataclass(frozen=True)
class StemArrangementJobsDeps:
    jobs: dict[str, dict[str, Any]]
    projects_by_id: dict[str, Path]
    load_manifest: Callable[[Path], dict]
    project_stem_path: Callable[[Path, dict, str | None], tuple[Path | None, str]]
    simple_midi_to_wire: Callable[[Path, str, str], dict]
    read_json_if_exists: Callable[..., Any]
    pack_working_sloppack: Callable[..., Path]
    build_project: Callable[..., dict]
    project_original_save_path: Callable[..., Path]
    write_manifest: Callable[[Path, dict], None]
    annotate_tone_block_with_vst: Callable[[dict | None], dict | None]
    librosa_module: Any
    numpy_module: Any
    mido_module: Any


def _infer_instrument(requested: str | None) -> str:
    if requested in ("guitar", "bass", "keys", "drums"):
        return requested
    raise RuntimeError("Instrument is required and must be one of: bass, guitar, keys, drums")


def _wire_instrument_for_conversion(target_instrument: str) -> str:
    # The current MIDI->wire converter supports bass/guitar layouts.
    return "bass" if target_instrument == "bass" else "guitar"


def _empty_wire(name: str, instrument: str) -> dict:
    tuning = [0, 0, 0, 0] if instrument == "bass" else [0, 0, 0, 0, 0, 0]
    return {
        "name": name,
        "instrument": instrument,
        "tuning": tuning,
        "capo": 0,
        "notes": [],
        "chords": [],
        "anchors": [],
        "handshapes": [],
        "templates": [],
    }


def _mk_gear(slot_type: str, key: str, knobs: dict[str, float] | None = None) -> dict:
    return {
        "Type": slot_type,
        "Key": key,
        "PedalKey": key,
        "KnobValues": knobs or {},
    }


def _mk_tone_definition(name: str, sort_order: int, gear_list: dict[str, dict]) -> dict:
    return {
        "Name": name,
        "Key": name,
        "IsCustom": True,
        "SortOrder": float(sort_order),
        "Volume": "-18.0",
        "ToneDescriptors": [],
        "GearList": gear_list,
    }


def _clamp_float(value: float, minimum: float, maximum: float) -> float:
    return float(max(minimum, min(maximum, value)))


def _lerp(minimum: float, maximum: float, factor: float) -> float:
    t = _clamp_float(factor, 0.0, 1.0)
    return minimum + (maximum - minimum) * t


def _default_guitar_timbre() -> dict[str, float]:
    return {
        "brightness": 0.5,
        "body": 0.45,
        "roughness": 0.4,
        "attack": 0.45,
        "space": 0.3,
    }


def _analyze_guitar_stem_timbre(audio_path: Path, *, librosa_module: Any, numpy_module: Any) -> dict[str, float]:
    if librosa_module is None or numpy_module is None:
        return _default_guitar_timbre()

    y, sr = librosa_module.load(str(audio_path), sr=22050, mono=True)
    if y is None or len(y) == 0:
        return _default_guitar_timbre()

    y = numpy_module.asarray(y, dtype=numpy_module.float32)
    harmonic, percussive = librosa_module.effects.hpss(y)
    hop_length = 512
    n_fft = 2048

    stft = numpy_module.abs(librosa_module.stft(harmonic, n_fft=n_fft, hop_length=hop_length))
    power = stft * stft
    if power.size == 0:
        return _default_guitar_timbre()

    freqs = librosa_module.fft_frequencies(sr=sr, n_fft=n_fft)
    total = numpy_module.maximum(numpy_module.sum(power, axis=0), 1e-9)
    low_mask = freqs < 220.0
    mid_mask = (freqs >= 220.0) & (freqs < 2200.0)
    high_mask = freqs >= 2200.0

    low_ratio = float(numpy_module.mean(numpy_module.sum(power[low_mask], axis=0) / total)) if numpy_module.any(low_mask) else 0.0
    mid_ratio = float(numpy_module.mean(numpy_module.sum(power[mid_mask], axis=0) / total)) if numpy_module.any(mid_mask) else 0.0
    high_ratio = float(numpy_module.mean(numpy_module.sum(power[high_mask], axis=0) / total)) if numpy_module.any(high_mask) else 0.0

    centroid = float(numpy_module.mean(librosa_module.feature.spectral_centroid(y=harmonic, sr=sr, hop_length=hop_length)[0]))
    rolloff = float(numpy_module.mean(librosa_module.feature.spectral_rolloff(y=harmonic, sr=sr, hop_length=hop_length, roll_percent=0.85)[0]))
    flatness = float(numpy_module.mean(librosa_module.feature.spectral_flatness(y=harmonic, n_fft=n_fft, hop_length=hop_length)[0]))
    zcr = float(numpy_module.mean(librosa_module.feature.zero_crossing_rate(harmonic, frame_length=n_fft, hop_length=hop_length)[0]))

    rms = librosa_module.feature.rms(y=harmonic, frame_length=n_fft, hop_length=hop_length)[0]
    if len(rms) > 0:
        rms_p20 = float(numpy_module.percentile(rms, 20))
        rms_p90 = float(numpy_module.percentile(rms, 90))
        dyn = _clamp_float((rms_p90 - rms_p20) / max(1e-6, rms_p90), 0.0, 1.0)
    else:
        dyn = 0.3

    duration = max(0.1, float(len(y)) / float(sr))
    onsets = librosa_module.onset.onset_detect(y=percussive, sr=sr, hop_length=hop_length, units="time")
    onset_density = len(onsets) / duration

    brightness = _clamp_float(
        0.38 * _clamp_float((centroid - 900.0) / 2600.0, 0.0, 1.0)
        + 0.28 * _clamp_float((rolloff - 2200.0) / 5200.0, 0.0, 1.0)
        + 0.34 * _clamp_float(high_ratio / 0.42, 0.0, 1.0),
        0.0,
        1.0,
    )
    body = _clamp_float(0.62 * _clamp_float(low_ratio / 0.36, 0.0, 1.0) + 0.38 * _clamp_float(mid_ratio / 0.55, 0.0, 1.0), 0.0, 1.0)
    roughness = _clamp_float(
        0.55 * _clamp_float(flatness / 0.32, 0.0, 1.0)
        + 0.45 * _clamp_float(zcr / 0.18, 0.0, 1.0),
        0.0,
        1.0,
    )
    attack = _clamp_float(
        0.6 * _clamp_float(onset_density / 6.0, 0.0, 1.0) + 0.4 * dyn,
        0.0,
        1.0,
    )
    space = _clamp_float(
        0.55 * (1.0 - dyn)
        + 0.2 * (1.0 - _clamp_float(onset_density / 8.0, 0.0, 1.0))
        + 0.25 * _clamp_float((1.0 - flatness) * 1.2, 0.0, 1.0),
        0.0,
        1.0,
    )

    return {
        "brightness": brightness,
        "body": body,
        "roughness": roughness,
        "attack": attack,
        "space": space,
    }


def _select_guitar_tone_profile(
    stem_id: str,
    notes: list[tuple[float, float, int]],
    timbre: dict[str, float],
) -> str:
    lowered = stem_id.lower()
    if any(token in lowered for token in ("solo", "lead")):
        return "lead"
    if any(token in lowered for token in ("clean", "acoustic", "arpeggio")):
        return "clean"
    if any(token in lowered for token in ("rhythm", "riff", "chord")):
        return "rhythm"

    if not notes:
        return "rhythm"
    avg_pitch = sum(pitch for _start, _end, pitch in notes) / max(1, len(notes))
    span_end = max(end for _start, end, _pitch in notes)
    notes_per_second = len(notes) / max(1.0, span_end)

    brightness = timbre.get("brightness", 0.5)
    roughness = timbre.get("roughness", 0.4)
    attack = timbre.get("attack", 0.45)

    if (avg_pitch >= 65 and notes_per_second >= 1.6) or (brightness >= 0.62 and roughness >= 0.48 and notes_per_second >= 2.0):
        return "lead"
    if roughness <= 0.28 and attack <= 0.42 and notes_per_second <= 2.1:
        return "clean"
    if avg_pitch >= 66 or notes_per_second >= 2.8:
        return "lead"
    if avg_pitch <= 54 and roughness < 0.45:
        return "clean"
    return "rhythm"


def _build_auto_guitar_tones(
    stem_id: str,
    arrangement_label: str,
    notes: list[tuple[float, float, int]],
    timbre: dict[str, float],
) -> dict:
    profile = _select_guitar_tone_profile(stem_id, notes, timbre)
    stem_title = stem_id.replace("_", " ").strip().title() or "Stem"

    brightness = timbre.get("brightness", 0.5)
    body = timbre.get("body", 0.45)
    roughness = timbre.get("roughness", 0.4)
    attack = timbre.get("attack", 0.45)
    space = timbre.get("space", 0.3)

    amp_gain_base = _lerp(26.0, 88.0, roughness * 0.65 + attack * 0.35)
    amp_bass_base = _lerp(38.0, 82.0, body)
    amp_mid_base = _lerp(40.0, 76.0, _clamp_float(0.5 + (body - brightness) * 0.5, 0.0, 1.0))
    amp_treble_base = _lerp(40.0, 84.0, brightness)

    eq63 = round(_lerp(-2.5, 3.5, body), 2)
    eq250 = round(_lerp(-1.5, 3.0, _clamp_float(body * 0.8 + 0.2, 0.0, 1.0)), 2)
    eq750 = round(_lerp(-1.0, 4.0, _clamp_float((1.0 - roughness) * 0.55 + attack * 0.45, 0.0, 1.0)), 2)
    eq2200 = round(_lerp(-1.0, 4.5, brightness), 2)
    eq5700 = round(_lerp(-2.0, 3.5, _clamp_float(brightness * 0.9 + roughness * 0.1, 0.0, 1.0)), 2)

    verb_mix = _lerp(8.0, 30.0, space)
    verb_time = _lerp(24.0, 70.0, space)
    verb_depth = _lerp(30.0, 78.0, space)

    clean_name = f"{stem_title} Clean"
    rhythm_name = f"{stem_title} Rhythm"
    lead_name = f"{stem_title} Lead"

    clean_def = _mk_tone_definition(
        clean_name,
        1,
        {
            "PrePedal1": _mk_gear("Pedals", "Pedal_EQ5", {
                "Pedal_EQ5_63": round(eq63 - 0.8, 2),
                "Pedal_EQ5_250": round(eq250 - 0.7, 2),
                "Pedal_EQ5_750": round(eq750 - 0.5, 2),
                "Pedal_EQ5_2200": round(eq2200 - 0.6, 2),
                "Pedal_EQ5_5700": round(eq5700 - 0.7, 2),
            }),
            "Amp": _mk_gear("Amps", "Amp_HG100", {
                "Amp_HG100_Gain": round(_clamp_float(amp_gain_base - 24.0, 16.0, 56.0), 2),
                "Amp_HG100_Bass": round(_clamp_float(amp_bass_base - 6.0, 28.0, 78.0), 2),
                "Amp_HG100_Mid": round(_clamp_float(amp_mid_base + 6.0, 36.0, 82.0), 2),
                "Amp_HG100_Treble": round(_clamp_float(amp_treble_base - 4.0, 34.0, 82.0), 2),
            }),
            "Cabinet": _mk_gear("Cabinets", "Cab_HG2120C_Condenser_Cone"),
            "Rack1": _mk_gear("Racks", "Rack_StudioVerb", {
                "Rack_StudioVerb_Mix": round(_clamp_float(verb_mix + 4.0, 8.0, 34.0), 2),
                "Rack_StudioVerb_Time": round(_clamp_float(verb_time + 10.0, 24.0, 78.0), 2),
                "Rack_StudioVerb_Tone": round(_clamp_float(_lerp(46.0, 64.0, brightness), 42.0, 72.0), 2),
                "Rack_StudioVerb_Depth": round(_clamp_float(verb_depth + 6.0, 28.0, 86.0), 2),
            }),
        },
    )

    rhythm_def = _mk_tone_definition(
        rhythm_name,
        2,
        {
            "PrePedal1": _mk_gear("Pedals", "Pedal_EQ5", {
                "Pedal_EQ5_63": eq63,
                "Pedal_EQ5_250": eq250,
                "Pedal_EQ5_750": eq750,
                "Pedal_EQ5_2200": eq2200,
                "Pedal_EQ5_5700": eq5700,
            }),
            "Amp": _mk_gear("Amps", "Amp_HG100", {
                "Amp_HG100_Gain": round(_clamp_float(amp_gain_base, 26.0, 90.0), 2),
                "Amp_HG100_Bass": round(_clamp_float(amp_bass_base, 34.0, 90.0), 2),
                "Amp_HG100_Mid": round(_clamp_float(amp_mid_base + 2.0, 36.0, 86.0), 2),
                "Amp_HG100_Treble": round(_clamp_float(amp_treble_base, 36.0, 90.0), 2),
            }),
            "Cabinet": _mk_gear("Cabinets", "Cab_HG2120C_Condenser_Cone"),
            "Rack1": _mk_gear("Racks", "Rack_StudioEQ", {
                "Rack_StudioEQ_Bass": round(_lerp(-2.0, 4.0, body), 2),
                "Rack_StudioEQ_LoMid": round(_lerp(-2.0, 4.5, _clamp_float((body + (1.0 - roughness)) * 0.5, 0.0, 1.0)), 2),
                "Rack_StudioEQ_HiMid": round(_lerp(-2.0, 5.0, _clamp_float((brightness + roughness) * 0.5, 0.0, 1.0)), 2),
                "Rack_StudioEQ_Treble": round(_lerp(-1.5, 5.0, brightness), 2),
            }),
            "Rack2": _mk_gear("Racks", "Rack_StudioVerb", {
                "Rack_StudioVerb_Mix": round(_clamp_float(verb_mix, 6.0, 30.0), 2),
                "Rack_StudioVerb_Time": round(_clamp_float(verb_time, 20.0, 72.0), 2),
                "Rack_StudioVerb_Tone": round(_clamp_float(_lerp(48.0, 66.0, brightness), 40.0, 72.0), 2),
                "Rack_StudioVerb_Depth": round(_clamp_float(verb_depth, 24.0, 80.0), 2),
            }),
        },
    )

    lead_def = _mk_tone_definition(
        lead_name,
        3,
        {
            "PrePedal1": _mk_gear("Pedals", "Pedal_EQ5", {
                "Pedal_EQ5_63": round(eq63 - 0.6, 2),
                "Pedal_EQ5_250": round(eq250 + 0.8, 2),
                "Pedal_EQ5_750": round(eq750 + 1.6, 2),
                "Pedal_EQ5_2200": round(eq2200 + 1.4, 2),
                "Pedal_EQ5_5700": round(eq5700 + 1.0, 2),
            }),
            "Amp": _mk_gear("Amps", "Amp_HG100", {
                "Amp_HG100_Gain": round(_clamp_float(amp_gain_base + 14.0, 48.0, 96.0), 2),
                "Amp_HG100_Bass": round(_clamp_float(amp_bass_base - 2.0, 30.0, 90.0), 2),
                "Amp_HG100_Mid": round(_clamp_float(amp_mid_base + 10.0, 42.0, 94.0), 2),
                "Amp_HG100_Treble": round(_clamp_float(amp_treble_base + 8.0, 42.0, 96.0), 2),
            }),
            "Cabinet": _mk_gear("Cabinets", "Cab_HG2120C_Condenser_Cone"),
            "Rack1": _mk_gear("Racks", "Rack_StudioEQ", {
                "Rack_StudioEQ_Bass": round(_lerp(-1.5, 3.5, body), 2),
                "Rack_StudioEQ_LoMid": round(_lerp(-1.0, 4.0, _clamp_float((body + attack) * 0.5, 0.0, 1.0)), 2),
                "Rack_StudioEQ_HiMid": round(_lerp(0.0, 6.0, _clamp_float((brightness + roughness) * 0.5, 0.0, 1.0)), 2),
                "Rack_StudioEQ_Treble": round(_lerp(0.0, 6.0, brightness), 2),
            }),
            "Rack2": _mk_gear("Racks", "Rack_StudioVerb", {
                "Rack_StudioVerb_Mix": round(_clamp_float(verb_mix + 6.0, 10.0, 36.0), 2),
                "Rack_StudioVerb_Time": round(_clamp_float(verb_time + 10.0, 24.0, 84.0), 2),
                "Rack_StudioVerb_Tone": round(_clamp_float(_lerp(50.0, 68.0, brightness), 42.0, 74.0), 2),
                "Rack_StudioVerb_Depth": round(_clamp_float(verb_depth + 8.0, 30.0, 90.0), 2),
            }),
        },
    )

    duration = max((end for _start, end, _pitch in notes), default=0.0)
    change_time = round(max(0.0, min(duration * 0.34, max(0.0, duration - 0.25))), 3)

    if profile == "clean":
        return {
            "base": clean_name,
            "definitions": [clean_def],
        }
    if profile == "rhythm":
        return {
            "base": rhythm_name,
            "definitions": [rhythm_def],
        }
    return {
        "base": clean_name,
        "changes": [{"t": change_time, "name": lead_name}] if change_time > 0.05 else [],
        "definitions": [clean_def, lead_def],
        "auto_source": f"stem:{stem_id}",
        "auto_label": arrangement_label,
    }


def _extract_monophonic_notes(audio_path: Path, *, librosa_module: Any, numpy_module: Any) -> list[tuple[float, float, int]]:
    if librosa_module is None or numpy_module is None:
        raise RuntimeError("Audio-to-MIDI requires librosa and numpy in backend requirements.")

    y, sr = librosa_module.load(str(audio_path), sr=22050, mono=True)
    if y is None or len(y) == 0:
        raise RuntimeError("Empty or unreadable stem audio.")

    y = numpy_module.asarray(y, dtype=numpy_module.float32)
    frame_length = 2048
    hop_length = 256

    f0, voiced_flag, _ = librosa_module.pyin(
        y,
        fmin=librosa_module.note_to_hz("C2"),
        fmax=librosa_module.note_to_hz("C7"),
        sr=sr,
        frame_length=frame_length,
        hop_length=hop_length,
    )
    if f0 is None:
        raise RuntimeError("No pitch contour detected for this stem.")

    rms = librosa_module.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    frame_times = librosa_module.frames_to_time(
        numpy_module.arange(len(f0)),
        sr=sr,
        hop_length=hop_length,
    )

    midi_frames: list[int | None] = []
    rms_len = len(rms)
    for index, hz in enumerate(f0):
        voiced = bool(voiced_flag[index]) if voiced_flag is not None else hz is not None
        if (not voiced) or hz is None or not numpy_module.isfinite(hz):
            midi_frames.append(None)
            continue
        if index < rms_len and float(rms[index]) < 0.008:
            midi_frames.append(None)
            continue
        midi = int(round(float(librosa_module.hz_to_midi(float(hz)))))
        midi = int(max(36, min(96, midi)))
        midi_frames.append(midi)

    notes: list[tuple[float, float, int]] = []
    current_start: int | None = None
    current_pitch: int | None = None
    minimum_duration = 0.08

    for index, midi in enumerate(midi_frames):
        if midi is None:
            if current_start is not None and current_pitch is not None:
                end_time = float(frame_times[index])
                start_time = float(frame_times[current_start])
                if end_time - start_time >= minimum_duration:
                    notes.append((start_time, end_time, current_pitch))
            current_start = None
            current_pitch = None
            continue

        if current_start is None:
            current_start = index
            current_pitch = midi
            continue

        if current_pitch is not None and abs(midi - current_pitch) <= 1:
            current_pitch = int(round((current_pitch + midi) / 2))
            continue

        end_time = float(frame_times[index])
        start_time = float(frame_times[current_start])
        if current_pitch is not None and end_time - start_time >= minimum_duration:
            notes.append((start_time, end_time, current_pitch))
        current_start = index
        current_pitch = midi

    if current_start is not None and current_pitch is not None:
        tail = float(hop_length) / float(sr)
        end_time = float(frame_times[-1]) + tail
        start_time = float(frame_times[current_start])
        if end_time - start_time >= minimum_duration:
            notes.append((start_time, end_time, current_pitch))

    if not notes:
        raise RuntimeError("No playable notes detected for this stem.")
    return notes


def _extract_keyboard_notes(audio_path: Path, *, librosa_module: Any, numpy_module: Any) -> list[dict[str, float | int]]:
    if librosa_module is None or numpy_module is None:
        raise RuntimeError("Keyboard conversion requires librosa and numpy.")

    y, sr = librosa_module.load(str(audio_path), sr=22050, mono=True)
    if y is None or len(y) == 0:
        raise RuntimeError("Empty or unreadable stem audio.")

    y = numpy_module.asarray(y, dtype=numpy_module.float32)
    harmonic, _percussive = librosa_module.effects.hpss(y)
    hop_length = 512

    cqt = numpy_module.abs(
        librosa_module.cqt(
            harmonic,
            sr=sr,
            hop_length=hop_length,
            fmin=librosa_module.note_to_hz("C1"),
            n_bins=96,
            bins_per_octave=12,
        )
    )
    if cqt.size == 0:
        raise RuntimeError("Could not derive harmonic spectrum for keyboard conversion.")

    onset_frames = librosa_module.onset.onset_detect(
        y=harmonic,
        sr=sr,
        hop_length=hop_length,
        units="frames",
    )
    frame_count = int(cqt.shape[1])
    boundaries = [0] + [int(x) for x in onset_frames if 0 < int(x) < frame_count] + [frame_count]
    boundaries = sorted(set(boundaries))

    rms = librosa_module.feature.rms(y=harmonic, hop_length=hop_length)[0]
    notes: list[dict[str, float | int]] = []

    for index in range(len(boundaries) - 1):
        start_frame = boundaries[index]
        end_frame = max(start_frame + 1, boundaries[index + 1])
        if end_frame - start_frame < 1:
            continue

        segment_rms = rms[start_frame:min(end_frame, len(rms))]
        if segment_rms.size == 0 or float(numpy_module.mean(segment_rms)) < 0.008:
            continue

        spectrum = numpy_module.mean(cqt[:, start_frame:end_frame], axis=1)
        max_energy = float(numpy_module.max(spectrum)) if spectrum.size else 0.0
        if max_energy <= 0:
            continue

        active_bins = numpy_module.where(spectrum >= max_energy * 0.45)[0]
        if active_bins.size == 0:
            active_bins = numpy_module.array([int(numpy_module.argmax(spectrum))])

        top_bins = sorted(
            [int(bin_index) for bin_index in active_bins],
            key=lambda bin_index: float(spectrum[bin_index]),
            reverse=True,
        )[:3]

        start_time = float(librosa_module.frames_to_time(start_frame, sr=sr, hop_length=hop_length))
        end_time = float(librosa_module.frames_to_time(end_frame, sr=sr, hop_length=hop_length))
        if end_time - start_time < 0.05:
            end_time = start_time + 0.05

        for bin_index in top_bins:
            pitch = int(max(24, min(108, 24 + bin_index)))
            velocity = int(max(45, min(112, round(35 + max_energy * 85))))
            notes.append(
                {
                    "start": round(start_time, 4),
                    "end": round(end_time, 4),
                    "pitch": pitch,
                    "velocity": velocity,
                }
            )

    if not notes:
        raise RuntimeError("No playable keyboard notes detected for this stem.")
    return notes


def _extract_drum_notes(audio_path: Path, *, librosa_module: Any, numpy_module: Any) -> list[dict[str, float | int]]:
    if librosa_module is None or numpy_module is None:
        raise RuntimeError("Drum conversion requires librosa and numpy.")

    y, sr = librosa_module.load(str(audio_path), sr=22050, mono=True)
    if y is None or len(y) == 0:
        raise RuntimeError("Empty or unreadable stem audio.")

    y = numpy_module.asarray(y, dtype=numpy_module.float32)
    _harmonic, percussive = librosa_module.effects.hpss(y)
    hop_length = 256

    onset_frames = librosa_module.onset.onset_detect(
        y=percussive,
        sr=sr,
        hop_length=hop_length,
        units="frames",
        pre_max=3,
        post_max=3,
        pre_avg=5,
        post_avg=5,
        delta=0.05,
        wait=2,
    )
    if onset_frames is None or len(onset_frames) == 0:
        raise RuntimeError("No percussive onsets detected for this stem.")

    rms = librosa_module.feature.rms(y=percussive, hop_length=hop_length)[0]
    centroid = librosa_module.feature.spectral_centroid(y=percussive, sr=sr, hop_length=hop_length)[0]
    rolloff = librosa_module.feature.spectral_rolloff(y=percussive, sr=sr, hop_length=hop_length, roll_percent=0.85)[0]

    notes: list[dict[str, float | int]] = []
    last_by_pitch: dict[int, float] = {}

    for frame in [int(x) for x in onset_frames]:
        index = max(0, min(frame, len(rms) - 1))
        amp = float(rms[index])
        if amp < 0.01:
            continue
        c = float(centroid[index]) if index < len(centroid) else 0.0
        r = float(rolloff[index]) if index < len(rolloff) else 0.0

        if r < 950 and c < 700:
            pitch = 36  # Kick
        elif c > 2500 or r > 5200:
            pitch = 42  # Closed hi-hat
        else:
            pitch = 38  # Snare

        start = float(librosa_module.frames_to_time(frame, sr=sr, hop_length=hop_length))
        if pitch in last_by_pitch and start - last_by_pitch[pitch] < 0.06:
            continue
        last_by_pitch[pitch] = start

        velocity = int(max(35, min(122, round(28 + amp * 520))))
        notes.append(
            {
                "start": round(start, 4),
                "end": round(start + 0.12, 4),
                "pitch": pitch,
                "velocity": velocity,
            }
        )

    if not notes:
        raise RuntimeError("No drum hits detected for this stem.")
    return notes


def _event_notes_to_wire(name: str, instrument: str, events: list[dict[str, float | int]]) -> dict:
    wire = _empty_wire(name, instrument)
    converted = []
    for event in events:
        pitch = int(event.get("pitch", 60) or 60)
        start = float(event.get("start", 0.0) or 0.0)
        end = float(event.get("end", start + 0.1) or (start + 0.1))
        duration = max(0.05, end - start)
        velocity = int(event.get("velocity", 96) or 96)
        if instrument == "drums":
            fret = max(0, min(24, pitch - 36))
        else:
            fret = max(0, min(24, pitch - 48))
        converted.append(
            {
                "t": round(start, 4),
                "s": 0,
                "f": fret,
                "sus": round(duration, 4),
                "velocity": max(1, min(127, velocity)),
                "pitch": max(0, min(127, pitch)),
                "sl": -1,
                "slu": -1,
                "bn": 0,
                "ho": False,
                "po": False,
                "hm": False,
                "hp": False,
                "pm": False,
                "mt": False,
                "vb": False,
                "tr": False,
                "ac": False,
                "tp": False,
            }
        )
    wire["notes"] = sorted(converted, key=lambda item: (item.get("t", 0), item.get("pitch", 0)))
    return wire


def _pitch_to_drum_piece(pitch: int) -> str:
    mapping = {
        35: "kick",
        36: "kick",
        37: "snare_xstick",
        38: "snare",
        40: "snare",
        41: "tom_floor",
        42: "hh_closed",
        43: "tom_low",
        44: "hh_pedal",
        45: "tom_mid",
        46: "hh_open",
        47: "tom_mid",
        48: "tom_hi",
        49: "crash_l",
        50: "tom_hi",
        51: "ride",
        52: "china",
        53: "ride_bell",
        55: "splash",
        57: "crash_r",
        59: "ride",
        80: "bell",
    }
    if pitch in mapping:
        return mapping[pitch]

    if pitch < 37:
        return "kick"
    if pitch < 41:
        return "snare"
    if pitch < 46:
        return "tom_low"
    if pitch < 50:
        return "hh_closed"
    if pitch < 54:
        return "crash_l"
    return "ride"


def _drum_events_to_drum_tab(name: str, events: list[dict[str, float | int]]) -> dict:
    hits: list[dict[str, Any]] = []
    seen: set[str] = set()
    ordered_pieces: list[str] = []

    for event in sorted(events, key=lambda item: (float(item.get("start", 0.0) or 0.0), int(item.get("pitch", 60) or 60))):
        pitch = int(event.get("pitch", 60) or 60)
        piece = _pitch_to_drum_piece(pitch)
        if piece not in seen:
            seen.add(piece)
            ordered_pieces.append(piece)

        start = round(max(0.0, float(event.get("start", 0.0) or 0.0)), 3)
        velocity = max(1, min(127, int(event.get("velocity", 100) or 100)))
        hit: dict[str, Any] = {"t": start, "p": piece}
        if velocity != 100:
            hit["v"] = velocity
        hits.append(hit)

    return {
        "version": 1,
        "name": (name or "Drums").strip() or "Drums",
        "kit": [{"id": piece, "name": piece.replace("_", " ").title()} for piece in ordered_pieces],
        "hits": hits,
    }


def _write_midi_from_notes(notes: list[tuple[float, float, int]], out_path: Path, *, bpm: float, mido_module: Any) -> None:
    if mido_module is None:
        raise RuntimeError("MIDI generation requires mido in backend requirements.")

    ticks_per_beat = 480
    safe_bpm = max(40.0, min(240.0, float(bpm or 120.0)))
    tempo = int(mido_module.bpm2tempo(safe_bpm))

    midi = mido_module.MidiFile(ticks_per_beat=ticks_per_beat)
    track = mido_module.MidiTrack()
    midi.tracks.append(track)
    track.append(mido_module.MetaMessage("set_tempo", tempo=tempo, time=0))
    track.append(mido_module.MetaMessage("track_name", name="Stem transcription", time=0))

    def sec_to_ticks(seconds: float) -> int:
        return int(round(max(0.0, seconds) * ticks_per_beat * 1_000_000.0 / tempo))

    previous_tick = 0
    for start_sec, end_sec, pitch in notes:
        start_tick = sec_to_ticks(start_sec)
        end_tick = max(start_tick + 1, sec_to_ticks(end_sec))

        track.append(
            mido_module.Message(
                "note_on",
                note=int(max(0, min(127, pitch))),
                velocity=86,
                time=max(0, start_tick - previous_tick),
            )
        )
        previous_tick = start_tick

        track.append(
            mido_module.Message(
                "note_off",
                note=int(max(0, min(127, pitch))),
                velocity=0,
                time=max(1, end_tick - previous_tick),
            )
        )
        previous_tick = end_tick

    midi.save(str(out_path))


def build_stem_arrangement_processor(deps: StemArrangementJobsDeps) -> Callable[..., None]:
    def process_stem_arrangement_job(
        job_id: str,
        project_id: str,
        stem_id: str,
        arrangement_name: str,
        instrument: str,
    ) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = deps.projects_by_id.get(project_id)
            if not source_dir:
                raise RuntimeError("Project not found")

            manifest = deps.load_manifest(source_dir)
            stem_audio_path, resolved_stem_id = deps.project_stem_path(source_dir, manifest, stem_id)
            if stem_audio_path is None:
                raise RuntimeError("Selected stem was not found in the project")

            lowered_stem = resolved_stem_id.lower()
            if any(token in lowered_stem for token in ("vocal", "voice", "lyric")):
                raise RuntimeError("Voice stems should use lyric recognition + sync, not MIDI arrangement generation")

            arrangement_label = (arrangement_name or "").strip()
            if not arrangement_label:
                raise RuntimeError("Arrangement name is required")

            target_instrument = _infer_instrument(instrument)
            transcription_notes: list[tuple[float, float, int]] = []
            if target_instrument in ("guitar", "bass"):
                wire_instrument = _wire_instrument_for_conversion(target_instrument)
                job.update(status="running", step=f"Analysing {resolved_stem_id} pitch", progress=12)
                notes = _extract_monophonic_notes(
                    stem_audio_path,
                    librosa_module=deps.librosa_module,
                    numpy_module=deps.numpy_module,
                )
                transcription_notes = notes

                with tempfile.TemporaryDirectory(prefix="stem_midi_") as temporary_dir:
                    midi_path = Path(temporary_dir) / "stem.mid"
                    _write_midi_from_notes(
                        notes,
                        midi_path,
                        bpm=float(manifest.get("bpm") or 120.0),
                        mido_module=deps.mido_module,
                    )
                    job.update(status="running", step=f"Building arrangement from {resolved_stem_id}", progress=58)
                    wire = deps.simple_midi_to_wire(midi_path, arrangement_label, wire_instrument)
            elif target_instrument == "keys":
                job.update(status="running", step=f"Analysing {resolved_stem_id} harmony", progress=16)
                key_events = _extract_keyboard_notes(
                    stem_audio_path,
                    librosa_module=deps.librosa_module,
                    numpy_module=deps.numpy_module,
                )
                job.update(status="running", step=f"Building keyboard arrangement from {resolved_stem_id}", progress=62)
                wire = _event_notes_to_wire(arrangement_label, "keys", key_events)
            else:
                job.update(status="running", step=f"Detecting drum hits in {resolved_stem_id}", progress=16)
                drum_events = _extract_drum_notes(
                    stem_audio_path,
                    librosa_module=deps.librosa_module,
                    numpy_module=deps.numpy_module,
                )
                job.update(status="running", step=f"Building drum arrangement from {resolved_stem_id}", progress=62)
                drum_tab = _drum_events_to_drum_tab(arrangement_label, drum_events)

            if target_instrument in ("guitar", "bass") and transcription_notes:
                job.update(status="running", step=f"Matching {resolved_stem_id} tone chain", progress=76)
                timbre = _analyze_guitar_stem_timbre(
                    stem_audio_path,
                    librosa_module=deps.librosa_module,
                    numpy_module=deps.numpy_module,
                )
                tone_block = _build_auto_guitar_tones(
                    resolved_stem_id,
                    arrangement_label,
                    transcription_notes,
                    timbre,
                )
                annotated_tones = deps.annotate_tone_block_with_vst(tone_block)
                wire["tones"] = annotated_tones if isinstance(annotated_tones, dict) else tone_block

            if target_instrument == "drums":
                drum_rel = str(manifest.get("drum_tab") or "drum_tab.json").strip() or "drum_tab.json"
                drum_path = (source_dir / drum_rel).resolve()
                try:
                    drum_path.relative_to(source_dir.resolve())
                except Exception:
                    raise RuntimeError("Invalid drum_tab path in manifest")
                drum_path.parent.mkdir(parents=True, exist_ok=True)
                drum_path.write_text(
                    json.dumps(drum_tab, separators=(",", ":"), ensure_ascii=False),
                    encoding="utf-8",
                )
                manifest["drum_tab"] = drum_rel
                arrangement_id = DRUM_TAB_ARRANGEMENT_ID
            else:
                arrangement_id = (
                    arrangement_label.lower().replace(" ", "_") + "_" + uuid.uuid4().hex[:6]
                )
                arrangement_rel = f"arrangements/{arrangement_id}.json"
                (source_dir / arrangement_rel).parent.mkdir(parents=True, exist_ok=True)
                (source_dir / arrangement_rel).write_text(
                    json.dumps(wire, separators=(",", ":")),
                    encoding="utf-8",
                )

                manifest_arrangements = manifest.setdefault("arrangements", [])
                tuning = wire.get("tuning", [0, 0, 0, 0, 0, 0])
                manifest_arrangements.append(
                    {
                        "id": arrangement_id,
                        "name": wire.get("name", arrangement_label),
                        "file": arrangement_rel,
                        "tuning": tuning,
                        "capo": wire.get("capo", 0),
                        "type": target_instrument,
                        "source": f"stem:{resolved_stem_id}",
                    }
                )
            deps.write_manifest(source_dir, manifest)

            previous_project = deps.read_json_if_exists(source_dir.parent / "project.json", {})
            working_path = deps.pack_working_sloppack(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated = deps.build_project(
                project_id,
                source_dir,
                selected_arrangement=arrangement_id,
            )
            original_path = deps.project_original_save_path(
                source_dir,
                previous_project if isinstance(previous_project, dict) else None,
            )
            updated["sloppackPath"] = str(original_path)
            updated["originalSloppackPath"] = str(original_path)
            updated["workingSloppackPath"] = str(working_path)
            updated["hasUncommittedChanges"] = True
            (source_dir.parent / "project.json").write_text(
                json.dumps(updated, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            job.update(
                status="done",
                step=f"Arrangement created from {resolved_stem_id}",
                progress=100,
                project=updated,
            )
        except Exception as exc:
            job.update(status="error", step="Stem arrangement generation failed", error=str(exc), progress=100)

    return process_stem_arrangement_job


def build_stem_tone_processor(deps: StemArrangementJobsDeps) -> Callable[..., None]:
    """Build a detached tone draft from a stem without mutating the project."""

    def process_stem_tone_job(
        job_id: str,
        project_id: str,
        stem_id: str,
        arrangement_label: str,
    ) -> None:
        job = deps.jobs[job_id]
        try:
            source_dir = deps.projects_by_id.get(project_id)
            if not source_dir:
                raise RuntimeError("Project not found")

            manifest = deps.load_manifest(source_dir)
            stem_audio_path, resolved_stem_id = deps.project_stem_path(source_dir, manifest, stem_id)
            if stem_audio_path is None:
                raise RuntimeError("Selected stem was not found in the project")

            lowered_stem = resolved_stem_id.lower()
            if any(token in lowered_stem for token in ("vocal", "voice", "lyric")):
                raise RuntimeError("Voice stems cannot be used to generate instrument tones")

            job.update(status="running", step=f"Analysing {resolved_stem_id} pitch", progress=12)
            notes = _extract_monophonic_notes(
                stem_audio_path,
                librosa_module=deps.librosa_module,
                numpy_module=deps.numpy_module,
            )
            job.update(status="running", step=f"Analysing {resolved_stem_id} timbre", progress=58)
            timbre = _analyze_guitar_stem_timbre(
                stem_audio_path,
                librosa_module=deps.librosa_module,
                numpy_module=deps.numpy_module,
            )
            label = arrangement_label.strip() or "Generated tones"
            tone_block = _build_auto_guitar_tones(resolved_stem_id, label, notes, timbre)
            tone_block.setdefault("auto_source", f"stem:{resolved_stem_id}")
            tone_block.setdefault("auto_label", label)
            annotated_tones = deps.annotate_tone_block_with_vst(tone_block)
            tones = annotated_tones if isinstance(annotated_tones, dict) else tone_block

            job.update(
                status="done",
                step=f"Tone draft generated from {resolved_stem_id}",
                progress=100,
                tones=tones,
                stem_id=resolved_stem_id,
            )
        except Exception as exc:
            job.update(status="error", step="Tone generation failed", error=str(exc), progress=100)

    return process_stem_tone_job
