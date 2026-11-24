# The plan's dishes in Piano › Piatti

The dishes of the meal plan can become dishes of Piano › Piatti (Nutrition saved meals, [dishes.md](dishes.md)), so their category, recipe and interchangeable dishes live in one place. Only when the person asks: nothing is saved on its own.

## One dish per name

- A planned dish is a meal without courses, or one course of a meal ([courses.md](courses.md)). Its name is its description, or its foods without amounts ("Pasta + Pomodoro") (`planDishName`).
- The same dish with other grams on another day is the same dish: dishes are compared by `looseDishKey`, the name without case, accents, punctuation, numbers and the unit after a number. The first one found in the plan is the one saved; the plan keeps each day's own amounts.
- Interchangeable dishes ([dish-groups.md](dish-groups.md)) are found by the exact name first and then by `looseDishKey`, so alternatives added on the dish page also show on every day of the plan with that dish.
- A dish is saved food by food when every food has its values, else with its totals; a dish with no values at all cannot be saved (the menu says to use "Modifica" first).
- Category: the course (Primo → Primi, Secondo → Secondi, Contorno → Contorni, Dolce → Dolci, Frutta and Fine pasto → Spuntini; Antipasto, Bevanda and own names stay without a category), else the meal type (colazione → Colazioni, spuntino → Spuntini, pranzo and cena → Piatti unici). It can be changed on the dish page.

## In the app

- The ⋯ of a meal or a course: "Salva nei tuoi piatti" (`POST /api/dishes` with `planDishWrite`), or "Apri nei tuoi piatti" when it is already there; the card shows "✓ Nei tuoi piatti".
- Piano ⋯ › "Salva tutti i piatti del piano": `POST /api/plans/:id/dishes/save` starts saving, in the background on the server (`services/planDishSaver.ts`), the plan's dishes not yet in Piatti, one every 2 seconds (at most 30 writes a minute, half of Nutrition's 60 requests); a rate limit waits and tries the same dish once more. It answers how many will be saved; the app says so and refreshes the dishes while they arrive. `GET /api/plans/:id/dishes/missing` answers how many are missing and how many are still being saved.
