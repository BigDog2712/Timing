use chrono::{Datelike, Duration, LocalResult, Months, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReminderRecurrence {
    Interval { minutes: u32 },
    Daily,
    Monthly,
    Yearly,
    Weekly { weekdays: Vec<u32> },
}

impl ReminderRecurrence {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Interval { minutes } if !(1..=86_400).contains(minutes) => {
                Err("reminder interval must be between 1 minute and 60 days".into())
            }
            Self::Weekly { weekdays }
                if weekdays.is_empty()
                    || weekdays.len() > 7
                    || weekdays.iter().any(|day| !(1..=7).contains(day))
                    || weekdays
                        .iter()
                        .enumerate()
                        .any(|(i, day)| weekdays[..i].contains(day)) =>
            {
                Err("reminder weekdays must be unique ISO weekdays".into())
            }
            _ => Ok(()),
        }
    }

    pub fn next_after<T: TimeZone>(
        &self,
        anchor_ms: i64,
        after_ms: i64,
        timezone: &T,
    ) -> Result<i64, String> {
        self.validate()?;
        let invalid = || "reminder time is outside the supported range".to_string();
        let anchor = timezone
            .timestamp_millis_opt(anchor_ms)
            .single()
            .ok_or_else(invalid)?;
        let after = timezone
            .timestamp_millis_opt(after_ms)
            .single()
            .ok_or_else(invalid)?;
        if let Self::Interval { minutes } = self {
            let step = i64::from(*minutes) * 60_000;
            let count = if after_ms < anchor_ms {
                0
            } else {
                after_ms.checked_sub(anchor_ms).ok_or_else(invalid)? / step + 1
            };
            return count
                .checked_mul(step)
                .and_then(|delta| anchor_ms.checked_add(delta))
                .filter(|next| timezone.timestamp_millis_opt(*next).single().is_some())
                .ok_or_else(invalid);
        }
        let start = after.date_naive().max(anchor.date_naive());
        // Eight years includes the leap-day gap across a non-leap century.
        for offset in 0..=8 {
            let date = match self {
                Self::Monthly => start
                    .with_day(1)
                    .and_then(|date| date.checked_add_months(Months::new(offset)))
                    .and_then(|date| {
                        NaiveDate::from_ymd_opt(date.year(), date.month(), anchor.day())
                    }),
                Self::Yearly => start
                    .year()
                    .checked_add(offset as i32)
                    .and_then(|year| NaiveDate::from_ymd_opt(year, anchor.month(), anchor.day())),
                _ => start.checked_add_signed(Duration::days(i64::from(offset))),
            };
            let Some(date) = date else { continue };
            if let Self::Weekly { weekdays } = self {
                if !weekdays.contains(&date.weekday().number_from_monday()) {
                    continue;
                }
            }
            let wall_time = date.and_time(anchor.time());
            // A missing DST wall time moves to the first valid minute; an ambiguous time fires once.
            for minutes in 0..=180 {
                let candidate = wall_time
                    .checked_add_signed(Duration::minutes(minutes))
                    .ok_or_else(invalid)?;
                let resolved = match timezone.from_local_datetime(&candidate) {
                    LocalResult::Single(value) => Some(value),
                    LocalResult::Ambiguous(first, second) => Some(first.min(second)),
                    LocalResult::None => None,
                };
                if let Some(value) = resolved {
                    let next = value.timestamp_millis();
                    if next > after_ms && next >= anchor_ms {
                        return Ok(next);
                    }
                    break;
                }
            }
        }
        Err(invalid())
    }
}

#[cfg(test)]
#[path = "reminder_schedule_mod_tests.rs"]
mod tests;
