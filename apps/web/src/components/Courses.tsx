import { COURSE_NAMES, type CourseAdd, type Dish, type FixedPlannedMeal } from "@intake/shared";
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
