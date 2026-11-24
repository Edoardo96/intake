import {
  WEEKDAYS,
  alternativesFor,
  courseMacros,
  courseText,
  dayTotals,
  isFixedMeal,
  mealFoodsText,
  planDishName,
  planDishWrite,
  type FixedPlannedMeal,
  type PlannedMeal,
  planAverages,  weekdayOf,
  type PlanUploadError,
  type PlannedDay,
  type Weekday,
} from "@intake/shared";
import { useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PlanUploadFailed, useChangeCourses, useChangePlanMeals, useDishGroups, useSaveDish, useSavePlanDishes, useDay, useFeatures, usePlan, usePlans, useEditPlanMeal, useSetPlanTime, useStartPlan, useSwapPlanMeal, useUploadPlan } from "../api/queries";
import { EditMeal, MoveMeal, PlanDayMeals, PlanDaySummary, SameTimeSwitch, SplitFoods, SplitWeek } from "../components/PlanDay";
import { CloseIcon, PlanIcon, SparklesIcon } from "../components/icons";
import { formatKcal, formatMediumDate, formatShortDate } from "../lib/format";
import { shareFile } from "../lib/shareFile";
import { t } from "../lib/strings";
import { Scrim } from "../components/Scrim";
import { NeedsCard } from "../components/NeedsCard";
import { DishesTab } from "../components/DishesTab";
import { AddCourse, SplitCourses, courseLabel } from "../components/Courses";
import { AddPlanMeal, RemoveMeal } from "../components/PlanMeals";
import { MealChips, MealMenuButton, MealMenuSheet, useSavedDishFinder, type MenuItem } from "../components/MealMenu";
import { DishAlternatives, DishGroupsCard, dishAsEdit } from "../components/DishAlternatives";
import { PLAN_TAB_PARAM, planTabFromSearch, preferredPlanTab, type PlanTab } from "../lib/planTab";

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

function dayTag(day: PlannedDay, isToday: boolean): string {
  if (isToday) return t.plan.today;
  if (day.label) return day.label;
  if (dayTotals(day).hasFreeMeal) return t.plan.free;
  const protein = dayTotals(day).protein;
  return protein !== null ? t.plan.proteinTag(String(roundTo(protein, 5))) : "";
}

function dayNote(day: PlannedDay): string {
  if (day.note) return day.note;
  const protein = dayTotals(day).protein;
  return protein !== null ? t.plan.proteinNote(String(roundTo(protein, 5))) : "";
}

export function PlanPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<PlanTab>(() => planTabFromSearch(search) ?? preferredPlanTab());
  const plans = usePlans();
  // "Genera con l'IA" needs the AI part (Pasti da foto) and the key
  const canGenerate = useFeatures().data?.recognition === true;
  const upload = useUploadPlan();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; issues?: PlanUploadError["issues"] } | null>(null);

  const data = plans.data;
  // Show the plan in effect today, or the next scheduled one if none is active yet
  const scheduled = data?.versions.filter((v) => v.status === "scheduled").at(-1);
  const scheduledPlan = usePlan(data && !data.active ? scheduled?.id : undefined).data ?? null;
  const shown = data?.active ?? scheduledPlan;
  // Goals for the day totals: today's view is usually cached by Oggi already
  const goals = useDay("today").data?.goals ?? null;
  const setTime = useSetPlanTime();
  const swap = useSwapPlanMeal();
  const edit = useEditPlanMeal();
  const courses = useChangeCourses();
  const planMeals = useChangePlanMeals();
  const startNow = useStartPlan();
  const [splitting, setSplitting] = useState<{ day: Weekday; index: number } | null>(null);
  const [splitWeekOpen, setSplitWeekOpen] = useState(false);
  // The ⋯ of a meal or a course, and the one panel open under it (docs/design/DESIGN.md, "Menu del pasto")
  const [menuFor, setMenuFor] = useState<{ index: number; course?: number } | null>(null);
  const [panel, setPanel] = useState<{ day: Weekday; index: number; course?: number; kind: PanelKind; n: number } | null>(null);
  const groups = useDishGroups();
  const findSaved = useSavedDishFinder();
  const saveDish = useSaveDish();
  const saveAll = useSavePlanDishes();
  const alternativesCount = (name: string) => alternativesFor(groups.data ?? [], name).length;
  const [sameTime, setSameTime] = useState(true);

  const todayWeekday = data ? weekdayOf(data.today) : "monday";
  // A version already in effect: taking out or adding a meal makes a new version from today (docs/plan-meals.md)
  const inEffect = Boolean(data && shown && data.active?.id === shown.id && shown.validFrom < data.today);
  const [selected, setSelected] = useState<Weekday | null>(null);
  const weekday = selected ?? todayWeekday;

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMenuOpen(false);
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessage({ kind: "error", text: t.plan.uploadNotJson });
      return;
    }
    upload.mutate(json, {
      onSuccess: (stored) => setMessage({ kind: "ok", text: t.plan.uploaded(formatShortDate(stored.validFrom)) }),
      onError: (error) =>
        setMessage(
          error instanceof PlanUploadFailed
            ? { kind: "error", text: t.plan.uploadInvalid, issues: error.issues }
            : { kind: "error", text: t.plan.uploadFailed },
        ),
    });
  }

  const averages = shown ? planAverages(shown.plan) : null;
  const subtitle = shown
    ? [
        data?.active ? t.plan.activeFrom(formatShortDate(shown.validFrom)) : t.plan.startsOn(formatShortDate(shown.validFrom)),
        averages ? t.plan.perDay(averages.kcal !== null ? formatKcal(roundTo(averages.kcal, 50)) : null, averages.protein !== null ? String(roundTo(averages.protein, 5)) : null) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const day = shown?.plan.days[weekday];
  // A meal of the week whose foods lack their values: the menu offers the whole-week split only then
  const weekNeedsSplit = shown ? WEEKDAYS.some((d) => shown.plan.days[d].meals.some((m) => isFixedMeal(m) && !!m.macros && m.foods.some((f) => !f.nutrients))) : false;
  const dayIndex = WEEKDAYS.indexOf(weekday);

  const openPanel = (index: number, kind: PanelKind, course?: number) => setPanel({ day: weekday, index, ...(course !== undefined ? { course } : {}), kind, n: Date.now() });

  function menuSubtitle(meal: PlannedMeal, course?: number): string {
    if (!isFixedMeal(meal)) return t.plan.freeBadge;
    const c = course !== undefined ? meal.courses?.[course] : undefined;
    const text = c ? courseText(c) : mealFoodsText(meal);
    const kcal = c ? courseMacros(c)?.kcal : meal.macros?.kcal;
    return kcal !== undefined ? `${text} · ${formatKcal(kcal)} kcal` : text;
  }

  /** "Salva nei tuoi piatti", or "Apri nei tuoi piatti" when the dish is already there (by its name without amounts). */
  function dishItem(meal: FixedPlannedMeal, index: number, course?: number): MenuItem {
    const c = course !== undefined ? meal.courses?.[course] : undefined;
    const saved = findSaved(planDishName(c ?? meal));
    if (saved) return { icon: "★", label: t.mealMenu.open_, onClick: () => navigate(`/piano/piatti/${saved.id}`) };
    const write = planDishWrite(meal, c);
    return {
      icon: "☆",
      label: t.mealMenu.save,
      ...(write ? {} : { hint: t.mealMenu.noValues, disabled: true }),
      onClick: () => {
        if (!write) return;
        const { key: _key, ...dish } = write;
        saveDish.mutate({ dish }, { onError: () => openPanel(index, "saveFailed", course) });
      },
    };
  }

  function menuSections(meal: PlannedMeal, index: number, course?: number): Array<{ label: string; items: MenuItem[] }> {
    if (!shown) return [];
    const fixed = isFixedMeal(meal) ? meal : null;
    if (fixed && course !== undefined) {
      const c = fixed.courses?.[course];
      if (!c) return [];
      const n = alternativesCount(courseText(c));
      return [
        { label: t.mealMenu.dish, items: [
          { icon: "✎", label: t.plan.edit, onClick: () => openPanel(index, "edit", course) },
          { icon: "⇄", label: t.mealMenu.alternatives(n), onClick: () => openPanel(index, "alts", course) },
          dishItem(fixed, index, course),
        ] },
        { label: t.mealMenu.course, items: [
          { icon: "−", label: t.courses.remove, danger: true, disabled: courses.isPending, onClick: () => courses.mutate({ id: shown.id, remove: { day: weekday, index, course } }) },
        ] },
      ];
    }
    const dishItems: MenuItem[] = !fixed
      ? [{ icon: "✎", label: t.plan.edit, onClick: () => openPanel(index, "edit") }]
      : fixed.courses
        ? []
        : [
            { icon: "✎", label: t.plan.edit, onClick: () => openPanel(index, "edit") },
            { icon: "⇄", label: t.mealMenu.alternatives(alternativesCount(mealFoodsText(fixed))), onClick: () => openPanel(index, "alts") },
            dishItem(fixed, index),
          ];
    const mealItems: MenuItem[] = [
      ...(fixed ? [{ icon: "+", label: t.courses.add.replace(/^\+\s*/, ""), onClick: () => openPanel(index, "course") }] : []),
      ...(fixed && fixed.foods.length >= 2 ? [{ icon: "☰", label: t.courses.split, onClick: () => openPanel(index, "split") }] : []),
      { icon: "⇅", label: t.mealMenu.move, onClick: () => openPanel(index, "move") },
      { icon: "−", label: t.planMeals.remove, danger: true, onClick: () => openPanel(index, "remove") },
    ];
    return [
      { label: t.mealMenu.dish, items: dishItems },
      { label: t.mealMenu.meal, items: mealItems },
    ];
  }
  const activeVersion = data?.versions.find((v) => v.status === "active");

  return (
    <div className="page section-page plan-page">
      <header className="section-header">
        <div className="page-heading">
          {tab === "plan" && subtitle && <p className="page-date">{subtitle}</p>}
          <h1 className="page-title">{t.plan.title}</h1>
        </div>
        {tab === "plan" && (
          <div className="menu-anchor">
            <button type="button" className="icon-button" aria-label={t.plan.manage} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                {canGenerate && shown && weekNeedsSplit && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item menu-item-rich"
                    onClick={() => {
                      setMenuOpen(false);
                      setSplitWeekOpen(true);
                    }}
                  >
                    <strong className="ai-label">
                      <SparklesIcon size={16} />
                      {t.plan.splitWeekMenu}
                    </strong>
                    <span className="muted">{t.plan.splitWeekMenuHint}</span>
                  </button>
                )}
                {canGenerate && (
                  <button type="button" role="menuitem" className="menu-item menu-item-rich" onClick={() => navigate("/piano/genera")}>
                    <strong className="ai-label">
                      <SparklesIcon size={16} />
                      {t.planGen.menu}
                    </strong>
                    <span className="muted">{t.planGen.menuHint}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item-rich"
                  disabled={!shown || saveAll.isPending}
                  onClick={() => {
                    setMenuOpen(false);
                    if (shown) saveAll.mutate(shown.id);
                  }}
                >
                  <strong>{t.mealMenu.saveAll}</strong>
                  <span className="muted">{t.mealMenu.saveAllHint}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-rich" disabled={!shown} onClick={() => navigate("/piano/spesa")}>
                  <strong>{t.shopping.menu}</strong>
                  <span className="muted">{t.shopping.menuHint}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-rich" disabled={!shown} onClick={() => navigate("/piano/stampa")}>
                  <strong>{t.shopping.print}</strong>
                  <span className="muted">{t.shopping.printHint}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item-rich"
                  disabled={!shown}
                  onClick={() => {
                    setMenuOpen(false);
                    if (shown) void shareFile(new Blob([`${JSON.stringify(shown.plan, null, 2)}\n`], { type: "application/json" }), `${t.shopping.pdfName}-${shown.validFrom}.json`, "application/json");
                  }}
                >
                  <strong>{t.plan.download}</strong>
                  <span className="muted">{t.plan.downloadHint}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item menu-item-rich" onClick={() => fileInput.current?.click()}>
                  <strong>{t.plan.upload}</strong>
                  <span className="muted">{t.plan.uploadHint}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item-rich"
                  disabled={!data?.versions.length}
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <strong>{t.plan.history}</strong>
                  <span className="muted">{t.plan.historyHint(data?.versions.length ?? 0, activeVersion ? formatMediumDate(activeVersion.validFrom) : null)}</span>
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => setMenuOpen(false)}>
                  {t.close}
                </button>
              </div>
            )}
          </div>
        )}
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </header>

      <div className="segmented plan-switch" role="tablist" aria-label={t.plan.switch}>
        {(["plan", "dishes", "needs"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className="segmented-option"
            onClick={() => {
              setTab(option);
              navigate(`/piano?vista=${PLAN_TAB_PARAM[option]}`, { replace: true });
            }}
          >
            {t.plan.tabs[option]}
          </button>
        ))}
      </div>

      {tab === "needs" ? (
        <NeedsCard />
      ) : tab === "dishes" ? (
        <DishesTab />
      ) : (
        <>
          {message && (
            <div className="notice" data-kind={message.kind} role="status">
              <p>{message.text}</p>
              {message.issues && (
                <ul className="issues">
                  {message.issues.map((issue, i) => (
                    <li key={i}>
                      <code>{issue.path || "file"}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {plans.isPending && <div className="card skeleton" style={{ height: 320 }} />}

          {data && scheduled && (
            <div className="notice plan-scheduled" role="status">
              <p>{t.plan.scheduledBanner(formatMediumDate(scheduled.validFrom))}</p>
              <button type="button" className="button-primary-inline" disabled={startNow.isPending} onClick={() => startNow.mutate({ id: scheduled.id, validFrom: data.today })}>
                {t.plan.startNow}
              </button>
              {startNow.isError && <p className="error-text">{t.plan.startFailed}</p>}
            </div>
          )}

          {data && !shown && (
            <div className="coming-soon">
              <span className="coming-soon-icon">
                <PlanIcon size={32} />
              </span>
              <strong>{t.plan.emptyTitle}</strong>
              <p className="muted">{t.plan.emptyBody}</p>
              <div className="plan-empty-actions">
                {canGenerate && (
                  <button type="button" className="button button-ai" onClick={() => navigate("/piano/genera")}>
                    <SparklesIcon size={18} />
                    {t.planGen.menu}
                  </button>
                )}
                <button type="button" className={canGenerate ? "button-secondary-small" : "button"} onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                  {t.plan.upload}
                </button>
              </div>
            </div>
          )}

          {shown && splitWeekOpen && (
            <SplitWeek plan={shown} onDone={() => setSplitWeekOpen(false)} onClose={() => setSplitWeekOpen(false)} />
          )}

          {shown && day && (
            <div className="plan-layout">
              <div className="plan-tabs" role="tablist" aria-label={t.plan.daysTabs}>
                {WEEKDAYS.map((w, i) => (
                  <button
                    key={w}
                    type="button"
                    role="tab"
                    className="plan-tab"
                    aria-selected={w === weekday}
                    aria-label={t.weekdaysLong[i]}
                    onClick={() => setSelected(w)}
                  >
                    <span className="plan-tab-letter">{t.weekdaysShort[i]}</span>
                    <span className="plan-tab-tag">{dayTag(shown.plan.days[w], data?.active ? w === todayWeekday : false)}</span>
                  </button>
                ))}
              </div>

              <div className="plan-day" role="tabpanel">
                <div className="plan-day-head">
                  <h2>{t.weekdaysLong[dayIndex]}</h2>
                  <span className="muted">{dayNote(day)}</span>
                </div>
                {saveAll.isSuccess && (
                  <p className="plan-notice" role="status">
                    {saveAll.data.saving === 0 ? t.mealMenu.allThere : t.mealMenu.started(saveAll.data.saving)}
                  </p>
                )}
                {saveAll.isError && (
                  <p className="form-error" role="alert">
                    {t.mealMenu.saveFailed}
                  </p>
                )}
                <PlanDayMeals
                  day={day}
                  timeBusy={setTime.isPending}
                  onTime={(index, time) => setTime.mutate({ id: shown.id, day: weekday, index, time, allDays: sameTime })}
                  menu={(meal, index) => <MealMenuButton label={t.mealMenu.open(meal.title)} onClick={() => setMenuFor({ index })} />}
                  courseMenu={(meal, index, k, c) => <MealMenuButton label={t.mealMenu.open(courseLabel(c.name))} onClick={() => setMenuFor({ index, course: k })} />}
                  dishes={(meal, index) =>
                    meal.courses ? null : (
                      <MealChips alternatives={alternativesCount(mealFoodsText(meal))} saved={Boolean(findSaved(planDishName(meal)))} onAlternatives={() => openPanel(index, "alts")} />
                    )
                  }
                  course={(meal, index, k, c) => {
                    const asMeal = { title: meal.title, ...(c.description ? { description: c.description } : {}), foods: c.foods, ...(c.macros ? { macros: c.macros } : {}) };
                    const here = panel && panel.day === weekday && panel.index === index && panel.course === k ? panel : null;
                    return (
                      <>
                        <MealChips alternatives={alternativesCount(mealFoodsText(asMeal))} saved={Boolean(findSaved(planDishName(c)))} onAlternatives={() => openPanel(index, "alts", k)} />
                        {here?.kind === "alts" && (
                          <PanelBox title={t.mealMenu.alternativesTitle} onClose={() => setPanel(null)}>
                            <DishAlternatives meal={asMeal} busy={edit.isPending} onUse={(dish) => edit.mutate({ id: shown.id, day: weekday, index, course: k, ...dishAsEdit(dish) })} />
                          </PanelBox>
                        )}
                        {here?.kind === "edit" && (
                          <EditMeal key={here.n} meal={asMeal} startOpen onCancel={() => setPanel(null)} busy={edit.isPending} failed={edit.isError} onSave={(dish, done) => edit.mutate({ id: shown.id, day: weekday, index, course: k, ...dish }, { onSuccess: () => { done(); setPanel(null); } })} />
                        )}
                        {here?.kind === "saveFailed" && <p className="form-error" role="alert">{t.mealMenu.saveFailed}</p>}
                      </>
                    );
                  }}
                  extra={(meal, index) => {
                    const here = panel && panel.day === weekday && panel.index === index && panel.course === undefined ? panel : null;
                    if (!here) return null;
                    const fixed = isFixedMeal(meal) ? meal : null;
                    return (
                      <div className="plan-meal-panel" key={here.n}>
                        {here.kind === "edit" && (
                          <EditMeal
                            meal={meal}
                            startOpen
                            onCancel={() => setPanel(null)}
                            busy={edit.isPending}
                            failed={edit.isError}
                            onSave={(dish, done) => edit.mutate({ id: shown.id, day: weekday, index, ...dish }, { onSuccess: () => { done(); setPanel(null); } })}
                            onSplit={() => setSplitting({ day: weekday, index })}
                          />
                        )}
                        {splitting?.day === weekday && splitting.index === index && (
                          <SplitFoods plan={shown} day={weekday} index={index} onDone={() => setSplitting(null)} onClose={() => setSplitting(null)} />
                        )}
                        {here.kind === "alts" && fixed && (
                          <PanelBox title={t.mealMenu.alternativesTitle} onClose={() => setPanel(null)}>
                            <DishAlternatives
                              meal={fixed}
                              busy={edit.isPending}
                              onUse={(dish) => edit.mutate({ id: shown.id, day: weekday, index, ...dishAsEdit(dish) })}
                              {...(canGenerate ? { ai: { planId: shown.id, day: weekday, index } } : {})}
                            />
                          </PanelBox>
                        )}
                        {here.kind === "course" && fixed && (
                          <AddCourse meal={fixed} startOpen busy={courses.isPending} failed={courses.isError} onAdd={(add, done) => courses.mutate({ id: shown.id, add: { day: weekday, index, ...add } }, { onSuccess: () => { done(); setPanel(null); } })} />
                        )}
                        {here.kind === "split" && fixed && (
                          <SplitCourses meal={fixed} startOpen busy={courses.isPending} failed={courses.isError} onSave={(labels, done) => courses.mutate({ id: shown.id, split: { day: weekday, index, labels } }, { onSuccess: () => { done(); setPanel(null); } })} />
                        )}
                        {here.kind === "move" && <MoveMeal plan={shown.plan} day={weekday} index={index} startOpen busy={swap.isPending} failed={swap.isError} onMove={(toDay) => { swap.mutate({ id: shown.id, day: weekday, index, toDay }); setPanel(null); }} />}
                        {here.kind === "remove" && (
                          <RemoveMeal meal={meal} startOpen dayName={t.weekdaysLong[dayIndex]!} inEffect={inEffect} busy={planMeals.isPending} failed={planMeals.isError} onRemove={(allDays, done) => planMeals.mutate({ id: shown.id, remove: { day: weekday, index, allDays } }, { onSuccess: () => { done(); setPanel(null); } })} />
                        )}
                        {here.kind === "saveFailed" && <p className="form-error" role="alert">{t.mealMenu.saveFailed}</p>}
                      </div>
                    );
                  }}
                />
                {menuFor && day.meals[menuFor.index] && (
                  <MealMenuSheet
                    title={t.mealMenu.title(menuFor.course === undefined ? day.meals[menuFor.index]!.title : courseLabel((day.meals[menuFor.index] as FixedPlannedMeal).courses?.[menuFor.course]?.name ?? ""), t.weekdaysLong[dayIndex]!)}
                    subtitle={menuSubtitle(day.meals[menuFor.index]!, menuFor.course)}
                    sections={menuSections(day.meals[menuFor.index]!, menuFor.index, menuFor.course)}
                    onClose={() => setMenuFor(null)}
                  />
                )}
                <AddPlanMeal
                  key={`add-${shown.id}-${weekday}`}
                  dayName={t.weekdaysLong[dayIndex]!}
                  inEffect={inEffect}
                  busy={planMeals.isPending}
                  failed={planMeals.isError}
                  onAdd={({ title, time, type, allDays, ...dish }, done) => planMeals.mutate({ id: shown.id, add: { day: weekday, allDays, title, time, type, ...dish } }, { onSuccess: done })}
                />
              </div>

              <aside className="plan-aside">
                <PlanDaySummary day={day} goals={goals} />
                <DishGroupsCard />
                <section className="card plan-times">
                  <SameTimeSwitch checked={sameTime} onChange={setSameTime} />
                  <p className="muted">{t.plan.timeHint}</p>
                  {setTime.isError && <p className="error-text">{t.plan.timeFailed}</p>}
                </section>
                {shown.plan.notes && shown.plan.notes.length > 0 && (
                  <details className="plan-notes" open>
                    <summary>{t.plan.notes}</summary>
                    <ul>
                      {shown.plan.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </aside>
            </div>
          )}
        </>
      )}

      {historyOpen && data && (
        <Scrim onClose={() => setHistoryOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t.plan.history} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-head">
              <h2>{t.plan.history}</h2>
              <button type="button" className="icon-button" aria-label={t.close} onClick={() => setHistoryOpen(false)}>
                <CloseIcon size={18} strokeWidth={2.5} />
              </button>
            </div>
            <div className="sheet-list">
              {data.versions.map((version) => (
                <div key={version.id} className="sheet-row" data-static>
                  <span className="sheet-row-text">
                    <strong>{t.plan.validFrom(formatMediumDate(version.validFrom))}</strong>
                    <span className="muted">{t.plan.uploadedOn(formatMediumDate(version.uploadedAt.slice(0, 10)))}</span>
                  </span>
                  <span className="version-status" data-status={version.status}>
                    {t.plan.status[version.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Scrim>
      )}
    </div>
  );
}

type PanelKind = "edit" | "alts" | "course" | "split" | "move" | "remove" | "saveFailed";

/** A panel opened from the meal menu, with its title and "Chiudi". */
function PanelBox({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="plan-panel-box">
      <div className="plan-panel-head">
        <span className="plan-edit-title">{title}</span>
        <button type="button" className="text-button" onClick={onClose}>
          {t.mealMenu.close}
        </button>
      </div>
      {children}
    </div>
  );
}
