# Courses (portate)

A meal can be made of several courses: a first course and a dessert at lunch, or a starter, a main course and a coffee at a restaurant. Each course is a dish of its own, so it can have its own interchangeable dishes ([dish-groups.md](dish-groups.md)), and the whole meal is still logged to Nutrition as **one meal**.

Course names are free text (1–30 characters); the chips offer Antipasto, Primo, Secondo, Contorno, Frutta, Dolce, Fine pasto and Bevanda (`COURSE_NAMES`, `packages/shared/src/courses.ts`).

## In the meal plan

- Model: a fixed meal has optional `courses[]` (2 to 6), each with `name`, optional `description`, `foods[]` and optional `macros` (`courseSchema`, `packages/shared/src/mealPlan.ts`). The meal's own `foods`, `description` and `macros` are kept as the sum of its courses (`withCourses`: the foods one after the other, the descriptions joined with " + ", the macros added up when every course has them), so code that does not know courses (shopping list, totals, matching, Claude Fitness export) keeps working. A meal left with one course becomes a single dish again. `normalizeCourses` recomputes the sums when a plan is saved.
- Piano: a meal with courses shows one box per course with its name, dish, values, its own "Modifica", its alternatives with "+ Aggiungi alternativa" (from your dishes or by hand; the AI choice is not offered for a single course) and "Togli portata". "+ Aggiungi portata" under every meal adds a course from your dishes or by hand; on a meal that is still one dish it first asks what the existing dish is ("Quello che c'è già è il…").
- Routes: `POST /api/plans/:id/course` (`courseAddSchema`: day, meal index, name, optional `firstName`, the dish) and `POST /api/plans/:id/course/remove` (`courseRemoveSchema`); one course is edited through `POST /api/plans/:id/meal` with `course` (and optional `courseName`). Each change saves a new plan version.
- Timeline and Oggi: the planned card lists the courses with a tick each (on by default) and, for a course with alternatives, its chips. "Mangiato come previsto · X kcal" logs only the ticked courses, each as planned or as the chosen alternative, as one Nutrition meal. `POST /api/days/:date/planned/:planId/:index` takes `{ courses: [{ eaten, alternative? }] }`; the idempotency key records the choice of every course.

## Logged meals

- Logging (`/pasto/nuovo`, "Ho mangiato altro", photo or text): the confirmation screen has "+ Aggiungi portata", which asks the course name (and, the first time, the name of the dish already on screen) and how to add it: **Foto** and **Descrivi** (part Pasti da foto, the AI recognizes the foods), **Dai tuoi piatti** (a dish of Piano › Piatti with its foods) or **A mano** (one food with its amount, kcal and macros). The foods are shown under course headers, each course with its ×; "+ Aggiungi alimento" adds to the last course.
- Editing ("Modifica pasto") shows the same courses again and the same "+ Aggiungi portata". A meal logged without courses shows as one dish with all its foods.
- Nutrition has no courses, so Intake keeps only how many consecutive foods belong to each course: table `meal_courses` (`meal_id`, `courses` as JSON `[{ name, count }]`, 2 to 8 courses), `apps/server/src/db/mealCourseStore.ts`. The foods are sent to Nutrition in course order and the meal's description joins the courses. `splitIntoCourses` gives the courses back only when the counts still match the foods; otherwise the meal shows as one dish.
- Routes: `POST /api/meals` and `PATCH /api/meals/:id` accept `courses` (the counts must add up to the number of foods; on `PATCH` a missing field keeps the courses, `null` removes them); `GET /api/meals/:id/courses`; deleting a meal removes its courses.
