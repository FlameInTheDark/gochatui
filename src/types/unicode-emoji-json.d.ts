declare module 'unicode-emoji-json/data-by-group.json' {
        type EmojiEntry = {
                emoji: string;
                name: string;
                slug: string;
                skin_tone_support?: boolean;
                unicode_version?: string;
                emoji_version?: string;
        };

        type EmojiGroup = {
                name: string;
                slug: string;
                emojis: EmojiEntry[];
        };

        const data: EmojiGroup[];
        export default data;
}
