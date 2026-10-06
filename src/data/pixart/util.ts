/** Symmetric 'Mechs are drawn as their left half (viewer's left) and mirrored. */
export const mirror = (half: string[]): string[] => half.map((r) => r + [...r].reverse().join(''));
