import {
  NEEDS_GOALS,
  NEEDS_JOBS,
  NEEDS_PACES,
  NEEDS_SEXES,
  NEEDS_TRAINING_TYPES,
  computeNeeds,
  needsProfileSchema,
  type NeedsProfile,
  type NeedsSource,
  type NeedsTargets,
  type NeedsView,
} from "@intake/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useApplyNeeds, useAskNeedsAi, useNeeds, useSaveNeedsProfile } from "../api/queries";
import { signedKg } from "../components/NeedsCard";
import { SparklesIcon } from "../components/icons";
import { formatKcal, formatMediumDate, formatWeight } from "../lib/format";
import { t } from "../lib/strings";
import { errorText } from "./NewMealPage";

/** The form as typed: numbers stay text until saved, so a field can be emptied while editing. */
interface Draft {
  sex: NeedsProfile["sex"] | null;
  age: string;
  heightCm: string;
  job: NeedsProfile["job"];
  stepsPerDay: string;
  trainingPerWeek: string;
  trainingType: NeedsProfile["trainingType"];
  trainingMinutes: string;
  goal: NeedsProfile["goal"];
  pace: NeedsProfile["pace"];
  notes: string;
}

const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function draftOf(view: NeedsView): Draft {
  const p = view.profile;
  return {
    sex: p?.sex ?? null,
    age: text(p?.age),
    heightCm: text(p?.heightCm),
    job: p?.job ?? "seated",
    stepsPerDay: text(p ? p.stepsPerDay : view.prefill.stepsPerDay),
    trainingPerWeek: text(p ? p.trainingPerWeek : (view.prefill.trainingPerWeek ?? 0)),
    trainingType: p?.trainingType ?? "weights",
    trainingMinutes: text(p ? p.trainingMinutes : (view.prefill.trainingMinutes ?? 60)),
    goal: p?.goal ?? "maintain",
    pace: p?.pace ?? "steady",
    notes: p?.notes ?? "",
  };
}

/** Digits only; "" is null. */
const number = (value: string): number | null => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null);

function profileOf(draft: Draft): NeedsProfile | null {
  const parsed = needsProfileSchema.safeParse({
    sex: draft.sex,
    age: number(draft.age),
    heightCm: number(draft.heightCm),
    job: draft.job,
    stepsPerDay: number(draft.stepsPerDay),
    trainingPerWeek: number(draft.trainingPerWeek) ?? 0,
    trainingType: draft.trainingType,
    trainingMinutes: number(draft.trainingMinutes) ?? 0,
    goal: draft.goal,
    pace: draft.pace,
    notes: draft.notes,
  });
  return parsed.success ? parsed.data : null;
}

function Segmented<T extends string>({ label, options, names, value, onChange }: { label: string; options: readonly T[]; names: Record<string, string>; value: T | null; onChange: (value: T) => void }) {
  return (
    <div className="needs-field">
      <span className="needs-field-label" id={`needs-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`needs-${label}`}>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={value === option} className="segmented-option" onClick={() => onChange(option)}>
            {names[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberRow({ label, unit, value, onChange }: { label: string; unit?: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="form-row">
      <span>{label}</span>
      <span className="needs-number">
        <input value={value} inputMode="numeric" enterKeyHint="done" maxLength={5} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} aria-label={unit ? `${label} (${unit})` : label} />
        {unit && <span className="muted">{unit}</span>}
      </span>
    </label>
  );
}

function CompareRow({ label, unit, standard, ai }: { label: string; unit: string; standard: number; ai: number }) {
  return (
    <>
      <span className="muted">{label}</span>
      <span>
        {formatKcal(standard)} {unit}
      </span>
      <span data-differs={standard !== ai || undefined}>
        {formatKcal(ai)} {unit}
      </span>
    </>
  );
}

/**
 * Piano › Il tuo fabbisogno: the fields (you, everyday life, workouts, goal), the standard calculation computed while
 * typing, and the AI opinion compared side by side. Nothing changes in Nutrition until a goal is applied.
 */
export function NeedsPage() {
  const needs = useNeeds();
  const [, navigate] = useLocation();
  const save = useSaveNeedsProfile();
  const apply = useApplyNeeds();
  const askAi = useAskNeedsAi();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (needs.data && !draft) setDraft(draftOf(needs.data));
  }, [needs.data, draft]);

  // "Aggiorna il parere" on the card opens the page at the AI part
  useEffect(() => {
    if (draft && window.location.hash === "#ia") document.getElementById("ia")?.scrollIntoView({ block: "start" });
  }, [draft]);

  const view = needs.data;
  const profile = draft ? profileOf(draft) : null;
  const weightKg = view?.weightKg ?? null;
  const result = useMemo(() => (profile && weightKg !== null ? computeNeeds(profile, weightKg) : null), [profile, weightKg]);
  const busy = save.isPending || apply.isPending || askAi.isPending;

  if (!view || !draft) {
    return (
      <div className="page detail-page edit-page needs-page">
        <div className="card skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const invalid = !profile && Boolean(draft.sex && draft.age && draft.heightCm);

  async function applyTargets(source: NeedsSource, targets: NeedsTargets) {
    if (!profile) return;
    await save.mutateAsync(profile);
    await apply.mutateAsync({ source, targets });
    navigate("/piano");
  }

  async function ask() {
    if (!profile) return;
    await save.mutateAsync(profile);
    askAi.mutate();
  }

  const ai = view.ai;
  const cut = draft.goal === "cut" || draft.goal === "bulk";

  return (
    <div className="page detail-page edit-page needs-page">
      <header className="edit-header">
        <Link href="/piano" className="text-button">
          {t.needs.cancel}
        </Link>
        <h1>{t.needs.title}</h1>
        <span />
      </header>

      <span className="sheet-section">{t.needs.you}</span>
      <Segmented label={t.needs.sex} options={NEEDS_SEXES} names={t.needs.sexes} value={draft.sex} onChange={(sex) => set({ sex })} />
      <div className="form-card">
        <NumberRow label={t.needs.age} unit={t.needs.ageUnit} value={draft.age} onChange={(age) => set({ age })} />
        <NumberRow label={t.needs.height} unit="cm" value={draft.heightCm} onChange={(heightCm) => set({ heightCm })} />
        <div className="form-row">
          <span>{t.needs.weight}</span>
          <span className="muted needs-weight">{weightKg !== null ? t.needs.weightFrom(formatWeight(weightKg)) : "—"}</span>
        </div>
      </div>
      {weightKg === null && <p className="notice" data-kind="error">{t.needs.noWeight}</p>}

      <span className="sheet-section">{t.needs.daily}</span>
      <Segmented label={t.needs.job} options={NEEDS_JOBS} names={t.needs.jobs} value={draft.job} onChange={(job) => set({ job })} />
      <div className="form-card">
        <NumberRow label={t.needs.steps} value={draft.stepsPerDay} onChange={(stepsPerDay) => set({ stepsPerDay })} />
      </div>
      {!view.profile && view.prefill.stepsPerDay !== null && <p className="sheet-note">{t.needs.stepsHint}</p>}

      <span className="sheet-section">{t.needs.training}</span>
      <div className="form-card">
        <NumberRow label={t.needs.perWeek} value={draft.trainingPerWeek} onChange={(trainingPerWeek) => set({ trainingPerWeek })} />
        <NumberRow label={t.needs.minutes} unit={t.needs.minutesUnit} value={draft.trainingMinutes} onChange={(trainingMinutes) => set({ trainingMinutes })} />
      </div>
      <Segmented label={t.needs.trainingType} options={NEEDS_TRAINING_TYPES} names={t.needs.trainingTypes} value={draft.trainingType} onChange={(trainingType) => set({ trainingType })} />
      {!view.profile && view.prefill.trainingPerWeek !== null && <p className="sheet-note">{t.needs.trainingHint}</p>}

      <span className="sheet-section">{t.needs.goal}</span>
      <div className="needs-goal-grid" role="radiogroup" aria-label={t.needs.goal}>
        {NEEDS_GOALS.map((goal) => (
          <button key={goal} type="button" role="radio" aria-checked={draft.goal === goal} className="needs-goal-option" onClick={() => set({ goal })}>
            <strong>{t.needs.goals[goal]}</strong>
            <span>{t.needs.goalHints[goal]}</span>
          </button>
        ))}
      </div>
      {cut && <Segmented label={t.needs.pace} options={NEEDS_PACES} names={t.needs.paces} value={draft.pace} onChange={(pace) => set({ pace })} />}

      {invalid && <p className="notice" data-kind="error">{t.needs.invalid}</p>}

      {result && (
        <section className="card needs-result" aria-labelledby="needs-result-title">
          <span className="needs-band-title" id="needs-result-title">
            {t.needs.result}
          </span>
          <strong className="needs-kcal">{formatKcal(result.kcal)} kcal</strong>
          <span className="needs-macros">{t.needs.macros(formatKcal(result.protein), formatKcal(result.carbs), formatKcal(result.fat))}</span>
          <span className="muted">{t.needs.resultNote(formatKcal(result.bmr), formatKcal(result.maintenance))}</span>
          <span className="muted">{Math.abs(result.weeklyChangeKg) < 0.05 ? t.needs.weeklyNone : t.needs.weekly(signedKg(result.weeklyChangeKg))}</span>
          {result.limited && <span className="needs-status" data-kind="warn">{t.needs.limited}</span>}
          <button type="button" className="button-primary" disabled={busy} onClick={() => void applyTargets("standard", result)}>
            {t.needs.apply}
          </button>
        </section>
      )}
      {apply.isError && <p className="notice" data-kind="error">{t.needs.applyFailed}</p>}

      {view.aiAvailable && (
        <section id="ia" className="needs-ai" aria-labelledby="needs-ai-title">
          <span className="sheet-section ai-label" id="needs-ai-title">
            <SparklesIcon size={16} />
            {t.needs.ai}
          </span>
          <label className="form-card text-entry">
            <span className="sheet-section">{t.needs.notes}</span>
            <textarea value={draft.notes} rows={3} maxLength={500} placeholder={t.needs.notesPlaceholder} onChange={(e) => set({ notes: e.target.value })} />
          </label>
          <p className="sheet-note">{t.needs.aiNote}</p>
          {askAi.isPending ? (
            <div className="card recognize-wait" aria-live="polite" aria-busy="true">
              <span className="recognize-spinner" aria-hidden="true" />
              <strong>{t.needs.aiAsking}</strong>
            </div>
          ) : (
            <button type="button" className="button-primary button-ai" disabled={!result || busy} onClick={() => void ask()}>
              <SparklesIcon size={18} />
              {ai ? t.needs.aiRefresh : t.needs.aiAsk}
            </button>
          )}
          {askAi.isError && <p className="notice" data-kind="error">{errorText(askAi.error)}</p>}

          {ai && result && !askAi.isPending && (
            <div className="card needs-opinion">
              <span className="muted">{t.needs.aiOf(formatMediumDate(ai.at.slice(0, 10)))}</span>
              <p>{ai.summary}</p>
              <div className="needs-compare">
                <span />
                <strong>{t.needs.compare.standard}</strong>
                <strong className="ai-label">
                  <SparklesIcon size={14} />
                  {t.needs.compare.ai}
                </strong>
                {(["kcal", "protein", "carbs", "fat"] as const).map((key) => (
                  <CompareRow key={key} label={t.needs[key]} unit={key === "kcal" ? "kcal" : "g"} standard={result[key]} ai={ai.targets[key]} />
                ))}
              </div>
              {ai.limited && <span className="needs-status" data-kind="warn">{t.needs.aiLimited}</span>}
              {ai.tips.length > 0 && (
                <>
                  <span className="needs-band-title">{t.needs.tips}</span>
                  <ul className="needs-tips">
                    {ai.tips.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="goals-actions">
                <button type="button" className="button-secondary" disabled={busy} onClick={() => void applyTargets("standard", result)}>
                  {t.needs.keepStandard}
                </button>
                <button type="button" className="button-primary-inline" disabled={busy} onClick={() => void applyTargets("ai", ai.targets)}>
                  {t.needs.useAi}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
