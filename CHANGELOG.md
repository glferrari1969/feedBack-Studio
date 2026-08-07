# Changelog

All notable changes to this project are documented in this file.

## [0.1.0-alpha.4] - 2026-08-07

### Fixed
- MP3 audio import now generates a valid manifest.yaml and correctly builds a feedpak package.
- MP3 metadata handling was improved so title, artist, album, and year are persisted consistently in imported projects.
- Naming/output flow was aligned with feedpak conventions across open/import paths, save path keys, and working package paths.
- Legacy sloppak naming was migrated to feedpak in runtime constants, project keys, and backend/frontend integration points.
- Guitar Pro import now detects GP7/GP8 ZIP-based .gp containers and returns a clear unsupported-format message instead of a generic failure.
- Guitar Pro arrangement import now prefers direct parsing (without mandatory MIDI roundtrip) to preserve original string/fret positions more accurately, with safe fallback to the previous path when needed.
- Guitar Pro arrangement import now preserves selected-track tuning and applies it to imported tab data.
- Unsupported .gp extension was removed from arrangement add/replace pickers and related backend validators.
- Tab editor retuning now remaps notes to playable string/fret positions for the selected tuning and tracks out-of-range notes.
- Out-of-range notes are now highlighted in red with signed fret delta labels, and are editable through the standard note controls.
- Quick edit controls were reorganized, and navigation buttons were added to jump to the previous/next note or chord.
- Note selection behavior was fixed so clicking a chord tone keeps that exact tone focused instead of always reverting to another tone.
- Chord and waveform navigation is now bidirectionally synchronized: selecting a note or chord seeks to its start, while seeking on the arrangement waveform selects the nearest chord on the active track.
- Drag behavior was stabilized with an activation threshold to reduce accidental note moves on simple click/select.
- String numbering display was corrected to match musical convention in UI editing controls: first string is highest, last string is lowest.
- Chord diagram mapping was aligned with Tab editor mapping logic, preventing mismatches after tuning/position changes.
- Chord diagram now shows a hint when selected notes are outside the current tuning/string range and cannot be displayed.
- Arrangement audio stem URLs are now normalized to forward-slash paths when built from manifest entries, improving waveform/audio visibility for packages with Windows-style stem paths.
- Stem discovery now also falls back to recursive project audio scanning (not only stems/) when declared stem entries are missing or invalid, improving waveform/audio visibility in legacy or non-standard packages.
- Arrangements audio loading now includes a frontend fallback to `/api/projects/{id}/asset/stems/full.ogg` when a selected stem URL is missing.
- Arrangements now include an `AutoSync arrangement` action that runs arrangement-aware sync against the selected stem, updates beatgrid/sync points/tempo map in the working copy, and keeps the workflow project-local until explicit commit.
- Remaining Italian UI strings in the affected editors were translated so the edited workflow now uses English-only labels.
