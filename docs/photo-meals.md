# Pasti da foto (meals from a photo or a description)

An optional part (`photoMeals`, see [features.md](features.md)), **off by default** on every installation, new or
existing. It also needs `ANTHROPIC_API_KEY` in the server's `.env`. While it is off, or without the key, the add sheet
keeps "Chiedi a Claude" as before.

## How it works

1. The add sheet shows "Foto del piatto" and "Descrivi a parole" (`/pasto/nuovo`, `/pasto/nuovo/testo`).
2. A photo from the camera or the library is resized **in the browser** (longest edge 1568 px, JPEG quality 0.85)
   and shown with "Cambia foto" and an optional note. Nothing is sent until "Analizza".
3. `POST /api/meals/recognize` sends the photo and/or the text to the Claude API (`services/mealRecognition.ts`). The
   answer is a `record_meal` tool call (or the same object as JSON text): foods, estimated grams eaten, nutrition per
   100 g (kcal, macros, fiber, sugar, added sugar), and likely hidden fats such as cooking oil marked "not visible".
   Food names follow the installation language.
4. The confirmation screen lets the user change the type, time and grams, remove foods, add a missed one in words
   ("+ Aggiungi alimento", recognized the same way) and also save the meal as a favorite.
5. Only "Registra pasto" writes to Nutrition (`POST /api/meals` → `log_meal`, with an idempotency key). Fiber, sugar
   and added sugar are sent all-or-none across items, as Nutrition requires.

## Model and cost

- `RECOGNITION_MODEL` in `.env` chooses the model; the default is `claude-sonnet-5-5`. `claude-haiku-5-5` is much
  cheaper and usually good enough for common dishes.
- One request per "Analizza" or "+ Aggiungi alimento"; nothing runs in the background. The request asks for at most
  2,000 output tokens and does not turn on extended thinking.
- Indicative cost per photo (list prices of November 2026: Sonnet 5.5 $2 / $10 and Haiku 5.5 $0.10 / $0.50 per million
  input / output tokens): a 1568 × 1176 photo is about 2,350 input tokens, the prompt and tool schema about 1,000 more,
  and the answer 300–800 tokens.
  - `claude-sonnet-5-5`: about **$0.01–0.015** per photo, less than a cent for a description.
  - `claude-haiku-5-5`: well under **$0.001** per photo.
- The key is billed by Anthropic to the account that owns it; the Console (Usage) shows the real cost. A key without
  credit gives its own message in the app ("Credito Claude esaurito").

## Privacy

- **The photo and the note are sent to Anthropic** (`api.anthropic.com`) under the API terms of the key's account.
  Nothing else is sent: no name, email, history or Nutrition data.
- The key lives only in the server's `.env` and is never logged; errors log the API's error type and message only.

## Kept photos

- The resized JPEG of a meal logged from a photo is saved as `<DATA_DIR>/meal-photos/<meal id>.jpg`
  (`db/mealPhotoStore.ts`), usually **200–400 KB**; Nutrition stores no images. It is shown as a thumbnail on the
  Timeline card and on top of the meal detail (`GET /api/meals/photos`, `GET /api/meals/:id/photo`).
- Deleting the meal in Intake deletes its photo. Turning the part off hides the photos (their routes answer 404
  `feature_disabled`) but keeps them.
- **Backups:** the photos are in the data volume, so every `deploy.sh` volume backup contains all of them (JPEG does
  not compress further). At 3 photos a day that is about 0.3–0.4 GB a year, and `deploy.sh` keeps 10 volume backups,
  so up to ten times that in `backups/`. They are **not** part of the nightly Nutrition backup
  ([backups.md](backups.md)), which only holds Nutrition's own export.

## Errors

| Answer | Message in the app |
|---|---|
| 503 `recognition_not_configured` | `ANTHROPIC_API_KEY` missing |
| 502 `recognition_auth` | invalid key |
| 402 `recognition_credit` | no credit left |
| 503 `recognition_busy` | Claude busy (429 / 529 / 503) |
| 502 `recognition_unreadable` | the answer did not describe a meal |
| 502 `recognition_failed` | any other failure, including a timeout after 60 s |
