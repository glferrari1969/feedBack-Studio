import type { ArrangementInfo } from '../types/music';

interface Props {
  arrangements: ArrangementInfo[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onDeleteCurrent?: () => Promise<void>;
  onDuplicateCurrent?: (name: string) => Promise<void>;
  onRenameCurrent?: (name: string) => Promise<void>;
  deleting?: boolean;
  duplicating?: boolean;
  renaming?: boolean;
}

export function ArrangementSelector({
  arrangements,
  selectedId,
  onSelect,
  onDeleteCurrent,
  onDuplicateCurrent,
  onRenameCurrent,
  deleting = false,
  duplicating = false,
  renaming = false,
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

  const duplicateCurrent = async () => {
    if (!selectedArrangement || !onDuplicateCurrent) return;
    const requestedName = window.prompt(
      'Name for the duplicated arrangement:',
      `${selectedArrangement.name} Copy`,
    );
    if (requestedName === null) return;
    const name = requestedName.trim();
    if (!name) {
      window.alert('Enter a name for the duplicated arrangement.');
      return;
    }
    await onDuplicateCurrent(name);
  };

  const renameCurrent = async () => {
    if (!selectedArrangement || !onRenameCurrent) return;
    const requestedName = window.prompt(
      'New name for the arrangement:',
      selectedArrangement.name,
    );
    if (requestedName === null) return;
    const name = requestedName.trim();
    if (!name) {
      window.alert('Enter a name for the arrangement.');
      return;
    }
    if (name === selectedArrangement.name) return;
    await onRenameCurrent(name);
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
          disabled={!selectedArrangement || !onDeleteCurrent || deleting || duplicating || renaming}
          onClick={() => {
            void deleteCurrent();
          }}
        >
          {deleting ? 'Deleting arrangement...' : 'Delete arrangement'}
        </button>
        <button
          type="button"
          className="secondaryButton"
          disabled={!selectedArrangement || !onDuplicateCurrent || deleting || duplicating || renaming}
          onClick={() => {
            void duplicateCurrent();
          }}
        >
          {duplicating ? 'Duplicating arrangement...' : 'Duplicate arrangement'}
        </button>
        <button
          type="button"
          className="secondaryButton"
          disabled={!selectedArrangement || !onRenameCurrent || deleting || duplicating || renaming}
          onClick={() => {
            void renameCurrent();
          }}
        >
          {renaming ? 'Renaming arrangement...' : 'Rename arrangement'}
        </button>
      </div>
    </section>
  );
}
