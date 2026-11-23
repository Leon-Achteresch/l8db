use std::sync::Mutex;

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WarningLevel {
    #[default]
    Disable,
    Enable,
    Error,
}

impl WarningLevel {
    fn sql(self) -> &'static str {
        match self {
            Self::Disable => "DISABLE",
            Self::Enable => "ENABLE",
            Self::Error => "ERROR",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlsqlWarnings {
    pub severe: WarningLevel,
    pub performance: WarningLevel,
    pub informational: WarningLevel,
    pub ignore: Vec<u32>,
    pub error: Vec<u32>,
}

static CURRENT: Mutex<Option<PlsqlWarnings>> = Mutex::new(None);

pub fn set(warnings: PlsqlWarnings) {
    if let Ok(mut current) = CURRENT.lock() {
        *current = Some(warnings.normalized());
    }
}

pub fn current() -> PlsqlWarnings {
    CURRENT
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .unwrap_or_default()
}

impl PlsqlWarnings {
    #[cfg(test)]
    pub fn all() -> Self {
        Self {
            severe: WarningLevel::Enable,
            performance: WarningLevel::Enable,
            informational: WarningLevel::Enable,
            ..Self::default()
        }
    }

    fn normalized(mut self) -> Self {
        for list in [&mut self.ignore, &mut self.error] {
            list.retain(|n| (5000..=7999).contains(n));
            list.sort_unstable();
            list.dedup();
        }
        let error = self.error.clone();
        self.ignore.retain(|n| !error.contains(n));
        self
    }

    pub fn enabled(&self) -> bool {
        [self.severe, self.performance, self.informational]
            .iter()
            .any(|level| *level != WarningLevel::Disable)
            || !self.error.is_empty()
    }

    pub fn sql(&self) -> String {
        let mut sql = String::from(
            "BEGIN DBMS_WARNING.SET_WARNING_SETTING_STRING('DISABLE:ALL', 'SESSION');",
        );
        for (category, level) in [
            ("SEVERE", self.severe),
            ("PERFORMANCE", self.performance),
            ("INFORMATIONAL", self.informational),
        ] {
            if level != WarningLevel::Disable {
                sql.push_str(&format!(
                    " DBMS_WARNING.ADD_WARNING_SETTING_CAT('{category}', '{}', 'SESSION');",
                    level.sql()
                ));
            }
        }
        for (numbers, level) in [(&self.ignore, "DISABLE"), (&self.error, "ERROR")] {
            for number in numbers {
                sql.push_str(&format!(
                    " DBMS_WARNING.ADD_WARNING_SETTING_NUM({number}, '{level}', 'SESSION');"
                ));
            }
        }
        sql.push_str(" END;");
        sql
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_dbms_warning_block() {
        let warnings = PlsqlWarnings {
            severe: WarningLevel::Error,
            performance: WarningLevel::Enable,
            ignore: vec![7203, 7203, 42, 6009],
            error: vec![6009, 99999],
            ..PlsqlWarnings::default()
        }
        .normalized();
        assert!(warnings.enabled());
        assert_eq!(
            warnings.sql(),
            "BEGIN DBMS_WARNING.SET_WARNING_SETTING_STRING('DISABLE:ALL', 'SESSION'); \
DBMS_WARNING.ADD_WARNING_SETTING_CAT('SEVERE', 'ERROR', 'SESSION'); \
DBMS_WARNING.ADD_WARNING_SETTING_CAT('PERFORMANCE', 'ENABLE', 'SESSION'); \
DBMS_WARNING.ADD_WARNING_SETTING_NUM(7203, 'DISABLE', 'SESSION'); \
DBMS_WARNING.ADD_WARNING_SETTING_NUM(6009, 'ERROR', 'SESSION'); END;"
        );
    }

    #[test]
    fn default_disables_everything() {
        let warnings = PlsqlWarnings {
            ignore: vec![7203],
            ..PlsqlWarnings::default()
        };
        assert!(!warnings.enabled());
        assert!(PlsqlWarnings::all().enabled());
    }
}
