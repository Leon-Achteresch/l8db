use serde_json::Value;

use crate::db::TableData;
use crate::mcp::config::{McpConfig, RedactRule};
use crate::mcp::redact::Redactor;

pub(super) struct Protection {
    redactor: Redactor,
}

impl Protection {
    pub fn new(
        connection_id: &str,
        rules: &[RedactRule],
        config: &McpConfig,
    ) -> Result<Self, String> {
        let mut extra: Vec<String> = rules
            .iter()
            .filter(|rule| rule.enabled)
            .map(|rule| rule.pattern.clone())
            .collect();
        if let Some(connection) = config
            .connections
            .iter()
            .find(|connection| connection.id == connection_id)
        {
            extra.extend(connection.sensitive_columns());
        }
        if extra.len() + config.redaction.columns.len() + config.redaction.values.len() > 200 {
            return Err("Die Maskierung enthält mehr als 200 Regeln pro Quelle.".into());
        }
        let redactor = Redactor::new(&config.redaction, &extra);
        redactor.check_valid()?;
        Ok(Self { redactor })
    }

    fn cell(&self, column: &str, value: &mut Value) {
        if self.redactor.column_is_sensitive(column) {
            *value = Value::Null;
            return;
        }
        match value {
            Value::Object(values) => {
                for (column, value) in values {
                    self.cell(column, value);
                }
            }
            Value::Array(values) => {
                for value in values {
                    self.cell("", value);
                }
            }
            value => *value = self.redactor.redact_cell(column, value),
        }
    }

    pub fn apply(&self, data: &mut TableData) -> Vec<String> {
        for row in &mut data.rows {
            if let Some(cells) = row.as_object_mut() {
                for column in &data.columns {
                    if let Some(value) = cells.get_mut(column) {
                        self.cell(column, value);
                    }
                }
            }
        }
        data.columns
            .iter()
            .filter(|column| self.redactor.column_is_sensitive(column))
            .cloned()
            .collect()
    }
}
