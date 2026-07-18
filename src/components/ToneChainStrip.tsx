import { useEffect, useMemo, useState } from "react";
import type { ToneBlock } from "../types/music";
import {
  addSloppackGear,
  addSloppackGearRecord,
  deleteSloppackGearEntry,
  getGearKey,
  getGearLabel,
  getGearParams,
  getGearSlot,
  getGearType,
  getSloppackGearEntries,
  getToneDefinitions,
  getToneName,
  getVstLookupKey,
  getVstPluginName,
  getVstParamMappings,
  getVstSuggestions,
  parseParamValue,
  replaceDefinition,
  setGearParams,
  setToneName,
  updateGearField,
  updateSloppackGearEntry,
  type GearRecord,
  type SloppackGearEntry,
  type ToneDefinition,
} from "../lib/sloppackTones";
import {
  GEAR_CATALOG,
  makeGearFromCatalog,
  type GearCatalogItem,
  type GearParameterSpec,
} from "../data/gearCatalog";
import { GearVisual } from "./GearVisual";

interface ToneChainStripProps {
  tones?: ToneBlock | null;
  onChange: (tones: ToneBlock | null) => void;
  onDeleteTone: (toneName: string) => boolean;
}

function clampIndex(value: number, length: number) {
  return Math.min(Math.max(value, 0), Math.max(0, length - 1));
}

function normalizeLookup(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function resolveCatalogItem(gear: GearRecord | undefined): GearCatalogItem | undefined {
  if (!gear) return undefined;
  const metadata = gear.FeedBackStudioCatalog;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const idValue = normalizeLookup((metadata as Record<string, unknown>).id);
    if (idValue) {
      const byMetaId = GEAR_CATALOG.find((item) => normalizeLookup(item.id) === idValue);
      if (byMetaId) return byMetaId;
    }
  }

  const key = normalizeLookup(getGearKey(gear));
  const name = normalizeLookup(getGearLabel(gear, ""));
  if (key) {
    const byId = GEAR_CATALOG.find((item) => normalizeLookup(item.id) === key);
    if (byId) return byId;
  }
  if (name) {
    const byName = GEAR_CATALOG.find((item) => normalizeLookup(item.name) === name);
    if (byName) return byName;
  }
  return undefined;
}

function catalogItemMatches(item: GearCatalogItem, query: string): boolean {
  const needle = normalizeLookup(query);
  if (!needle) return true;
  if (normalizeLookup(item.id).includes(needle)) return true;
  if (normalizeLookup(item.name).includes(needle)) return true;
  if (normalizeLookup(item.description).includes(needle)) return true;
  if (normalizeLookup(item.category).includes(needle)) return true;
  if (normalizeLookup(item.slot).includes(needle)) return true;
  return item.tags.some((tag) => normalizeLookup(tag).includes(needle));
}

export function ToneChainStrip({ tones, onChange, onDeleteTone }: ToneChainStripProps) {
  const definitions = useMemo(() => getToneDefinitions(tones), [tones]);
  const names = useMemo(() => definitions.map((definition, index) => getToneName(definition, `Tone ${index + 1}`)), [definitions]);
  const [selectedName, setSelectedName] = useState(tones?.base || names[0] || "");
  const [selectedGearIndex, setSelectedGearIndex] = useState(0);
  const [visualPanelOpen, setVisualPanelOpen] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<string>("all");
  const [catalogSlot, setCatalogSlot] = useState<string>("all");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [newParamName, setNewParamName] = useState("");
  const [newParamValue, setNewParamValue] = useState("50");
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState("");

  useEffect(() => {
    if (!selectedName || !names.includes(selectedName)) {
      setSelectedName(tones?.base && names.includes(tones.base) ? tones.base : names[0] || "");
    }
  }, [names, selectedName, tones?.base]);

  const selectedIndex = Math.max(0, names.indexOf(selectedName));
  const selectedDefinition = definitions[selectedIndex];
  const selectedGearEntries = useMemo(() => getSloppackGearEntries(selectedDefinition), [selectedDefinition]);
  const selectedEntry: SloppackGearEntry | undefined = selectedGearEntries[selectedGearIndex];
  const selectedGear: GearRecord | undefined = selectedEntry?.gear;
  const selectedParams = selectedGear ? getGearParams(selectedGear) : {};
  const vstSuggestions = selectedGear ? getVstSuggestions(selectedGear) : [];
  const vstLookupKey = selectedGear ? getVstLookupKey(selectedGear) : "";
  const selectedCatalogItem = useMemo(() => resolveCatalogItem(selectedGear), [selectedGear]);

  const catalogCategories = useMemo(() => Array.from(new Set(GEAR_CATALOG.map((item) => item.category))), []);
  const catalogSlots = useMemo(() => Array.from(new Set(GEAR_CATALOG.map((item) => item.slot))), []);

  const filteredCatalog = useMemo(() => {
    return GEAR_CATALOG
      .filter((item) => catalogCategory === "all" || item.category === catalogCategory)
      .filter((item) => catalogSlot === "all" || item.slot === catalogSlot)
      .filter((item) => catalogItemMatches(item, catalogQuery));
  }, [catalogCategory, catalogSlot, catalogQuery]);

  const catalogParamKeys = useMemo(() => {
    return new Set((selectedCatalogItem?.parameters ?? []).map((parameter) => parameter.key));
  }, [selectedCatalogItem]);

  const extraParams = useMemo(() => {
    return Object.entries(selectedParams).filter(([key]) => !catalogParamKeys.has(key));
  }, [selectedParams, catalogParamKeys]);

  useEffect(() => {
    setSelectedGearIndex((current) => clampIndex(current, selectedGearEntries.length));
  }, [selectedGearEntries.length]);

  useEffect(() => {
    if (!visualPanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVisualPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [visualPanelOpen]);

  useEffect(() => {
    setJsonDraft(selectedDefinition ? JSON.stringify(selectedDefinition, null, 2) : "{}");
    setJsonError("");
  }, [selectedDefinition]);

  const emitDefinition = (definition: ToneDefinition) => {
    onChange(replaceDefinition(tones, selectedIndex, definition));
  };

  const emitDefinitions = (nextDefinitions: ToneDefinition[], patch?: Partial<ToneBlock>) => {
    onChange({ ...(tones ?? {}), ...patch, definitions: nextDefinitions });
  };

  const updateSelectedGear = (nextGear: GearRecord) => {
    if (!selectedDefinition || !selectedEntry) return;
    emitDefinition(updateSloppackGearEntry(selectedDefinition, selectedEntry, nextGear));
  };

  const addGear = () => {
    if (!selectedDefinition) return;
    emitDefinition(addSloppackGear(selectedDefinition, selectedGearEntries.length));
    setSelectedGearIndex(selectedGearEntries.length);
  };

  const addGearFromCatalog = (item: GearCatalogItem) => {
    if (!selectedDefinition) return;
    const created = makeGearFromCatalog(item) as GearRecord;
    emitDefinition(addSloppackGearRecord(selectedDefinition, selectedGearEntries.length, created, item.id));
    setSelectedGearIndex(selectedGearEntries.length);
  };

  const deleteGear = () => {
    if (!selectedDefinition || !selectedEntry) return;
    emitDefinition(deleteSloppackGearEntry(selectedDefinition, selectedEntry));
    setVisualPanelOpen(false);
    setSelectedGearIndex((current) => Math.max(0, current - 1));
  };

  const addParameter = () => {
    if (!selectedGear || !newParamName.trim()) return;
    updateSelectedGear(setGearParams(selectedGear, { ...selectedParams, [newParamName.trim()]: parseParamValue(newParamValue, 0) }));
    setNewParamName("");
    setNewParamValue("50");
  };

  const updateParam = (key: string, value: unknown) => {
    if (!selectedGear) return;
    updateSelectedGear(setGearParams(selectedGear, { ...selectedParams, [key]: value }));
  };

  const updateCatalogParameter = (spec: GearParameterSpec, rawValue: string | boolean) => {
    if (spec.type === "boolean") {
      const parsed = typeof rawValue === "boolean" ? rawValue : rawValue === "true";
      updateParam(spec.key, parsed);
      return;
    }
    if (spec.type === "number") {
      const parsed = Number(rawValue);
      const fallback = typeof spec.defaultValue === "number" ? spec.defaultValue : 0;
      updateParam(spec.key, Number.isFinite(parsed) ? parsed : fallback);
      return;
    }
    updateParam(spec.key, typeof rawValue === "string" ? rawValue : String(rawValue));
  };

  const renderCatalogParameterControl = (spec: GearParameterSpec) => {
    const rawValue = selectedParams[spec.key] ?? spec.defaultValue;
    if (spec.type === "select") {
      return (
        <select
          value={String(rawValue ?? "")}
          onChange={(event) => updateCatalogParameter(spec, event.target.value)}
        >
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    if (spec.type === "boolean") {
      const current = typeof rawValue === "boolean" ? rawValue : String(rawValue).toLowerCase() === "true";
      return (
        <select
          value={current ? "true" : "false"}
          onChange={(event) => updateCatalogParameter(spec, event.target.value)}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    if (spec.type === "number") {
      const numeric = typeof rawValue === "number" ? rawValue : Number(rawValue);
      const value = Number.isFinite(numeric) ? numeric : (typeof spec.defaultValue === "number" ? spec.defaultValue : 0);
      return (
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={value}
          onChange={(event) => updateCatalogParameter(spec, event.target.value)}
        />
      );
    }
    return (
      <input
        value={String(rawValue ?? "")}
        onChange={(event) => updateCatalogParameter(spec, event.target.value)}
      />
    );
  };

  const renameTone = (newName: string) => {
    const clean = newName.trim();
    if (!clean || !selectedDefinition) return;
    const oldName = selectedName;
    const nextDefinitions = definitions.map((definition, index) => index === selectedIndex ? setToneName(definition, clean) : definition);
    const nextChanges = (tones?.changes ?? []).map((change) => change.name === oldName ? { ...change, name: clean } : change);
    const nextBase = tones?.base === oldName ? clean : tones?.base;
    setSelectedName(clean);
    emitDefinitions(nextDefinitions, { base: nextBase, changes: nextChanges });
  };

  const deleteTone = (toneName: string, toneIndex: number) => {
    const nextName = names[toneIndex + 1] ?? names[toneIndex - 1] ?? "";
    if (!onDeleteTone(toneName)) return;
    if (selectedName === toneName) setSelectedName(nextName);
    setSelectedGearIndex(0);
    setVisualPanelOpen(false);
  };

  const applyJsonDraft = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Tone must be a JSON object.");
      emitDefinition(parsed as ToneDefinition);
      setJsonError("");
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  if (!definitions.length) {
    return (
      <section className="panel toneChainUnderTab">
        <div className="panelHeader compactHeader">
          <div>
            <h3>Tone effect chain</h3>
            <span>No tone is present in the selected arrangement.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel toneChainUnderTab">
      <div className="panelHeader compactHeader">
        <div>
          <h3>Tone effect chain</h3>
          <span>Chain read from and saved to the sloppack block <code>tones.definitions[].GearList</code>.</span>
        </div>
      </div>

      <div className="toneChainLayout">
        <div className="toneChainToneList" aria-label="Tone definitions in the sloppack">
          {names.map((name, index) => (
            <div className="toneListRow" key={`${name}-${index}`}>
              <button className={`tonePill ${name === selectedName ? "selected" : ""}`} onClick={() => { setSelectedName(name); setSelectedGearIndex(0); setVisualPanelOpen(false); }}>
                {name}
              </button>
              <button type="button" className="dangerButton toneListDelete" onClick={() => deleteTone(name, index)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="toneChainMain">
          <div className="toneNameLine">
            <label>
              Tone name
              <input value={selectedName} onChange={(event) => renameTone(event.target.value)} />
            </label>
            <button className="smallButton" onClick={addGear}>Add blank effect</button>
          </div>

          <details className="gearBrowserDetails">
            <summary>Add effect from catalog</summary>
            <div className="gearBrowserControls">
              <label>
                Category
                <select value={catalogCategory} onChange={(event) => setCatalogCategory(event.target.value)}>
                  <option value="all">All</option>
                  {catalogCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Search
                <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Name, tag, description" />
              </label>
              <label>
                Slot
                <select value={catalogSlot} onChange={(event) => setCatalogSlot(event.target.value)}>
                  <option value="all">All</option>
                  {catalogSlots.map((slot) => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="gearCatalogList">
              {filteredCatalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="gearCatalogItem"
                  onClick={() => addGearFromCatalog(item)}
                  title="Add this catalog effect to GearList"
                >
                  <span>{item.category} · {item.slot}</span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
              {filteredCatalog.length === 0 && (
                <p className="hint smallHint paddedHint">No catalog effects match current filters.</p>
              )}
            </div>
          </details>

          {selectedGearEntries.length === 0 ? (
            <p className="hint smallHint paddedHint">
              This tone does not contain <code>GearList</code> in the recognized sloppack format, or the list is empty. You can add an effect to GearList or edit the raw JSON below.
            </p>
          ) : (
            <div className="effectChainGraphic largeEffectChain" aria-label="Graphical effect chain from GearList">
              {selectedGearEntries.map((entry, index) => (
                <div className="effectChainNodeWrap" key={`${entry.slot}-${index}`}>
                  <button className={`effectChainNode ${index === selectedGearIndex ? "selected" : ""}`} onClick={() => { setSelectedGearIndex(index); setVisualPanelOpen(true); }} title="Open graphical effect panel">
                    <span className="effectIndex">{index + 1}</span>
                    <strong>{entry.label}</strong>
                    <small>{getGearType(entry.gear)}{entry.slot ? ` · ${entry.slot}` : ""}</small>
                  </button>
                  {index < selectedGearEntries.length - 1 && <span className="effectChainArrow">→</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toneParamSide">
          {selectedGear ? (
            <>
              <div className="subHeader splitSubHeader">
                <span>Effect parameters</span>
                <button className="dangerButton" onClick={deleteGear}>Delete</button>
              </div>
              {vstSuggestions.length > 0 ? (
                <div className="toneVstPanel">
                  <div className="subHeader">VST mapping suggestions</div>
                  <ul className="hint smallHint">
                    {vstSuggestions.map((candidate, index) => (
                      <li key={`${getVstPluginName(candidate)}-${index}`}>
                        <strong>{getVstPluginName(candidate)}</strong>
                        {String(candidate.manufacturer || "").trim() ? ` · ${candidate.manufacturer}` : ""}
                        {String(candidate.format || "").trim() ? ` · ${candidate.format}` : ""}
                        {Object.keys(getVstParamMappings(candidate)).length ? ` — ${Object.keys(getVstParamMappings(candidate)).length} mapped knob${Object.keys(getVstParamMappings(candidate)).length === 1 ? "" : "s"}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : vstLookupKey ? (
                <p className="hint smallHint">No VST mapping found for gear lookup <code>{vstLookupKey}</code>.</p>
              ) : null}
              <div className="gearMetaGrid compactGearGrid">
                <label>Name <input value={String(selectedGear.Name ?? selectedGear.name ?? "")} onChange={(event) => updateSelectedGear(updateGearField(selectedGear, "Name", event.target.value))} /></label>
                <label>Type <input value={String(selectedGear.Type ?? selectedGear.type ?? "")} onChange={(event) => updateSelectedGear(updateGearField(selectedGear, "Type", event.target.value))} /></label>
                <label>Key <input value={getGearKey(selectedGear)} onChange={(event) => updateSelectedGear(updateGearField(selectedGear, "Key", event.target.value))} /></label>
                <label>Slot <input value={getGearSlot(selectedGear) || selectedEntry?.slot || ""} onChange={(event) => updateSelectedGear(updateGearField(selectedGear, "Slot", event.target.value))} /></label>
              </div>
              {selectedCatalogItem && (
                <p className="hint smallHint paddedHint">
                  Catalog preset: <strong>{selectedCatalogItem.name}</strong> ({selectedCatalogItem.source}).
                </p>
              )}
              <div className="paramGrid toneInlineParams">
                {selectedCatalogItem ? (
                  selectedCatalogItem.parameters.map((spec) => (
                    <label key={spec.key}>
                      {spec.key}{spec.unit ? ` (${spec.unit})` : ""}
                      {renderCatalogParameterControl(spec)}
                    </label>
                  ))
                ) : (
                  Object.entries(selectedParams).map(([key, value]) => (
                    <label key={key}>
                      {key}
                      <span className="paramInputLine">
                        <input value={String(value)} type={typeof value === "number" ? "number" : "text"} step={typeof value === "number" ? "0.01" : undefined} onChange={(event) => updateSelectedGear(setGearParams(selectedGear, { ...selectedParams, [key]: parseParamValue(event.target.value, value) }))} />
                        <button className="dangerButton miniButton" onClick={() => { const next = { ...selectedParams }; delete next[key]; updateSelectedGear(setGearParams(selectedGear, next)); }}>×</button>
                      </span>
                    </label>
                  ))
                )}
                {selectedCatalogItem && extraParams.map(([key, value]) => (
                  <label key={key}>
                    {key}
                    <span className="paramInputLine">
                      <input value={String(value)} type={typeof value === "number" ? "number" : "text"} step={typeof value === "number" ? "0.01" : undefined} onChange={(event) => updateSelectedGear(setGearParams(selectedGear, { ...selectedParams, [key]: parseParamValue(event.target.value, value) }))} />
                      <button className="dangerButton miniButton" onClick={() => { const next = { ...selectedParams }; delete next[key]; updateSelectedGear(setGearParams(selectedGear, next)); }}>×</button>
                    </span>
                  </label>
                ))}
                <label>
                  New parameter
                  <span className="paramInputLine">
                    <input value={newParamName} onChange={(event) => setNewParamName(event.target.value)} placeholder="Gain" />
                    <input value={newParamValue} onChange={(event) => setNewParamValue(event.target.value)} placeholder="50" />
                    <button className="smallButton miniButton" onClick={addParameter}>+</button>
                  </span>
                </label>
              </div>
            </>
          ) : <p className="hint smallHint paddedHint">Select an effect in the GearList chain to edit its parameters.</p>}
        </div>
      </div>

      {visualPanelOpen && selectedGear ? (
        <div className="gearVisualDrawerBackdrop" role="presentation" onMouseDown={() => setVisualPanelOpen(false)}>
          <aside
            className="gearVisualDrawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Graphical controls for ${getGearLabel(selectedGear, selectedEntry?.label || "effect")}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="panelHeader withAction">
              <div>
                <h3>{getGearLabel(selectedGear, selectedEntry?.label || "Effect")}</h3>
                <span className="miniMeta">Graphical controls · changes are applied directly to the tone</span>
              </div>
              <button type="button" className="secondaryButton" onClick={() => setVisualPanelOpen(false)}>Close</button>
            </div>
            <div className="gearVisualStage">
              <GearVisual
                gearKey={getGearKey(selectedGear)}
                label={getGearLabel(selectedGear, selectedEntry?.label || "Effect")}
                type={getGearType(selectedGear)}
                slot={getGearSlot(selectedGear) || selectedEntry?.slot || ""}
                params={selectedParams}
                onParamChange={updateParam}
              />
            </div>
          </aside>
        </div>
      ) : null}

      <details className="toneRawDetails toneRawUnderTab">
        <summary>Raw JSON for selected tone</summary>
        <p className="hint smallHint">This is the original object inside <code>tones.definitions[]</code>. The graphical chain directly edits its <code>GearList</code>.</p>
        <textarea
          value={jsonDraft}
          onChange={(event) => { setJsonDraft(event.target.value); setJsonError(""); }}
          onBlur={applyJsonDraft}
          spellCheck={false}
        />
        <div className="rawJsonActions">
          <button className="smallButton" onClick={applyJsonDraft}>Apply JSON</button>
          {jsonError && <span className="errorText">{jsonError}</span>}
        </div>
      </details>
    </section>
  );
}
