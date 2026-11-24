import { alternativesFor, dishMacros, foodLine, type PlannedEntry } from "@intake/shared";
import { useState } from "react";
import { MealCourseSheet } from "./MealCourseSheet";
import { otherFromDish, otherFromManual, otherFromRecognized, otherKcal, type OtherCourse } from "../lib/otherCourse";
import { photoForRecognition } from "../lib/image";
import { useDishGroups, useFeatures, useRecognizeMeal } from "../api/queries";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

/**
 * Which dish of a planned meal was eaten: the planned one or one of its interchangeable dishes (Piatti intercambiabili,
 * docs/dish-groups.md). "Mangiato come previsto" then logs the chosen dish with its foods.
 */
export function useDishChoice(entry: PlannedEntry) {
  const groups = useDishGroups();
  const alternatives = alternativesFor(groups.data ?? [], entry.foods);
  const [chosen, setChosen] = useState<number | null>(null);
  const alt = chosen === null ? undefined : alternatives[chosen];
  const macros = alt ? dishMacros(alt.dish) : (entry.macros ?? null);
  return {
    alternatives,
    chosen: alt ? chosen : null,
    choose: setChosen,
    canLog: macros !== null,
    kcal: macros?.kcal ?? null,
    summary: alt ? alt.dish.name : entry.foods,
    lines: alt ? alt.dish.foods.map(foodLine) : entry.lines.length > 0 ? entry.lines : [entry.foods],
    alternative: alt ? { groupId: alt.groupId, dishIndex: alt.dishIndex } : undefined,
  };
}

export type DishChoiceState = ReturnType<typeof useDishChoice>;

/**
 * The choice, closed until "Alternative (N)" is tapped; nothing when the planned dish has no interchangeable dishes.
 * Closing it goes back to the planned dish.
 */
export function DishChoice({ entry, choice }: { entry: PlannedEntry; choice: DishChoiceState }) {
  const [open, setOpen] = useState(false);
  if (choice.alternatives.length === 0) return null;
  if (!open) {
    return (
      <button type="button" className="button-small button-outline dish-choice-toggle" aria-expanded={false} onClick={() => setOpen(true)}>
        {t.dishes.showAlternatives(choice.alternatives.length)}
      </button>
    );
  }
  const chips = [{ key: "planned", label: entry.foods, tag: t.dishes.planned, value: null as number | null }, ...choice.alternatives.map((alt, i) => ({ key: `${alt.groupId}-${alt.dishIndex}`, label: alt.dish.name, tag: null, value: i }))];
  return (
    <div className="dish-choice" role="group" aria-label={t.dishes.eaten}>
      <div className="dish-choice-head">
        <span className="dish-choice-title">{t.dishes.eaten}</span>
        <button
          type="button"
          className="text-button dish-choice-close"
          aria-expanded={true}
          onClick={() => {
            choice.choose(null);
            setOpen(false);
          }}
        >
          {t.dishes.hideAlternatives}
        </button>
      </div>
      <div className="dish-choice-chips">
        {chips.map((chip) => {
          const kcal = chip.value === null ? (entry.macros?.kcal ?? null) : (dishMacros(choice.alternatives[chip.value]!.dish)?.kcal ?? null);
          return (
            <button key={chip.key} type="button" className="dish-chip" aria-pressed={choice.chosen === chip.value} onClick={() => choice.choose(chip.value)}>
              <span className="dish-chip-name">{chip.label}</span>
              <span className="dish-chip-meta">
                {chip.tag && <span className="dish-chip-tag">{chip.tag}</span>}
                {kcal !== null ? `${formatKcal(kcal)} kcal` : t.dishes.noValues}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type LogChoice = {
  alternative?: { groupId: number; dishIndex: number };
  courses?: Array<{ eaten: boolean; alternative?: { groupId: number; dishIndex: number }; other?: OtherCourse }>;
};

/**
 * A planned meal with courses (docs/courses.md): which courses were eaten (all, until one is unticked) and, for each,
 * the planned dish or one of its interchangeable dishes. "Mangiato come previsto" logs them as one meal.
 */
export function useCoursesChoice(entry: PlannedEntry) {
  const groups = useDishGroups();
  const courses = entry.courses ?? [];
  const [eaten, setEaten] = useState<boolean[]>(() => courses.map(() => true));
  const [chosen, setChosen] = useState<Array<number | null>>(() => courses.map(() => null));
  // "Altro…": what was eaten in place of a course; it wins over the planned dish and its alternatives
  const [others, setOthers] = useState<Array<OtherCourse | null>>(() => courses.map(() => null));
  const rows = courses.map((course, i) => {
    const alternatives = alternativesFor(groups.data ?? [], course.foods);
    const other = others[i] ?? null;
    const alt = other || chosen[i] === null || chosen[i] === undefined ? undefined : alternatives[chosen[i]!];
    const macros = other ? { kcal: otherKcal(other), protein: 0, carbs: 0, fat: 0, fiber: 0 } : alt ? dishMacros(alt.dish) : course.macros;
    const text = other ? other.name : alt ? alt.dish.name : course.foods;
    const lines = other ? other.foods.map(foodLine) : alt ? alt.dish.foods.map(foodLine) : course.lines;
    return { course, alternatives, alt, other, eaten: eaten[i] ?? true, chosen: alt ? chosen[i]! : null, macros, text, lines };
  });
  const picked = rows.filter((r) => r.eaten);
  const hasOther = picked.some((r) => r.other);
  // Courses split from a meal with totals only have no values: the whole meal as planned still logs with its totals
  const asPlanned = rows.every((r) => r.eaten && !r.alt && !r.other) && entry.macros !== null && entry.macros !== undefined;
  const summed = picked.length > 0 && picked.every((r) => r.macros);
  const canLog = summed || asPlanned;
  const kcal = summed ? Math.round(picked.reduce((s, r) => s + r.macros!.kcal, 0)) : asPlanned ? Math.round(entry.macros!.kcal) : null;
  return {
    rows,
    canLog,
    kcal,
    /** "Mangiato come previsto · 640 kcal", or "Registra · 720 kcal" once a course is something else. */
    label: kcal === null ? t.timeline.eatenAsPlanned : hasOther ? t.courses.register(formatKcal(kcal)) : t.courses.logChosen(formatKcal(kcal)),
    toggle: (i: number) => setEaten((list) => list.map((v, j) => (j === i ? !v : v))),
    choose: (i: number, value: number | null) => {
      setOthers((list) => list.map((v, j) => (j === i ? null : v)));
      setChosen((list) => list.map((v, j) => (j === i ? value : v)));
    },
    setOther: (i: number, other: OtherCourse | null) => {
      setOthers((list) => list.map((v, j) => (j === i ? other : v)));
      if (other) setEaten((list) => list.map((v, j) => (j === i ? true : v)));
    },
    body: {
      courses: rows.map((r) => ({ eaten: r.eaten, ...(r.other ? { other: r.other } : r.alt ? { alternative: { groupId: r.alt.groupId, dishIndex: r.alt.dishIndex } } : {}) })),
    } satisfies LogChoice,
  };
}

export type CoursesChoiceState = ReturnType<typeof useCoursesChoice>;

/** "Cosa hai mangiato?": one row per course with a tick, chips for its interchangeable dishes and "Altro…". */
export function CoursesChoice({ choice, label }: { choice: CoursesChoiceState; label: (name: string) => string }) {
  const [otherFor, setOtherFor] = useState<number | null>(null);
  const canRecognize = useFeatures().data?.recognition === true;
  const recognize = useRecognizeMeal();
  const [failed, setFailed] = useState(false);
  const done = (i: number, other: OtherCourse | null) => {
    if (!other) return setFailed(true);
    choice.setOther(i, other);
    setOtherFor(null);
  };
  return (
    <div className="course-choice" role="group" aria-label={t.courses.eaten}>
      <span className="dish-choice-title">{t.courses.eaten}</span>
      {choice.rows.map((row, i) => (
        <div key={i} className="course-choice-row" data-eaten={row.eaten || undefined}>
          <input type="checkbox" className="course-check" checked={row.eaten} aria-label={t.courses.toggle(label(row.course.name))} onChange={() => choice.toggle(i)} />
          <div className="course-choice-body">
            <span className="plan-course-name">
              {label(row.course.name).toUpperCase()}
              {!row.eaten && ` · ${t.courses.skipped.toUpperCase()}`}
            </span>
            {row.eaten && row.other ? (
              <div className="course-other">
                <span className="course-choice-text">
                  <span className="dish-chip-tag">{t.courses.otherTag}</span> {row.other.name} · {formatKcal(otherKcal(row.other))} kcal
                </span>
                <button type="button" className="item-remove" aria-label={t.courses.otherUndo(label(row.course.name))} onClick={() => choice.setOther(i, null)}>
                  ×
                </button>
              </div>
            ) : row.eaten ? (
              <div className="dish-choice-chips">
                {[null, ...row.alternatives.map((_, k) => k)].map((value) => {
                  const dish = value === null ? null : row.alternatives[value]!.dish;
                  const kcal = value === null ? (row.course.macros?.kcal ?? null) : (dishMacros(dish!)?.kcal ?? null);
                  return (
                    <button key={value ?? "planned"} type="button" className="dish-chip" aria-pressed={row.chosen === value} onClick={() => choice.choose(i, value)}>
                      <span className="dish-chip-name">{dish ? dish.name : row.course.foods}</span>
                      <span className="dish-chip-meta">
                        {value === null && <span className="dish-chip-tag">{t.dishes.planned}</span>}
                        {kcal !== null ? `${formatKcal(kcal)} kcal` : t.dishes.noValues}
                      </span>
                    </button>
                  );
                })}
                <button type="button" className="dish-chip dish-chip-other" aria-label={t.courses.otherOf(label(row.course.name))} onClick={() => { setFailed(false); recognize.reset(); setOtherFor(i); }}>
                  <span className="dish-chip-name">{t.courses.otherChip}</span>
                </button>
              </div>
            ) : (
              <span className="course-choice-text">{row.text}</span>
            )}
          </div>
        </div>
      ))}
      {otherFor !== null && choice.rows[otherFor] && (
        <MealCourseSheet
          fixedName={choice.rows[otherFor]!.course.name}
          askFirst={false}
          ai={canRecognize}
          busy={recognize.isPending}
          error={failed || recognize.isError ? t.courses.otherFailed : null}
          onClose={() => setOtherFor(null)}
          onText={(text) => recognize.mutate({ text }, { onSuccess: (meal) => done(otherFor, otherFromRecognized(meal.description || text, meal.items)), onError: () => setFailed(true) })}
          onPhoto={(file) =>
            void photoForRecognition(file)
              .then((photo) => recognize.mutate({ images: [{ mediaType: photo.mediaType, data: photo.data }] }, { onSuccess: (meal) => done(otherFor, otherFromRecognized(meal.description, meal.items)) }))
              .catch(() => setFailed(true))
          }
          onDish={(dish) => done(otherFor, otherFromDish(dish))}
          onManual={(food) => done(otherFor, otherFromManual(food))}
        />
      )}
    </div>
  );
}
