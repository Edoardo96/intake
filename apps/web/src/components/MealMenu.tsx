import { looseDishKey, type DishSummary } from "@intake/shared";
import { useEffect, type ReactNode } from "react";
import { useDishes } from "../api/queries";
import { t } from "../lib/strings";
import { CloseIcon } from "./icons";
import { Scrim } from "./Scrim";

/**
 * The ⋯ of a meal (or of a course) in Piano: every action of the meal in one sheet, grouped by "Il piatto" and
 * "Il pasto", so the card shows only the dish, its values and two small chips. Rules in docs/design/DESIGN.md.
 */
export interface MenuItem {
  icon: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function MealMenuSheet({ title, subtitle, sections, onClose }: { title: string; subtitle?: string; sections: Array<{ label: string; items: MenuItem[] }>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Scrim onClose={onClose}>
      <div className="sheet meal-menu" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="sheet-head">
          <div className="meal-menu-head">
            <h2>{title}</h2>
            {subtitle && <span className="muted">{subtitle}</span>}
          </div>
          <button type="button" className="icon-button" aria-label={t.mealMenu.close} onClick={onClose}>
            <CloseIcon size={18} strokeWidth={2.5} />
          </button>
        </div>
        {sections
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <div key={section.label} className="meal-menu-section" role="menu" aria-label={section.label}>
              <span className="plan-edit-title">{section.label}</span>
              {section.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className="meal-menu-item"
                  data-danger={item.danger || undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    onClose();
                    item.onClick();
                  }}
                >
                  <span className="meal-menu-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="meal-menu-label">
                    <strong>{item.label}</strong>
                    {item.hint && <span className="muted">{item.hint}</span>}
                  </span>
                  <span className="meal-menu-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </Scrim>
  );
}

/** The ⋯ button in a meal's header. */
export function MealMenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="meal-menu-button" aria-label={label} aria-haspopup="dialog" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </button>
  );
}

/** "⇄ 2 alternative" (opens them) and "✓ Nei tuoi piatti" under a planned dish; nothing when neither applies. */
export function MealChips({ alternatives, saved, onAlternatives, children }: { alternatives: number; saved: boolean; onAlternatives: () => void; children?: ReactNode }) {
  if (alternatives === 0 && !saved && !children) return null;
  return (
    <div className="meal-chips">
      {alternatives > 0 && (
        <button type="button" className="meal-chip meal-chip-alt" onClick={onAlternatives}>
          {t.mealMenu.chip(alternatives)}
        </button>
      )}
      {saved && <span className="meal-chip">{t.mealMenu.inDishes}</span>}
      {children}
    </div>
  );
}

/** The saved dish (Piano › Piatti) with this name, without amounts: the same dish with other grams is the same dish. */
export function useSavedDishFinder(): (name: string) => DishSummary | null {
  const dishes = useDishes();
  const byKey = new Map<string, DishSummary>();
  for (const dish of dishes.data?.dishes ?? []) {
    for (const text of [dish.name, dish.description]) {
      const key = looseDishKey(text);
      if (key && !byKey.has(key)) byKey.set(key, dish);
    }
  }
  return (name: string) => byKey.get(looseDishKey(name)) ?? null;
}
