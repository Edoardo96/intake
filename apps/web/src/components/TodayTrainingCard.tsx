import { Link } from "wouter";
import { useTraining } from "../api/queries";
import { addDays } from "../lib/dates";
import { formatWeekdayDay } from "../lib/format";
import { t } from "../lib/strings";
import { exerciseName, targetText } from "../pages/TrainingPage";

const SHOWN = 3;

/**
 * "Allenamento di oggi" on Oggi (docs/design § Allenamenti): what was done today, the session planned for today
 * (openGym) or the next routine (Hevy), with its first exercises. Same data as Andamento › Allenamenti.
 */
export function TodayTrainingCard({ date }: { date: string }) {
  const query = useTraining();
  const data = query.data;
  if (!data || !data.configured || data.hevyUnavailable || data.today !== date) return null;
  const source = data.source?.label ?? "Hevy";
  const done = data.recent.find((w) => w.date === date);
  const next = data.next;
  if (!done && !next) return null;

  const restToday = next?.date != null && next.date > date;
  const when = next?.date === addDays(date, 1) ? t.training.tomorrowWhen : next?.date ? formatWeekdayDay(next.date).toLowerCase() : "";
  const showExercises = next && !done && !restToday;

  return (
    <section className="card today-training" aria-label={t.todayTraining.aria}>
      <div className="activity-head">
        <span className="activity-label">{t.todayTraining.label}</span>
        <span className="source-pill">{source}</span>
      </div>
      {done ? (
        <div className="today-training-main">
          <strong>{t.todayTraining.done(done.title)}</strong>
          <span className="muted">{t.todayTraining.doneMeta(done.start, done.minutes, done.exercises)}</span>
        </div>
      ) : restToday ? (
        <div className="today-training-main">
          <strong>{t.todayTraining.rest}</strong>
          <span className="muted">{t.todayTraining.nextOn(when, next!.title)}</span>
        </div>
      ) : (
        <div className="today-training-main">
          <strong>{next!.date ? next!.title : t.todayTraining.nextRoutine(next!.title)}</strong>
          <span className="muted">{[t.training.exerciseCount(next!.exerciseCount), next!.typicalMinutes ? t.training.about(next!.typicalMinutes) : null].filter(Boolean).join(" · ")}</span>
        </div>
      )}
      {showExercises && (
        <ul className="today-training-list">
          {next!.exercises.slice(0, SHOWN).map((e, i) => (
            <li key={`${e.templateId ?? e.title}-${i}`}>
              <span>{exerciseName(e)}</span>
              <span className="muted">{targetText(e)}</span>
            </li>
          ))}
          {next!.exercises.length > SHOWN && <li className="muted">{t.todayTraining.more(next!.exercises.length - SHOWN)}</li>}
        </ul>
      )}
      <Link href="/andamento/allenamenti" className="activity-more">
        {t.todayTraining.open}
      </Link>
    </section>
  );
}
