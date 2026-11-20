import { macrosFor, type NeedsView } from "@intake/shared";
import { Link } from "wouter";
import { useApplyNeeds, useNeeds } from "../api/queries";
import { formatKcal, formatMediumDate, formatOneDecimal, formatWeight } from "../lib/format";
import { t } from "../lib/strings";
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

/**
 * Piano › "Il tuo fabbisogno": the active goal with where it came from, the check on the real data (no AI) and the
 * last AI opinion. The form and the comparison are on NeedsPage.
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

      {view.aiAvailable && (
        <div className="needs-band">
          <span className="needs-band-title ai-label">
            <SparklesIcon size={16} />
            {t.needs.ai}
          </span>
          {ai ? (
            <>
              <span className="muted">{t.needs.aiOf(formatMediumDate(ai.at.slice(0, 10)))}</span>
              <p className="needs-ai-summary">{ai.summary}</p>
            </>
          ) : null}
          <Link href={`${NEEDS_PATH}#ia`} className="button-secondary-small needs-ai-link">
            <SparklesIcon size={16} />
            {ai ? t.needs.aiRefresh : t.needs.aiAsk}
          </Link>
        </div>
      )}
    </section>
  );
}
