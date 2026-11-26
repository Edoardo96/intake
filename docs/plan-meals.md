# Taking meals out of the plan and adding meals

In Piano, the ⋯ of a meal has "Togli pasto", and under the day's meals "+ Aggiungi pasto" adds one. Each asks whether the change is for the day shown only ("Solo mercoledì") or for every day ("Tutti i giorni"). To skip a meal on one date only, use "Salta" in the Timeline instead: that leaves the plan as it is.

## Model

- Shared code: `packages/shared/src/planMeals.ts` (`removePlanMeal`, `addPlanMeal`).
- A meal taken out is gone from the day: there is no list of removed meals. To have it again, "+ Aggiungi pasto" adds it (its dish can come from Piano › Piatti when it was saved there, [plan-dishes.md](plan-dishes.md)). A day's `removed` list written by an earlier Intake is accepted but ignored, and dropped on the next change of that day.
- "Tutti i giorni" finds the same meal on the other days by its title, counted among the meals with that title: the first "Spuntino" is the morning one, the second the afternoon one. Days without it are left alone.
- A new meal has a title (Colazione, Spuntino, Pranzo, Merenda, Cena or a name of your own; the type follows the title, snack for your own names), a time and a dish from your dishes or written by hand; it goes into the day at its time.

## Versions and links

Taking out or adding a meal moves the positions of the other meals of the day, and the links between planned and logged meals ("Mangiato come previsto") and the skipped meals are kept by position. So:

- A version already in effect (started before today) is not changed: the change is saved as a new version from today, so the past days keep the plan they had. "Storico versioni" shows it.
- A version that starts today or later is changed in place.
- In both cases the links and skips of today and later move to the meals' new positions (`PlanStore.moveRefs`); those of a meal taken out are dropped. A superseded version cannot be changed (409 `plan_superseded`).

## API (owner only, part Alimentazione)

| Route | Body |
|---|---|
| `POST /api/plans/:id/meals/remove` | `{ day, index, allDays }` |
| `POST /api/plans/:id/meals/add` | `{ day, allDays, title, time, type, description, foods, macros? }` |

Each answers with the stored version that now holds the change (a new one when the plan was already in effect).
