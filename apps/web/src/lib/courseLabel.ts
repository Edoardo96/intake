import { COURSE_NAMES } from "@intake/shared";
import { t } from "./strings";

/** The name of a course in the app's language (plans keep the Italian names), or the person's own as written. */
export function courseLabel(name: string): string {
  const i = (COURSE_NAMES as readonly string[]).indexOf(name);
  return i >= 0 ? t.courses.names[i]! : name;
}
