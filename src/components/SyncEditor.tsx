import type { SyncPoint } from "../types/music";

interface SyncEditorProps {
  syncPoints: SyncPoint[];
  selectedSyncPointId?: string | null;
  currentTime: number;
  syncSource?: string;
  syncWarning?: string;
  beatgridCount?: number;
  tempoMapCount?: number;
  onSelectPoint: (id: string | null) => void;
  onAddPoint: () => void;
  onChangePoint: (point: SyncPoint) => void;
  onDeletePoint: (id: string) => void;
}

export function SyncEditor({
  syncPoints,
  selectedSyncPointId,
  currentTime,
  syncSource,
  syncWarning,
  beatgridCount,
  tempoMapCount,
  onSelectPoint,
  onAddPoint,
  onChangePoint,
  onDeletePoint,
}: SyncEditorProps) {
  const sortedPoints = [...syncPoints].sort((a, b) => a.time - b.time);
  const selectedPoint =
    sortedPoints.find((point) => point.id === selectedSyncPointId) ??
    sortedPoints[0];

  return (
    <section className="panel syncEditor">
      <div className="panelHeader withAction">
        <span>Sync editor</span>
        <button className="smallButton" onClick={onAddPoint}>
          Add at {currentTime.toFixed(2)}s
        </button>
      </div>
      {(syncSource || beatgridCount || tempoMapCount || syncWarning) && (
        <div className="syncInfo">
          <div>
            <strong>Sync:</strong> {syncSource || "manual"} · beatgrid{" "}
            {beatgridCount ?? 0} · tempoMap {tempoMapCount ?? 0}
          </div>
          {syncWarning ? (
            <div className="warningText">{syncWarning}</div>
          ) : null}
        </div>
      )}
      <div className="syncHelp">
        <strong>Visual editing:</strong> drag the yellow markers on the waveform or
        tab editor. Double-click the waveform to add a point; in the tab
        editor use Shift+double-click.
      </div>

      {selectedPoint ? (
        <div className="syncDetail">
          <div className="subHeader">Selected point</div>
          <div className="syncDetailGrid">
            <label>
              Bar
              <input
                type="number"
                min={1}
                value={selectedPoint.bar}
                onChange={(event) =>
                  onChangePoint({
                    ...selectedPoint,
                    bar: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Beat
              <input
                type="number"
                min={1}
                step={0.25}
                value={selectedPoint.beat}
                onChange={(event) =>
                  onChangePoint({
                    ...selectedPoint,
                    beat: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Time
              <input
                type="number"
                min={0}
                step={0.001}
                value={selectedPoint.time}
                onChange={(event) =>
                  onChangePoint({
                    ...selectedPoint,
                    time: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              className="dangerButton"
              onClick={() => onDeletePoint(selectedPoint.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <p className="hint slimHint">
          No sync points. Add one from the playhead or double-click
          the waveform.
        </p>
      )}

      <div className="syncMiniList">
        {sortedPoints.map((point) => (
          <button
            key={point.id}
            type="button"
            className={`syncMiniItem ${point.id === selectedSyncPointId ? "selected" : ""}`}
            onClick={() => onSelectPoint(point.id)}
            title={`Go to ${point.time.toFixed(3)}s`}
          >
            <span>
              {point.bar}.{point.beat}
            </span>
            <em>{point.time.toFixed(3)}s</em>
          </button>
        ))}
      </div>
    </section>
  );
}
