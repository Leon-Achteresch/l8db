use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;

use super::pool::PoolState;
use super::{create_adapter_from_string, DatabaseKind};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CatalogObject {
    pub object_type: String,
    pub name: String,
    pub parent: Option<String>,
    pub ddl: String,
    pub attributes: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<String>>,
}

pub fn attach_dependencies(
    objects: &mut [CatalogObject],
    covered: &[&str],
    edges: impl IntoIterator<Item = (String, String, String)>,
) {
    let mut graph: HashMap<(String, String), BTreeSet<String>> = HashMap::new();
    for (object_type, name, referenced) in edges {
        if name != referenced {
            graph
                .entry((object_type, name))
                .or_default()
                .insert(referenced);
        }
    }
    for object in objects
        .iter_mut()
        .filter(|object| covered.contains(&object.object_type.as_str()))
    {
        let key = (object.object_type.clone(), object.name.clone());
        object.depends_on = Some(
            graph
                .get(&key)
                .map(|names| names.iter().cloned().collect())
                .unwrap_or_default(),
        );
    }
}

impl CatalogObject {
    pub fn new(
        object_type: &str,
        name: impl Into<String>,
        parent: Option<String>,
        ddl: impl Into<String>,
    ) -> Self {
        Self {
            object_type: object_type.to_string(),
            name: name.into(),
            parent,
            ddl: ddl.into(),
            attributes: BTreeMap::new(),
            depends_on: None,
        }
    }

    pub fn attr(mut self, key: &str, value: impl Into<String>) -> Self {
        self.attributes.insert(key.to_string(), value.into());
        self
    }
}

#[tauri::command]
pub async fn schema_catalog(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    types: Vec<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<Vec<CatalogObject>, String> {
    if schema.trim().is_empty() {
        return Err("Bitte ein Schema wählen.".to_string());
    }
    create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?
    .schema_catalog(&schema, &types)
    .await
}

#[tauri::command]
pub async fn schema_partition_ddl(
    kind: DatabaseKind,
    connection_string: String,
    database: Option<String>,
    schema: String,
    tables: Vec<String>,
    pool_state: tauri::State<'_, PoolState>,
) -> Result<BTreeMap<String, String>, String> {
    create_adapter_from_string(
        kind,
        &connection_string,
        database.as_deref(),
        pool_state.inner().clone(),
    )?
    .schema_partition_ddl(&schema, &tables)
    .await
}

#[cfg(test)]
#[path = "schema_compare_live_tests.rs"]
mod live_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attaches_dependencies_only_to_covered_types() {
        let mut objects = vec![
            CatalogObject::new("view", "V2", None, ""),
            CatalogObject::new("view", "V1", None, ""),
            CatalogObject::new("package", "P", None, ""),
            CatalogObject::new("package_body", "P", None, ""),
            CatalogObject::new("index", "I", Some("T".into()), ""),
        ];
        let edge = |kind: &str, name: &str, referenced: &str| {
            (kind.to_string(), name.to_string(), referenced.to_string())
        };
        attach_dependencies(
            &mut objects,
            &["view", "package", "package_body"],
            [
                edge("view", "V2", "V1"),
                edge("view", "V2", "T"),
                edge("view", "V2", "V1"),
                edge("package_body", "P", "P"),
                edge("package_body", "P", "T"),
            ],
        );
        let deps: Vec<_> = objects.iter().map(|o| o.depends_on.clone()).collect();
        assert_eq!(
            deps,
            vec![
                Some(vec!["T".to_string(), "V1".to_string()]),
                Some(vec![]),
                Some(vec![]),
                Some(vec!["T".to_string()]),
                None,
            ]
        );
        let json = serde_json::to_value(&objects[4]).unwrap();
        assert!(json.get("depends_on").is_none());
    }
}
