use super::types::{Attachment, ConnectionContext, Event};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::{oneshot, watch};

#[derive(Default)]
pub struct AiState {
    pub runs: Mutex<HashMap<String, watch::Sender<bool>>>,
    pub approvals: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    pub completions: Mutex<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Default)]
pub struct RunScope {
    pub connections: Vec<ConnectionContext>,
    pub attachments: Vec<Attachment>,
}

pub struct Run {
    pub scope: RunScope,
    pub id: String,
    pub owner: String,
    pub plan_only: bool,
    pub approval: String,
    pub state: Arc<AiState>,
    pub channel: Channel<Event>,
}

impl Run {
    pub fn emit(&self, kind: &str, data: Value) {
        if self
            .channel
            .send(Event {
                kind: kind.into(),
                data,
            })
            .is_err()
        {
            if let Ok(runs) = self.state.runs.lock() {
                if let Some(cancel) = runs.get(&format!("{}:{}", self.owner, self.id)) {
                    let _ = cancel.send(true);
                }
            }
        }
    }

    pub fn finish(&self) {
        let prefix = format!("{}:{}:", self.owner, self.id);
        if let Ok(mut approvals) = self.state.approvals.lock() {
            approvals.retain(|key, _| !key.starts_with(&prefix));
        }
        if let Ok(mut runs) = self.state.runs.lock() {
            runs.remove(&format!("{}:{}", self.owner, self.id));
        }
    }

    pub async fn approve(&self, title: &str, details: Value) -> Result<bool, String> {
        Ok(self
            .wait("approval", title, details)
            .await?
            .as_bool()
            .unwrap_or(false))
    }

    pub fn auto(&self, mcp: bool) -> bool {
        !self.plan_only && (self.approval == "all" || mcp && self.approval == "mcp")
    }

    pub async fn approve_tool(
        &self,
        mcp: bool,
        title: &str,
        details: Value,
    ) -> Result<bool, String> {
        if self.auto(mcp) {
            return Ok(true);
        }
        self.approve(title, details).await
    }

    pub async fn input(&self, title: &str, details: Value) -> Result<Value, String> {
        self.wait("input", title, details).await
    }

    async fn wait(&self, kind: &str, title: &str, details: Value) -> Result<Value, String> {
        let id = super::new_id();
        let key = format!("{}:{}:{id}", self.owner, self.id);
        let (sender, receiver) = oneshot::channel();
        self.state
            .approvals
            .lock()
            .map_err(|_| "Freigabespeicher nicht verfügbar")?
            .insert(key.clone(), sender);
        self.emit(kind, json!({"id": id, "title": title, "details": details}));
        let result = tokio::time::timeout(Duration::from_secs(600), receiver).await;
        self.state
            .approvals
            .lock()
            .map_err(|_| "Freigabespeicher nicht verfügbar")?
            .remove(&key);
        let allowed = result.ok().and_then(Result::ok).unwrap_or(json!(false));
        self.emit("approvalResolved", json!({"id": id, "allowed": allowed}));
        Ok(allowed)
    }
}

impl Drop for Run {
    fn drop(&mut self) {
        self.finish();
    }
}
