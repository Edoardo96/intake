import { Link } from "wouter";
import { DishesTab } from "../components/DishesTab";
import { t } from "../lib/strings";

/**
 * "+" › I tuoi piatti: the dishes of Piano › Piatti in a screen of their own, with the search and the categories, starting
 * on the dishes of the meal of this hour. A dish opens the confirmation screen; new dishes are made in Piano › Piatti.
 */
export function DishLogPage() {
  return (
    <div className="page detail-page edit-page dish-log-page">
      <header className="edit-header edit-header-back">
        <Link href="/" className="icon-button" aria-label={t.dishBook.backHome}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1>{t.addSheet.saved}</h1>
        <span aria-hidden="true" />
      </header>
      <p className="muted dish-log-hint">{t.dishBook.logHint}</p>
      <DishesTab forLogging />
    </div>
  );
}
