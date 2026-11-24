import { WEEKDAYS, alternativesFor, coursesOf, courseText, dishKey, isFixedMeal, looseDishKey, mealFoodsText, type DishGroup, type MealPlan, type Weekday } from "@intake/shared";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useChangeDishGroups, useChangeRecipe, useDeleteDish, useDishAlias, useDishes, useDishGroups, useEditPlanMeal, useFeatures, usePlans } from "../api/queries";
import { DishPickerSheet, dishAsEdit } from "../components/DishAlternatives";
import { CloseIcon, SparklesIcon } from "../components/icons";
import { Scrim } from "../components/Scrim";
import { categoryLabel, dishFromSaved } from "../lib/dishCategory";
import { formatKcal } from "../lib/format";
import { planErrorText } from "../lib/planErrors";
import { t } from "../lib/strings";

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/**
 * Piano › Piatti › a dish: its category, values and foods, the recipe (asked once to the AI and kept), the dishes it is
 * interchangeable with, where it is in the plan, "Metti nel piano" and "Registra ora". Rules in docs/dishes.md.
 */
export function DishPage({ id }: { id: string }) {
  const s = t.dishBook;
  const dishes = useDishes();
  const groups = useDishGroups();
  const links = useChangeDishGroups();
  const plans = usePlans();
  const edit = useEditPlanMeal();
  const remove = useDeleteDish();
  const recipe = useChangeRecipe(id);
  const aiAvailable = useFeatures().data?.recognition === true;
  const [, navigate] = useLocation();
  const [picking, setPicking] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const alias = useDishAlias();
  const meal = dishes.data?.dishes.find((d) => d.id === id);
  const header = (
    <header className="edit-header edit-header-back">
      <Link href="/piano?vista=piatti" className="icon-button" aria-label={s.back}>
        <BackIcon />
      </Link>
      <h1>{s.dish}</h1>
      {meal ? (
        <Link href={`/piano/piatti/${id}/modifica`} className="text-button text-button-strong dish-edit-link">
          {s.edit}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </header>
  );
  if (!meal) {
    return (
      <div className="page detail-page edit-page dish-page">
        {header}
        {dishes.isPending ? <div className="card skeleton" style={{ height: 320 }} /> : <p className="muted">{s.notFound}</p>}
      </div>
    );
  }

  const dish = dishFromSaved(meal);
  const alternatives = [...alternativesFor(groups.data ?? [], meal.name), ...alternativesFor(groups.data ?? [], meal.description)].filter(
    (alt, i, list) => list.findIndex((other) => other.groupId === alt.groupId && other.dishIndex === alt.dishIndex) === i,
  );
  const group: DishGroup | undefined = alternatives[0] ? groups.data?.find((g) => g.id === alternatives[0]!.groupId) : undefined;
  const fiber = meal.items.length > 0 ? meal.items.reduce((sum, item) => sum + (item.nutrients.fiber ?? 0), 0) : null;
  const plan = plans.data?.active ?? null;
  // The same dish with other grams on another day is the same dish; each course of a meal is a dish of its own
  const keys = [meal.name, meal.description, ...meal.aliases].map(looseDishKey).filter(Boolean);
  const inPlan = plan
    ? WEEKDAYS.flatMap((w, i) =>
        plan.plan.days[w].meals.flatMap((m) =>
          isFixedMeal(m) && (keys.includes(looseDishKey(mealFoodsText(m))) || (m.courses && coursesOf(m).some((c) => keys.includes(looseDishKey(courseText(c))) || keys.includes(looseDishKey(c.foods.map((f) => f.name).join(" + "))))) || keys.includes(looseDishKey(m.foods.map((f) => f.name).join(" + "))))
            ? [`${t.weekdaysLong[i]} ${m.title.toLowerCase()}`]
            : [],
        ),
      )
    : [];

  function putInPlan(day: Weekday, index: number, label: string) {
    if (!plan) return;
    edit.mutate(
      { id: plan.id, day, index, ...dishAsEdit(dish) },
      {
        onSuccess: () => {
          setPlacing(false);
          setPlaced(label);
        },
      },
    );
  }

  return (
    <div className="page detail-page edit-page dish-page">
      {header}

      <div className="dish-head">
        <h2 className="dish-title">{meal.name}</h2>
        <div className="dish-tags">
          <span className="dish-tag">{meal.category ? categoryLabel(meal.category) : s.noCategory}</span>
          {meal.mealType && <span className="dish-tag">{t.mealTypes[meal.mealType] ?? meal.mealType}</span>}
        </div>
      </div>

      <section className="card dish-values" aria-label={s.values}>
        <div className="dish-kcal">
          <strong>{meal.kcal !== null ? `${formatKcal(meal.kcal)} kcal` : s.noValues}</strong>
          <span className="muted">{s.perServing}</span>
        </div>
        <div className="dish-macros">
          <span className="dish-macro" data-macro="protein">
            <strong>{formatKcal(meal.protein ?? 0)} g</strong>
            {t.macros.protein}
          </span>
          <span className="dish-macro" data-macro="carbs">
            <strong>{formatKcal(meal.carbs ?? 0)} g</strong>
            {t.macros.carbs}
          </span>
          <span className="dish-macro" data-macro="fat">
            <strong>{formatKcal(meal.fat ?? 0)} g</strong>
            {t.macros.fat}
          </span>
          {fiber !== null && (
            <span className="dish-macro" data-macro="fiber">
              <strong>{formatKcal(Math.round(fiber))} g</strong>
              {t.macros.fiber}
            </span>
          )}
        </div>
      </section>

      <section className="card dish-card" aria-label={s.foods}>
        <span className="sheet-section">{s.foods.toUpperCase()}</span>
        {meal.items.length > 0 ? (
          <ul className="dish-foods">
            {meal.items.map((item, i) => (
              <li key={i}>
                <span>{item.name}</span>
                <span className="muted">
                  {[item.quantityText, `${formatKcal(item.nutrients.kcal)} kcal`].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{meal.description || s.totalsOnly}</p>
        )}
      </section>

      <section className="card dish-card dish-recipe-row" aria-label={s.recipe}>
        <span className="dish-recipe-text">
          <span className="sheet-section">{s.recipe.toUpperCase()}</span>
          <span className="muted">{meal.hasRecipe ? s.recipeKept : aiAvailable ? s.recipeNotAsked : s.recipeNone}</span>
        </span>
        {meal.hasRecipe ? (
          <Link href={`/piano/piatti/${id}/ricetta`} className="button-secondary-small">
            {s.openRecipe}
          </Link>
        ) : aiAvailable ? (
          <button
            type="button"
            className="button-secondary-small button-ai-soft"
            disabled={recipe.isPending}
            onClick={() => recipe.mutate({ generate: { note: "" } }, { onSuccess: () => navigate(`/piano/piatti/${id}/ricetta`) })}
          >
            <SparklesIcon size={14} />
            {recipe.isPending ? s.recipeWorking : s.askRecipe}
          </button>
        ) : (
          <Link href={`/piano/piatti/${id}/ricetta?modifica=1`} className="button-secondary-small">
            {s.writeRecipe}
          </Link>
        )}
        {recipe.isError && (
          <p className="error-text dish-recipe-error" role="alert">
            {planErrorText(recipe.error)}
          </p>
        )}
      </section>

      <section className="card dish-card" aria-label={s.interchangeable}>
        <div className="dish-card-head">
          <span className="sheet-section">{s.interchangeable.toUpperCase()}</span>
          <button type="button" className="text-button text-button-strong" onClick={() => setPicking(true)}>
            {s.addAlternative}
          </button>
        </div>
        {alternatives.length === 0 && <p className="muted">{s.noAlternatives}</p>}
        <ul className="dish-alt-list">
          {alternatives.map((alt) => (
            <li key={`${alt.groupId}-${alt.dishIndex}`} className="dish-alt">
              <span className="dish-alt-text">
                <strong>{alt.dish.name}</strong>
              </span>
              <button
                type="button"
                className="item-remove"
                disabled={links.isPending}
                aria-label={t.dishes.remove(alt.dish.name)}
                onClick={() => group && links.mutate({ id: group.id, dishes: group.dishes.filter((_, i) => i !== alt.dishIndex) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {inPlan.length > 0 && <p className="muted dish-in-plan">{s.inPlan(inPlan.join(", "))}</p>}
        {meal.aliases.length > 0 && (
          <div className="dish-aliases">
            <span className="plan-edit-title">{t.mealMenu.alsoAs}</span>
            <ul>
              {meal.aliases.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <button type="button" className="item-remove" disabled={alias.isPending} aria-label={t.mealMenu.removeAlias(name)} onClick={() => alias.mutate({ id: meal.id, name, remove: true })}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {placed && (
        <p className="notice" data-kind="success" role="status">
          {s.placed(placed)}
        </p>
      )}

      <div className="dish-actions">
        <button type="button" className="button-secondary" disabled={!plan} onClick={() => setPlacing(true)}>
          {s.putInPlan}
        </button>
        <Link href={`/pasto/nuovo/preferito/${id}`} className="button-primary-inline">
          {s.logNow}
        </Link>
      </div>
      {!plan && plans.isSuccess && <p className="muted">{s.noActivePlan}</p>}

      {confirmDelete ? (
        <div className="dish-delete" role="group" aria-label={s.deleteConfirm(meal.name)}>
          <span className="muted">{s.deleteConfirm(meal.name)}</span>
          <span className="meal-photos-clear-actions">
            <button type="button" className="button-secondary-small" onClick={() => setConfirmDelete(false)}>
              {s.cancel}
            </button>
            <button type="button" className="button-secondary-small button-danger-small" disabled={remove.isPending} onClick={() => remove.mutate(id, { onSuccess: () => navigate("/piano?vista=piatti") })}>
              {s.delete}
            </button>
          </span>
        </div>
      ) : (
        <button type="button" className="text-button dish-delete-link" onClick={() => setConfirmDelete(true)}>
          {s.deleteDish}
        </button>
      )}
      {remove.isError && <p className="error-text">{s.failed}</p>}

      {picking && (
        <DishPickerSheet
          meal={meal.name}
          category={meal.category}
          exclude={[meal.id]}
          busy={links.isPending}
          failed={links.isError}
          onClose={() => setPicking(false)}
          onPick={(alternative) => links.mutate({ link: { dish, alternative } }, { onSuccess: () => setPicking(false) })}
        />
      )}
      {placing && plan && (
        <PlanSlotSheet
          plan={plan.plan}
          busy={edit.isPending}
          failed={edit.isError}
          onClose={() => setPlacing(false)}
          onPick={putInPlan}
        />
      )}
    </div>
  );
}

/** "Metti nel piano": every fixed meal of the active plan, by day; the chosen one gets this dish (like "Usa questo"). */
function PlanSlotSheet({ plan, onPick, onClose, busy, failed }: { plan: MealPlan; onPick: (day: Weekday, index: number, label: string) => void; onClose: () => void; busy: boolean; failed: boolean }) {
  const s = t.dishBook;
  return (
    <Scrim onClose={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={s.putInPlan} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{s.putInPlan}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>
        <p className="muted dish-fav-for">{s.putInPlanHint}</p>
        {failed && (
          <p className="error-text" role="alert">
            {s.failed}
          </p>
        )}
        {WEEKDAYS.map((w, i) => {
          const meals = plan.days[w].meals.map((m, index) => ({ m, index })).filter(({ m }) => isFixedMeal(m));
          if (meals.length === 0) return null;
          return (
            <section key={w} aria-label={t.weekdaysLong[i]}>
              <span className="sheet-section">{t.weekdaysLong[i]!.toUpperCase()}</span>
              <div className="sheet-list">
                {meals.map(({ m, index }) => (
                  <button key={index} type="button" className="sheet-row" disabled={busy} onClick={() => onPick(w, index, `${t.weekdaysLong[i]} ${m.title.toLowerCase()}`)}>
                    <span className="sheet-row-text">
                      <strong>{m.title}</strong>
                      <span className="muted">{mealFoodsText(m)}</span>
                    </span>
                    <span className="sheet-row-action">{s.replace}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Scrim>
  );
}
