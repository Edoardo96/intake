# Interchangeable dishes (Piatti intercambiabili)

A group of dishes that can take each other's place in the meal plan, wherever any of them appears. With "Pasta con tonno" and "Pasta al salmone" in one group, every meal of the plan whose dish is "Pasta con tonno" (Monday lunch, Friday dinner, …) offers "Pasta al salmone" as its alternative, and every meal with "Pasta al salmone" offers "Pasta con tonno".

## Model

- Shared code: `packages/shared/src/dishGroups.ts`. Store: `apps/server/src/db/dishGroupStore.ts` (table `dish_groups`, one row per group, its dishes as JSON). Routes: `apps/server/src/routes/dishGroups.ts`.
- A dish has a name, other names (`aliases`), its foods (with per-food values when known) and optional totals. A group has 2 to 8 dishes; a group left with one dish is removed.
- Groups belong to the installation, not to a plan: they last when a new plan is uploaded or generated.
- A planned meal belongs to a dish by its text (`mealFoodsText`: the description, or the foods joined), compared without case, accents or punctuation. When a plan calls the same dish differently, "Collega anche…" adds that name to the dish.
- Linking a dish that is already in another group merges the two groups.

## API (owner only, part Alimentazione)

| Route | |
|---|---|
| `GET /api/dish-groups` | All groups |
| `POST /api/dish-groups/link` | `{ dish, alternative }`: adds `alternative` to the group of `dish` (or a new group) |
| `PUT /api/dish-groups/:id` | `{ dishes }`: the group after a change (a dish removed, a name linked) |
| `DELETE /api/dish-groups/:id` | Removes the group |
| `POST /api/days/:date/planned/:planId/:index` | Optional body `{ alternative: { groupId, dishIndex } }`: "Mangiato come previsto" logs that dish instead of the planned one |

## Where it shows

- **Piano**: under each fixed meal, "ALTERNATIVE" lists the other dishes of its group with their kcal and protein, "Usa questo" (the dish takes the place of the planned one through the same edit as "Modifica"; the shopping list follows the plan) and ×. "+ Aggiungi alternativa" adds one from a favorite (its foods and values come with it) or by hand (the dish editor, with "Cerca nel database"). The AI one comes from "Alternativa": "Tieni come alternativa" keeps the proposal in the group instead of using it. The AI never adds alternatives on its own.
- **Piano › Piatti intercambiabili** (side card): every group, with "Collega anche…", × per dish and "Elimina gruppo".
- **Timeline and Oggi** (next meal): nothing is shown until "Alternative (N)" is tapped; then "Cosa hai mangiato?" chips with the planned dish (labelled "Previsto") and its alternatives; the chosen one has a check mark. "Chiudi" goes back to the planned dish. "Mangiato come previsto" logs the chosen dish food by food when every food has values, otherwise with its totals; a dish without values cannot be logged this way.

## Logging an alternative

`logPlannedMeal` checks that the group contains the planned dish, logs the alternative with the meal's title and type (`"Pranzo: Pasta al salmone"`), uses the idempotency key `intake-plan-<plan>-<date>-<index>-alt-<group>-<dish>` and links the logged meal to the planned one, so the planned card is fulfilled as usual.

## Claude Fitness import

A meal's `alternative[]` (with `alternative_macros` when complete) becomes an interchangeable dish of the meal's dish on upload, instead of an "oppure: …" line in the plan. Uploading the same file again does not add anything twice.
