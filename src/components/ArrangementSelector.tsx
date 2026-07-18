import type { ArrangementInfo } from '../types/music';

interface Props {
  arrangements: ArrangementInfo[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDeleteCurrent?: () => Promise<void>;
  deleting?: boolean;
}

export function ArrangementSelector({
  arrangements,
  selectedId,
  onSelect,
  onDeleteCurrent,
  deleting = false,
}: Props) {
  const selectedArrangement = arrangements.find((arrangement) => arrangement.id === selectedId);

  const deleteCurrent = async () => {
    if (!selectedArrangement || !onDeleteCurrent) return;
    const confirmed = window.confirm(
      `Delete arrangement \"${selectedArrangement.name}\"? This action removes the arrangement from the current project.`,
    );
    if (!confirmed) return;
    await onDeleteCurrent();
  };

  return (
    <section className="panel compactPanel">
      <div className="panelHeader">Arrangement to edit</div>
      <label className="field">
        <span>Arrangements in file</span>
        <select value={selectedId ?? ''} onChange={(event) => onSelect(event.target.value)}>
          {arrangements.length === 0 && <option value="">No arrangement</option>}
          {arrangements.map((arr) => <option key={arr.id} value={arr.id}>{arr.name} {arr.noteCount ? `(${arr.noteCount})` : ''}</option>)}
        </select>
      </label>
      <div className="arrangementEditActions">
        <button
          type="button"
          className="dangerButton"
          disabled={!selectedArrangement || deleting}
          onClick={() => {
            void deleteCurrent();
          }}
        >
          {deleting ? 'Deleting arrangement...' : 'Delete arrangement'}
        </button>
      </div>
    </section>
  );
}
