import { alternativesFor, dishKeys, dishMacros, dishOfMeal, foodLine, mealFoodsText, plannedFoodsOf, type Dish, type DishGroup, type FixedPlannedMeal, type PlannedMacros } from "@intake/shared";
import { useState } from "react";
import { useChangeDishGroups, useDishGroups, useSavedMeals } from "../api/queries";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";
import { EditMeal, type DishEdit } from "./PlanDay";

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
 * "Alternativa" (AlternativeMeal › "Tieni come alternativa"). Rules in docs/dish-groups.md.
 */
export function DishAlternatives({ meal, onUse, busy }: { meal: FixedPlannedMeal; onUse: (dish: Dish) => void; busy?: boolean }) {
  const groups = useDishGroups();
  const change = useChangeDishGroups();
  const [adding, setAdding] = useState<null | "menu" | "favorites" | "hand">(null);
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
          <span className="muted plan-edit-hint">{t.dishes.hint}</span>
          <div className="plan-replace-actions">
            <button type="button" className="button-secondary-small" onClick={() => setAdding(null)}>
              {t.dishes.cancel}
            </button>
            <button type="button" className="button-secondary-small" onClick={() => setAdding("favorites")}>
              {t.dishes.fromFavorites}
            </button>
            <button type="button" className="button-secondary-small" onClick={() => setAdding("hand")}>
              {t.dishes.byHand}
            </button>
          </div>
        </div>
      )}
      {adding === "favorites" && <FavoritePicker onPick={(dish) => link(dish)} onCancel={() => setAdding(null)} busy={change.isPending} />}
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
      {change.isError && adding !== "hand" && (
        <p className="error-text" role="alert">
          {t.dishes.failed}
        </p>
      )}
    </div>
  );
}

/** "Dai preferiti": a favorite with its foods becomes a dish (its values come with it). */
function FavoritePicker({ onPick, onCancel, busy }: { onPick: (dish: Dish) => void; onCancel: () => void; busy?: boolean }) {
  const saved = useSavedMeals();
  const favorites = (saved.data ?? []).filter((m) => m.items.length > 0);
  return (
    <div className="dish-alt-choose">
      <span className="plan-edit-title">{t.dishes.fromFavorites}</span>
      {saved.isLoading && <p className="muted">{t.dishes.loading}</p>}
      {saved.isSuccess && favorites.length === 0 && <p className="muted">{t.dishes.favoritesEmpty}</p>}
      <ul className="dish-alt-list">
        {favorites.map((favorite) => {
          const foods = plannedFoodsOf(favorite.items);
          const dish: Dish = { name: favorite.name, aliases: [], foods, macros: null };
          return (
            <li key={favorite.id} className="dish-alt">
              <span className="dish-alt-text">
                <strong>{favorite.name}</strong>
                <span className="muted">{foods.map(foodLine).join(" + ")}</span>
              </span>
              <button type="button" className="button-secondary-small" disabled={busy} onClick={() => onPick(dish)}>
                {t.dishes.pick}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="plan-replace-actions">
        <button type="button" className="button-secondary-small" onClick={onCancel}>
          {t.dishes.cancel}
        </button>
      </div>
    </div>
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
