import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MEAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Largest photo kept: the app sends a JPEG resized to 1568 px, usually 200–400 KB. */
export const MEAL_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Photos of meals logged from a photo, one JPEG per Nutrition meal id in `<DATA_DIR>/meal-photos/`. Nutrition stores
 * no images, so this is local data like the plans; it is in the data volume, so deploy.sh backs it up.
 */
export class MealPhotoStore {
  constructor(private readonly dir: string) {}

  static isMealId(id: string): boolean {
    return MEAL_ID.test(id);
  }

  /** A JPEG starts with FF D8 FF; anything else is refused. */
  static isJpeg(bytes: Buffer): boolean {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  save(mealId: string, jpeg: Buffer): void {
    if (!MealPhotoStore.isMealId(mealId)) throw new Error("invalid meal id");
    if (!MealPhotoStore.isJpeg(jpeg) || jpeg.length > MEAL_PHOTO_MAX_BYTES) throw new Error("invalid photo");
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(mealId), jpeg);
  }

  get(mealId: string): Buffer | null {
    if (!MealPhotoStore.isMealId(mealId)) return null;
    try {
      return readFileSync(this.path(mealId));
    } catch {
      return null;
    }
  }

  delete(mealId: string): void {
    if (MealPhotoStore.isMealId(mealId)) rmSync(this.path(mealId), { force: true });
  }

  /** Ids of the meals that have a photo. */
  list(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((name) => name.endsWith(".jpg"))
        .map((name) => name.slice(0, -4))
        .filter((id) => MealPhotoStore.isMealId(id));
    } catch {
      return [];
    }
  }

  private path(mealId: string): string {
    return join(this.dir, `${mealId.toLowerCase()}.jpg`);
  }
}
