# Pasti da foto (meals from a photo or a description)

An optional part (`photoMeals`, see [features.md](features.md)), **off by default** on every installation, new or
existing. It also needs `ANTHROPIC_API_KEY` in the server's `.env`. While it is off, or without the key, the add sheet
keeps "Chiedi a Claude" as before.

## How it works

1. The add sheet shows "Foto del piatto" and "Descrivi a parole" (`/pasto/nuovo`, `/pasto/nuovo/testo`).
2. A photo from the camera or the library is resized **in the browser** (longest edge 1568 px, JPEG quality 0.85)
   and shown with "Cambia foto" and an optional note. Nothing is sent until "Analizza". Redrawing the photo on a
   canvas also drops its EXIF data (GPS position, camera, date): neither Anthropic nor the server receives it.
3. `POST /api/meals/recognize` sends the photo and/or the text to the Claude API (`services/mealRecognition.ts`,
   official SDK `@anthropic-ai/sdk`). The answer is a **structured output** (`output_config.format`, a JSON schema
   with `additionalProperties: false` at every level), so it always has the expected shape: foods, estimated grams
   eaten, nutrition per 100 g (kcal, macros, fiber, sugar, added sugar), and likely hidden fats such as cooking oil
   marked "not visible". The ranges (grams, 1–20 foods) are checked after with zod. Food names follow the
   installation language.
4. The confirmation screen lets the user change the type, time and grams, remove foods, add a missed one in words
   ("+ Aggiungi alimento", recognized the same way) and also save the meal as a favorite.
5. Only "Registra pasto" writes to Nutrition (`POST /api/meals` → `log_meal`, with an idempotency key). Fiber, sugar
   and added sugar are sent all-or-none across items, as Nutrition requires.

## Model and cost

- The model is chosen in **Impostazioni › Funzioni**, under Pasti da foto: **Haiku 5.5 (default)** or Sonnet 5.5
  (settings key `recognition_model`, `db/recognitionModelStore.ts`). `RECOGNITION_MODEL` in `.env` sets the starting
  model and, if it names another one, adds it to the choice. The change applies to the next request.
- One request per "Analizza" or "+ Aggiungi alimento"; nothing runs in the background. The SDK retries 429, 529 and
  connection errors twice by itself; each attempt times out after 60 s.
- Thinking is on by default on the 5.5 models and cannot be turned off on Sonnet 5.5; its tokens are billed as output
  and count against `max_tokens`. The request asks for **`effort: "low"`** (portion estimation needs little
  reasoning) and allows `max_tokens: 16000`, so an answer is not cut by the thinking; only the tokens generated are
  paid. An answer that still stops at `max_tokens` is logged and shown as unreadable.
- Every request logs its usage (model, stop reason, input, output and thinking tokens), never the photo or the text,
  so the real cost can be read in the server log or in the Anthropic Console.
- COST_PLACEHOLDER

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
| 402 `recognition_credit` | no credit left (`PaymentRequiredError` or a `billing_error`) |
| 503 `recognition_busy` | Claude busy (rate limit or overloaded, after the SDK retries) |
| 422 `recognition_refused` | Claude declined (`stop_reason: refusal`) |
| 502 `recognition_unreadable` | the answer was cut at `max_tokens`, or did not describe a meal |
| 502 `recognition_failed` | any other failure, including a timeout |
