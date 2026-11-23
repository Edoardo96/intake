import { alternativesFor, dishMacros, foodLine, type PlannedEntry } from "@intake/shared";
import { useState } from "react";
import { useDishGroups } from "../api/queries";
import { formatKcal } from "../lib/format";
import { t } from "../lib/strings";

/**
 * Which dish of a planned meal was eaten: the planned one or one of its interchangeable dishes (Piatti intercambiabili,
 * docs/dish-groups.md). "Mangiato come previsto" then logs the chosen dish with its foods.
 */
export function useDishChoice(entry: PlannedEntry) {
  const groups = useDishGroups();
  const alternatives = alternativesFor(groups.data ?? [], entry.foods);
  const [chosen, setChosen] = useState<number | null>(null);
  const alt = chosen === null ? undefined : alternatives[chosen];
  const macros = alt ? dishMacros(alt.dish) : (entry.macros ?? null);
  return {
    alternatives,
    chosen: alt ? chosen : null,
    choose: setChosen,
    canLog: macros !== null,
    kcal: macros?.kcal ?? null,
    summary: alt ? alt.dish.name : entry.foods,
    lines: alt ? alt.dish.foods.map(foodLine) : entry.lines.length > 0 ? entry.lines : [entry.foods],
    alternative: alt ? { groupId: alt.groupId, dishIndex: alt.dishIndex } : undefined,
  };
}

export type DishChoiceState = ReturnType<typeof useDishChoice>;

/** The chips of the choice; nothing when the planned dish has no interchangeable dishes. */
export function DishChoice({ entry, choice }: { entry: PlannedEntry; choice: DishChoiceState }) {
  if (choice.alternatives.length === 0) return null;
  const chips = [{ key: "planned", label: entry.foods, tag: t.dishes.planned, value: null as number | null }, ...choice.alternatives.map((alt, i) => ({ key: `${alt.groupId}-${alt.dishIndex}`, label: alt.dish.name, tag: null, value: i }))];
  return (
    <div className="dish-choice" role="group" aria-label={t.dishes.eaten}>
      <span className="dish-choice-title">{t.dishes.eaten}</span>
      <div className="dish-choice-chips">
        {chips.map((chip) => {
          const kcal = chip.value === null ? (entry.macros?.kcal ?? null) : (dishMacros(choice.alternatives[chip.value]!.dish)?.kcal ?? null);
          return (
            <button key={chip.key} type="button" className="dish-chip" aria-pressed={choice.chosen === chip.value} onClick={() => choice.choose(chip.value)}>
              <span className="dish-chip-name">{chip.label}</span>
              <span className="dish-chip-meta">
                {chip.tag && <span className="dish-chip-tag">{chip.tag}</span>}
                {kcal !== null ? `${formatKcal(kcal)} kcal` : t.dishes.noValues}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
