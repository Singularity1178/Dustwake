import { saveToStorage as save, loadFromStorage as load } from "../world/save";
import type { World } from "../world/world";

export const saveToStorage = (w: World) => save(w, localStorage);
export const loadFromStorage = () => load(localStorage);