# The plan's dishes in Piano › Piatti

The dishes of the meal plan can become dishes of Piano › Piatti (Nutrition saved meals, [dishes.md](dishes.md)), so their category, recipe and interchangeable dishes live in one place. Only when the person asks: nothing is saved on its own.

## One dish per name

- A planned dish is a meal without courses, or one course of a meal ([courses.md](courses.md)). Its name is its description, or its foods without amounts ("Pasta + Pomodoro") (`planDishName`).
- The same dish with other grams on another day is the same dish: dishes are compared by `looseDishKey`, the name without case, accents, punctuation, numbers and the unit after a number. The first one found in the plan is the one saved; the plan keeps each day's own amounts.
- Interchangeable dishes ([dish-groups.md](dish-groups.md)) are found by the exact name first and then by `looseDishKey`, so alternatives added on the dish page also show on every day of the plan with that dish.
- A dish is saved food by food when every food has its values, else with its totals; a dish with no values at all cannot be saved (the menu says to use "Modifica" first).
- Category: the course (Primo → Primi, Secondo → Secondi, Contorno → Contorni, Dolce → Dolci, Frutta and Fine pasto → Spuntini; Antipasto, Bevanda and own names stay without a category), else the meal type (colazione → Colazioni, spuntino → Spuntini, pranzo and cena → Piatti unici). It can be changed on the dish page.

## Similar dishes: "Unisci" or a new dish

- Before saving a plan dish, the app compares it with the dishes of Piatti (`similarDishes`): the meaningful words of the names (without amounts and small words such as "di", "con", "e") and, when both have at least two foods, the foods. Half or more in common (`SIMILAR_DISH_SCORE`) makes them similar; the best three are shown.
- "Somiglia a un piatto che hai già" lists them with their foods and kcal. "Unisci" makes the plan dish's name another name of that dish (`dish_meta.aliases`, at most 20, `POST /api/dishes/:id/aliases`); if that dish is in a group of interchangeable dishes, the name is added to it there too. From then on the plan finds the dish, its recipe and its alternatives under that name, and the card says "✓ Nei tuoi piatti". "No, crea un piatto nuovo" saves it as it is.
- The dish page lists the merged names under "Nel piano anche come", each with × to undo it (`POST /api/dishes/:id/aliases/remove`).
- A save refused because the name already exists (409) opens the same question with that dish.
- "Salva tutti i piatti del piano" never merges on its own: it skips the dishes that look like one already there and says how many, so each can be saved from its own menu.

## In the app

- The ⋯ of a meal or a course: "Salva nei tuoi piatti" (`POST /api/dishes` with `planDishWrite`), or "Apri nei tuoi piatti" when it is already there; the card shows "✓ Nei tuoi piatti".
- A failed save says why: a name already taken, Nutrition busy (rate limit), values missing. Sugar is sent only together with added sugar, which Nutrition requires.
- Piano ⋯ › "Salva tutti i piatti del piano": `POST /api/plans/:id/dishes/save` starts saving, in the background on the server (`services/planDishSaver.ts`), the plan's dishes not yet in Piatti, one every 2 seconds (at most 30 writes a minute, half of Nutrition's 60 requests); a rate limit waits and tries the same dish once more. It answers `{ saving, similar }`; the app says how many are being saved and how many look like a dish already there, and refreshes the dishes while they arrive. `GET /api/plans/:id/dishes/missing` answers how many are missing, how many are similar and how many are still being saved.
