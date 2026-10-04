use std::collections::HashSet;
use std::str::FromStr;

use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime,
    TimeZone, Utc,
};
use chrono_tz::Tz;
use croner::Cron;

use crate::automation::model::{IntervalUnit, Schedule, Task, Trigger};

const HORIZON_DAYS: i64 = 5 * 366;
const MAX_REJECTED: usize = 1_000;
const MAX_GAP_MINUTES: i64 = 180;

#[derive(Clone, Copy)]
enum Zone {
    Named(Tz),
    Local,
}

impl Zone {
    fn resolve(&self, naive: NaiveDateTime) -> LocalResult<DateTime<Utc>> {
        match self {
            Zone::Named(tz) => tz
                .from_local_datetime(&naive)
                .map(|at| at.with_timezone(&Utc)),
            Zone::Local => Local
                .from_local_datetime(&naive)
                .map(|at| at.with_timezone(&Utc)),
        }
    }

    fn to_utc(&self, naive: NaiveDateTime) -> Option<DateTime<Utc>> {
        (0..=MAX_GAP_MINUTES).find_map(|minutes| {
            match self.resolve(naive + Duration::minutes(minutes)) {
                LocalResult::Single(at) => Some(at),
                LocalResult::Ambiguous(earliest, _) => Some(earliest),
                LocalResult::None => None,
            }
        })
    }

    fn local(&self, at: DateTime<Utc>) -> NaiveDateTime {
        match self {
            Zone::Named(tz) => at.with_timezone(tz).naive_local(),
            Zone::Local => at.with_timezone(&Local).naive_local(),
        }
    }

    fn cron_next(&self, cron: &Cron, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        match self {
            Zone::Named(tz) => cron
                .find_next_occurrence(&after.with_timezone(tz), false)
                .ok()
                .map(|at| at.with_timezone(&Utc)),
            Zone::Local => cron
                .find_next_occurrence(&after.with_timezone(&Local), false)
                .ok()
                .map(|at| at.with_timezone(&Utc)),
        }
    }
}

fn system_zone() -> Zone {
    std::env::var("TZ")
        .ok()
        .and_then(|name| Tz::from_str(name.trim_start_matches(':')).ok())
        .or_else(|| {
            let target = std::fs::read_link("/etc/localtime").ok()?;
            let target = target.to_string_lossy();
            let (_, name) = target.split_once("zoneinfo/")?;
            Tz::from_str(name).ok()
        })
        .map(Zone::Named)
        .unwrap_or(Zone::Local)
}

enum DayRule {
    All,
    Weekdays(Vec<u32>),
    MonthDays(Vec<u32>, bool),
    Nth(i8, u32),
}

impl DayRule {
    fn matches(&self, date: NaiveDate) -> bool {
        let last_day = (date + Duration::days(1)).month() != date.month();
        match self {
            DayRule::All => true,
            DayRule::Weekdays(days) => days.contains(&date.weekday().number_from_monday()),
            DayRule::MonthDays(days, last) => days.contains(&date.day()) || (*last && last_day),
            DayRule::Nth(nth, weekday) => {
                date.weekday().number_from_monday() == *weekday
                    && if *nth < 0 {
                        date.day() + 7 > days_in_month(date)
                    } else {
                        (date.day() - 1) / 7 + 1 == *nth as u32
                    }
            }
        }
    }
}

fn days_in_month(date: NaiveDate) -> u32 {
    let (year, month) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    NaiveDate::from_ymd_opt(year, month, 1)
        .and_then(|first| first.pred_opt())
        .map(|last| last.day())
        .unwrap_or(31)
}

enum Kind {
    Every(Duration, DateTime<Utc>),
    EveryDays(i64, NaiveDateTime),
    Days(Vec<NaiveTime>, DayRule),
    Cron(Box<Cron>),
    Once(Option<DateTime<Utc>>),
    Event,
}

struct Plan {
    zone: Zone,
    start: Option<DateTime<Utc>>,
    end: Option<DateTime<Utc>>,
    exclusions: HashSet<NaiveDate>,
    window: Option<(NaiveTime, NaiveTime)>,
    kind: Kind,
}

fn parse_time(text: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(text, "%H:%M")
        .ok()
        .filter(|_| text.len() == 5)
        .ok_or_else(|| format!("Ungültige Uhrzeit „{text}“ (erwartet HH:MM)."))
}

fn parse_times(times: &[String]) -> Result<Vec<NaiveTime>, String> {
    if times.is_empty() {
        return Err("Mindestens eine Uhrzeit angeben.".into());
    }
    let mut parsed = times
        .iter()
        .map(|time| parse_time(time))
        .collect::<Result<Vec<_>, _>>()?;
    parsed.sort();
    parsed.dedup();
    Ok(parsed)
}

fn parse_date(text: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .map_err(|_| format!("Ungültiges Datum „{text}“ (erwartet JJJJ-MM-TT)."))
}

fn parse_local(text: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M")
        .or_else(|_| NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S"))
        .map_err(|_| format!("Ungültiger Zeitpunkt „{text}“ (erwartet JJJJ-MM-TTTHH:MM)."))
}

fn local_point(zone: &Zone, text: &Option<String>) -> Result<Option<DateTime<Utc>>, String> {
    match text.as_deref().filter(|text| !text.is_empty()) {
        Some(text) => Ok(Some(zone.to_utc(parse_local(text)?).ok_or_else(|| {
            format!("Zeitpunkt „{text}“ existiert in dieser Zeitzone nicht.")
        })?)),
        None => Ok(None),
    }
}

fn compile(schedule: &Schedule) -> Result<Plan, String> {
    let zone = match schedule.timezone.as_deref().filter(|name| !name.is_empty()) {
        Some(name) => {
            Zone::Named(Tz::from_str(name).map_err(|_| format!("Unbekannte Zeitzone „{name}“."))?)
        }
        None => system_zone(),
    };
    let start = local_point(&zone, &schedule.start_at)?;
    let end = local_point(&zone, &schedule.end_at)?;
    if let (Some(start), Some(end)) = (start, end) {
        if start > end {
            return Err("Das Enddatum liegt vor dem Startdatum.".into());
        }
    }
    let exclusions = schedule
        .exclusions
        .iter()
        .map(|date| parse_date(date))
        .collect::<Result<HashSet<_>, _>>()?;
    let window = match &schedule.window {
        Some(window) => {
            let (from, to) = (parse_time(&window.from)?, parse_time(&window.to)?);
            if from == to {
                return Err("Zeitfenster: Beginn und Ende dürfen nicht gleich sein.".into());
            }
            Some((from, to))
        }
        None => None,
    };
    let kind = match &schedule.trigger {
        Trigger::Interval { every, unit } => {
            if *every < 1 {
                return Err("Das Intervall muss mindestens 1 sein.".into());
            }
            let anchor = match schedule.start_at.as_deref().filter(|text| !text.is_empty()) {
                Some(text) => parse_local(text)?,
                None => NaiveDate::from_ymd_opt(2000, 1, 1)
                    .and_then(|date| date.and_hms_opt(0, 0, 0))
                    .ok_or("Ungültiger Anker.")?,
            };
            let seconds = match unit {
                IntervalUnit::Minutes => 60,
                IntervalUnit::Hours => 3_600,
                IntervalUnit::Days => 0,
            };
            if seconds == 0 {
                Kind::EveryDays(*every as i64, anchor)
            } else {
                let anchor = zone.to_utc(anchor).ok_or("Ungültiger Anker.")?;
                Kind::Every(Duration::seconds(*every as i64 * seconds), anchor)
            }
        }
        Trigger::Daily { times } => Kind::Days(parse_times(times)?, DayRule::All),
        Trigger::Weekly { weekdays, times } => {
            if weekdays.is_empty() {
                return Err("Mindestens einen Wochentag wählen.".into());
            }
            if let Some(day) = weekdays.iter().find(|day| !(1..=7).contains(*day)) {
                return Err(format!(
                    "Ungültiger Wochentag {day} (1 = Montag … 7 = Sonntag)."
                ));
            }
            Kind::Days(
                parse_times(times)?,
                DayRule::Weekdays(weekdays.iter().map(|day| *day as u32).collect()),
            )
        }
        Trigger::Monthly {
            days,
            last_day,
            times,
        } => {
            if days.is_empty() && !last_day {
                return Err("Mindestens einen Monatstag oder „letzter Tag“ wählen.".into());
            }
            if let Some(day) = days.iter().find(|day| !(1..=31).contains(*day)) {
                return Err(format!("Ungültiger Monatstag {day} (1–31)."));
            }
            Kind::Days(
                parse_times(times)?,
                DayRule::MonthDays(days.iter().map(|day| *day as u32).collect(), *last_day),
            )
        }
        Trigger::MonthlyNth {
            nth,
            weekday,
            times,
        } => {
            if !(1..=4).contains(nth) && *nth != -1 {
                return Err(format!(
                    "Ungültige Position {nth} (1–4 oder −1 für den letzten)."
                ));
            }
            if !(1..=7).contains(weekday) {
                return Err(format!(
                    "Ungültiger Wochentag {weekday} (1 = Montag … 7 = Sonntag)."
                ));
            }
            Kind::Days(parse_times(times)?, DayRule::Nth(*nth, *weekday as u32))
        }
        Trigger::Cron { expression } => Kind::Cron(Box::new(
            Cron::from_str(expression.trim())
                .map_err(|error| format!("Ungültiger Cron-Ausdruck: {error}"))?,
        )),
        Trigger::Once { at } => Kind::Once(local_point(&zone, &Some(at.clone()))?),
        Trigger::AppStart { .. } => Kind::Event,
        Trigger::AfterTask { task_id, .. } => {
            if task_id.trim().is_empty() {
                return Err("Bitte den auslösenden Task wählen.".into());
            }
            Kind::Event
        }
    };
    Ok(Plan {
        zone,
        start,
        end,
        exclusions,
        window,
        kind,
    })
}

impl Plan {
    fn candidate(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        match &self.kind {
            Kind::Every(step, anchor) => {
                if after < *anchor {
                    return Some(*anchor);
                }
                let step_ms = step.num_milliseconds();
                let k = (after - *anchor).num_milliseconds() / step_ms + 1;
                Some(*anchor + Duration::milliseconds(k * step_ms))
            }
            Kind::EveryDays(every, anchor) => {
                let anchor_utc = self.zone.to_utc(*anchor)?;
                let mut k = ((after - anchor_utc).num_days() / every - 1).max(0);
                loop {
                    let local = *anchor + Duration::days(k * every);
                    if let Some(at) = self.zone.to_utc(local) {
                        if at > after {
                            return Some(at);
                        }
                    }
                    k += 1;
                }
            }
            Kind::Days(times, rule) => {
                let first = self.zone.local(after).date() - Duration::days(1);
                (0..=HORIZON_DAYS)
                    .map(|offset| first + Duration::days(offset))
                    .filter(|date| rule.matches(*date))
                    .find_map(|date| {
                        times
                            .iter()
                            .filter_map(|time| self.zone.to_utc(date.and_time(*time)))
                            .find(|at| *at > after)
                    })
            }
            Kind::Cron(cron) => self.zone.cron_next(cron, after),
            Kind::Once(at) => at.filter(|at| *at > after),
            Kind::Event => None,
        }
    }

    fn rejection(&self, at: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let before = |point: DateTime<Utc>| point - Duration::milliseconds(1);
        if let Some(start) = self.start.filter(|start| at < *start) {
            return Some(before(start));
        }
        let local = self.zone.local(at);
        if self.exclusions.contains(&local.date()) {
            let next_day = (local.date() + Duration::days(1)).and_time(NaiveTime::MIN);
            return Some(self.zone.to_utc(next_day).map(before).unwrap_or(at));
        }
        if let (Some((from, to)), Kind::Every(..) | Kind::EveryDays(..)) = (self.window, &self.kind)
        {
            let time = local.time();
            let inside = if from < to {
                time >= from && time < to
            } else {
                time >= from || time < to
            };
            if !inside {
                let mut opening = local.date().and_time(from);
                if opening <= local {
                    opening += Duration::days(1);
                }
                return Some(self.zone.to_utc(opening).map(before).unwrap_or(at));
            }
        }
        None
    }
}

pub fn next_runs(
    schedule: &Schedule,
    after: DateTime<Utc>,
    count: usize,
) -> Result<Vec<DateTime<Utc>>, String> {
    let plan = compile(schedule)?;
    let limit = after + Duration::days(HORIZON_DAYS);
    let mut found = Vec::new();
    let mut rejected = 0;
    let mut cursor = after;
    while found.len() < count {
        let Some(at) = plan.candidate(cursor) else {
            break;
        };
        if at > limit || plan.end.is_some_and(|end| at > end) {
            break;
        }
        match plan.rejection(at) {
            None => {
                found.push(at);
                cursor = at;
            }
            Some(jump) => {
                rejected += 1;
                if rejected > MAX_REJECTED {
                    break;
                }
                cursor = jump.max(at);
            }
        }
    }
    Ok(found)
}

pub fn next_run(task: &Task, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    task.schedules
        .iter()
        .filter(|schedule| schedule.enabled)
        .filter_map(|schedule| next_runs(schedule, after, 1).ok()?.into_iter().next())
        .min()
}

pub fn validate(schedule: &Schedule) -> Result<(), String> {
    compile(schedule).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn schedule(trigger: serde_json::Value, extra: serde_json::Value) -> Schedule {
        let mut value = json!({ "id": "s", "trigger": trigger, "timezone": "Europe/Berlin" });
        for (key, field) in extra.as_object().unwrap() {
            value[key] = field.clone();
        }
        serde_json::from_value(value).unwrap()
    }

    fn runs(schedule: &Schedule, after: &str, count: usize) -> Vec<String> {
        next_runs(schedule, at(after), count)
            .unwrap()
            .into_iter()
            .map(|at| at.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .collect()
    }

    #[test]
    fn interval_minutes_follow_anchor() {
        let s = schedule(
            json!({"type": "interval", "every": 15, "unit": "minutes"}),
            json!({}),
        );
        assert_eq!(
            runs(&s, "2026-10-04T07:07:00Z", 3),
            [
                "2026-10-04T07:15:00Z",
                "2026-10-04T07:30:00Z",
                "2026-10-04T07:45:00Z"
            ]
        );
    }

    #[test]
    fn interval_hours_are_absolute_across_dst() {
        let s = schedule(
            json!({"type": "interval", "every": 1, "unit": "hours"}),
            json!({}),
        );
        assert_eq!(
            runs(&s, "2026-03-29T00:30:00Z", 3),
            [
                "2026-03-29T01:00:00Z",
                "2026-03-29T02:00:00Z",
                "2026-03-29T03:00:00Z"
            ]
        );
    }

    #[test]
    fn interval_days_keep_local_time_across_dst() {
        let s = schedule(
            json!({"type": "interval", "every": 1, "unit": "days"}),
            json!({"startAt": "2026-03-27T09:00"}),
        );
        assert_eq!(
            runs(&s, "2026-03-26T12:00:00Z", 3),
            [
                "2026-03-27T08:00:00Z",
                "2026-03-28T08:00:00Z",
                "2026-03-29T07:00:00Z"
            ]
        );
        let every_two = schedule(
            json!({"type": "interval", "every": 2, "unit": "days"}),
            json!({"startAt": "2026-10-01T06:00"}),
        );
        assert_eq!(
            runs(&every_two, "2026-10-04T12:00:00Z", 2),
            ["2026-10-05T04:00:00Z", "2026-10-07T04:00:00Z"]
        );
    }

    #[test]
    fn daily_sorts_multiple_times() {
        let s = schedule(
            json!({"type": "daily", "times": ["18:00", "09:00"]}),
            json!({}),
        );
        assert_eq!(
            runs(&s, "2026-10-04T08:00:00Z", 3),
            [
                "2026-10-04T16:00:00Z",
                "2026-10-05T07:00:00Z",
                "2026-10-05T16:00:00Z"
            ]
        );
    }

    #[test]
    fn dst_gap_moves_to_next_valid_minute() {
        let s = schedule(json!({"type": "daily", "times": ["02:30"]}), json!({}));
        assert_eq!(
            runs(&s, "2026-03-28T12:00:00Z", 2),
            ["2026-03-29T01:00:00Z", "2026-03-30T00:30:00Z"]
        );
    }

    #[test]
    fn dst_overlap_uses_earlier_instance() {
        let s = schedule(json!({"type": "daily", "times": ["02:30"]}), json!({}));
        assert_eq!(
            runs(&s, "2026-10-24T12:00:00Z", 2),
            ["2026-10-25T00:30:00Z", "2026-10-26T01:30:00Z"]
        );
    }

    #[test]
    fn weekly_uses_iso_weekdays() {
        let s = schedule(
            json!({"type": "weekly", "weekdays": [1, 5], "times": ["09:00"]}),
            json!({}),
        );
        assert_eq!(
            runs(&s, "2026-10-03T12:00:00Z", 3),
            [
                "2026-10-05T07:00:00Z",
                "2026-10-09T07:00:00Z",
                "2026-10-12T07:00:00Z"
            ]
        );
    }

    #[test]
    fn monthly_skips_missing_days_and_supports_last_day() {
        let s = schedule(
            json!({"type": "monthly", "days": [31], "times": ["12:00"]}),
            json!({"timezone": "UTC"}),
        );
        assert_eq!(
            runs(&s, "2026-01-31T12:00:00Z", 2),
            ["2026-03-31T12:00:00Z", "2026-05-31T12:00:00Z"]
        );
        let last = schedule(
            json!({"type": "monthly", "lastDay": true, "times": ["12:00"]}),
            json!({"timezone": "UTC"}),
        );
        assert_eq!(
            runs(&last, "2026-01-15T00:00:00Z", 3),
            [
                "2026-01-31T12:00:00Z",
                "2026-02-28T12:00:00Z",
                "2026-03-31T12:00:00Z"
            ]
        );
        assert_eq!(
            runs(&last, "2028-02-01T00:00:00Z", 1),
            ["2028-02-29T12:00:00Z"]
        );
    }

    #[test]
    fn monthly_nth_including_last() {
        let last_friday = schedule(
            json!({"type": "monthly_nth", "nth": -1, "weekday": 5, "times": ["10:00"]}),
            json!({"timezone": "UTC"}),
        );
        assert_eq!(
            runs(&last_friday, "2026-10-04T00:00:00Z", 3),
            [
                "2026-10-30T10:00:00Z",
                "2026-11-27T10:00:00Z",
                "2026-12-25T10:00:00Z"
            ]
        );
        let second_tuesday = schedule(
            json!({"type": "monthly_nth", "nth": 2, "weekday": 2, "times": ["10:00"]}),
            json!({"timezone": "UTC"}),
        );
        assert_eq!(
            runs(&second_tuesday, "2026-10-04T00:00:00Z", 2),
            ["2026-10-13T10:00:00Z", "2026-11-10T10:00:00Z"]
        );
    }

    #[test]
    fn window_across_midnight() {
        let s = schedule(
            json!({"type": "interval", "every": 1, "unit": "hours"}),
            json!({"timezone": "UTC", "window": {"from": "22:00", "to": "02:00"}}),
        );
        assert_eq!(
            runs(&s, "2026-10-04T12:00:00Z", 5),
            [
                "2026-10-04T22:00:00Z",
                "2026-10-04T23:00:00Z",
                "2026-10-05T00:00:00Z",
                "2026-10-05T01:00:00Z",
                "2026-10-05T22:00:00Z"
            ]
        );
    }

    #[test]
    fn window_jumps_to_opening_for_minute_intervals() {
        let s = schedule(
            json!({"type": "interval", "every": 7, "unit": "minutes"}),
            json!({"timezone": "UTC", "window": {"from": "09:00", "to": "17:00"}, "exclusions": ["2026-10-05"]}),
        );
        let found = next_runs(&s, at("2026-10-04T17:00:00Z"), 2).unwrap();
        assert_eq!(found.len(), 2);
        assert!(found[0] >= at("2026-10-06T09:00:00Z") && found[0] < at("2026-10-06T09:07:00Z"));
    }

    #[test]
    fn exclusions_skip_local_dates() {
        let s = schedule(
            json!({"type": "daily", "times": ["09:00"]}),
            json!({"timezone": "UTC", "exclusions": ["2026-10-05"]}),
        );
        assert_eq!(
            runs(&s, "2026-10-04T12:00:00Z", 2),
            ["2026-10-06T09:00:00Z", "2026-10-07T09:00:00Z"]
        );
    }

    #[test]
    fn start_and_end_bound_results() {
        let s = schedule(
            json!({"type": "daily", "times": ["09:00"]}),
            json!({"timezone": "UTC", "startAt": "2026-10-10T00:00", "endAt": "2026-10-12T09:00"}),
        );
        assert_eq!(
            runs(&s, "2026-10-04T12:00:00Z", 5),
            [
                "2026-10-10T09:00:00Z",
                "2026-10-11T09:00:00Z",
                "2026-10-12T09:00:00Z"
            ]
        );
    }

    #[test]
    fn cron_with_five_and_six_fields() {
        let last_day = schedule(
            json!({"type": "cron", "expression": "0 12 L * *"}),
            json!({}),
        );
        assert_eq!(
            runs(&last_day, "2026-10-04T00:00:00Z", 2),
            ["2026-10-31T11:00:00Z", "2026-11-30T11:00:00Z"]
        );
        let weekdays = schedule(
            json!({"type": "cron", "expression": "0 0 9 * * MON-FRI"}),
            json!({}),
        );
        assert_eq!(
            runs(&weekdays, "2026-10-03T12:00:00Z", 2),
            ["2026-10-05T07:00:00Z", "2026-10-06T07:00:00Z"]
        );
        let seconds = schedule(
            json!({"type": "cron", "expression": "30 * * * * *"}),
            json!({"timezone": "UTC"}),
        );
        assert_eq!(
            runs(&seconds, "2026-10-04T12:00:00Z", 2),
            ["2026-10-04T12:00:30Z", "2026-10-04T12:01:30Z"]
        );
    }

    #[test]
    fn once_only_in_future() {
        let s = schedule(json!({"type": "once", "at": "2026-10-10T08:15"}), json!({}));
        assert_eq!(
            runs(&s, "2026-10-04T00:00:00Z", 3),
            ["2026-10-10T06:15:00Z"]
        );
        assert!(runs(&s, "2026-10-11T00:00:00Z", 3).is_empty());
    }

    #[test]
    fn event_triggers_have_no_times() {
        let app = schedule(json!({"type": "app_start", "delaySeconds": 5}), json!({}));
        let after = schedule(
            json!({"type": "after_task", "taskId": "x", "on": "success"}),
            json!({}),
        );
        assert!(runs(&app, "2026-10-04T00:00:00Z", 3).is_empty());
        assert!(runs(&after, "2026-10-04T00:00:00Z", 3).is_empty());
    }

    #[test]
    fn system_timezone_is_used_without_timezone() {
        let mut s = schedule(json!({"type": "daily", "times": ["09:00"]}), json!({}));
        s.timezone = None;
        assert_eq!(
            next_runs(&s, at("2026-10-04T00:00:00Z"), 3).unwrap().len(),
            3
        );
    }

    #[test]
    fn next_run_uses_earliest_enabled_schedule() {
        let task: Task = serde_json::from_value(json!({
            "id": "t",
            "name": "T",
            "schedules": [
                {"id": "a", "trigger": {"type": "daily", "times": ["10:00"]}, "timezone": "UTC"},
                {"id": "b", "enabled": false, "trigger": {"type": "daily", "times": ["08:00"]}, "timezone": "UTC"},
                {"id": "c", "trigger": {"type": "daily", "times": ["09:00"]}, "timezone": "UTC"},
                {"id": "d", "trigger": {"type": "app_start"}}
            ]
        }))
        .unwrap();
        assert_eq!(
            next_run(&task, at("2026-10-04T00:00:00Z")),
            Some(at("2026-10-04T09:00:00Z"))
        );
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let cases = [
            (json!({"type": "daily", "times": ["9:00"]}), json!({})),
            (json!({"type": "daily", "times": ["24:00"]}), json!({})),
            (json!({"type": "daily", "times": []}), json!({})),
            (
                json!({"type": "weekly", "weekdays": [], "times": ["09:00"]}),
                json!({}),
            ),
            (
                json!({"type": "weekly", "weekdays": [8], "times": ["09:00"]}),
                json!({}),
            ),
            (json!({"type": "monthly", "times": ["09:00"]}), json!({})),
            (
                json!({"type": "monthly", "days": [32], "times": ["09:00"]}),
                json!({}),
            ),
            (
                json!({"type": "monthly_nth", "nth": 5, "weekday": 1, "times": ["09:00"]}),
                json!({}),
            ),
            (
                json!({"type": "monthly_nth", "nth": 0, "weekday": 1, "times": ["09:00"]}),
                json!({}),
            ),
            (
                json!({"type": "monthly_nth", "nth": 1, "weekday": 0, "times": ["09:00"]}),
                json!({}),
            ),
            (
                json!({"type": "cron", "expression": "kein cron"}),
                json!({}),
            ),
            (
                json!({"type": "interval", "every": 0, "unit": "minutes"}),
                json!({}),
            ),
            (json!({"type": "once", "at": "morgen"}), json!({})),
            (
                json!({"type": "after_task", "taskId": "", "on": "always"}),
                json!({}),
            ),
            (
                json!({"type": "daily", "times": ["09:00"]}),
                json!({"timezone": "Mars/Base"}),
            ),
            (
                json!({"type": "daily", "times": ["09:00"]}),
                json!({"exclusions": ["2026-13-01"]}),
            ),
            (
                json!({"type": "daily", "times": ["09:00"]}),
                json!({"startAt": "2026-10-10T00:00", "endAt": "2026-10-01T00:00"}),
            ),
            (
                json!({"type": "interval", "every": 1, "unit": "hours"}),
                json!({"window": {"from": "09:00", "to": "09:00"}}),
            ),
        ];
        for (trigger, extra) in cases {
            let s = schedule(trigger.clone(), extra.clone());
            assert!(validate(&s).is_err(), "{trigger} {extra}");
            assert!(next_runs(&s, Utc::now(), 1).is_err());
        }
        let cron = schedule(
            json!({"type": "cron", "expression": "kein cron"}),
            json!({}),
        );
        assert!(validate(&cron)
            .unwrap_err()
            .starts_with("Ungültiger Cron-Ausdruck: "));
    }
}
