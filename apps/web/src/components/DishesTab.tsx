import { dishCategories, searchDishes, type DishSummary } from "@intake/shared";
import { useState } from "react";
import { Link } from "wouter";
import { useDishes, useDishGroups } from "../api/queries";
import { alternativesCount, categoryLabel, foodsLine } from "../lib/dishCategory";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

/**
 * Piano › Piatti: the person's dishes (Nutrition saved meals) with a search over names and foods, category chips with how
 * many dishes each has, and the dishes grouped by category. Rules in docs/dishes.md.
 */
export function DishesTab({ forLogging = false }: { forLogging?: boolean } = {}) {
  const dishes = useDishes();
  const groups = useDishGroups();
  const [query, setQuery] = useState("");
  // "+" › I tuoi piatti: starts on the dishes of the meal of this hour, when there are any
  const nowType = mealTypeNow();
  const [category, setCategory] = useState<string | null>(null);
  const [onlyNow, setOnlyNow] = useState(forLogging);
  const s = t.dishBook;
  const all = dishes.data?.dishes ?? [];
  const categories = dishCategories(dishes.data?.customCategories ?? []);
  const count = (c: string | null) => all.filter((d) => d.category === c).length;
  const nowCount = all.filter((d) => d.mealType === nowType).length;
  const filterNow = forLogging && onlyNow && nowCount > 0;
  const found = searchDishes(all, query).filter((d) => (category === null || d.category === category) && (!filterNow || d.mealType === nowType));
  const sections = [...categories, null]
    .map((c) => ({ category: c, dishes: found.filter((d) => d.category === c).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((section) => section.dishes.length > 0);

  return (
    <div className="dishes">
      <div className="dishes-tools">
        <label className="dishes-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input type="search" value={query} placeholder={s.search} aria-label={s.search} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {!forLogging && (
          <Link href="/piano/piatti/nuovo" className="button-primary-inline dishes-new" aria-label={s.newDish}>
            {s.newDishShort}
          </Link>
        )}
      </div>

      {all.length > 0 && (
        <div className="dish-chips" role="group" aria-label={s.categoriesLabel}>
          {forLogging && nowCount > 0 && (
            <button type="button" className="dish-filter" aria-pressed={filterNow} onClick={() => setOnlyNow(!onlyNow)}>
              {s.nowFilter(t.mealTypes[nowType] ?? nowType)} {nowCount}
            </button>
          )}
          <button type="button" className="dish-filter" aria-pressed={category === null && !filterNow} onClick={() => { setCategory(null); setOnlyNow(false); }}>
            {s.all} {all.length}
          </button>
          {categories
            .filter((c) => count(c) > 0)
            .map((c) => (
              <button key={c} type="button" className="dish-filter" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>
                {categoryLabel(c)} {count(c)}
              </button>
            ))}
        </div>
      )}

      {dishes.isPending && <div className="card skeleton" style={{ height: 240 }} />}
      {dishes.isError && <p className="error-text">{s.loadFailed}</p>}
      {dishes.isSuccess && all.length === 0 && (
        <div className="coming-soon">
          <strong>{s.emptyTitle}</strong>
          <p className="muted">{s.emptyBody}</p>
        </div>
      )}
      {dishes.isSuccess && all.length > 0 && found.length === 0 && <p className="muted">{s.noMatch}</p>}

      {sections.map((section) => (
        <section key={section.category ?? "none"} className="dish-section" aria-label={section.category ? categoryLabel(section.category) : s.noCategory}>
          <span className="sheet-section">
            {(section.category ? categoryLabel(section.category) : s.noCategory).toUpperCase()} · {section.dishes.length}
          </span>
          <div className="sheet-list">
            {section.dishes.map((dish) => (
              <DishRow key={dish.id} dish={dish} alternatives={alternativesCount(groups.data, dish)} href={forLogging ? `/pasto/nuovo/preferito/${dish.id}` : `/piano/piatti/${dish.id}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DishRow({ dish, alternatives, href }: { dish: DishSummary; alternatives: number; href: string }) {
  return (
    <Link href={href} className="sheet-row dish-row">
      <span className="sheet-row-text">
        <strong>{dish.name}</strong>
        <span className="muted">{foodsLine(dish)}</span>
      </span>
      <span className="dish-row-side">
        {dish.kcal !== null && <span className="dish-row-kcal">{formatKcal(dish.kcal)} kcal</span>}
        {alternatives > 0 && <span className="dish-badge">⇄ {t.dishBook.alternatives(alternatives)}</span>}
        {dish.hasRecipe && <span className="dish-badge dish-badge-recipe">{t.dishBook.hasRecipe}</span>}
      </span>
    </Link>
  );
}

/** The Nutrition meal type of this hour of the device, as the confirmation screen guesses it. */
function mealTypeNow(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 19) return "snack";
  return "dinner";
}
