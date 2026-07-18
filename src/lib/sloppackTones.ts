import type { ToneBlock, ToneChange } from "../types/music";

export type ToneDefinition = Record<string, unknown>;
export type GearRecord = Record<string, unknown>;

export type GearPath =
  | { kind: "array"; index: number }
  | { kind: "object"; key: string };

export interface SloppackGearEntry {
  path: GearPath;
  gear: GearRecord;
  originalValue: unknown;
  label: string;
  slot: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function preferredString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeToneBlock(tones?: ToneBlock | null): ToneBlock | null {
  if (!tones || typeof tones !== "object") return null;
  const next: ToneBlock = {};
  if (typeof tones.base === "string" && tones.base.trim()) next.base = tones.base.trim();
  if (Array.isArray(tones.changes)) {
    next.changes = tones.changes
      .filter((change): change is ToneChange => Boolean(change) && typeof change.name === "string" && Boolean(change.name.trim()) && Number.isFinite(Number(change.t)))
      .map((change) => ({ t: Number(Number(change.t).toFixed(3)), name: change.name.trim() }))
      .sort((a, b) => a.t - b.t);
  }
  if (Array.isArray(tones.definitions)) {
    next.definitions = tones.definitions.filter(isRecord).map((definition) => cloneJson(definition));
  }
  return Object.keys(next).length ? next : null;
}

export function getToneDefinitions(tones?: ToneBlock | null): ToneDefinition[] {
  return Array.isArray(tones?.definitions) ? tones!.definitions!.filter(isRecord).map((definition) => definition as ToneDefinition) : [];
}

export function getToneName(definition: ToneDefinition | undefined, fallback: string): string {
  if (!definition) return fallback;
  return preferredString(definition.Name, definition.name, definition.Key, definition.key) || fallback;
}

export function setToneName(definition: ToneDefinition, name: string): ToneDefinition {
  const next = { ...definition };
  if ("Name" in next || !("name" in next)) next.Name = name;
  else next.name = name;
  return next;
}

export function getSloppackGearList(definition?: ToneDefinition): unknown {
  if (!definition) return undefined;
  // The sloppack tone schema stores the Rocksmith tone object verbatim.
  // Its effect chain is the raw GearList member of each definition.
  if ("GearList" in definition) return definition.GearList;
  return undefined;
}

function primitiveGear(slot: string, value: unknown): GearRecord {
  return {
    Name: preferredString(value) || slot,
    Key: preferredString(value),
    Slot: slot,
    _feedbackStudioPrimitiveValue: value,
  };
}

export function getSloppackGearEntries(definition?: ToneDefinition): SloppackGearEntry[] {
  const raw = getSloppackGearList(definition);
  if (Array.isArray(raw)) {
    return raw.map((value, index) => {
      const slot = String(index + 1);
      const gear = isRecord(value) ? value as GearRecord : primitiveGear(slot, value);
      return {
        path: { kind: "array", index },
        originalValue: value,
        gear,
        slot: getGearSlot(gear) || slot,
        label: getGearLabel(gear, `Effect ${index + 1}`),
      };
    });
  }
  if (isRecord(raw)) {
    return Object.entries(raw).map(([key, value]) => {
      const gear = isRecord(value) ? value as GearRecord : primitiveGear(key, value);
      return {
        path: { kind: "object", key },
        originalValue: value,
        gear,
        slot: getGearSlot(gear) || key,
        label: getGearLabel(gear, key),
      };
    });
  }
  return [];
}

export function getGearLabel(gear: GearRecord, fallback = "Effect"): string {
  return preferredString(gear.Name, gear.name, gear.DisplayName, gear.displayName, gear.Key, gear.key, gear.Id, gear.id) || fallback;
}

export function getGearType(gear: GearRecord): string {
  return preferredString(gear.Type, gear.type, gear.Category, gear.category, gear.Slot, gear.slot, gear.PedalType, gear.pedalType) || "Gear";
}

export function getGearKey(gear: GearRecord): string {
  return preferredString(gear.Key, gear.key, gear.Id, gear.id);
}

export function getGearSlot(gear: GearRecord): string {
  return preferredString(gear.Slot, gear.slot, gear.PedalType, gear.pedalType);
}

export function getVstData(gear: GearRecord): Record<string, unknown> | undefined {
  const vst = gear._feedback_studio_vst ?? gear._vst ?? gear._feedbackStudioVst;
  return isRecord(vst) ? (vst as Record<string, unknown>) : undefined;
}

export function getVstSuggestions(gear: GearRecord): Record<string, unknown>[] {
  const vst = getVstData(gear);
  if (!vst) return [];
  const raw = vst.suggestions;
  return Array.isArray(raw) ? raw.filter(isRecord) as Record<string, unknown>[] : [];
}

export function getVstLookupKey(gear: GearRecord): string {
  const vst = getVstData(gear);
  if (!vst) return "";
  return preferredString(vst.lookupKey, vst.lookup_key, vst.lookup, vst.key);
}

export function getVstPluginName(candidate: Record<string, unknown>): string {
  return preferredString(candidate.name, candidate.plugin, candidate.pluginKey, candidate.plugin_key) || "VST";
}

export function getVstParamMappings(candidate: Record<string, unknown>): Record<string, unknown> {
  const raw = candidate.parameterMappings ?? candidate.parameter_mappings ?? {};
  return isRecord(raw) ? raw as Record<string, unknown> : {};
}

function stripInternalFields(gear: GearRecord): GearRecord {
  const next = { ...gear };
  delete next._feedbackStudioPrimitiveValue;
  return next;
}

function updateGearListValue(raw: unknown, entry: SloppackGearEntry, nextGear: GearRecord): unknown {
  const cleaned = stripInternalFields(nextGear);
  if (Array.isArray(raw) && entry.path.kind === "array") {
    const targetIndex = entry.path.index;
    return raw.map((value, index) => index === targetIndex ? cleaned : value);
  }
  if (isRecord(raw) && entry.path.kind === "object") {
    return { ...raw, [entry.path.key]: cleaned };
  }
  return raw;
}

export function updateSloppackGearEntry(definition: ToneDefinition, entry: SloppackGearEntry, nextGear: GearRecord): ToneDefinition {
  const next = { ...definition };
  const raw = getSloppackGearList(definition);
  next.GearList = updateGearListValue(raw, entry, nextGear);
  return next;
}

export function addSloppackGear(definition: ToneDefinition, index: number): ToneDefinition {
  const next = { ...definition };
  const raw = getSloppackGearList(definition);
  const created: GearRecord = { Name: `Effect ${index + 1}`, Key: "", Type: "Pedal", Params: {} };
  if (Array.isArray(raw)) next.GearList = [...raw, created];
  else if (isRecord(raw)) next.GearList = { ...raw, [`Effect${index + 1}`]: created };
  else next.GearList = [created];
  return next;
}

export function addSloppackGearRecord(
  definition: ToneDefinition,
  index: number,
  gear: GearRecord,
  objectKey?: string,
): ToneDefinition {
  const next = { ...definition };
  const raw = getSloppackGearList(definition);
  const created = stripInternalFields(cloneJson(gear));
  if (Array.isArray(raw)) {
    next.GearList = [...raw, created];
  } else if (isRecord(raw)) {
    const key = objectKey?.trim() || `Effect${index + 1}`;
    next.GearList = { ...raw, [key]: created };
  } else {
    next.GearList = [created];
  }
  return next;
}

export function deleteSloppackGearEntry(definition: ToneDefinition, entry: SloppackGearEntry): ToneDefinition {
  const next = { ...definition };
  const raw = getSloppackGearList(definition);
  if (Array.isArray(raw) && entry.path.kind === "array") {
    const targetIndex = entry.path.index;
    next.GearList = raw.filter((_, index) => index !== targetIndex);
  } else if (isRecord(raw) && entry.path.kind === "object") {
    const copy = { ...raw };
    delete copy[entry.path.key];
    next.GearList = copy;
  }
  return next;
}

export function getGearParams(gear: GearRecord): Record<string, unknown> {
  const raw = gear.Parameters ?? gear.parameters ?? gear.Params ?? gear.params ?? gear.KnobValues ?? gear.knobValues ?? gear.Knobs ?? gear.knobs;
  return isRecord(raw) ? raw : {};
}

export function setGearParams(gear: GearRecord, params: Record<string, unknown>): GearRecord {
  const next = { ...gear };
  if ("Parameters" in next) next.Parameters = params;
  else if ("parameters" in next) next.parameters = params;
  else if ("Params" in next) next.Params = params;
  else if ("params" in next) next.params = params;
  else if ("KnobValues" in next) next.KnobValues = params;
  else if ("knobValues" in next) next.knobValues = params;
  else if ("Knobs" in next) next.Knobs = params;
  else if ("knobs" in next) next.knobs = params;
  else next.Params = params;
  return next;
}

export function updateGearField(gear: GearRecord, field: "Name" | "Type" | "Key" | "Slot", value: string): GearRecord {
  const next = { ...gear };
  if (field === "Name") {
    if ("Name" in next || !("name" in next)) next.Name = value;
    else next.name = value;
  } else if (field === "Type") {
    if ("Type" in next || !("type" in next)) next.Type = value;
    else next.type = value;
  } else if (field === "Key") {
    if ("Key" in next || !("key" in next)) next.Key = value;
    else next.key = value;
  } else if (field === "Slot") {
    if ("Slot" in next || !("slot" in next)) next.Slot = value;
    else next.slot = value;
  }
  return next;
}

export function parseParamValue(value: string, previous: unknown): unknown {
  if (typeof previous === "boolean") return value === "true";
  if (typeof previous === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : previous;
  }
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return value;
}

export function replaceDefinition(tones: ToneBlock | null | undefined, index: number, definition: ToneDefinition): ToneBlock {
  const definitions = getToneDefinitions(tones).map((item, itemIndex) => itemIndex === index ? definition : item);
  return { ...(tones ?? {}), definitions };
}
