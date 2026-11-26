import { alternativesFor, dishMacros, foodLine, type PlannedEntry } from "@intake/shared";
import { useState } from "react";
import { useDishGroups } from "../api/queries";
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

export type LogChoice = { alternative?: { groupId: number; dishIndex: number }; courses?: Array<{ eaten: boolean; alternative?: { groupId: number; dishIndex: number } }> };

/**
 * A planned meal with courses (docs/courses.md): which courses were eaten (all, until one is unticked) and, for each,
 * the planned dish or one of its interchangeable dishes. "Mangiato come previsto" logs them as one meal.
 */
export function useCoursesChoice(entry: PlannedEntry) {
  const groups = useDishGroups();
  const courses = entry.courses ?? [];
  const [eaten, setEaten] = useState<boolean[]>(() => courses.map(() => true));
  const [chosen, setChosen] = useState<Array<number | null>>(() => courses.map(() => null));
  const rows = courses.map((course, i) => {
    const alternatives = alternativesFor(groups.data ?? [], course.foods);
    const alt = chosen[i] === null || chosen[i] === undefined ? undefined : alternatives[chosen[i]!];
    const macros = alt ? dishMacros(alt.dish) : course.macros;
    return { course, alternatives, alt, eaten: eaten[i] ?? true, chosen: alt ? chosen[i]! : null, macros, text: alt ? alt.dish.name : course.foods, lines: alt ? alt.dish.foods.map(foodLine) : course.lines };
  });
  const picked = rows.filter((r) => r.eaten);
  // Courses split from a meal with totals only have no values: the whole meal as planned still logs with its totals
  const asPlanned = rows.every((r) => r.eaten && !r.alt) && entry.macros !== null && entry.macros !== undefined;
  const summed = picked.length > 0 && picked.every((r) => r.macros);
  const canLog = summed || asPlanned;
  return {
    rows,
    canLog,
    kcal: summed ? Math.round(picked.reduce((s, r) => s + r.macros!.kcal, 0)) : asPlanned ? Math.round(entry.macros!.kcal) : null,
    toggle: (i: number) => setEaten((list) => list.map((v, j) => (j === i ? !v : v))),
    choose: (i: number, value: number | null) => setChosen((list) => list.map((v, j) => (j === i ? value : v))),
    body: { courses: rows.map((r) => ({ eaten: r.eaten, ...(r.alt ? { alternative: { groupId: r.alt.groupId, dishIndex: r.alt.dishIndex } } : {}) })) } satisfies LogChoice,
  };
}

export type CoursesChoiceState = ReturnType<typeof useCoursesChoice>;

/** "Cosa hai mangiato?": one row per course with a tick, and chips for its interchangeable dishes. */
export function CoursesChoice({ choice, label }: { choice: CoursesChoiceState; label: (name: string) => string }) {
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
            {row.eaten && row.alternatives.length > 0 ? (
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
              </div>
            ) : (
              <span className="course-choice-text">
                {row.text}
                {row.macros && ` · ${formatKcal(row.macros.kcal)} kcal`}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
