import type { GuitarTechniques, MidiNote } from '../types/music';

interface TechniquePanelProps {
  selectedNote?: MidiNote;
  onChangeNote: (note: MidiNote) => void;
}

const techniqueOptions: Array<{ key: keyof GuitarTechniques; label: string }> = [
  { key: 'palmMute', label: 'Palm mute' },
  { key: 'hammerOn', label: 'Hammer-on' },
  { key: 'pullOff', label: 'Pull-off' },
  { key: 'slide', label: 'Slide' },
  { key: 'bend', label: 'Bend' },
  { key: 'vibrato', label: 'Vibrato' },
  { key: 'harmonic', label: 'Harmonic' }
];

export function TechniquePanel({ selectedNote, onChangeNote }: TechniquePanelProps) {
  const toggleTechnique = (key: keyof GuitarTechniques) => {
    if (!selectedNote) return;
    onChangeNote({
      ...selectedNote,
      techniques: {
        ...selectedNote.techniques,
        [key]: !selectedNote.techniques?.[key]
      }
    });
  };

  return (
    <section className="techniquePanel">
      <div className="subHeader">Techniques</div>
      {!selectedNote ? (
        <p className="hint slimHint">Select a note in the tablature to edit techniques.</p>
      ) : (
        <div className="techniqueGrid">
          {techniqueOptions.map((option) => (
            <button
              key={option.key}
              className={`techniqueButton ${selectedNote.techniques?.[option.key] ? 'active' : ''}`}
              onClick={() => toggleTechnique(option.key)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
