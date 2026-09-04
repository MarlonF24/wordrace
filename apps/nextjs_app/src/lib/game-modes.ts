/** Browser-safe game-mode values and labels shared with the database schema. */

export const GAME_MODE_VALUES = ['normal', 'collide'] as const;

export type GameMode = (typeof GAME_MODE_VALUES)[number];

export const GAME_MODES: Record<GameMode, { label: string; description: string }> = {
    normal: {
        label: 'Normal',
        description: 'Race from Start to Target',
    },
    collide: {
        label: 'Collide',
        description: 'Meet in the middle; filler words are not clickable',
    },
};
