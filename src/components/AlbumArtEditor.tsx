import type { ProjectState } from '../types/music';
import { resolveAssetUrl, uploadCoverArt } from '../api/backend';

interface AlbumArtEditorProps {
  project: ProjectState;
  onChange: (project: ProjectState) => void;
}

export function AlbumArtEditor({ project, onChange }: AlbumArtEditorProps) {
  const cover = resolveAssetUrl(project.coverUrl);

  const changeCover = async (file?: File) => {
    if (!file) return;
    try {
      const next = await uploadCoverArt(project.id, file);
      onChange({ ...project, coverUrl: next.coverUrl, coverPath: next.coverPath });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const clearCover = () => {
    onChange({ ...project, coverUrl: undefined, coverPath: '' });
  };

  return (
    <div className="albumArtEditor">
      <div className="albumArtPreview">
        {cover ? <img src={cover} alt="Album cover" /> : <span>No cover</span>}
      </div>
      <div className="albumArtControls">
        <label className="smallButton fileButton">
          Change cover
          <input type="file" accept="image/png,image/jpeg,image/webp,image/bmp,.dds" onChange={(event) => changeCover(event.target.files?.[0])} />
        </label>
        {cover ? <button type="button" className="smallButton dangerButton" onClick={clearCover}>Remove cover</button> : null}
        <span className="miniMeta">The cover is saved inside the feedpak manifest.</span>
      </div>
    </div>
  );
}
