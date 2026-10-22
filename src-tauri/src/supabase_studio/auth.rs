use super::like_pattern;
use crate::supabase::{
    client, cloud_ref, database_execute, database_query, is_self_hosted, management_get,
    project_api_auth, project_secret_key, project_url, token, uses_pg_meta, validate_ref,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const PAGE_SIZE: u32 = 50;
const MAX_PAGE: u32 = 10_000;
const LINK_TYPES: [&str; 6] = [
    "signup",
    "invite",
    "magiclink",
    "recovery",
    "email_change_current",
    "email_change_new",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct SupabaseStudioAuthUser {
    pub id: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub created_at: Option<String>,
    pub last_sign_in_at: Option<String>,
    pub email_confirmed_at: Option<String>,
    pub phone_confirmed_at: Option<String>,
    pub is_anonymous: Option<bool>,
    pub banned_until: Option<String>,
    #[serde(default)]
    pub providers: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupabaseStudioAuthUsersPage {
    pub users: Vec<SupabaseStudioAuthUser>,
    pub has_more: bool,
    pub total: Option<u64>,
    pub server_side: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct SupabaseStudioAuthUserAttributes {
    pub email: Option<String>,
    pub phone: Option<String>,
    pub password: Option<String>,
    pub email_confirm: Option<bool>,
    pub phone_confirm: Option<bool>,
    pub user_metadata: Option<Value>,
    pub app_metadata: Option<Value>,
    pub ban_duration: Option<String>,
    pub role: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseStudioAuthLink {
    pub action_link: Option<String>,
    pub email_otp: Option<String>,
    pub hashed_token: Option<String>,
    pub verification_type: Option<String>,
    pub redirect_to: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupabaseStudioAuthSignOut {
    pub sessions: i64,
    pub refresh_tokens: i64,
}

fn validate_uuid(id: &str) -> Result<&str, String> {
    if id.len() != 36
        || !id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("Ungültige ID.".into());
    }
    Ok(id)
}

fn validate_email(email: &str) -> Result<&str, String> {
    let email = email.trim();
    if email.is_empty()
        || email.len() > 320
        || email.contains(char::is_whitespace)
        || !email.contains('@')
    {
        return Err("Ungültige E-Mail-Adresse.".into());
    }
    Ok(email)
}

fn validate_phone(phone: &str) -> Result<String, String> {
    let phone = phone
        .trim()
        .chars()
        .filter(|character| !matches!(character, ' ' | '-' | '(' | ')'))
        .collect::<String>();
    let digits = phone.strip_prefix('+').unwrap_or(&phone);
    if digits.len() < 5 || digits.len() > 20 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Ungültige Telefonnummer.".into());
    }
    Ok(phone)
}

fn validate_ban_duration(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value == "none" {
        return Ok(value);
    }
    let invalid = || "Ungültige Sperrdauer, erwartet z. B. 24h, 30m oder none.".to_string();
    if value.is_empty() || value.len() > 32 {
        return Err(invalid());
    }
    let mut rest = value;
    while !rest.is_empty() {
        let number = rest
            .find(|character: char| !character.is_ascii_digit() && character != '.')
            .ok_or_else(invalid)?;
        if number == 0 || rest[..number].parse::<f64>().is_err() {
            return Err(invalid());
        }
        rest = &rest[number..];
        let unit = ["ns", "us", "ms", "s", "m", "h"]
            .into_iter()
            .filter(|unit| rest.starts_with(unit))
            .max_by_key(|unit| unit.len())
            .ok_or_else(invalid)?;
        rest = &rest[unit.len()..];
    }
    Ok(value)
}

fn metadata_object(value: &Value, label: &str) -> Result<Value, String> {
    if !value.is_object() {
        return Err(format!("{label} muss ein JSON-Objekt sein."));
    }
    if value.to_string().len() > 64 * 1024 {
        return Err(format!("{label} ist zu groß."));
    }
    Ok(value.clone())
}

fn attributes_body(
    attributes: &SupabaseStudioAuthUserAttributes,
    create: bool,
) -> Result<Value, String> {
    let mut body = Map::new();
    if let Some(email) = attributes
        .email
        .as_deref()
        .filter(|email| !email.trim().is_empty())
    {
        body.insert("email".into(), json!(validate_email(email)?));
    }
    if let Some(phone) = attributes
        .phone
        .as_deref()
        .filter(|phone| !phone.trim().is_empty())
    {
        body.insert("phone".into(), json!(validate_phone(phone)?));
    }
    if let Some(password) = attributes
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
    {
        if password.len() < 6 || password.len() > 1024 {
            return Err("Passwort muss zwischen 6 und 1024 Zeichen lang sein.".into());
        }
        body.insert("password".into(), json!(password));
    }
    if let Some(confirm) = attributes.email_confirm {
        body.insert("email_confirm".into(), json!(confirm));
    }
    if let Some(confirm) = attributes.phone_confirm {
        body.insert("phone_confirm".into(), json!(confirm));
    }
    if let Some(metadata) = &attributes.user_metadata {
        body.insert(
            "user_metadata".into(),
            metadata_object(metadata, "user_metadata")?,
        );
    }
    if let Some(metadata) = &attributes.app_metadata {
        body.insert(
            "app_metadata".into(),
            metadata_object(metadata, "app_metadata")?,
        );
    }
    if let Some(duration) = attributes.ban_duration.as_deref() {
        body.insert(
            "ban_duration".into(),
            json!(validate_ban_duration(duration)?),
        );
    }
    if let Some(role) = attributes.role.as_deref().filter(|role| !role.is_empty()) {
        if role.len() > 63
            || !role
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err("Ungültige Rolle.".into());
        }
        body.insert("role".into(), json!(role));
    }
    if create && !body.contains_key("email") && !body.contains_key("phone") {
        return Err("E-Mail-Adresse oder Telefonnummer wird benötigt.".into());
    }
    if body.is_empty() {
        return Err("Keine Änderungen angegeben.".into());
    }
    Ok(Value::Object(body))
}

fn filter_sql(filter: &str) -> Result<&'static str, String> {
    Ok(match filter {
        "all" => "true",
        "confirmed" => "(u.email_confirmed_at is not null or u.phone_confirmed_at is not null)",
        "unconfirmed" => "(u.email_confirmed_at is null and u.phone_confirmed_at is null)",
        "anonymous" => "coalesce(u.is_anonymous, false)",
        "banned" => "(u.banned_until is not null and u.banned_until > now())",
        _ => return Err("Ungültiger Filter.".into()),
    })
}

fn sort_sql(sort: &str) -> Result<&'static str, String> {
    Ok(match sort {
        "created_desc" => "u.created_at desc nulls last, u.id",
        "created_asc" => "u.created_at asc nulls last, u.id",
        "last_sign_in_desc" => "u.last_sign_in_at desc nulls last, u.id",
        "last_sign_in_asc" => "u.last_sign_in_at asc nulls last, u.id",
        "email_asc" => "u.email asc nulls last, u.id",
        _ => return Err("Ungültige Sortierung.".into()),
    })
}

fn users_sql(
    search: &str,
    filter: &str,
    sort: &str,
    page: u32,
) -> Result<(String, Vec<Value>), String> {
    let mut conditions = vec![filter_sql(filter)?.to_string()];
    let mut parameters = Vec::new();
    let search = search.trim();
    if !search.is_empty() {
        parameters.push(json!(search));
        parameters.push(json!(like_pattern(search)));
        conditions.push(
            "(u.id::text = $1 or u.email ilike $2 or u.phone ilike $2 or u.raw_user_meta_data->>'full_name' ilike $2)"
                .into(),
        );
    }
    let offset = (page - 1) * PAGE_SIZE;
    Ok((
        format!(
            "select u.id::text as id, u.email, u.phone, u.created_at, u.last_sign_in_at, u.email_confirmed_at, u.phone_confirmed_at, u.is_anonymous, u.banned_until, coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) as providers from auth.users u where {} order by {} limit {} offset {offset}",
            conditions.join(" and "),
            sort_sql(sort)?,
            PAGE_SIZE + 1,
        ),
        parameters,
    ))
}

fn string_field(user: &Value, key: &str) -> Option<String> {
    user[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn api_user(user: &Value) -> SupabaseStudioAuthUser {
    SupabaseStudioAuthUser {
        id: user["id"].as_str().unwrap_or_default().to_string(),
        email: string_field(user, "email"),
        phone: string_field(user, "phone"),
        created_at: string_field(user, "created_at"),
        last_sign_in_at: string_field(user, "last_sign_in_at"),
        email_confirmed_at: string_field(user, "email_confirmed_at"),
        phone_confirmed_at: string_field(user, "phone_confirmed_at"),
        is_anonymous: user["is_anonymous"].as_bool(),
        banned_until: string_field(user, "banned_until"),
        providers: user["app_metadata"]["providers"]
            .as_array()
            .map(|providers| {
                providers
                    .iter()
                    .filter_map(|provider| provider.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn is_banned(user: &SupabaseStudioAuthUser, now: chrono::DateTime<chrono::Utc>) -> bool {
    user.banned_until
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|until| until > now)
}

fn apply_page_filter(
    users: &mut Vec<SupabaseStudioAuthUser>,
    filter: &str,
    sort: &str,
) -> Result<(), String> {
    filter_sql(filter)?;
    sort_sql(sort)?;
    let now = chrono::Utc::now();
    users.retain(|user| {
        let confirmed = user.email_confirmed_at.is_some() || user.phone_confirmed_at.is_some();
        match filter {
            "confirmed" => confirmed,
            "unconfirmed" => !confirmed,
            "anonymous" => user.is_anonymous == Some(true),
            "banned" => is_banned(user, now),
            _ => true,
        }
    });
    match sort {
        "last_sign_in_desc" => users.sort_by(|a, b| b.last_sign_in_at.cmp(&a.last_sign_in_at)),
        "last_sign_in_asc" => users.sort_by(|a, b| a.last_sign_in_at.cmp(&b.last_sign_in_at)),
        "email_asc" => users.sort_by(|a, b| a.email.cmp(&b.email)),
        _ => {}
    }
    Ok(())
}

async fn sql_available(reference: &str) -> Result<bool, String> {
    Ok(uses_pg_meta(reference).await? && (is_self_hosted(reference) || token().await.is_ok()))
}

async fn auth_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| "Supabase Auth hat unerwartete Daten geliefert.".to_string())?;
    if !status.is_success() {
        let body = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
        let message = ["msg", "message", "error_description", "error"]
            .into_iter()
            .find_map(|key| body[key].as_str())
            .unwrap_or("Anfrage fehlgeschlagen.")
            .chars()
            .take(300)
            .collect::<String>();
        return Err(format!("Supabase Auth HTTP {}: {message}", status.as_u16()));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text)
        .map_err(|_| "Supabase Auth hat unerwartete Daten geliefert.".to_string())
}

async fn auth_request(
    reference: &str,
    method: reqwest::Method,
    path: &str,
    query: &[(&str, String)],
    body: Option<Value>,
) -> Result<(Value, reqwest::header::HeaderMap), String> {
    let key = project_secret_key(reference).await?;
    let mut request = project_api_auth(
        client().request(method, project_url(reference, path).await?),
        &key,
    );
    if !query.is_empty() {
        request = request.query(query);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Supabase Auth ist nicht erreichbar: {error}"))?;
    let headers = response.headers().clone();
    Ok((auth_response(response).await?, headers))
}

async fn auth_call(
    reference: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    Ok(auth_request(reference, method, path, &[], body).await?.0)
}

#[tauri::command]
pub async fn supabase_studio_auth_users(
    reference: String,
    page: u32,
    search: String,
    filter: String,
    sort: String,
) -> Result<SupabaseStudioAuthUsersPage, String> {
    let reference = validate_ref(&reference)?;
    if page == 0 || page > MAX_PAGE {
        return Err("Ungültige Seitennummer.".into());
    }
    if search.len() > 320 {
        return Err("Suchbegriff ist zu lang.".into());
    }
    if sql_available(reference).await? {
        let (query, parameters) = users_sql(&search, &filter, &sort, page)?;
        let mut users =
            database_query::<SupabaseStudioAuthUser>(reference, &query, &parameters).await?;
        let has_more = users.len() > PAGE_SIZE as usize;
        users.truncate(PAGE_SIZE as usize);
        return Ok(SupabaseStudioAuthUsersPage {
            users,
            has_more,
            total: None,
            server_side: true,
        });
    }
    let mut query = vec![
        ("page", page.to_string()),
        ("per_page", PAGE_SIZE.to_string()),
        (
            "sort",
            if sort == "created_asc" {
                "created_at asc"
            } else {
                "created_at desc"
            }
            .to_string(),
        ),
    ];
    if !search.trim().is_empty() {
        query.push(("filter", search.trim().to_string()));
    }
    let (body, headers) = auth_request(
        reference,
        reqwest::Method::GET,
        "auth/v1/admin/users",
        &query,
        None,
    )
    .await?;
    let total = headers
        .get("x-total-count")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let raw = body["users"].as_array().cloned().unwrap_or_default();
    let has_more = total.map_or(raw.len() == PAGE_SIZE as usize, |total| {
        u64::from(page) * u64::from(PAGE_SIZE) < total
    });
    let mut users = raw.iter().map(api_user).collect::<Vec<_>>();
    apply_page_filter(&mut users, &filter, &sort)?;
    Ok(SupabaseStudioAuthUsersPage {
        users,
        has_more,
        total,
        server_side: false,
    })
}

#[tauri::command]
pub async fn supabase_studio_auth_user(
    reference: String,
    user_id: String,
) -> Result<Value, String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_uuid(&user_id)?;
    auth_call(
        reference,
        reqwest::Method::GET,
        &format!("auth/v1/admin/users/{user_id}"),
        None,
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_auth_create_user(
    reference: String,
    attributes: SupabaseStudioAuthUserAttributes,
) -> Result<Value, String> {
    let reference = validate_ref(&reference)?;
    let body = attributes_body(&attributes, true)?;
    auth_call(
        reference,
        reqwest::Method::POST,
        "auth/v1/admin/users",
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_auth_update_user(
    reference: String,
    user_id: String,
    attributes: SupabaseStudioAuthUserAttributes,
) -> Result<Value, String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_uuid(&user_id)?;
    let body = attributes_body(&attributes, false)?;
    auth_call(
        reference,
        reqwest::Method::PUT,
        &format!("auth/v1/admin/users/{user_id}"),
        Some(body),
    )
    .await
}

#[tauri::command]
pub async fn supabase_studio_auth_soft_delete_user(
    reference: String,
    user_id: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_uuid(&user_id)?;
    auth_call(
        reference,
        reqwest::Method::DELETE,
        &format!("auth/v1/admin/users/{user_id}"),
        Some(json!({"should_soft_delete": true})),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_auth_invite(
    reference: String,
    email: String,
    redirect_to: String,
    data: Option<Value>,
) -> Result<Value, String> {
    let reference = validate_ref(&reference)?;
    let mut body = json!({"email": validate_email(&email)?});
    if let Some(data) = &data {
        body["data"] = metadata_object(data, "data")?;
    }
    let mut query = Vec::new();
    if !redirect_to.trim().is_empty() {
        query.push(("redirect_to", validate_redirect(&redirect_to)?.to_string()));
    }
    Ok(auth_request(
        reference,
        reqwest::Method::POST,
        "auth/v1/invite",
        &query,
        Some(body),
    )
    .await?
    .0)
}

fn validate_redirect(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.len() > 2048 || reqwest::Url::parse(value).is_err() {
        return Err("Ungültige Weiterleitungs-URL.".into());
    }
    Ok(value)
}

fn link_body(
    kind: &str,
    email: &str,
    new_email: &str,
    password: &str,
    redirect_to: &str,
    data: Option<&Value>,
) -> Result<Value, String> {
    if !LINK_TYPES.contains(&kind) {
        return Err("Ungültiger Link-Typ.".into());
    }
    let mut body = json!({"type": kind, "email": validate_email(email)?});
    if kind.starts_with("email_change") {
        body["new_email"] = json!(validate_email(new_email)?);
    }
    if kind == "signup" {
        if password.len() < 6 || password.len() > 1024 {
            return Err("Passwort muss zwischen 6 und 1024 Zeichen lang sein.".into());
        }
        body["password"] = json!(password);
    }
    if !redirect_to.trim().is_empty() {
        body["redirect_to"] = json!(validate_redirect(redirect_to)?);
    }
    if let Some(data) = data {
        if matches!(kind, "signup" | "invite") {
            body["data"] = metadata_object(data, "data")?;
        }
    }
    Ok(body)
}

#[tauri::command]
pub async fn supabase_studio_auth_generate_link(
    reference: String,
    kind: String,
    email: String,
    new_email: String,
    password: String,
    redirect_to: String,
    data: Option<Value>,
) -> Result<SupabaseStudioAuthLink, String> {
    let reference = validate_ref(&reference)?;
    let body = link_body(
        &kind,
        &email,
        &new_email,
        &password,
        &redirect_to,
        data.as_ref(),
    )?;
    let response = auth_call(
        reference,
        reqwest::Method::POST,
        "auth/v1/admin/generate_link",
        Some(body),
    )
    .await?;
    let source = if response["action_link"].is_string() {
        &response
    } else {
        &response["properties"]
    };
    serde_json::from_value(source.clone())
        .map_err(|_| "Supabase Auth hat unerwartete Daten geliefert.".to_string())
}

#[tauri::command]
pub async fn supabase_studio_auth_sign_out_user(
    reference: String,
    user_id: String,
) -> Result<SupabaseStudioAuthSignOut, String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_uuid(&user_id)?;
    if !sql_available(reference).await? {
        return Err("Alle Sitzungen beenden benötigt SQL-Zugriff.".into());
    }
    let rows = database_execute(
        reference,
        "with s as (delete from auth.sessions where user_id::text = $1 returning 1), r as (delete from auth.refresh_tokens where user_id::text = $1 returning 1) select (select count(*) from s)::int as sessions, (select count(*) from r)::int as refresh_tokens",
        &[json!(user_id)],
    )
    .await?;
    rows.into_iter()
        .next()
        .and_then(|row| serde_json::from_value(row).ok())
        .ok_or_else(|| "Supabase hat unerwartete Daten geliefert.".to_string())
}

#[tauri::command]
pub async fn supabase_studio_auth_delete_factor(
    reference: String,
    user_id: String,
    factor_id: String,
) -> Result<(), String> {
    let reference = validate_ref(&reference)?;
    let user_id = validate_uuid(&user_id)?;
    let factor_id = validate_uuid(&factor_id)?;
    auth_call(
        reference,
        reqwest::Method::DELETE,
        &format!("auth/v1/admin/users/{user_id}/factors/{factor_id}"),
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_auth_settings(reference: String) -> Result<Value, String> {
    let reference = validate_ref(&reference)?;
    auth_call(reference, reqwest::Method::GET, "auth/v1/settings", None).await
}

#[tauri::command]
pub async fn supabase_studio_auth_config(reference: String) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    management_get(
        &token().await?,
        &format!("projects/{reference}/config/auth"),
    )
    .await
}

fn validate_config_patch(patch: &Map<String, Value>) -> Result<(), String> {
    if patch.is_empty() {
        return Err("Keine Änderungen angegeben.".into());
    }
    if patch.len() > 500 {
        return Err("Zu viele Änderungen auf einmal.".into());
    }
    for (key, value) in patch {
        if key.is_empty()
            || key.len() > 80
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err(format!("Ungültiger Konfigurationsschlüssel: {key}"));
        }
        if value.is_array() || value.is_object() {
            return Err(format!("Ungültiger Wert für {key}."));
        }
        if value.as_str().is_some_and(|text| text.len() > 16 * 1024) {
            return Err(format!("Wert für {key} ist zu lang."));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn supabase_studio_auth_update_config(
    reference: String,
    patch: Map<String, Value>,
) -> Result<Value, String> {
    let reference = cloud_ref(&reference)?;
    validate_config_patch(&patch)?;
    let response = client()
        .patch(format!(
            "https://api.supabase.com/v1/projects/{reference}/config/auth"
        ))
        .bearer_auth(token().await?)
        .json(&patch)
        .send()
        .await
        .map_err(|error| format!("Supabase ist nicht erreichbar: {error}"))?;
    auth_response(response).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_list_sql_is_bounded_and_parameterized() {
        let (query, parameters) =
            users_sql("a%b'; drop", "banned", "last_sign_in_desc", 3).unwrap();
        assert!(query.contains("limit 51 offset 100"));
        assert!(query.contains("banned_until > now()"));
        assert!(query.contains("last_sign_in_at desc"));
        assert!(!query.contains("drop"));
        assert_eq!(parameters[1], json!("%a\\%b'; drop%"));
        let (query, parameters) = users_sql(" ", "all", "created_desc", 1).unwrap();
        assert!(parameters.is_empty());
        assert!(!query.contains("$1"));
        assert!(users_sql("", "x", "created_desc", 1).is_err());
        assert!(users_sql("", "all", "id; drop", 1).is_err());
    }

    #[test]
    fn ban_duration_accepts_go_durations_only() {
        for value in ["none", "24h", "1h30m", "876000h", "1.5h", "100ms"] {
            assert!(validate_ban_duration(value).is_ok(), "{value}");
        }
        for value in ["", "h", "24", "24x", "-1h", "1h;", "24 h"] {
            assert!(validate_ban_duration(value).is_err(), "{value}");
        }
    }

    #[test]
    fn attributes_are_validated() {
        let create = SupabaseStudioAuthUserAttributes {
            password: Some("secret1".into()),
            ..Default::default()
        };
        assert!(attributes_body(&create, true).is_err());
        assert!(attributes_body(&SupabaseStudioAuthUserAttributes::default(), false).is_err());
        let body = attributes_body(
            &SupabaseStudioAuthUserAttributes {
                phone: Some("+49 (151) 123-456".into()),
                user_metadata: Some(json!({"name": "A"})),
                ban_duration: Some("none".into()),
                ..Default::default()
            },
            true,
        )
        .unwrap();
        assert_eq!(body["phone"], json!("+49151123456"));
        assert_eq!(body["ban_duration"], json!("none"));
        for invalid in [
            SupabaseStudioAuthUserAttributes {
                email: Some("no mail".into()),
                ..Default::default()
            },
            SupabaseStudioAuthUserAttributes {
                password: Some("123".into()),
                ..Default::default()
            },
            SupabaseStudioAuthUserAttributes {
                app_metadata: Some(json!([1])),
                ..Default::default()
            },
            SupabaseStudioAuthUserAttributes {
                role: Some("x; drop".into()),
                ..Default::default()
            },
        ] {
            assert!(attributes_body(&invalid, false).is_err());
        }
    }

    #[test]
    fn link_and_config_inputs_are_validated() {
        assert!(link_body("magiclink", "a@b.c", "", "", "", None).is_ok());
        assert!(link_body("signup", "a@b.c", "", "", "", None).is_err());
        assert!(link_body("email_change_new", "a@b.c", "bad", "", "", None).is_err());
        assert!(link_body("other", "a@b.c", "", "", "", None).is_err());
        assert!(link_body("recovery", "a@b.c", "", "", "not a url", None).is_err());
        assert!(validate_uuid("12345678-1234-1234-1234-123456789abc").is_ok());
        assert!(validate_uuid("../../settings/aaaaaaaaaaaaaaaaaaaaaaaaaaa").is_err());
        let mut patch = Map::new();
        assert!(validate_config_patch(&patch).is_err());
        patch.insert("site_url".into(), json!("https://x"));
        patch.insert("jwt_exp".into(), json!(3600));
        assert!(validate_config_patch(&patch).is_ok());
        patch.insert("Bad-Key".into(), json!(true));
        assert!(validate_config_patch(&patch).is_err());
        patch.remove("Bad-Key");
        patch.insert("nested".into(), json!({"a": 1}));
        assert!(validate_config_patch(&patch).is_err());
    }

    #[test]
    fn page_filter_applies_status_and_sort() {
        let user = |id: &str, confirmed: bool, banned: Option<&str>, sign_in: Option<&str>| {
            SupabaseStudioAuthUser {
                id: id.into(),
                email: Some(format!("{id}@x.y")),
                phone: None,
                created_at: None,
                last_sign_in_at: sign_in.map(str::to_string),
                email_confirmed_at: confirmed.then(|| "2026-01-01T00:00:00Z".into()),
                phone_confirmed_at: None,
                is_anonymous: Some(false),
                banned_until: banned.map(str::to_string),
                providers: vec![],
            }
        };
        let all = vec![
            user("a", true, None, Some("2026-01-01T00:00:00Z")),
            user(
                "b",
                false,
                Some("2999-01-01T00:00:00Z"),
                Some("2026-02-01T00:00:00Z"),
            ),
            user("c", false, Some("2000-01-01T00:00:00Z"), None),
        ];
        let mut banned = all.clone();
        apply_page_filter(&mut banned, "banned", "created_desc").unwrap();
        assert_eq!(banned.len(), 1);
        assert_eq!(banned[0].id, "b");
        let mut unconfirmed = all.clone();
        apply_page_filter(&mut unconfirmed, "unconfirmed", "last_sign_in_desc").unwrap();
        assert_eq!(unconfirmed[0].id, "b");
        assert!(apply_page_filter(&mut all.clone(), "x", "created_desc").is_err());
        let parsed = api_user(&json!({
            "id": "u", "email": "", "app_metadata": {"providers": ["email", "github"]}
        }));
        assert_eq!(parsed.email, None);
        assert_eq!(parsed.providers, vec!["email", "github"]);
    }

    #[tokio::test]
    #[ignore]
    async fn supabase_studio_auth_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_SUPABASE_URL"), env("L8DB_E2E_SUPABASE_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let reference =
            crate::supabase::supabase_connect_self_hosted(url.clone(), key.clone(), "Auth".into())
                .await
                .unwrap()
                .reference;
        let suffix = std::process::id();
        let email = format!("l8db-auth-{suffix}@example.com");

        let created = supabase_studio_auth_create_user(
            reference.clone(),
            SupabaseStudioAuthUserAttributes {
                email: Some(email.clone()),
                password: Some("l8db-secret-1".into()),
                email_confirm: Some(true),
                user_metadata: Some(json!({"full_name": "L8db Auth"})),
                app_metadata: Some(json!({"plan": "pro"})),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let user_id = created["id"].as_str().unwrap().to_string();
        let phone_user = supabase_studio_auth_create_user(
            reference.clone(),
            SupabaseStudioAuthUserAttributes {
                phone: Some(format!("+4915{suffix:09}")),
                password: Some("l8db-secret-1".into()),
                phone_confirm: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let phone_id = phone_user["id"].as_str().unwrap().to_string();

        let page = supabase_studio_auth_users(
            reference.clone(),
            1,
            email.clone(),
            "confirmed".into(),
            "created_desc".into(),
        )
        .await
        .unwrap();
        assert!(page.server_side);
        assert_eq!(page.users.len(), 1);
        assert_eq!(page.users[0].id, user_id);
        assert_eq!(page.users[0].providers, vec!["email"]);
        let by_id = supabase_studio_auth_users(
            reference.clone(),
            1,
            user_id.clone(),
            "all".into(),
            "last_sign_in_desc".into(),
        )
        .await
        .unwrap();
        assert_eq!(by_id.users.len(), 1);

        let detail = supabase_studio_auth_user(reference.clone(), user_id.clone())
            .await
            .unwrap();
        assert_eq!(detail["app_metadata"]["plan"], json!("pro"));
        assert_eq!(detail["user_metadata"]["full_name"], json!("L8db Auth"));

        let updated = supabase_studio_auth_update_user(
            reference.clone(),
            user_id.clone(),
            SupabaseStudioAuthUserAttributes {
                user_metadata: Some(json!({"full_name": "Changed"})),
                ban_duration: Some("24h".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(updated["user_metadata"]["full_name"], json!("Changed"));
        let banned = supabase_studio_auth_users(
            reference.clone(),
            1,
            email.clone(),
            "banned".into(),
            "email_asc".into(),
        )
        .await
        .unwrap();
        assert_eq!(banned.users.len(), 1);
        supabase_studio_auth_update_user(
            reference.clone(),
            user_id.clone(),
            SupabaseStudioAuthUserAttributes {
                ban_duration: Some("none".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let link = supabase_studio_auth_generate_link(
            reference.clone(),
            "magiclink".into(),
            email.clone(),
            String::new(),
            String::new(),
            String::new(),
            None,
        )
        .await
        .unwrap();
        assert!(link.action_link.unwrap().contains("token="));
        let recovery = supabase_studio_auth_generate_link(
            reference.clone(),
            "recovery".into(),
            email.clone(),
            String::new(),
            String::new(),
            String::new(),
            None,
        )
        .await
        .unwrap();
        assert!(recovery.hashed_token.is_some());

        let signed_out = supabase_studio_auth_sign_out_user(reference.clone(), user_id.clone())
            .await
            .unwrap();
        assert!(signed_out.sessions >= 0);
        assert!(supabase_studio_auth_delete_factor(
            reference.clone(),
            user_id.clone(),
            "00000000-0000-0000-0000-000000000000".into(),
        )
        .await
        .is_err());

        let settings = supabase_studio_auth_settings(reference.clone())
            .await
            .unwrap();
        assert!(settings["external"]["email"].is_boolean());
        assert!(supabase_studio_auth_config(reference.clone())
            .await
            .is_err());

        let invite_email = format!("l8db-invite-{suffix}@example.com");
        let invite = supabase_studio_auth_invite(
            reference.clone(),
            invite_email.clone(),
            String::new(),
            Some(json!({"source": "l8db"})),
        )
        .await;
        let invited_id = match &invite {
            Ok(user) => user["id"].as_str().map(str::to_string),
            Err(error) => {
                assert!(error.contains("Supabase Auth HTTP"), "{error}");
                None
            }
        };

        latency("supabase studio auth users", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_auth_users(
                    reference,
                    1,
                    String::new(),
                    "all".into(),
                    "created_desc".into(),
                )
                .await
                .unwrap();
            }
        })
        .await;
        latency("supabase studio auth search", 500, || {
            let (reference, email) = (reference.clone(), email.clone());
            async move {
                supabase_studio_auth_users(
                    reference,
                    1,
                    email,
                    "unconfirmed".into(),
                    "last_sign_in_asc".into(),
                )
                .await
                .unwrap();
            }
        })
        .await;
        latency("supabase studio auth user detail", 500, || {
            let (reference, user_id) = (reference.clone(), user_id.clone());
            async move {
                supabase_studio_auth_user(reference, user_id).await.unwrap();
            }
        })
        .await;
        latency("supabase studio auth settings", 500, || {
            let reference = reference.clone();
            async move {
                supabase_studio_auth_settings(reference).await.unwrap();
            }
        })
        .await;

        supabase_studio_auth_soft_delete_user(reference.clone(), phone_id.clone())
            .await
            .unwrap();
        crate::supabase::supabase_delete_auth_user(reference.clone(), user_id.clone())
            .await
            .unwrap();
        if let Some(invited_id) = invited_id {
            crate::supabase::supabase_delete_auth_user(reference.clone(), invited_id)
                .await
                .unwrap();
        }
        crate::baas_self_hosted_live_tests::pg_query(
            &url,
            &key,
            &format!("delete from auth.users where id = '{phone_id}'"),
        )
        .await;
        assert!(supabase_studio_auth_user(reference.clone(), user_id)
            .await
            .is_err());
        crate::supabase::supabase_disconnect_self_hosted(reference)
            .await
            .unwrap();
    }
}
