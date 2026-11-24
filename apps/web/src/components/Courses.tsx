import { COURSE_NAMES, foodLine, type CourseAdd, type Dish, type FixedPlannedMeal } from "@intake/shared";
import { useState } from "react";
import { courseLabel } from "../lib/courseLabel";
import { t } from "../lib/strings";
import { DishPickerSheet, dishAsEdit, dishOfEdit } from "./DishAlternatives";
import { EditMeal } from "./PlanDay";

type NewCourse = Omit<CourseAdd, "day" | "index">;

export { courseLabel };

function NameChips({ value, onChange, label }: { value: string; onChange: (name: string) => void; label: string }) {
  const [own, setOwn] = useState(false);
  return (
    <div className="dish-form-group" role="radiogroup" aria-label={label}>
      <span className="plan-edit-title">{label}</span>
      <div className="dish-chips dish-chips-wrap">
        {COURSE_NAMES.map((name) => (
          <button key={name} type="button" role="radio" aria-checked={value === name} className="dish-filter" onClick={() => { setOwn(false); onChange(name); }}>
            {courseLabel(name)}
          </button>
        ))}
        <button type="button" className="dish-filter dish-filter-new" aria-pressed={own} onClick={() => { setOwn(true); onChange(""); }}>
          {t.courses.other}
        </button>
      </div>
      {own && <input className="course-name-input" value={value} maxLength={30} autoFocus aria-label={t.courses.otherName} placeholder={t.courses.otherName} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

/**
 * "+ Aggiungi portata" under a planned meal: which course it is (and, for a meal that is still one dish, what the dish
 * already there is), then the dish from "I tuoi piatti" or written by hand. Rules in docs/courses.md.
 */
export function AddCourse({ meal, onAdd, busy, failed }: { meal: FixedPlannedMeal; onAdd: (course: NewCourse, done: () => void) => void; busy?: boolean; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string>(meal.courses ? "Secondo" : "Fine pasto");
  const [firstName, setFirstName] = useState<string>("Primo");
  const [source, setSource] = useState<null | "dishes" | "hand">(null);
  const close = () => {
    setOpen(false);
    setSource(null);
  };
  const add = (dish: Dish) => {
    const { description, foods, macros } = dishAsEdit(dish);
    onAdd({ name: name.trim() || t.courses.defaultName, ...(meal.courses ? {} : { firstName: firstName.trim() || t.courses.defaultName }), description, foods, ...(macros ? { macros } : {}) }, close);
  };
  if (!open) {
    return (
      <button type="button" className="course-add" onClick={() => setOpen(true)}>
        {t.courses.add}
      </button>
    );
  }
  return (
    <div className="dish-alt-choose course-panel">
      <strong className="dish-add-title">{t.courses.add.replace(/^\+\s*/, "")}</strong>
      {!meal.courses && <NameChips value={firstName} onChange={setFirstName} label={t.courses.firstIs} />}
      <NameChips value={name} onChange={setName} label={t.courses.whichCourse} />
      <span className="plan-edit-title">{t.courses.what}</span>
      <button type="button" className="dish-add-option" onClick={() => setSource("dishes")}>
        <span>
          <strong>{t.dishes.fromDishes}</strong>
          <span className="muted">{t.dishes.fromDishesHint}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      <button type="button" className="dish-add-option" onClick={() => setSource("hand")}>
        <span>
          <strong>{t.dishes.byHand}</strong>
          <span className="muted">{t.dishes.byHandHint}</span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
      {source === "hand" && <EditMeal meal={{ title: meal.title, foods: [] }} startOpen busy={busy} failed={failed} onCancel={() => setSource(null)} onSave={(edit, done) => onAdd({ ...newFromEdit(meal, edit), name: name.trim() || t.courses.defaultName, ...(meal.courses ? {} : { firstName: firstName.trim() || t.courses.defaultName }) }, () => { done(); close(); })} />}
      {source === "dishes" && <DishPickerSheet meal={meal.title} subtitle={t.courses.courseOf(courseLabel(name) || t.courses.defaultName, meal.title)} busy={busy} failed={failed} onClose={() => setSource(null)} onPick={add} />}
      {failed && source !== "hand" && (
        <p className="error-text" role="alert">
          {t.dishes.failed}
        </p>
      )}
      <button type="button" className="text-button dish-add-cancel" onClick={close}>
        {t.dishes.cancel}
      </button>
    </div>
  );
}

function newFromEdit(meal: FixedPlannedMeal, edit: Parameters<typeof dishOfEdit>[1]) {
  const { description, foods, macros } = dishAsEdit(dishOfEdit(meal, edit));
  return { description, foods, ...(macros ? { macros } : {}) };
}

/**
 * "Dividi in portate" on a planned meal: which courses it has, then the course of each food. Every food in one course
 * makes the meal one dish again. Rules in docs/courses.md.
 */
export function SplitCourses({ meal, onSave, busy, failed }: { meal: FixedPlannedMeal; onSave: (labels: string[], done: () => void) => void; busy?: boolean; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = meal.courses?.flatMap((c) => c.foods.map(() => c.name)) ?? [];
  const own = (meal.courses ?? []).map((c) => c.name).filter((name) => !(COURSE_NAMES as readonly string[]).includes(name));
  const options = [...COURSE_NAMES, ...own];
  const [chosen, setChosen] = useState<string[]>(() => (meal.courses ? meal.courses.map((c) => c.name) : ["Primo", "Secondo"]));
  const [labels, setLabels] = useState<string[]>(() => (current.length === meal.foods.length ? current : meal.foods.map(() => "Primo")));
  if (meal.foods.length < 2) return null;
  if (!open) {
    return (
      <button type="button" className="plan-meal-action" onClick={() => setOpen(true)}>
        {t.courses.split}
      </button>
    );
  }
  // The courses in the order they are listed in the chips; a food whose course was deselected goes to the first one
  const inUse = options.filter((name) => chosen.includes(name));
  const shown = labels.map((label) => (inUse.includes(label) ? label : (inUse[0] ?? label)));
  const toggle = (name: string) => setChosen((list) => (list.includes(name) ? (list.length > 1 ? list.filter((n) => n !== name) : list) : list.length < 6 ? [...list, name] : list));
  const withoutValues = meal.foods.some((f) => !f.nutrients);
  const single = new Set(shown).size < 2;
  return (
    <div className="dish-alt-choose course-panel course-split">
      <strong className="dish-add-title">{t.courses.split}</strong>
      <div className="dish-form-group">
        <span className="plan-edit-title">{t.courses.splitWhich}</span>
        <div className="dish-chips dish-chips-wrap">
          {options.map((name) => (
            <button key={name} type="button" className="dish-filter" aria-pressed={chosen.includes(name)} onClick={() => toggle(name)}>
              {courseLabel(name)}
            </button>
          ))}
        </div>
      </div>
      <span className="plan-edit-title">{t.courses.splitHint}</span>
      <ul className="course-split-list">
        {meal.foods.map((food, i) => (
          <li key={i}>
            <span className="course-split-food">{foodLine(food)}</span>
            <div className="dish-chips dish-chips-wrap" role="radiogroup" aria-label={food.name}>
              {inUse.map((name) => (
                <button key={name} type="button" role="radio" aria-checked={shown[i] === name} className="dish-filter course-split-chip" onClick={() => setLabels(shown.map((l, j) => (j === i ? name : l)))}>
                  {courseLabel(name)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {single && <p className="muted course-split-note">{t.courses.splitOne}</p>}
      {!single && withoutValues && <p className="muted course-split-note">{t.courses.splitNoValues}</p>}
      {failed && <p className="form-error" role="alert">{t.courses.splitFailed}</p>}
      <div className="plan-replace-actions">
        <button type="button" className="button-secondary-small" onClick={() => setOpen(false)}>
          {t.plan.editCancel}
        </button>
        <button type="button" className="button-primary-inline" disabled={busy} onClick={() => onSave(shown, () => setOpen(false))}>
          {t.courses.splitSave}
        </button>
      </div>
    </div>
  );
}
