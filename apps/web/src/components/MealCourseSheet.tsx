import { COURSE_NAMES, type DishSummary } from "@intake/shared";
import { useEffect, useRef, useState } from "react";
import { courseLabel } from "../lib/courseLabel";
import { t } from "../lib/strings";
import { DishPickerSheet } from "./DishAlternatives";
import { CloseIcon, SparklesIcon } from "./icons";
import { Scrim } from "./Scrim";

/** A food typed by hand: its amount and the values for that amount. */
export interface ManualFood {
  name: string;
  amount: number;
  unit: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface CourseSource {
  /** The course's name, and the name of what was already on the screen when it was one dish. */
  name: string;
  firstName?: string;
}

function Chips({ value, onChange, label }: { value: string; onChange: (name: string) => void; label: string }) {
  const own = value !== "" && !(COURSE_NAMES as readonly string[]).includes(value);
  const [typing, setTyping] = useState(own);
  return (
    <div className="dish-form-group" role="radiogroup" aria-label={label}>
      <span className="plan-edit-title">{label}</span>
      <div className="dish-chips dish-chips-wrap">
        {COURSE_NAMES.map((name) => (
          <button key={name} type="button" role="radio" aria-checked={value === name} className="dish-filter" onClick={() => { setTyping(false); onChange(name); }}>
            {courseLabel(name)}
          </button>
        ))}
        <button type="button" className="dish-filter dish-filter-new" aria-pressed={typing} onClick={() => { setTyping(true); onChange(""); }}>
          {t.courses.other}
        </button>
      </div>
      {typing && <input className="course-name-input" value={value} maxLength={30} autoFocus aria-label={t.courses.otherName} placeholder={t.courses.otherName} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

const number = (value: string) => Number(value.trim().replace(",", "."));

/**
 * "+ Aggiungi portata" on Nuovo pasto and Modifica pasto (docs/courses.md): which course it is, then a photo, a
 * description (both recognized by the AI, part Pasti da foto), one of your dishes or a food typed by hand. Every course
 * is added to the same meal, logged once at the end.
 */
export function MealCourseSheet({
  askFirst,
  ai,
  busy,
  error,
  onClose,
  onPhoto,
  onText,
  onDish,
  onManual,
}: {
  /** The meal on the screen is still one dish: also ask what it is. */
  askFirst: boolean;
  ai: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPhoto: (file: File, course: CourseSource) => void;
  onText: (text: string, course: CourseSource) => void;
  onDish: (dish: DishSummary, course: CourseSource) => void;
  onManual: (food: ManualFood, course: CourseSource) => void;
}) {
  const [name, setName] = useState<string>("Secondo");
  const [firstName, setFirstName] = useState<string>("Primo");
  const [mode, setMode] = useState<null | "text" | "dishes" | "hand">(null);
  const [text, setText] = useState("");
  const [food, setFood] = useState({ name: "", amount: "", kcal: "", protein: "", carbs: "", fat: "" });
  const [problem, setProblem] = useState(false);
  const library = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const course = (): CourseSource => ({ name: name.trim() || t.courses.defaultName, ...(askFirst ? { firstName: firstName.trim() || t.courses.defaultName } : {}) });

  function addManual() {
    const values = { amount: number(food.amount || "1"), kcal: number(food.kcal), protein: number(food.protein || "0"), carbs: number(food.carbs || "0"), fat: number(food.fat || "0") };
    if (!food.name.trim() || Object.values(values).some((v) => !Number.isFinite(v) || v < 0) || values.amount <= 0 || food.kcal.trim() === "") return setProblem(true);
    setProblem(false);
    onManual({ name: food.name.trim(), unit: food.amount.trim() ? "g" : "porzione", ...values }, course());
  }

  // The dishes picker is a sheet of its own, shown instead of this one
  if (mode === "dishes") {
    return <DishPickerSheet meal="" subtitle={courseLabel(name) || t.courses.defaultName} onClose={() => setMode(null)} onPick={() => {}} onPickSaved={(dish) => onDish(dish, course())} />;
  }
  return (
    <Scrim onClose={() => !busy && onClose()}>
      <div className="sheet course-sheet" role="dialog" aria-modal="true" aria-label={t.courses.add} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{t.courses.addTitle}</h2>
          <button type="button" className="icon-button" aria-label={t.close} disabled={busy} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>
        {askFirst && <Chips value={firstName} onChange={setFirstName} label={t.courses.firstIsMeal} />}
        <Chips value={name} onChange={setName} label={t.courses.whichCourse} />
        <span className="plan-edit-title">{t.courses.how}</span>

        {busy ? (
          <div className="card recognize-wait" aria-live="polite" aria-busy="true">
            <span className="recognize-spinner" aria-hidden="true" />
            <strong>{t.newMeal.analyzing}</strong>
          </div>
        ) : (
          <>
            {ai && (
              <>
                <button type="button" className="dish-add-option" onClick={() => library.current?.click()}>
                  <span>
                    <strong className="ai-label">
                      <SparklesIcon size={14} />
                      {t.courses.photo}
                    </strong>
                    <span className="muted">{t.courses.photoHint}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
                <input ref={library} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0], course())} />
                <button type="button" className="dish-add-option" aria-expanded={mode === "text"} onClick={() => setMode(mode === "text" ? null : "text")}>
                  <span>
                    <strong className="ai-label">
                      <SparklesIcon size={14} />
                      {t.courses.describe}
                    </strong>
                    <span className="muted">{t.courses.describeHint}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
                {mode === "text" && (
                  <form
                    className="course-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (text.trim()) onText(text.trim(), course());
                    }}
                  >
                    <textarea rows={3} value={text} maxLength={500} autoFocus aria-label={t.courses.describe} placeholder={t.courses.describeHint} onChange={(e) => setText(e.target.value)} />
                    <button type="submit" className="button-primary-inline button-ai" disabled={!text.trim()}>
                      <SparklesIcon size={16} />
                      {t.newMeal.analyze}
                    </button>
                  </form>
                )}
              </>
            )}
            <button type="button" className="dish-add-option" onClick={() => setMode("dishes")}>
              <span>
                <strong>{t.dishes.fromDishes}</strong>
                <span className="muted">{t.dishes.fromDishesHint}</span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            <button type="button" className="dish-add-option" aria-expanded={mode === "hand"} onClick={() => setMode(mode === "hand" ? null : "hand")}>
              <span>
                <strong>{t.dishes.byHand}</strong>
                <span className="muted">{t.courses.byHandHint}</span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            {mode === "hand" && (
              <form
                className="course-inline course-manual"
                onSubmit={(e) => {
                  e.preventDefault();
                  addManual();
                }}
              >
                <label className="field">
                  <span>{t.plan.foodName}</span>
                  <input value={food.name} maxLength={80} autoFocus onChange={(e) => setFood({ ...food, name: e.target.value })} />
                </label>
                <div className="course-manual-grid">
                  {(["amount", "kcal", "protein", "carbs", "fat"] as const).map((key) => (
                    <label key={key} className="field">
                      <span>{t.courses.manual[key]}</span>
                      <input value={food[key]} inputMode="decimal" onChange={(e) => setFood({ ...food, [key]: e.target.value })} />
                    </label>
                  ))}
                </div>
                {problem && <p className="error-text">{t.courses.manualProblem}</p>}
                <button type="submit" className="button-primary-inline">
                  {t.courses.addFood}
                </button>
              </form>
            )}
          </>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Scrim>
  );
}
