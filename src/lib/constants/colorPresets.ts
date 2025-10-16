export const PRESET_COLORS = [
	'#5865F2',
	'#E873F6',
	'#3BC6B6',
	'#F97316',
	'#F43F5E',
	'#FACC15',
	'#0EA5E9',
	'#22C55E',
	'#A855F7',
	'#F59E0B',
	'#EC4899',
	'#14B8A6'
] as const;

export type PresetColor = (typeof PRESET_COLORS)[number];
