export type MentionType = 'user' | 'channel' | 'role';

export type SpecialMention = 'everyone' | 'here';

export type MentionMatch = {
        type: MentionType;
        id: string;
        start: number;
        end: number;
        raw: string;
        special?: SpecialMention | null;
};

export const MENTION_ACCENT_COLORS: Record<MentionType, string> = {
        user: '#5865F2',
        role: '#5865F2',
        channel: '#4F545C'
};

const MENTION_PATTERN = /<(@&|@!|@|#)([0-9]{1,})>/g;
const SPECIAL_MENTION_PATTERN = /@everyone|@here/g;

const SPECIAL_MENTION_MAP: Record<string, SpecialMention> = {
        '@everyone': 'everyone',
        '@here': 'here'
};

function normalizeMentionType(prefix: string): MentionType | null {
	if (prefix === '#') return 'channel';
	if (prefix === '@' || prefix === '@!') return 'user';
	if (prefix === '@&') return 'role';
	return null;
}

export function parseMentions(content: string | null | undefined): MentionMatch[] {
        if (!content) return [];
        const matches: MentionMatch[] = [];
        const text = String(content);
        MENTION_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = MENTION_PATTERN.exec(text)) !== null) {
                const [raw, prefix, id] = match;
                const type = normalizeMentionType(prefix);
                if (!type) continue;
                const start = match.index;
                const end = start + raw.length;
                matches.push({ type, id, start, end, raw, special: null });
        }
        SPECIAL_MENTION_PATTERN.lastIndex = 0;
        let specialMatch: RegExpExecArray | null;
        while ((specialMatch = SPECIAL_MENTION_PATTERN.exec(text)) !== null) {
                const raw = specialMatch[0];
                const special = SPECIAL_MENTION_MAP[raw];
                if (!special) continue;
                const start = specialMatch.index;
                if (start > 0 && text[start - 1] === '<') {
                        continue;
                }
                const end = start + raw.length;
                matches.push({
                        type: 'user',
                        id: special,
                        start,
                        end,
                        raw,
                        special
                });
        }

        if (matches.length <= 1) {
                return matches;
        }

        matches.sort((a, b) => {
                if (a.start === b.start) {
                        return a.end - b.end;
                }
                return a.start - b.start;
        });

        const filtered: MentionMatch[] = [];
        let lastEnd = -1;
        for (const mention of matches) {
                if (mention.start < lastEnd) {
                        continue;
                }
                filtered.push(mention);
                lastEnd = mention.end;
        }

        return filtered;
}

export type MentionSplitSegment =
	| { type: 'text'; value: string }
	| { type: 'mention'; mention: MentionMatch };

export function splitTextWithMentions(content: string | null | undefined): MentionSplitSegment[] {
	if (!content) return [];
	const segments: MentionSplitSegment[] = [];
	const text = String(content);
	const matches = parseMentions(text);
	if (!matches.length) {
		return [{ type: 'text', value: text }];
	}
	let lastIndex = 0;
	for (const mention of matches) {
		if (mention.start > lastIndex) {
			segments.push({ type: 'text', value: text.slice(lastIndex, mention.start) });
		}
		segments.push({ type: 'mention', mention });
		lastIndex = mention.end;
	}
	if (lastIndex < text.length) {
		segments.push({ type: 'text', value: text.slice(lastIndex) });
	}
	return segments;
}

export function mentionPlaceholder(type: MentionType, id: string): string {
	if (!id) return '';
	if (type === 'channel') return `<#${id}>`;
	if (type === 'role') return `<@&${id}>`;
	return `<@${id}>`;
}

export function findMentionAtIndex(mentions: MentionMatch[], index: number): MentionMatch | null {
	for (const mention of mentions) {
		if (index > mention.start && index < mention.end) {
			return mention;
		}
		if (index === mention.start || index === mention.end) {
			return mention;
		}
	}
	return null;
}

export type MentionTrigger = {
	trigger: '@' | '#';
	start: number;
	query: string;
};

const TRIGGER_PATTERN = /(^|[\s>"'([{])([@#])([^\s@#<>{}]*)$/;

export function detectMentionTrigger(content: string, cursor: number): MentionTrigger | null {
	if (!content) return null;
	if (cursor < 0 || cursor > content.length) return null;
	const before = content.slice(0, cursor);
	const match = before.match(TRIGGER_PATTERN);
	if (!match) return null;
	const [, , rawTrigger, query = ''] = match;
	const start = cursor - query.length - 1;
	if (start > 0 && content[start - 1] === '<') {
		return null;
	}
	if (rawTrigger !== '@' && rawTrigger !== '#') {
		return null;
	}
	return { trigger: rawTrigger, start, query };
}

export function isCursorInsideMention(content: string, cursor: number): MentionMatch | null {
	if (!content) return null;
	if (cursor < 0 || cursor > content.length) return null;
	const matches = parseMentions(content);
	for (const mention of matches) {
		if (cursor > mention.start && cursor < mention.end) {
			return mention;
		}
	}
	return null;
}
