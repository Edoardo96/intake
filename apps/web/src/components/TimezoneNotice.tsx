import { useState } from "react";
import { deviceTimezone, useSetTimezone } from "../api/queries";
import { t } from "../lib/strings";

const HIDDEN_KEY = "intake.timezoneNoticeHidden";

function hiddenFor(device: string): boolean {
  try {
    return globalThis.localStorage?.getItem(HIDDEN_KEY) === device;
  } catch {
    return false;
  }
}

/**
 * Oggi: a new Nutrition account is on UTC until a timezone is set, which puts "today" and the time of new meals
 * an hour or two off in Italy. When Nutrition says UTC and this device is elsewhere, this asks to use the device's
 * timezone, after a confirmation (TimezoneConfirm). "Non ora" hides it on this device.
 */
/**
 * The second step of "Usa …" (Oggi and Profilo): changing the zone regroups the meals already logged by the new
 * zone's days, so one near midnight can move to the day before or after. Nothing is written before "Conferma".
 */
export function TimezoneConfirm({ device, onCancel }: { device: string; onCancel: () => void }) {
  const setTimezone = useSetTimezone();
  return (
    <div className="timezone-confirm" role="group" aria-label={t.profile.useTimezone(device)}>
      <p>{t.profile.timezoneConfirm(device)}</p>
      {setTimezone.isError && <p className="error-text">{t.profile.timezoneFailed}</p>}
      <div className="timezone-actions">
        <button type="button" className="text-button" disabled={setTimezone.isPending} onClick={onCancel}>
          {t.profile.timezoneCancel}
        </button>
        <button type="button" className="button-primary-small" disabled={setTimezone.isPending} onClick={() => setTimezone.mutate(device)}>
          {t.profile.timezoneApply}
        </button>
      </div>
    </div>
  );
}

export function TimezoneNotice({ timezone }: { timezone: string }) {
  const device = deviceTimezone();
  const [hidden, setHidden] = useState(() => (device ? hiddenFor(device) : true));
  const [confirming, setConfirming] = useState(false);
  if (timezone !== "UTC" || !device || device === "UTC" || device === "Etc/UTC" || hidden) return null;

  const hide = () => {
    setHidden(true);
    try {
      globalThis.localStorage?.setItem(HIDDEN_KEY, device);
    } catch {
      // Storage blocked: hidden until the next visit
    }
  };

  return (
    <div className="notice timezone-notice" role="status">
      <p>{t.profile.timezoneNotice(device)}</p>
      {confirming ? (
        <TimezoneConfirm device={device} onCancel={() => setConfirming(false)} />
      ) : (
        <div className="timezone-actions">
          <button type="button" className="text-button" onClick={hide}>
            {t.profile.timezoneLater}
          </button>
          <button type="button" className="button-primary-small" onClick={() => setConfirming(true)}>
            {t.profile.useTimezone(device)}
          </button>
        </div>
      )}
    </div>
  );
}
