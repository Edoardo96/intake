import { macrosFor, type NeedsTargets, type NeedsView } from "@intake/shared";
import { Link } from "wouter";
import { useApplyNeeds, useAskNeedsAi, useNeeds } from "../api/queries";
import { formatKcal, formatMediumDate, formatOneDecimal, formatWeight } from "../lib/format";
import { t } from "../lib/strings";
import { errorText } from "../pages/NewMealPage";
import { SparklesIcon } from "./icons";

export const NEEDS_PATH = "/piano/fabbisogno";

/** −0.5 → "−0,5", 0.3 → "+0,3" */
export function signedKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatOneDecimal(Math.abs(rounded))}`;
}

function CheckBand({ view }: { view: NeedsView }) {
  const apply = useApplyNeeds();
  const { check, profile, weightKg } = view;
  return (
    <div className="needs-band" aria-labelledby="needs-check-title">
      <span className="needs-band-title" id="needs-check-title">
        {t.needs.check}
      </span>
      {check.status === "few_data" ? (
        <p className="muted">{t.needs.checkFew(check.loggedDays, check.weighIns)}</p>
      ) : (
        <>
          <p>{t.needs.checkFacts(formatKcal(check.avgKcal), signedKg(check.weeklyChangeKg), formatKcal(check.maintenance))}</p>
          {!profile ? null : check.inLine ? (
            <span className="needs-status" data-kind="ok">
              {t.needs.checkInLine}
            </span>
          ) : (
            <div className="needs-suggest">
              <strong>{t.needs.checkSuggest(formatKcal(check.suggestedKcal))}</strong>
              {weightKg !== null && (
                <button
                  type="button"
                  className="button-secondary-small"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate({ source: "check", targets: macrosFor(check.suggestedKcal, profile.goal, weightKg) })}
                >
                  {t.needs.checkApply}
                </button>
              )}
            </div>
          )}
          {apply.isError && <p className="error-text">{t.needs.applyFailed}</p>}
        </>
      )}
      <span className="muted needs-band-note">{t.needs.checkNoAi}</span>
    </div>
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

const sameGoal = (goals: NeedsView["goals"], targets: NeedsTargets) => goals.kcal === targets.kcal && goals.protein === targets.protein;

/**
 * "Il parere dell'IA", separate from the settings: "Chiedi" asks the AI from here with the saved fields, and the
 * opinion is compared with the standard calculation before anything changes.
 */
function AiBand({ view }: { view: NeedsView }) {
  const ask = useAskNeedsAi();
  const apply = useApplyNeeds();
  const { ai, result, goals } = view;
  const busy = ask.isPending || apply.isPending;
  return (
    <div className="needs-band" aria-busy={ask.isPending}>
      <span className="needs-band-title ai-label">
        <SparklesIcon size={16} />
        {t.needs.ai}
      </span>
      {ask.isPending ? (
        <span className="needs-ai-wait" aria-live="polite">
          <span className="recognize-spinner" aria-hidden="true" />
          {t.needs.aiAsking}
        </span>
      ) : (
        ai && (
          <>
            <span className="muted">{t.needs.aiOf(formatMediumDate(ai.at.slice(0, 10)))}</span>
            <p>{ai.summary}</p>
            {result && (
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
            )}
            {ai.limited && <span className="needs-status" data-kind="warn">{t.needs.aiLimited}</span>}
            {ai.tips.length > 0 && (
              <div className="needs-tips-box">
                <span className="needs-band-title">{t.needs.tips}</span>
                <ul className="needs-tips">
                  {ai.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
            {sameGoal(goals, ai.targets) ? (
              <span className="needs-status" data-kind="ok">
                {t.needs.aiInUse}
              </span>
            ) : (
              <div className="needs-ai-actions">
                {result && !sameGoal(goals, result) && (
                  <button type="button" className="button-secondary-small" disabled={busy} onClick={() => apply.mutate({ source: "standard", targets: result })}>
                    {t.needs.keepStandard}
                  </button>
                )}
                <button type="button" className="button-primary-small" disabled={busy} onClick={() => apply.mutate({ source: "ai", targets: ai.targets })}>
                  {t.needs.useAi}
                </button>
              </div>
            )}
          </>
        )
      )}
      {ask.isError && <p className="error-text">{errorText(ask.error)}</p>}
      {apply.isError && <p className="error-text">{t.needs.applyFailed}</p>}
      <button type="button" className="button-secondary-small needs-ai-link" disabled={busy || !result} onClick={() => ask.mutate()}>
        <SparklesIcon size={16} />
        {t.needs.aiAsk}
      </button>
    </div>
  );
}

/**
 * Piano › "Il tuo fabbisogno": the active goal with where it came from, the check on the real data (no AI) and the
 * AI opinion. The settings and the standard calculation are on NeedsPage.
 */
export function NeedsCard() {
  const needs = useNeeds();
  if (needs.isPending) return <div className="card skeleton" style={{ height: 180 }} />;
  if (!needs.data) return null;
  const view = needs.data;
  const { goals, profile, result, applied, ai } = view;

  if (!profile) {
    return (
      <section className="card needs-card" aria-labelledby="needs-title">
        <h2 id="needs-title">{t.needs.title}</h2>
        <p className="muted">{t.needs.intro}</p>
        <Link href={NEEDS_PATH} className="button needs-start">
          {t.needs.start}
        </Link>
        <CheckBand view={view} />
      </section>
    );
  }

  const differs = result && goals.kcal !== null && Math.abs(result.kcal - goals.kcal) > 50 && applied?.source !== "ai" && applied?.source !== "check";
  return (
    <section className="card needs-card" aria-labelledby="needs-title">
      <div className="needs-head">
        <h2 id="needs-title">{t.needs.title}</h2>
        <Link href={NEEDS_PATH} className="text-button text-button-strong">
          {t.needs.edit}
        </Link>
      </div>

      <div className="needs-band needs-goal">
        <span className="needs-pills">
          <span className="source-pill">{t.needs.goals[profile.goal]}</span>
          {applied && <span className="source-pill">{t.needs.sources[applied.source]}</span>}
        </span>
        {goals.kcal !== null ? (
          <>
            <strong className="needs-kcal">{formatKcal(goals.kcal)} kcal</strong>
            {goals.protein !== null && goals.carbs !== null && goals.fat !== null && (
              <span className="needs-macros">{t.needs.macros(formatKcal(goals.protein), formatKcal(goals.carbs), formatKcal(goals.fat))}</span>
            )}
          </>
        ) : (
          <strong>{t.needs.noGoal}</strong>
        )}
        <span className="muted">
          {t.needs.summary(view.weightKg !== null ? formatWeight(view.weightKg) : null, profile.trainingPerWeek, result ? formatKcal(result.maintenance) : null)}
        </span>
        {differs && <span className="muted">{t.needs.calcDiffers(formatKcal(result.kcal))}</span>}
      </div>

      <CheckBand view={view} />

      {view.aiAvailable && <AiBand view={view} />}
    </section>
  );
}
