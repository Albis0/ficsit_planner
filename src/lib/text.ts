/** Lower-cased, accent-free form of a name, so a search for "alclad" also finds "Alclad". */
export const searchKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Alternate recipes are named "Alternate: Cast Screw"; the kind is shown separately, so drop the prefix. */
export const recipeLabel = (label: string, kind: string) => (kind === 'alternate' ? label.replace(/^[^:]+:\s*/, '') : label);

/** "Miner Mk.2" -> "Mk.2" where the miner picker already says what it is. */
export const minerLabel = (label: string) => label.match(/Mk\.\s?\d+$/)?.[0] ?? label;
