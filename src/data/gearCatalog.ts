export type GearCategory = "Amp" | "Cabinet" | "Pedal" | "Rack" | "Utility";

export interface GearParameterSpec {
  key: string;
  label: string;
  type: "number" | "select" | "boolean" | "text";
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | string | boolean;
  options?: string[];
  unit?: string;
}

export interface GearCatalogItem {
  id: string;
  category: GearCategory;
  name: string;
  slot: "pre" | "amp" | "cabinet" | "loop" | "rack" | "utility";
  description: string;
  source: "starter" | "community" | "imported";
  tags: string[];
  parameters: GearParameterSpec[];
}

const knob = (key: string, label: string, defaultValue = 50): GearParameterSpec => ({
  key,
  label,
  type: "number",
  min: 0,
  max: 100,
  step: 1,
  defaultValue,
});

const mix = (defaultValue = 50): GearParameterSpec => knob("Mix", "Mix", defaultValue);
const level = (defaultValue = 75): GearParameterSpec => knob("Level", "Level", defaultValue);

export const GEAR_CATALOG: GearCatalogItem[] = [
  {
    id: "amp-clean-american",
    category: "Amp",
    name: "American Clean",
    slot: "amp",
    description: "Generic clean amp in an American combo style.",
    source: "starter",
    tags: ["clean", "amp", "guitar"],
    parameters: [knob("Gain", "Gain", 28), knob("Bass", "Bass", 50), knob("Mid", "Mid", 45), knob("Treble", "Treble", 58), knob("Presence", "Presence", 50), level(72)],
  },
  {
    id: "amp-tw-22",
    category: "Amp",
    name: "TW 22 / Boutique Clean",
    slot: "amp",
    description: "Community entry often associated with TW/AMTW amps used in Tone Designer.",
    source: "community",
    tags: ["clean", "tw", "amtw", "amp"],
    parameters: [knob("Gain", "Gain", 34), knob("Bass", "Bass", 48), knob("Mid", "Mid", 52), knob("Treble", "Treble", 60), knob("Reverb", "Reverb", 18), level(70)],
  },
  {
    id: "amp-bassman-style",
    category: "Amp",
    name: "Bassman-style 40",
    slot: "amp",
    description: "Starter amp inspired by AMTW 40 references cited by the community.",
    source: "community",
    tags: ["amp", "vintage", "clean", "bassman"],
    parameters: [knob("Gain", "Gain", 42), knob("Bass", "Bass", 54), knob("Mid", "Mid", 50), knob("Treble", "Treble", 52), knob("Presence", "Presence", 45), level(72)],
  },
  {
    id: "amp-classic-british",
    category: "Amp",
    name: "Classic British Lead",
    slot: "amp",
    description: "Classic rock amp for crunch and lead tones.",
    source: "starter",
    tags: ["amp", "rock", "crunch", "lead"],
    parameters: [knob("Gain", "Gain", 62), knob("Bass", "Bass", 52), knob("Mid", "Mid", 63), knob("Treble", "Treble", 57), knob("Presence", "Presence", 54), level(70)],
  },
  {
    id: "amp-modern-high-gain",
    category: "Amp",
    name: "Modern High Gain",
    slot: "amp",
    description: "High-gain amp for modern rock and metal.",
    source: "starter",
    tags: ["amp", "metal", "distortion", "lead"],
    parameters: [knob("Gain", "Gain", 78), knob("Bass", "Bass", 56), knob("Mid", "Mid", 44), knob("Treble", "Treble", 62), knob("Presence", "Presence", 58), level(66), knob("NoiseGate", "Noise gate", 35)],
  },
  {
    id: "amp-bass-svt-style",
    category: "Amp",
    name: "AT/SVT-style Bass Amp",
    slot: "amp",
    description: "Starter bass amp inspired by AT/SVT references cited by the community.",
    source: "community",
    tags: ["bass", "amp", "svt", "at"],
    parameters: [knob("Drive", "Drive", 35), knob("Bass", "Bass", 64), knob("Mid", "Mid", 55), knob("Treble", "Treble", 45), knob("Presence", "Presence", 40), level(76)],
  },
  {
    id: "cab-112-open",
    category: "Cabinet",
    name: "1x12 Open Back",
    slot: "cabinet",
    description: "Small open-back cabinet.",
    source: "starter",
    tags: ["cab", "guitar", "clean"],
    parameters: [
      { key: "Mic", label: "Mic", type: "select", defaultValue: "Dynamic Edge", options: ["Dynamic Center", "Dynamic Edge", "Condenser", "Ribbon"] },
      knob("Room", "Room", 20),
      level(70),
    ],
  },
  {
    id: "cab-212-combo",
    category: "Cabinet",
    name: "2x12 Combo",
    slot: "cabinet",
    description: "Mid-sized cabinet for clean/crunch tones.",
    source: "starter",
    tags: ["cab", "guitar", "combo"],
    parameters: [
      { key: "Mic", label: "Mic", type: "select", defaultValue: "Dynamic Edge", options: ["Dynamic Center", "Dynamic Edge", "Condenser", "Ribbon"] },
      knob("Room", "Room", 24),
      level(72),
    ],
  },
  {
    id: "cab-412-closed",
    category: "Cabinet",
    name: "4x12 Closed Back",
    slot: "cabinet",
    description: "Closed-back cabinet for rock/metal.",
    source: "starter",
    tags: ["cab", "guitar", "rock", "metal"],
    parameters: [
      { key: "Mic", label: "Mic", type: "select", defaultValue: "Dynamic Center", options: ["Dynamic Center", "Dynamic Edge", "Condenser", "Ribbon"] },
      knob("Room", "Room", 15),
      level(75),
    ],
  },
  {
    id: "cab-bass-810",
    category: "Cabinet",
    name: "8x10 Bass Cabinet",
    slot: "cabinet",
    description: "Large bass cabinet.",
    source: "starter",
    tags: ["cab", "bass"],
    parameters: [
      { key: "Mic", label: "Mic", type: "select", defaultValue: "Dynamic Center", options: ["Dynamic Center", "Dynamic Edge", "Condenser", "Ribbon"] },
      knob("Room", "Room", 12),
      level(76),
    ],
  },
  {
    id: "pedal-super-drive",
    category: "Pedal",
    name: "Super Drive",
    slot: "pre",
    description: "Generic overdrive; community guides compare it to the Super Overdrive family.",
    source: "community",
    tags: ["drive", "overdrive", "pedal", "pre"],
    parameters: [knob("Drive", "Drive", 48), knob("Tone", "Tone", 55), level(72), mix(100)],
  },
  {
    id: "pedal-green-screamer",
    category: "Pedal",
    name: "Green Screamer",
    slot: "pre",
    description: "Mid-hump screamer-style overdrive.",
    source: "starter",
    tags: ["drive", "screamer", "overdrive", "pedal"],
    parameters: [knob("Drive", "Drive", 34), knob("Tone", "Tone", 58), level(78), mix(100)],
  },
  {
    id: "pedal-fuzz",
    category: "Pedal",
    name: "Fuzz Box",
    slot: "pre",
    description: "Aggressive fuzz meant to be used before the amp.",
    source: "starter",
    tags: ["fuzz", "distortion", "pedal"],
    parameters: [knob("Fuzz", "Fuzz", 68), knob("Tone", "Tone", 44), level(68), mix(100)],
  },
  {
    id: "pedal-compressor",
    category: "Pedal",
    name: "Compressor",
    slot: "pre",
    description: "Basic compression for clean, funk, and bass tones.",
    source: "starter",
    tags: ["compressor", "dynamics", "pedal"],
    parameters: [knob("Sustain", "Sustain", 48), knob("Attack", "Attack", 35), level(70), mix(85)],
  },
  {
    id: "pedal-wah",
    category: "Pedal",
    name: "Wah",
    slot: "pre",
    description: "Generic wah/envelope filter.",
    source: "starter",
    tags: ["wah", "filter", "pedal"],
    parameters: [knob("Position", "Position", 50), knob("Resonance", "Resonance", 55), level(70), mix(100)],
  },
  {
    id: "pedal-chorus",
    category: "Pedal",
    name: "Chorus",
    slot: "loop",
    description: "Stereo chorus/modulation.",
    source: "starter",
    tags: ["chorus", "modulation", "pedal"],
    parameters: [knob("Rate", "Rate", 28), knob("Depth", "Depth", 52), level(70), mix(36)],
  },
  {
    id: "pedal-phaser",
    category: "Pedal",
    name: "Phaser",
    slot: "loop",
    description: "Classic phaser.",
    source: "starter",
    tags: ["phaser", "modulation", "pedal"],
    parameters: [knob("Rate", "Rate", 34), knob("Depth", "Depth", 55), knob("Feedback", "Feedback", 38), mix(42)],
  },
  {
    id: "pedal-flanger",
    category: "Pedal",
    name: "Flanger",
    slot: "loop",
    description: "Flanger/modulation.",
    source: "starter",
    tags: ["flanger", "modulation", "pedal"],
    parameters: [knob("Rate", "Rate", 28), knob("Depth", "Depth", 52), knob("Feedback", "Feedback", 48), mix(38)],
  },
  {
    id: "pedal-delay",
    category: "Pedal",
    name: "Delay",
    slot: "loop",
    description: "Simple post-amp delay.",
    source: "starter",
    tags: ["delay", "echo", "pedal", "loop"],
    parameters: [
      { key: "Time", label: "Time", type: "number", min: 40, max: 1500, step: 1, defaultValue: 420, unit: "ms" },
      knob("Feedback", "Feedback", 32),
      mix(28),
      level(70),
    ],
  },
  {
    id: "pedal-reverb",
    category: "Pedal",
    name: "Reverb",
    slot: "loop",
    description: "Generic reverb.",
    source: "starter",
    tags: ["reverb", "space", "pedal", "loop"],
    parameters: [knob("Decay", "Decay", 48), knob("Tone", "Tone", 54), mix(24), level(70)],
  },
  {
    id: "rack-eq",
    category: "Rack",
    name: "Rack EQ",
    slot: "rack",
    description: "Primary multi-band EQ.",
    source: "starter",
    tags: ["eq", "rack", "utility"],
    parameters: [knob("Low", "Low", 50), knob("LowMid", "Low mid", 50), knob("HighMid", "High mid", 50), knob("High", "High", 50), level(70)],
  },
  {
    id: "utility-noise-gate",
    category: "Utility",
    name: "Noise Gate",
    slot: "utility",
    description: "Reduces noise and feedback between notes.",
    source: "starter",
    tags: ["gate", "noise", "utility"],
    parameters: [knob("Threshold", "Threshold", 42), knob("Release", "Release", 45)],
  },
];

export function makeGearFromCatalog(item: GearCatalogItem) {
  return {
    Type: item.category,
    Name: item.name,
    Key: item.id,
    Slot: item.slot,
    Parameters: Object.fromEntries(
      item.parameters.map((parameter) => [parameter.key, parameter.defaultValue]),
    ),
    FeedBackStudioCatalog: {
      id: item.id,
      source: item.source,
      description: item.description,
    },
  };
}
