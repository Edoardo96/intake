import { MEAL_TYPES, type Dish, type MealPlan, type PlannedMeal, type Weekday } from "@intake/shared";
import { useState } from "react";
import { mealFoodsText } from "@intake/shared";
import { t } from "../lib/strings";
import { DishPickerSheet, dishAsEdit } from "./DishAlternatives";
import { EditMeal, type DishEdit } from "./PlanDay";

/**
 * "Togli pasto", "Pasti tolti" with "Rimetti", and "+ Aggiungi pasto" in Piano. Each asks whether the change is for this
 * day only or for every day. Rules in docs/plan-meals.md.
 */

/** The two answers "Solo mercoledì" / "Tutti i giorni", with "Annulla". */
function DayChoice({ dayName, busy, onChoose, onCancel, all = true }: { dayName: string; busy?: boolean; onChoose: (allDays: boolean) => void; onCancel: () => void; all?: boolean }) {
  return (
    <div className="plan-replace-actions plan-meals-choice">
      <button type="button" className="button-secondary-small" onClick={onCancel}>
        {t.planMeals.cancel}
      </button>
      <button type="button" className="button-secondary-small" disabled={busy} onClick={() => onChoose(false)}>
        {t.planMeals.onlyDay(dayName)}
      </button>
      {all && (
        <button type="button" className="button-primary-inline" disabled={busy} onClick={() => onChoose(true)}>
          {t.planMeals.allDays}
        </button>
      )}
    </div>
  );
}

export function RemoveMeal({ meal, dayName, inEffect, busy, failed, onRemove }: { meal: PlannedMeal; dayName: string; inEffect: boolean; busy?: boolean; failed?: boolean; onRemove: (allDays: boolean, done: () => void) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="plan-meal-action" onClick={() => setOpen(true)}>
        {t.planMeals.remove}
      </button>
    );
  }
  return (
    <div className="dish-alt-choose plan-meals-panel">
      <strong className="dish-add-title">{t.planMeals.removeTitle(meal.title)}</strong>
      <p className="muted plan-meals-note">{t.planMeals.removeHint}</p>
      {inEffect && <p className="muted plan-meals-note">{t.planMeals.newVersion}</p>}
      {failed && <p className="form-error" role="alert">{t.planMeals.failed}</p>}
      <DayChoice dayName={dayName} busy={busy} onCancel={() => setOpen(false)} onChoose={(allDays) => onRemove(allDays, () => setOpen(false))} />
    </div>
  );
}

const sameMeal = (a: PlannedMeal, b: PlannedMeal) => a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.time === b.time;

export function RemovedMeals({ plan, day, dayName, inEffect, busy, failed, onRestore }: { plan: MealPlan; day: Weekday; dayName: string; inEffect: boolean; busy?: boolean; failed?: boolean; onRestore: (removed: number, allDays: boolean) => void }) {
  const [asking, setAsking] = useState<number | null>(null);
  const removed = plan.days[day].removed ?? [];
  if (removed.length === 0) return null;
  return (
    <section className="plan-removed" aria-label={t.planMeals.removedTitle}>
      <h3 className="plan-edit-title">{t.planMeals.removedTitle}</h3>
      {failed && <p className="form-error" role="alert">{t.planMeals.failed}</p>}
      <ul className="plan-removed-list">
        {removed.map((meal, i) => {
          // "Tutti i giorni" only when the same meal was taken out of another day too
          const elsewhere = Object.entries(plan.days).some(([w, d]) => w !== day && (d.removed ?? []).some((other) => sameMeal(other, meal)));
          return (
            <li key={i} className="plan-removed-row">
              <div className="plan-removed-text">
                <strong>
                  {meal.title}
                  {meal.time ? ` · ${meal.time}` : ""}
                </strong>
                <span className="muted">{"foods" in meal ? mealFoodsText(meal) : (meal.description ?? "")}</span>
              </div>
              {asking === i ? (
                <DayChoice dayName={dayName} busy={busy} onCancel={() => setAsking(null)} onChoose={(allDays) => { onRestore(i, allDays); setAsking(null); }} />
              ) : (
                <button type="button" className="button-secondary-small" disabled={busy} aria-label={t.planMeals.restoreOf(meal.title)} onClick={() => (elsewhere ? setAsking(i) : onRestore(i, false))}>
                  {t.planMeals.restore}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {inEffect && <p className="muted plan-meals-note">{t.planMeals.newVersion}</p>}
    </section>
  );
}

/** Meal type of each title chip: Colazione, Spuntino, Pranzo, Merenda, Cena. */
const TITLE_TYPES: Array<(typeof MEAL_TYPES)[number]> = ["breakfast", "snack", "lunch", "snack", "dinner"];
const TITLE_TIMES = ["08:00", "11:00", "13:00", "16:30", "20:00"];

export interface NewPlanMeal extends DishEdit {
  title: string;
  time: string;
  type: (typeof MEAL_TYPES)[number];
  allDays: boolean;
}

export function AddPlanMeal({ dayName, inEffect, busy, failed, onAdd }: { dayName: string; inEffect: boolean; busy?: boolean; failed?: boolean; onAdd: (meal: NewPlanMeal, done: () => void) => void }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(1);
  const [own, setOwn] = useState("");
  const [time, setTime] = useState(TITLE_TIMES[1]!);
  const [allDays, setAllDays] = useState(false);
  const [source, setSource] = useState<null | "dishes" | "hand">(null);
  const close = () => {
    setOpen(false);
    setSource(null);
  };
  if (!open) {
    return (
      <button type="button" className="course-add" onClick={() => setOpen(true)}>
        {t.planMeals.add}
      </button>
    );
  }
  const title = pick === -1 ? own.trim() : t.planMeals.titles[pick]!;
  const type = pick === -1 ? "snack" : TITLE_TYPES[pick]!;
  const save = (dish: DishEdit, done: () => void) => onAdd({ ...dish, title: title || t.planMeals.titles[1]!, time, type, allDays }, () => { done(); close(); });
  return (
    <div className="dish-alt-choose plan-meals-panel">
      <strong className="dish-add-title">{t.planMeals.addTitle}</strong>
      <div className="dish-form-group" role="radiogroup" aria-label={t.planMeals.name}>
        <span className="plan-edit-title">{t.planMeals.name}</span>
        <div className="dish-chips dish-chips-wrap">
          {t.planMeals.titles.map((name, i) => (
            <button key={name} type="button" role="radio" aria-checked={pick === i} className="dish-filter" onClick={() => { setPick(i); setTime(TITLE_TIMES[i]!); }}>
              {name}
            </button>
          ))}
          <button type="button" className="dish-filter dish-filter-new" aria-pressed={pick === -1} onClick={() => setPick(-1)}>
            {t.planMeals.ownName}
          </button>
        </div>
        {pick === -1 && <input className="course-name-input" value={own} maxLength={30} autoFocus aria-label={t.planMeals.ownName} placeholder={t.planMeals.ownName} onChange={(e) => setOwn(e.target.value)} />}
      </div>
      <label className="plan-meals-time">
        <span className="plan-edit-title">{t.planMeals.time}</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value || time)} />
      </label>
      <div className="dish-form-group" role="radiogroup" aria-label={t.planMeals.days}>
        <span className="plan-edit-title">{t.planMeals.days}</span>
        <div className="dish-chips dish-chips-wrap">
          <button type="button" role="radio" aria-checked={!allDays} className="dish-filter" onClick={() => setAllDays(false)}>
            {t.planMeals.onlyDay(dayName)}
          </button>
          <button type="button" role="radio" aria-checked={allDays} className="dish-filter" onClick={() => setAllDays(true)}>
            {t.planMeals.allDays}
          </button>
        </div>
      </div>
      {inEffect && <p className="muted plan-meals-note">{t.planMeals.newVersion}</p>}
      {failed && <p className="form-error" role="alert">{t.planMeals.failed}</p>}
      <span className="plan-edit-title">{t.planMeals.dish}</span>
      <button type="button" className="dish-add-option" disabled={!title} onClick={() => setSource("dishes")}>
        <span>
          <strong>{t.dishes.fromDishes}</strong>
          <span className="muted">{t.dishes.fromDishesHint}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      <button type="button" className="dish-add-option" disabled={!title} onClick={() => setSource("hand")}>
        <span>
          <strong>{t.dishes.byHand}</strong>
          <span className="muted">{t.dishes.byHandHint}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      {source === "hand" && <EditMeal meal={{ title, foods: [] }} startOpen busy={busy} failed={failed} onCancel={() => setSource(null)} onSave={save} />}
      {source === "dishes" && (
        <DishPickerSheet meal={title} subtitle={t.planMeals.addTitle} busy={busy} failed={failed} onClose={() => setSource(null)} onPick={(dish: Dish) => save(dishAsEdit(dish), () => {})} />
      )}
      <div className="plan-replace-actions">
        <button type="button" className="button-secondary-small" onClick={close}>
          {t.planMeals.cancel}
        </button>
      </div>
    </div>
  );
}
