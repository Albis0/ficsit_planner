import type { Item } from './data';
import { liftedOnDark } from './settings';

/** A fluid's colour on the pipe, as the game has it, lifted where it would sink into the dark floor (crude oil is near black). */
export const pipeColor = (item: Pick<Item, 'color'> | undefined): string | undefined =>
  item?.color ? liftedOnDark(item.color) : undefined;
