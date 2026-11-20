import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAddWater, useDay, useFeature, useFeatures, useLogPlanned, useLogSavedMeal, useDeleteSavedMeal, useRecentMeals, useRepeatMeal, useSavedMeals } from "../api/queries";
import { formatKcal, formatShortDate } from "../lib/format";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";
import { mealSummary, mealTitle } from "./Timeline";
import { Scrim } from "./Scrim";

/** Icons of the "Altro cibo" rows, from the design. */
const ROW_ICONS = {
  repeat: "M4 12a8 8 0 1 0 3-6.2M4 4v5h5",
  saved: "M12 17l-5 3 1-6-4-4 6-1 2-5 2 5 6 1-4 4 1 6z",
  claude: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
};

/** Opens Claude (the app when installed, via universal link) with the start of the request. */
const CLAUDE_URL = `https://claude.ai/new?q=${encodeURIComponent(t.addSheet.claudePrompt)}`;

function RowIcon({ path }: { path: string }) {
  return (
    <span className="row-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}

interface Props {
  onClose: () => void;
}

const WATER_AMOUNTS = [200, 250];

/** Favorites listed when the row opens, before "Mostra altri". */
const SAVED_SHOWN = 5;

/** ▾ / ▴ at the end of a row that opens a list. */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <span className="row-chevron" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </svg>
    </span>
  );
}

/**
 * "Aggiungi" sheet opened by the + button: a bottom sheet on phones, a centered dialog on wider screens.
 * Water shortcuts (when Acqua is on), today's plan meals not yet logged, then favorites, recent meals and the other ways to add food.
 */
export function AddSheet({ onClose }: Props) {
  const addWater = useAddWater("today");
  const water = useFeature("water");
  const recognition = useFeatures().data?.recognition ?? false;
  const today = useDay("today");
  const logPlanned = useLogPlanned("today");
  const [showRecent, setShowRecent] = useState(false);
  const recent = useRecentMeals(showRecent);
  const repeat = useRepeatMeal();
  const saved = useSavedMeals();
  const logSaved = useLogSavedMeal();
  const deleteSaved = useDeleteSavedMeal();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showAllSaved, setShowAllSaved] = useState(false);
  const shownSaved = showAllSaved ? (saved.data ?? []) : (saved.data ?? []).slice(0, SAVED_SHOWN);
  const hiddenSaved = (saved.data?.length ?? 0) - shownSaved.length;
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const planMeals = (today.data?.planned ?? []).filter((entry) => entry.status === "todo" || entry.status === "planned");

  return (
    <Scrim onClose={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t.addSheet.title} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{t.addSheet.title}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>

        {recognition && (
          <div className="capture-tiles">
            <Link href="/pasto/nuovo" className="capture-tile" data-primary onClick={onClose}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              <span>
                <strong>{t.newMeal.photo}</strong>
                <span className="capture-tile-hint">{t.newMeal.photoHint}</span>
              </span>
            </Link>
            <Link href="/pasto/nuovo/testo" className="capture-tile" onClick={onClose}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16v10H9l-5 4z" />
                <path d="M8 10h8M8 13h5" />
              </svg>
              <span>
                <strong>{t.newMeal.text}</strong>
                <span className="capture-tile-hint">{t.newMeal.textHint}</span>
              </span>
            </Link>
          </div>
        )}

        {water && (
          <div className="sheet-water">
            {WATER_AMOUNTS.map((amount, i) => (
              <button
                key={amount}
                ref={i === 0 ? firstButton : undefined}
                type="button"
                className="sheet-water-button"
                disabled={addWater.isPending}
                onClick={() => addWater.mutate(amount, { onSuccess: onClose })}
              >
                {t.water.addLong(`${amount} ml`)}
              </button>
            ))}
          </div>
        )}
        {water && addWater.isError && <p className="error-text">{t.errors.waterFailed}</p>}

        {planMeals.length > 0 && today.data && (
          <>
            <span className="sheet-section">{t.addSheet.fromPlan}</span>
            <div className="sheet-list">
              {planMeals.map((entry) => (
                <button
                  key={`${entry.planId}-${entry.index}`}
                  type="button"
                  className="sheet-row"
                  disabled={!entry.macros || logPlanned.isPending}
                  onClick={() =>
                    logPlanned.mutate({ date: today.data!.date, planId: entry.planId, index: entry.index }, { onSuccess: onClose })
                  }
                >
                  <span className="sheet-row-text">
                    <strong>
                      {entry.title} · {entry.time}
                    </strong>
                    <span className="muted">{entry.foods}</span>
                  </span>
                  <span className="sheet-row-action">{entry.macros ? t.addSheet.log : t.addSheet.noMacros}</span>
                </button>
              ))}
            </div>
            {logPlanned.isError && <p className="error-text">{t.timeline.logFailed}</p>}
          </>
        )}

        <span className="sheet-section">{t.addSheet.otherFood}</span>
        <div className="sheet-list">
          {saved.data && saved.data.length > 0 ? (
            <>
              {/* Favorites are one row that opens, like "Ripeti un pasto recente", so a long list doesn't fill the sheet */}
              <button type="button" className="sheet-row" aria-expanded={showSaved} onClick={() => setShowSaved((v) => !v)}>
                <RowIcon path={ROW_ICONS.saved} />
                <span className="sheet-row-text">
                  <strong>{t.addSheet.saved}</strong>
                  <span className="muted">{t.addSheet.savedCount(saved.data.length)}</span>
                </span>
                <ChevronIcon open={showSaved} />
              </button>
              {showSaved && (
                <div className="recent-list">
                {shownSaved.map((meal) =>
                  confirmDelete === meal.id ? (
                    // Deleting is confirmed in place: the favorite goes from Nutrition, logged meals keep their values
                    <div key={meal.id} className="sheet-row saved-confirm" data-static role="group" aria-label={t.addSheet.deleteSavedConfirm(meal.name)}>
                      <span className="sheet-row-text">
                        <strong>{t.addSheet.deleteSavedConfirm(meal.name)}</strong>
                        <span className="muted">{t.addSheet.deleteSavedNote}</span>
                      </span>
                      <span className="saved-confirm-actions">
                        <button type="button" className="button-secondary-small" onClick={() => setConfirmDelete(null)}>
                          {t.addSheet.deleteSavedNo}
                        </button>
                        <button
                          type="button"
                          className="button-secondary-small"
                          data-kind="danger"
                          disabled={deleteSaved.isPending}
                          onClick={() => deleteSaved.mutate(meal, { onSuccess: () => setConfirmDelete(null) })}
                        >
                          {t.addSheet.deleteSavedYes}
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div key={meal.id} className="sheet-row saved-row" data-static>
                      <button type="button" className="sheet-row" disabled={logSaved.isPending} onClick={() => logSaved.mutate(meal, { onSuccess: onClose })}>
                        <span className="sheet-row-text">
                          <strong>
                            {meal.name}
                            {meal.kcal !== null && ` · ${formatKcal(meal.kcal)} kcal`}
                          </strong>
                          {meal.description && <span className="muted">{meal.description}</span>}
                        </span>
                        <span className="sheet-row-action">{t.addSheet.log}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button saved-delete"
                        aria-label={t.addSheet.deleteSaved(meal.name)}
                        onClick={() => {
                          deleteSaved.reset();
                          setConfirmDelete(meal.id);
                        }}
                      >
                        <CloseIcon size={18} />
                      </button>
                    </div>
                  ),
                )}
                  {hiddenSaved > 0 && (
                    <button type="button" className="text-button saved-more" onClick={() => setShowAllSaved(true)}>
                      {t.addSheet.savedMore(hiddenSaved)}
                    </button>
                  )}
                  {logSaved.isError && <p className="error-text">{t.timeline.logFailed}</p>}
                  {deleteSaved.isError && <p className="error-text">{t.addSheet.deleteSavedFailed}</p>}
                </div>
              )}
            </>
          ) : (
            <div className="sheet-row">
              <RowIcon path={ROW_ICONS.saved} />
              <span className="sheet-row-text">
                <strong>{t.addSheet.saved}</strong>
                <span className="muted">{saved.isError ? t.addSheet.savedFailed : saved.data ? t.addSheet.savedEmpty : t.loading}</span>
              </span>
            </div>
          )}
          <button type="button" className="sheet-row" aria-expanded={showRecent} onClick={() => setShowRecent((v) => !v)}>
            <RowIcon path={ROW_ICONS.repeat} />
            <span className="sheet-row-text">
              <strong>{t.addSheet.repeat}</strong>
              <span className="muted">{t.addSheet.repeatHint}</span>
            </span>
          </button>
          {showRecent && (
            <div className="recent-list">
              {recent.isPending && <p className="muted recent-empty">{t.loading}</p>}
              {recent.data?.length === 0 && <p className="muted recent-empty">{t.addSheet.noRecent}</p>}
              {recent.data?.map((meal) => (
                <button
                  key={meal.id}
                  type="button"
                  className="sheet-row recent-row"
                  disabled={repeat.isPending}
                  onClick={() => repeat.mutate(meal, { onSuccess: onClose })}
                >
                  <span className="sheet-row-text">
                    <strong>
                      {mealTitle(meal)} · {formatShortDate(meal.date)}
                    </strong>
                    <span className="muted">
                      {mealSummary(meal)} · {formatKcal(meal.nutrients.kcal)} kcal
                    </span>
                  </span>
                  <span className="sheet-row-action">{t.addSheet.log}</span>
                </button>
              ))}
              {repeat.isError && <p className="error-text">{t.timeline.logFailed}</p>}
            </div>
          )}
          {!recognition && (
            <a className="sheet-row" href={CLAUDE_URL} target="_blank" rel="noreferrer">
              <RowIcon path={ROW_ICONS.claude} />
              <span className="sheet-row-text">
                <strong>{t.addSheet.claude}</strong>
                <span className="muted">{t.addSheet.claudeHint}</span>
              </span>
              <span className="sheet-row-action">{t.addSheet.open}</span>
            </a>
          )}
        </div>
      </div>
    </Scrim>
  );
}
