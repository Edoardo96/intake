import { DISH_CUSTOM_CATEGORIES_MAX, NUTRITION_MEAL_TYPES, dishCategories, type DishFood, type DishWrite, type NutritionMealType } from "@intake/shared";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ApiError } from "../api/client";
import { useDishes, useEstimateMacros, useFeatures, useSaveDish, useSetDishCategories } from "../api/queries";
import { FoodPicker } from "../components/FoodPicker";
import { SparklesIcon } from "../components/icons";
import { foodNutrients, type FoodRow } from "../components/PlanDay";
import { categoryLabel } from "../lib/dishCategory";
import { planErrorText } from "../lib/planErrors";
import { t } from "../lib/strings";

const FIELDS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
type Values = Record<(typeof FIELDS)[number], string>;
const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(Math.round(value * 10) / 10).replace(".", ","));
const number = (value: string) => Number(value.trim().replace(",", "."));
const EMPTY: Values = { kcal: "", protein: "", carbs: "", fat: "", fiber: "" };

/**
 * "Nuovo piatto" and "Modifica" in Piatti: name, category (with "+ Nuova" for an own one), foods with amount and unit, and
 * the values: added up from the foods when they all have their own, else typed, found with "Cerca nel database" or
 * estimated with "Ricalcola con l'IA". Saved on Nutrition as a saved meal. Rules in docs/dishes.md.
 */
export function DishEditPage({ id }: { id?: string }) {
  const s = t.dishBook;
  const dishes = useDishes();
  const save = useSaveDish();
  const setCategories = useSetDishCategories();
  const estimate = useEstimateMacros();
  const aiAvailable = useFeatures().data?.recognition === true;
  const [, navigate] = useLocation();
  const existing = id ? dishes.data?.dishes.find((d) => d.id === id) : undefined;

  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [foods, setFoods] = useState<FoodRow[]>([{ name: "", quantity: "", unit: "g" }]);
  const [values, setValues] = useState<Values>(EMPTY);
  const [valuesTyped, setValuesTyped] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Editing: the form starts from the dish as Nutrition has it
  useEffect(() => {
    if (loaded || !existing) return;
    setName(existing.name);
    setCategory(existing.category);
    if (existing.items.length > 0) {
      setFoods(existing.items.map((item) => {
        const n = item.nutrients;
        const nutrients = { kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat, fiber: n.fiber ?? 0, ...(n.sugar !== null && n.addedSugar !== null ? { sugar: n.sugar, addedSugar: Math.min(n.addedSugar, n.sugar) } : {}) };
        return { name: item.name, quantity: text(item.quantity), unit: item.unit ?? "", nutrients, origName: item.name, ...(item.quantity !== null ? { origQuantity: item.quantity } : {}), ...(item.unit ? { origUnit: item.unit } : {}) };
      }));
    } else {
      setFoods([{ name: existing.description || existing.name, quantity: "", unit: "" }]);
      setValues({ kcal: text(existing.kcal), protein: text(existing.protein), carbs: text(existing.carbs), fat: text(existing.fat), fiber: "" });
      setValuesTyped(true);
    }
    setLoaded(true);
  }, [existing, loaded]);

  const categories = dishCategories(dishes.data?.customCategories ?? []);
  const setFood = (index: number, patch: Partial<FoodRow>) => setFoods(foods.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  /** Rows with a name; their own values are kept, scaled or dropped as in the plan editor. */
  function parsedFoods(): DishFood[] | null {
    const parsed: DishFood[] = [];
    for (const row of foods.filter((f) => f.name.trim())) {
      const quantity = row.quantity.trim() === "" ? undefined : number(row.quantity);
      if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) return null;
      const nutrients = foodNutrients(row, quantity);
      parsed.push({ name: row.name.trim(), ...(quantity !== undefined ? { quantity } : {}), ...(row.unit.trim() && quantity !== undefined ? { unit: row.unit.trim() } : {}), ...(nutrients ? { nutrients } : {}) });
    }
    return parsed.length > 0 ? parsed : null;
  }

  // While every food has its own values the totals are their sum
  const current = parsedFoods();
  const summed = !valuesTyped && current && current.every((f) => f.nutrients);
  const shownValues: Values = summed
    ? (Object.fromEntries(FIELDS.map((key) => [key, text(current.reduce((sum, f) => sum + f.nutrients![key], 0))])) as Values)
    : values;

  function typeValue(key: (typeof FIELDS)[number], value: string) {
    const base = valuesTyped ? values : shownValues;
    setValuesTyped(true);
    setValues({ ...base, [key]: value });
  }

  function fill(found: { kcal: number; protein: number; carbs: number; fat: number; fiber: number }, message: string) {
    setValues({ kcal: text(Math.round(found.kcal)), protein: text(found.protein), carbs: text(found.carbs), fat: text(found.fat), fiber: text(found.fiber) });
    setValuesTyped(true);
    setNote(message);
  }

  function addCategory() {
    const value = newCategory.trim();
    if (!value) return setAdding(false);
    const own = dishes.data?.customCategories ?? [];
    if (!categories.some((c) => categoryLabel(c).toLowerCase() === value.toLowerCase()) && own.length < DISH_CUSTOM_CATEGORIES_MAX) setCategories.mutate([...own, value]);
    setCategory(categories.find((c) => categoryLabel(c).toLowerCase() === value.toLowerCase()) ?? value);
    setNewCategory("");
    setAdding(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setProblem(s.needName);
    const parsed = parsedFoods();
    if (!parsed) return setProblem(foods.some((f) => f.name.trim()) ? s.needNumber : s.needFood);
    let dish: DishWrite;
    if (summed) {
      dish = { name: name.trim(), category, mealType: existing?.mealType && isNutritionType(existing.mealType) ? existing.mealType : null, foods: parsed };
    } else {
      const numbers = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim() === "" ? (key === "kcal" ? Number.NaN : 0) : number(values[key])])) as Record<(typeof FIELDS)[number], number>;
      if (Object.values(numbers).some((v) => !Number.isFinite(v) || v < 0)) return setProblem(s.needValues);
      dish = { name: name.trim(), category, mealType: existing?.mealType && isNutritionType(existing.mealType) ? existing.mealType : null, foods: parsed.map(({ nutrients: _n, ...food }) => food), totals: numbers };
    }
    setProblem(null);
    save.mutate({ ...(id ? { id } : {}), dish }, { onSuccess: (result) => navigate(result.id ? `/piano/piatti/${result.id}` : "/piano?vista=piatti") });
  }

  const back = id ? `/piano/piatti/${id}` : "/piano?vista=piatti";
  const labels: Record<(typeof FIELDS)[number], string> = { kcal: `${t.calories.label} (kcal)`, protein: `${t.macros.protein} (g)`, carbs: `${t.macros.carbs} (g)`, fat: `${t.macros.fat} (g)`, fiber: `${t.macros.fiber} (g)` };
  const saveError = save.error instanceof ApiError && save.error.code === "name_taken" ? s.nameTaken : save.isError ? s.failed : null;

  return (
    <div className="page detail-page edit-page dish-edit-page">
      <header className="edit-header edit-header-back">
        <Link href={back} className="icon-button" aria-label={s.cancel}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1>{id ? s.editTitle : s.newTitle}</h1>
        <span aria-hidden="true" />
      </header>

      {id && !loaded ? (
        <div className="card skeleton" style={{ height: 320 }} />
      ) : (
        <form className="dish-form" onSubmit={submit}>
          <label className="field">
            <span>{s.name}</span>
            <input value={name} maxLength={100} placeholder={s.namePlaceholder} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="dish-form-group" role="radiogroup" aria-label={s.category}>
            <span className="plan-edit-title">{s.category}</span>
            <div className="dish-chips dish-chips-wrap">
              {categories.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={category === c} className="dish-filter" onClick={() => setCategory(category === c ? null : c)}>
                  {categoryLabel(c)}
                </button>
              ))}
              {category && !categories.includes(category) && (
                <button type="button" role="radio" aria-checked className="dish-filter" onClick={() => setCategory(null)}>
                  {category}
                </button>
              )}
              {!adding && (
                <button type="button" className="dish-filter dish-filter-new" onClick={() => setAdding(true)}>
                  {s.newCategory}
                </button>
              )}
            </div>
            {adding && (
              <div className="dish-alias">
                <input value={newCategory} maxLength={40} autoFocus aria-label={s.newCategoryName} placeholder={s.newCategoryName} onChange={(e) => setNewCategory(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())} />
                <button type="button" className="button-secondary-small" onClick={addCategory}>
                  {s.add}
                </button>
              </div>
            )}
          </div>

          <span className="plan-edit-title">{s.foods}</span>
          {foods.map((food, i) => (
            <div key={i} className="plan-edit-food">
              <input value={food.name} maxLength={80} aria-label={`${t.plan.foodName} ${i + 1}`} placeholder={t.plan.foodName} onChange={(e) => setFood(i, { name: e.target.value })} />
              <input value={food.quantity} inputMode="decimal" aria-label={`${t.plan.foodQty} · ${food.name || i + 1}`} placeholder="0" onChange={(e) => setFood(i, { quantity: e.target.value })} />
              <input value={food.unit} maxLength={12} aria-label={`${t.plan.foodUnit} · ${food.name || i + 1}`} placeholder="g" onChange={(e) => setFood(i, { unit: e.target.value })} />
              <button type="button" className="item-remove" aria-label={t.plan.foodRemove(food.name)} disabled={foods.length <= 1} onClick={() => setFoods(foods.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          {foods.length < 30 && (
            <button type="button" className="text-button text-button-strong add-food" onClick={() => setFoods([...foods, { name: "", quantity: "", unit: "g" }])}>
              {t.plan.addFood}
            </button>
          )}

          <span className="plan-edit-title">{s.values}</span>
          <div className="plan-edit-values">
            {FIELDS.map((key) => (
              <label key={key} className="field">
                <span>{labels[key]}</span>
                <input value={shownValues[key]} inputMode="decimal" onChange={(e) => typeValue(key, e.target.value)} />
              </label>
            ))}
          </div>
          <span className="muted plan-edit-hint">{summed ? s.valuesSummed : s.valuesHint}</span>
          <div className="plan-edit-tools">
            <button type="button" className="button-secondary-small" aria-expanded={picking} onClick={() => setPicking(!picking)}>
              {t.plan.dbSearch}
            </button>
            {aiAvailable && (
              <button
                type="button"
                className="button-secondary-small button-ai-soft"
                disabled={estimate.isPending}
                onClick={() => {
                  const parsed = parsedFoods();
                  if (!parsed) return setProblem(s.needFood);
                  estimate.mutate({ description: name.trim(), foods: parsed.map(({ nutrients: _n, ...f }) => f) }, { onSuccess: ({ macros }) => fill(macros, t.plan.aiEstimated) });
                }}
              >
                <SparklesIcon size={14} />
                {estimate.isPending ? t.plan.aiEstimating : t.plan.aiEstimate}
              </button>
            )}
          </div>
          {estimate.isError && <p className="error-text">{planErrorText(estimate.error)}</p>}
          {note && (
            <p className="muted plan-edit-hint" role="status">
              {note}
            </p>
          )}
          {picking && (
            <FoodPicker
              foods={foods}
              onApply={(found, used, total) => {
                fill(found, t.plan.dbApplied(used, total));
                setPicking(false);
              }}
            />
          )}

          {(problem || saveError) && (
            <p className="error-text" role="alert">
              {problem ?? saveError}
            </p>
          )}
          <button type="submit" className="button-primary-inline dish-save" disabled={save.isPending}>
            {save.isPending ? s.saving : s.save}
          </button>
        </form>
      )}
    </div>
  );
}

const isNutritionType = (type: string): type is NutritionMealType => (NUTRITION_MEAL_TYPES as readonly string[]).includes(type);
