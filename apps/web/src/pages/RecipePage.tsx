import type { Recipe } from "@intake/shared";
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useChangeRecipe, useDishes, useFeatures, useRecipe } from "../api/queries";
import { SparklesIcon } from "../components/icons";
import { formatMediumDate } from "../lib/format";
import { planErrorText } from "../lib/planErrors";
import { t } from "../lib/strings";

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

/**
 * The recipe of a dish: asked once to the AI ("Chiedi la ricetta all'IA", part Pasti da foto) and kept with the dish, so
 * reading it again costs nothing. "Rigenera" asks a new one, "Modifica" lets the person correct it, × deletes it. When the
 * dish's foods change after it was written, it says so. Rules in docs/dishes.md.
 */
export function RecipePage({ id }: { id: string }) {
  const s = t.dishBook;
  const dishes = useDishes();
  const view = useRecipe(id);
  const change = useChangeRecipe(id);
  const aiAvailable = useFeatures().data?.recognition === true;
  const [editing, setEditing] = useState(new URLSearchParams(useSearch()).get("modifica") === "1");
  const [wish, setWish] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meal = dishes.data?.dishes.find((d) => d.id === id);
  const stored = view.data?.recipe ?? null;

  return (
    <div className="page detail-page edit-page recipe-page">
      <header className="edit-header edit-header-back">
        <Link href={`/piano/piatti/${id}`} className="icon-button" aria-label={s.back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1>{s.recipe}</h1>
        <span aria-hidden="true" />
      </header>
      {meal && <p className="muted recipe-of">{meal.name}</p>}

      {view.isPending && <div className="card skeleton" style={{ height: 320 }} />}

      {editing ? (
        <RecipeEditor
          recipe={stored?.recipe ?? null}
          busy={change.isPending}
          failed={change.isError}
          onCancel={() => setEditing(false)}
          onSave={(recipe) => change.mutate({ save: recipe }, { onSuccess: () => setEditing(false) })}
        />
      ) : stored ? (
        <>
          {view.data?.stale && (
            <p className="notice recipe-stale" role="status">
              {s.recipeStale}
            </p>
          )}
          <div className="dish-tags">
            <span className="dish-tag">{s.minutes(stored.recipe.minutes)}</span>
            <span className="dish-tag">{s.servings(stored.recipe.servings)}</span>
            <span className="dish-tag">{s.difficulty[stored.recipe.difficulty]}</span>
          </div>
          <section className="card dish-card" aria-label={s.ingredients}>
            <span className="sheet-section">{s.ingredients.toUpperCase()}</span>
            <ul className="recipe-ingredients">
              {stored.recipe.ingredients.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
          <section className="card dish-card" aria-label={s.steps}>
            <span className="sheet-section">{s.steps.toUpperCase()}</span>
            <ol className="recipe-steps">
              {stored.recipe.steps.map((step, i) => (
                <li key={i}>
                  <span className="recipe-step-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
          {stored.recipe.tip && (
            <section className="card dish-card" aria-label={s.tip}>
              <span className="sheet-section">{s.tip.toUpperCase()}</span>
              <p className="recipe-tip">{stored.recipe.tip}</p>
            </section>
          )}
          <p className="muted recipe-source">
            {stored.source === "ai" ? (
              <span className="ai-label">
                <SparklesIcon size={14} />
                {s.writtenByAi(formatMediumDate(stored.at.slice(0, 10)))}
              </span>
            ) : (
              s.editedByYou(formatMediumDate(stored.at.slice(0, 10)))
            )}
          </p>
          {aiAvailable && (
            <label className="field">
              <span>{s.wish}</span>
              <input value={wish} maxLength={200} placeholder={s.wishPlaceholder} onChange={(e) => setWish(e.target.value)} />
            </label>
          )}
          {change.isError && <p className="error-text">{planErrorText(change.error)}</p>}
          <div className="dish-actions">
            {aiAvailable && (
              <button type="button" className="button-secondary button-ai-soft" disabled={change.isPending} onClick={() => change.mutate({ generate: { note: wish.trim() } }, { onSuccess: () => setWish("") })}>
                <SparklesIcon size={16} />
                {change.isPending ? s.recipeWorking : s.regenerate}
              </button>
            )}
            <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
              {s.edit}
            </button>
          </div>
          {confirmDelete ? (
            <div className="dish-delete" role="group" aria-label={s.deleteRecipeConfirm}>
              <span className="muted">{s.deleteRecipeConfirm}</span>
              <span className="meal-photos-clear-actions">
                <button type="button" className="button-secondary-small" onClick={() => setConfirmDelete(false)}>
                  {s.cancel}
                </button>
                <button type="button" className="button-secondary-small button-danger-small" disabled={change.isPending} onClick={() => change.mutate({ remove: true }, { onSuccess: () => setConfirmDelete(false) })}>
                  {s.delete}
                </button>
              </span>
            </div>
          ) : (
            <button type="button" className="text-button dish-delete-link" onClick={() => setConfirmDelete(true)}>
              {s.deleteRecipe}
            </button>
          )}
        </>
      ) : (
        view.isSuccess && (
          <div className="coming-soon">
            <strong>{s.noRecipe}</strong>
            <p className="muted">{aiAvailable ? s.recipeNotAsked : s.recipeNone}</p>
            {aiAvailable && (
              <label className="field recipe-wish">
                <span>{s.wish}</span>
                <input value={wish} maxLength={200} placeholder={s.wishPlaceholder} onChange={(e) => setWish(e.target.value)} />
              </label>
            )}
            {change.isError && <p className="error-text">{planErrorText(change.error)}</p>}
            <div className="plan-empty-actions">
              {aiAvailable && (
                <button type="button" className="button button-ai" disabled={change.isPending} onClick={() => change.mutate({ generate: { note: wish.trim() } })}>
                  <SparklesIcon size={18} />
                  {change.isPending ? s.recipeWorking : s.askRecipe}
                </button>
              )}
              <button type="button" className="button-secondary-small" onClick={() => setEditing(true)}>
                {s.writeRecipe}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** "Modifica" of a recipe, or one written by hand: one ingredient and one step per line. */
function RecipeEditor({ recipe, onSave, onCancel, busy, failed }: { recipe: Recipe | null; onSave: (recipe: Recipe) => void; onCancel: () => void; busy: boolean; failed: boolean }) {
  const s = t.dishBook;
  const [minutes, setMinutes] = useState(String(recipe?.minutes ?? 20));
  const [servings, setServings] = useState(String(recipe?.servings ?? 1));
  const [difficulty, setDifficulty] = useState<Recipe["difficulty"]>(recipe?.difficulty ?? "easy");
  const [ingredients, setIngredients] = useState((recipe?.ingredients ?? []).join("\n"));
  const [steps, setSteps] = useState((recipe?.steps ?? []).join("\n"));
  const [tip, setTip] = useState(recipe?.tip ?? "");
  const [problem, setProblem] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const m = Number(minutes);
    const n = Number(servings);
    if (!Number.isInteger(m) || m < 1 || !Number.isInteger(n) || n < 1 || lines(ingredients).length === 0 || lines(steps).length === 0) return setProblem(true);
    setProblem(false);
    onSave({ minutes: m, servings: n, difficulty, ingredients: lines(ingredients).slice(0, 30), steps: lines(steps).slice(0, 15), ...(tip.trim() ? { tip: tip.trim() } : {}) });
  }

  return (
    <form className="dish-form" onSubmit={submit}>
      <div className="recipe-numbers">
        <label className="field">
          <span>{s.minutesLabel}</span>
          <input value={minutes} inputMode="numeric" onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <label className="field">
          <span>{s.servingsLabel}</span>
          <input value={servings} inputMode="numeric" onChange={(e) => setServings(e.target.value)} />
        </label>
      </div>
      <div className="segmented" role="radiogroup" aria-label={s.difficultyLabel}>
        {(["easy", "medium", "hard"] as const).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={difficulty === option} className="segmented-option" onClick={() => setDifficulty(option)}>
            {s.difficulty[option]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{s.ingredientsLabel}</span>
        <textarea rows={5} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
      </label>
      <label className="field">
        <span>{s.stepsLabel}</span>
        <textarea rows={7} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </label>
      <label className="field">
        <span>{s.tipLabel}</span>
        <input value={tip} maxLength={400} onChange={(e) => setTip(e.target.value)} />
      </label>
      {(problem || failed) && (
        <p className="error-text" role="alert">
          {problem ? s.recipeIncomplete : s.failed}
        </p>
      )}
      <div className="plan-replace-actions">
        <button type="button" className="button-secondary-small" onClick={onCancel}>
          {s.cancel}
        </button>
        <button type="submit" className="button-primary-inline" disabled={busy}>
          {s.save}
        </button>
      </div>
    </form>
  );
}
