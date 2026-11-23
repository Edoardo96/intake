# Dishes (Piatti)

Piano › Piatti is the person's own database of dishes, with categories and recipes. It replaces the old "preferiti":
a dish **is** a Nutrition saved meal, so the same dishes can be logged by talking to Claude and appear in the add sheet
("I tuoi piatti"). Intake keeps only what Nutrition has no place for.

## Where the data lives

| What | Where |
|---|---|
| Name, foods with amounts and values, totals, default meal type | Nutrition saved meal (`save_meal`, `update_saved_meal`, `get_saved_meals`, `delete_saved_meal`) |
| Category | SQLite `dish_meta.category`, by saved meal id (`db/dishStore.ts`) |
| Recipe | SQLite `dish_meta.recipe` (JSON: recipe, date, `ai` or `manual`, the foods it was written for) |
| The person's own categories | settings key `dish_categories` (at most 12) |

Dishes have no photo: a photo belongs to one logged meal, not to a dish made again on other days.

## Categories

Built-in, in this order: Colazioni, Primi, Secondi, Piatti unici, Contorni, Spuntini, Dolci (ids `breakfast`, `first`,
`main`, `single`, `side`, `snack`, `dessert`; names in the app's language). "+ Nuova" in the editor adds an own one.
A dish without a category is listed under "Senza categoria".

## Screens

- **Piano › Piatti** (`/piano?vista=piatti`): a search over names and foods (without case, accents or punctuation),
  "+ Nuovo", category chips with how many dishes each has (the chosen one inverted with a ✓), and the dishes grouped by
  category with their foods, kcal, "⇄ N alternative" (Piatti intercambiabili, [dish-groups.md](dish-groups.md)) and
  "Ricetta" when one is kept.
- **Dish** (`/piano/piatti/:id`): category and default meal type, kcal and macros, foods with amount and kcal, the recipe
  row, "Intercambiabile con" (+ Aggiungi from the other dishes, × to unlink), where the dish is in the active plan,
  "Metti nel piano" (a sheet with every fixed meal of the active plan by day; the chosen one gets this dish, as
  "Usa questo"), "Registra ora" (the confirmation screen of a new meal, `/pasto/nuovo/preferito/:id`) and
  "Elimina piatto" (confirmed in the row; meals already logged keep their values).
- **Nuovo piatto / Modifica** (`/piano/piatti/nuovo`, `/piano/piatti/:id/modifica`): name (unique among the dishes),
  category, foods with amount and unit, and values. While every food has its own values the totals are their sum and
  the dish is saved food by food (`items`); a food without values, or a total typed by hand, "Cerca nel database" or
  "Ricalcola con l'IA", saves the dish with its totals and the foods as its description. Changing only an amount scales
  that food's values, as in the plan editor.
- **Ricetta** (`/piano/piatti/:id/ricetta`): asked once with "Chiedi all'IA" (part Pasti da foto, the plan model, with
  an optional wish) and kept with the dish, so reading it again is free. Time, servings, difficulty, "Ti serve", the
  numbered steps and a tip; "Rigenera" asks a new one, "Modifica" corrects it by hand (then it says "Modificata da te"),
  "Elimina la ricetta" removes it. Without the AI the person can write it. When the dish's foods change after the
  recipe was written, the page says so.
- **Aggiungi alternativa › Dai tuoi piatti** (Piano): the same dishes in a sheet with a search and the categories,
  starting on the category of the planned dish when it is one of the dishes; dishes already linked are marked
  "✓ Già collegato".

## The AI recipe

`PlanGenerator.writeRecipe` sends only the dish's name, description, foods with amounts and the optional wish. The
system prompt asks for a short home-cooking recipe with exactly those foods and amounts (only water, salt, pepper,
herbs and spices may be added, so the dish's values stay right), no medical or nutrition advice, in the installation
language. One small structured-output request; the token usage is logged.

## API (owner only)

| Route | |
|---|---|
| `GET /api/dishes` | `{ dishes: [saved meal + category + hasRecipe], customCategories }` (one `get_saved_meals`, cached 30 s) |
| `POST /api/dishes` | `{ name, category, mealType?, foods[], totals? }` → `save_meal`; 409 `name_taken` |
| `PATCH /api/dishes/:id` | the same body → `update_saved_meal` (the name only when it changed) |
| `DELETE /api/dishes/:id` | `delete_saved_meal` and the local category and recipe |
| `PUT /api/dishes/categories` | `{ custom: [names] }` |
| `GET` / `PUT` / `DELETE /api/dishes/:id/recipe` | the kept recipe (`{ recipe, stale }`), a recipe written or corrected by hand, its deletion |
| `POST /api/dishes/:id/recipe/generate` | `{ note? }`, part Pasti da foto (404 `feature_disabled` while it is off, 503 without the key) |
