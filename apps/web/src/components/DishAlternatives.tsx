import { alternativesFor, dishCategories, dishKey, dishKeys, dishMacros, dishOfMeal, mealFoodsText, searchDishes, type Dish, type DishSummary, type DishGroup, type FixedPlannedMeal, type PlannedMacros, type Weekday, isFixedMeal, looseDishKey } from "@intake/shared";
import { useEffect, useState } from "react";
import { useChangeDishGroups, useDishes, useDishGroups } from "../api/queries";
import { categoryLabel, dishFromSaved } from "../lib/dishCategory";
import { Link } from "wouter";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";
import { AlternativeMeal, EditMeal, type DishEdit } from "./PlanDay";
import { CloseIcon, SparklesIcon } from "./icons";
import { Scrim } from "./Scrim";

/** The category of the dish of the list with this name (or description), to start the picker on it. */
function categoryOf(dishes: DishSummary[] | undefined, name: string): string | null {
  const key = dishKey(name);
  return dishes?.find((d) => dishKey(d.name) === key || dishKey(d.description) === key)?.category ?? null;
}

/** A dish written in "A mano" (the plan editor) as a dish of a group. */
export function dishOfEdit(meal: FixedPlannedMeal, edit: DishEdit): Dish {
  return dishOfMeal({ title: meal.title, ...(edit.description ? { description: edit.description } : {}), foods: edit.foods, ...(edit.macros ? { macros: edit.macros } : {}) });
}

/** The nutrients an edit of the plan accepts (`mealEditSchema`), from a dish. */
export function editMacros(macros: PlannedMacros | null) {
  if (!macros) return {};
  const { kcal, protein, carbs, fat, fiber, sugar, addedSugar } = macros;
  return { macros: { kcal, protein, carbs, fat, fiber, ...(sugar !== undefined && addedSugar !== undefined ? { sugar, addedSugar } : {}) } };
}

/** A dish as the plan stores it when it takes the place of the planned one ("Usa questo"). */
export function dishAsEdit(dish: Dish) {
  return { description: dish.name, foods: dish.foods, ...editMacros(dishMacros(dish)) };
}

function DishLine({ dish }: { dish: Dish }) {
  const macros = dishMacros(dish);
  return (
    <span className="dish-alt-text">
      <strong>{dish.name}</strong>
      <span className="muted">{macros ? `${formatKcal(macros.kcal)} kcal · P ${formatKcal(macros.protein)} g` : t.dishes.noValues}</span>
    </span>
  );
}

/**
 * Piatti intercambiabili under a fixed meal of Piano: the other dishes of its group, each with "Usa questo" (it takes the
 * place of the planned dish) and ×, and "+ Aggiungi alternativa" from a favorite or by hand. The AI one comes from
 * third choice of "+ Aggiungi alternativa" (✦ Con l'IA, while the AI is available). Rules in docs/dish-groups.md.
 */
export function DishAlternatives({
  meal,
  onUse,
  busy,
  ai,
}: {
  meal: FixedPlannedMeal;
  onUse: (dish: Dish) => void;
  busy?: boolean;
  /** "✦ Con l'IA": the plan meal the AI proposes for; absent while the AI is not available. */
  ai?: { planId: number; day: Weekday; index: number };
}) {
  const groups = useDishGroups();
  const change = useChangeDishGroups();
  const dishes = useDishes();
  const [adding, setAdding] = useState<null | "menu" | "favorites" | "hand" | "ai">(null);
  const name = mealFoodsText(meal);
  const alternatives = alternativesFor(groups.data ?? [], name);
  const group = alternatives[0] ? groups.data?.find((g) => g.id === alternatives[0]!.groupId) : undefined;

  const link = (alternative: Dish, done?: () => void) =>
    change.mutate({ link: { dish: dishOfMeal(meal), alternative } }, { onSuccess: () => { setAdding(null); done?.(); } });
  const remove = (g: DishGroup, dishIndex: number) => change.mutate({ id: g.id, dishes: g.dishes.filter((_, i) => i !== dishIndex) });

  if (groups.isLoading) return null;
  return (
    <div className="dish-alts" role="group" aria-label={t.dishes.sectionOf(meal.title)}>
      {alternatives.length > 0 && (
        <>
          <span className="plan-edit-title">{t.dishes.title}</span>
          <ul className="dish-alt-list">
            {alternatives.map((alt) => (
              <li key={`${alt.groupId}-${alt.dishIndex}`} className="dish-alt">
                <DishLine dish={alt.dish} />
                <button type="button" className="button-secondary-small" disabled={busy} aria-label={t.dishes.useOf(alt.dish.name)} onClick={() => onUse(alt.dish)}>
                  {t.dishes.use}
                </button>
                <button type="button" className="item-remove" disabled={change.isPending} aria-label={t.dishes.remove(alt.dish.name)} onClick={() => group && remove(group, alt.dishIndex)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {adding === null && (
        <button type="button" className="text-button text-button-strong dish-alt-add" onClick={() => setAdding("menu")}>
          {t.dishes.add}
        </button>
      )}
      {adding === "menu" && (
        <div className="dish-alt-choose">
          <strong className="dish-add-title">{t.dishes.addTitle}</strong>
          <span className="muted plan-edit-hint">{t.dishes.hint}</span>
          <button type="button" className="dish-add-option" onClick={() => setAdding("favorites")}>
            <span>
              <strong>{t.dishes.fromDishes}</strong>
              <span className="muted">{t.dishes.fromDishesHint}</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="dish-add-option" onClick={() => setAdding("hand")}>
            <span>
              <strong>{t.dishes.byHand}</strong>
              <span className="muted">{t.dishes.byHandHint}</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
          {ai && (
            <button type="button" className="dish-add-option" data-ai onClick={() => setAdding("ai")}>
              <span>
                <strong className="ai-label">
                  <SparklesIcon size={14} />
                  {t.dishes.withAi}
                </strong>
                <span>{t.dishes.withAiHint}</span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          )}
          <button type="button" className="text-button dish-add-cancel" onClick={() => setAdding(null)}>
            {t.dishes.cancel}
          </button>
        </div>
      )}
      {adding === "ai" && ai && (
        <AlternativeMeal
          planId={ai.planId}
          day={ai.day}
          index={ai.index}
          meal={meal}
          startOpen
          busy={busy || change.isPending}
          onCancel={() => setAdding(null)}
          onKeep={(dish, done) => link(dishOfMeal(dish), done)}
          onUse={(dish) => {
            if (isFixedMeal(dish)) onUse(dishOfMeal(dish));
            setAdding(null);
          }}
        />
      )}
      {adding === "favorites" && (
        <DishPickerSheet meal={name} category={categoryOf(dishes.data?.dishes, name)} onPick={(dish) => link(dish)} onClose={() => setAdding(null)} busy={change.isPending} failed={change.isError} />
      )}
      {adding === "hand" && (
        <EditMeal
          meal={{ title: meal.title, foods: [] }}
          startOpen
          busy={change.isPending}
          failed={change.isError}
          onCancel={() => setAdding(null)}
          onSave={(edit, done) => link(dishOfEdit(meal, edit), done)}
        />
      )}
      {change.isError && (adding === null || adding === "ai") && (
        <p className="error-text" role="alert">
          {t.dishes.failed}
        </p>
      )}
    </div>
  );
}

/**
 * "Dai tuoi piatti": a sheet with a search and the categories over the dishes (Nutrition saved meals) that have foods;
 * it starts on the category of the dish it is for, when known. Tapping one picks it (its foods and values come with it).
 */
export function DishPickerSheet({
  meal,
  category,
  exclude = [],
  onPick,
  onClose,
  busy,
  failed,
  subtitle,
  onPickSaved,
}: {
  meal: string;
  /** Picks the dish as it is on Nutrition (Nuovo pasto › + Aggiungi portata) instead of as a dish of a group. */
  onPickSaved?: (dish: DishSummary) => void;
  /** The line under the title; "Alternativa a …" by default. */
  subtitle?: string;
  category?: string | null;
  exclude?: string[];
  onPick: (dish: Dish) => void;
  onClose: () => void;
  busy?: boolean;
  failed?: boolean;
}) {
  const dishes = useDishes();
  const groups = useDishGroups();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | null>(category ?? null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Not the dish itself: by id, or by name for a dish of the plan
  const own = looseDishKey(meal);
  const all = (dishes.data?.dishes ?? []).filter((d) => !exclude.includes(d.id) && looseDishKey(d.name) !== own && looseDishKey(d.description) !== own);
  const categories = dishCategories(dishes.data?.customCategories ?? []).filter((c) => all.some((d) => d.category === c));
  const shown = searchDishes(all, query).filter((d) => filter === null || d.category === filter);
  const linked = new Set(alternativesFor(groups.data ?? [], meal).map((alt) => dishKey(alt.dish.name)));
  return (
    <Scrim onClose={onClose}>
      <div className="sheet dish-fav-sheet" role="dialog" aria-modal="true" aria-label={t.dishes.fromDishes} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{t.dishes.fromDishes}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>
        <p className="muted dish-fav-for">{subtitle ?? t.dishes.alternativeTo(meal)}</p>
        <input type="search" className="dish-fav-search" value={query} autoFocus placeholder={t.dishes.searchDishes} aria-label={t.dishes.searchDishes} onChange={(e) => setQuery(e.target.value)} />
        {categories.length > 0 && (
          <div className="dish-chips" role="group" aria-label={t.dishBook.categoriesLabel}>
            <button type="button" className="dish-filter" aria-pressed={filter === null} onClick={() => setFilter(null)}>
              {t.dishBook.all}
            </button>
            {categories.map((c) => (
              <button key={c} type="button" className="dish-filter" aria-pressed={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        )}
        {filter !== null && category === filter && <p className="muted dish-fav-for">{t.dishes.sameCategory}</p>}
        {dishes.isLoading && <p className="muted">{t.dishes.loading}</p>}
        {dishes.isSuccess && all.length === 0 && <p className="muted">{t.dishes.favoritesEmpty}</p>}
        {dishes.isSuccess && all.length > 0 && shown.length === 0 && <p className="muted">{t.dishes.noMatch}</p>}
        {failed && (
          <p className="error-text" role="alert">
            {t.dishes.failed}
          </p>
        )}
        <div className="sheet-list">
          {shown.map((saved) => {
            const done = linked.has(dishKey(saved.name));
            return (
              <button key={saved.id} type="button" className="sheet-row" disabled={busy || (done && !onPickSaved)} onClick={() => (onPickSaved ? onPickSaved(saved) : onPick(dishFromSaved(saved)))}>
                <span className="sheet-row-text">
                  <strong>{saved.name}</strong>
                  <span className="muted">
                    {saved.kcal !== null ? `${formatKcal(saved.kcal)} kcal · ` : ""}
                    {saved.protein !== null ? `P ${formatKcal(saved.protein)} g` : ""}
                  </span>
                </span>
                <span className="sheet-row-action">{done && !onPickSaved ? t.dishes.linked : t.dishes.pick}</span>
              </button>
            );
          })}
        </div>
        <Link href="/piano/piatti/nuovo" className="text-button text-button-strong dish-new-link">
          {t.dishes.createDish}
        </Link>
      </div>
    </Scrim>
  );
}

/**
 * Piano › Piatti intercambiabili: every group, with "Collega anche…" (another name of a dish, for plans that call it
 * differently), a dish removed with ×, or the whole group removed.
 */
export function DishGroupsCard() {
  const groups = useDishGroups();
  const change = useChangeDishGroups();
  const [naming, setNaming] = useState<{ groupId: number; dishIndex: number } | null>(null);
  const [alias, setAlias] = useState("");
  const list = groups.data ?? [];

  function addAlias(group: DishGroup, dishIndex: number) {
    const name = alias.trim();
    if (!name) return;
    const dish = group.dishes[dishIndex]!;
    if (dishKeys({ name, aliases: [] }).every((k) => dishKeys(dish).includes(k))) return setNaming(null);
    const dishes = group.dishes.map((d, i) => (i === dishIndex ? { ...d, aliases: [...d.aliases, name] } : d));
    change.mutate({ id: group.id, dishes }, { onSuccess: () => setNaming(null) });
  }

  return (
    <details className="plan-notes dish-groups">
      <summary>{t.dishes.manage}</summary>
      <p className="muted plan-edit-hint">{t.dishes.manageHint}</p>
      {groups.isSuccess && list.length === 0 && <p className="muted">{t.dishes.empty}</p>}
      {list.map((group) => (
        <section key={group.id} className="dish-group" aria-label={t.dishes.groupOf(group.dishes.map((d) => d.name).join(" ↔ "))}>
          <ul className="dish-alt-list">
            {group.dishes.map((dish, i) => (
              <li key={i} className="dish-alt">
                <span className="dish-alt-text">
                  <strong>{dish.name}</strong>
                  {dish.aliases.length > 0 && <span className="muted">{t.dishes.aliases(dish.aliases.join(", "))}</span>}
                  <button
                    type="button"
                    className="text-button dish-alias-link"
                    onClick={() => {
                      setNaming({ groupId: group.id, dishIndex: i });
                      setAlias("");
                    }}
                  >
                    {t.dishes.linkAlso}
                  </button>
                </span>
                <button type="button" className="item-remove" disabled={change.isPending} aria-label={t.dishes.remove(dish.name)} onClick={() => change.mutate({ id: group.id, dishes: group.dishes.filter((_, j) => j !== i) })}>
                  ×
                </button>
                {naming?.groupId === group.id && naming.dishIndex === i && (
                  <form
                    className="dish-alias"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addAlias(group, i);
                    }}
                  >
                    <input value={alias} maxLength={200} autoFocus aria-label={t.dishes.aliasOf(dish.name)} placeholder={t.dishes.aliasPlaceholder} onChange={(e) => setAlias(e.target.value)} />
                    <button type="submit" className="button-secondary-small" disabled={change.isPending}>
                      {t.dishes.aliasAdd}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="text-button dish-group-remove" disabled={change.isPending} onClick={() => change.mutate({ remove: group.id })}>
            {t.dishes.removeGroup}
          </button>
        </section>
      ))}
      {change.isError && (
        <p className="error-text" role="alert">
          {t.dishes.failed}
        </p>
      )}
    </details>
  );
}
