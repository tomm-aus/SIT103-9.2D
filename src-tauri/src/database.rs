use tauri::{AppHandle, Manager};
use sqlx::{Pool, Postgres, Row};
use serde::{Deserialize, Serialize};
use regex::Regex;
use once_cell::sync::Lazy;
use std::sync::Mutex;

// Base database URL without credentials
static BASE_DATABASE_URL: &str = "vultr-prod-44a7761f-10fc-493b-8699-2d7253da7113-vultr-prod-fa3d.vultrdb.com:16751/defaultdb?sslmode=require";

// Validation constants
const MAX_NAME_LENGTH: usize = 200;
const MIN_RATING: i32 = 1;
const MAX_RATING: i32 = 10;
const MAX_BATCH_DELETE_SIZE: usize = 100;

// Regex patterns for validation
static SAFE_TEXT_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"^[a-zA-Z0-9\s\.,!?\-_()':;"&]+$"#).unwrap()
});

static NAME_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^[a-zA-Z0-9\s\.,!?\-_()':;&]+$").unwrap()
});

// Login credentials struct
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseCredentials {
    pub username: String,
    pub password: String,
}

// Authentication response
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub message: String,
}

// Enum for media type
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Movie,
    Tv,
}

impl std::fmt::Display for MediaType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            MediaType::Movie => write!(f, "movie"),
            MediaType::Tv => write!(f, "tv"),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WatchListItem {
    pub id: Option<i32>,
    pub media_type: MediaType,
    #[serde(deserialize_with = "deserialize_sanitized_string")]
    pub name: String,
    pub rating: i32,
    pub would_watch_again: bool,
}

#[derive(Debug, Serialize)]
pub struct DatabaseResponse {
    pub success: bool,
    pub message: String,
    pub rows_affected: u64,
    pub data: Option<Vec<WatchListItem>>,
}

#[derive(Debug)]
pub enum ValidationError {
    EmptyField(String),
    TooLong(String, usize),
    InvalidRange(String, i32, i32, i32),
    InvalidCharacters(String),
    TooManyItems(String, usize),
    InvalidMediaType(String),
    AuthenticationRequired,
    DuplicateEntry(String, String), // media_type, name
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            ValidationError::EmptyField(field) => write!(f, "{} cannot be empty", field),
            ValidationError::TooLong(field, max) => write!(f, "{} cannot exceed {} characters", field, max),
            ValidationError::InvalidRange(field, value, min, max) =>
                write!(f, "{} value {} is invalid. Must be between {} and {}", field, value, min, max),
            ValidationError::InvalidCharacters(field) =>
                write!(f, "{} contains invalid characters. Only letters, numbers, spaces, and basic punctuation are allowed", field),
            ValidationError::TooManyItems(field, max) =>
                write!(f, "{} cannot exceed {} items", field, max),
            ValidationError::InvalidMediaType(value) =>
                write!(f, "Invalid media type: {}. Must be 'movie' or 'tv'", value),
            ValidationError::AuthenticationRequired =>
                write!(f, "Authentication required. Please login first."),
            ValidationError::DuplicateEntry(media_type, name) =>
                write!(f, "A {} with the name '{}' already exists in your watch list", media_type, name),
        }
    }
}

fn deserialize_sanitized_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    Ok(sanitize_string(&s))
}

fn sanitize_string(input: &str) -> String {
    input
        .trim()
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("&", "&amp;")
        .replace("\"", "&quot;")
        .replace("'", "&#x27;")
        .replace("/", "&#x2F;")
        .chars()
        .filter(|c| c.is_ascii() || c.is_alphabetic())
        .collect::<String>()
        .chars()
        .take(MAX_NAME_LENGTH)
        .collect()
}

fn validate_name(name: &str) -> Result<(), ValidationError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(ValidationError::EmptyField("Name".to_string()));
    }

    if trimmed.len() > MAX_NAME_LENGTH {
        return Err(ValidationError::TooLong("Name".to_string(), MAX_NAME_LENGTH));
    }

    if !NAME_PATTERN.is_match(trimmed) {
        return Err(ValidationError::InvalidCharacters("Name".to_string()));
    }

    Ok(())
}

fn validate_rating(rating: i32) -> Result<(), ValidationError> {
    if rating < MIN_RATING || rating > MAX_RATING {
        return Err(ValidationError::InvalidRange(
            "Rating".to_string(),
            rating,
            MIN_RATING,
            MAX_RATING
        ));
    }
    Ok(())
}

fn validate_ids_for_deletion(ids: &[i32]) -> Result<(), ValidationError> {
    if ids.is_empty() {
        return Err(ValidationError::EmptyField("ID list".to_string()));
    }

    if ids.len() > MAX_BATCH_DELETE_SIZE {
        return Err(ValidationError::TooManyItems("ID list".to_string(), MAX_BATCH_DELETE_SIZE));
    }

    for &id in ids {
        if id <= 0 {
            return Err(ValidationError::InvalidRange("ID".to_string(), id, 1, i32::MAX));
        }
    }

    Ok(())
}

async fn check_duplicate_exists(pool: &Pool<Postgres>, name: &str, media_type: &MediaType) -> Result<bool, sqlx::Error> {
    let query = r#"
        SELECT EXISTS(
            SELECT 1 FROM watch_list
            WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
            AND media_type = $2
        ) as exists
    "#;

    let exists: bool = sqlx::query_scalar(query)
        .bind(name)
        .bind(media_type.to_string())
        .fetch_one(pool)
        .await?;

    Ok(exists)
}

fn validate_watch_list_item(item: &WatchListItem) -> Result<(), ValidationError> {
    validate_name(&item.name)?;
    validate_rating(item.rating)?;
    Ok(())
}

// Structure for storing the database pool with authentication state
pub struct AppState {
    pub db: Mutex<Option<Pool<Postgres>>>,
    pub authenticated: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            db: Mutex::new(None),
            authenticated: Mutex::new(false),
        }
    }
}

pub async fn init(app_handle: &AppHandle) {
    println!("Initializing application state...");

    let app_state = AppState::new();
    app_handle.manage(app_state);

    println!("Application state initialized. Waiting for user authentication...");
}

fn build_database_url(username: &str, password: &str) -> String {
    format!("postgresql://{}:{}@{}", username, password, BASE_DATABASE_URL)
}

async fn create_connection(username: &str, password: &str) -> Result<Pool<Postgres>, sqlx::Error> {
    let database_url = build_database_url(username, password);

    sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .idle_timeout(std::time::Duration::from_secs(300))
        .max_lifetime(std::time::Duration::from_secs(1800))
        .connect(&database_url)
        .await
}

async fn test_connection_and_permissions(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    // Test basic connection
    sqlx::query("SELECT 1").fetch_one(pool).await?;

    // Test if watch_list table exists and is accessible
    let table_check_query = r#"
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'watch_list'
        );
    "#;

    let exists: bool = sqlx::query_scalar(table_check_query).fetch_one(pool).await?;
    if !exists {
        return Err(sqlx::Error::RowNotFound);
    }

    // Test permissions by trying to select from the table
    sqlx::query("SELECT COUNT(*) FROM watch_list").fetch_one(pool).await?;

    Ok(())
}

#[tauri::command]
pub async fn authenticate(
    state: tauri::State<'_, AppState>,
    credentials: DatabaseCredentials,
) -> Result<AuthResponse, String> {
    println!("Attempting authentication for user: {}", credentials.username);

    // Basic input validation
    if credentials.username.trim().is_empty() {
        return Ok(AuthResponse {
            success: false,
            message: "Username cannot be empty".to_string(),
        });
    }

    if credentials.password.trim().is_empty() {
        return Ok(AuthResponse {
            success: false,
            message: "Password cannot be empty".to_string(),
        });
    }

    // Attempt to create connection
    match create_connection(&credentials.username, &credentials.password).await {
        Ok(pool) => {
            // Test the connection and permissions
            match test_connection_and_permissions(&pool).await {
                Ok(_) => {
                    // Store the connection pool - use separate scope to ensure lock is dropped
                    {
                        let mut db_lock = state.db.lock().unwrap();
                        *db_lock = Some(pool);
                    }

                    // Mark as authenticated - use separate scope to ensure lock is dropped
                    {
                        let mut auth_lock = state.authenticated.lock().unwrap();
                        *auth_lock = true;
                    }

                    println!("Authentication successful for user: {}", credentials.username);
                    Ok(AuthResponse {
                        success: true,
                        message: "Authentication successful".to_string(),
                    })
                }
                Err(e) => {
                    println!("Permission test failed for user {}: {}", credentials.username, e);
                    Ok(AuthResponse {
                        success: false,
                        message: "Authentication failed: Insufficient database permissions or watch_list table not found".to_string(),
                    })
                }
            }
        }
        Err(e) => {
            println!("Connection failed for user {}: {}", credentials.username, e);
            Ok(AuthResponse {
                success: false,
                message: "Authentication failed: Invalid username or password".to_string(),
            })
        }
    }
}

#[tauri::command]
pub async fn logout(state: tauri::State<'_, AppState>) -> Result<AuthResponse, String> {
    println!("Logging out user...");

    // Close database connection - use separate scope to ensure lock is dropped before await
    let pool_to_close = {
        let mut db_lock = state.db.lock().unwrap();
        db_lock.take()
    };

    // Close the pool outside the lock
    if let Some(pool) = pool_to_close {
        pool.close().await;
    }

    // Mark as not authenticated - use separate scope to ensure lock is dropped
    {
        let mut auth_lock = state.authenticated.lock().unwrap();
        *auth_lock = false;
    }

    println!("Logout successful");
    Ok(AuthResponse {
        success: true,
        message: "Logged out successfully".to_string(),
    })
}

// Helper function to check authentication and get database pool
fn get_authenticated_pool(state: &tauri::State<AppState>) -> Result<Pool<Postgres>, ValidationError> {
    // Use separate scopes to ensure locks are dropped before returning
    let is_authenticated = {
        let auth_lock = state.authenticated.lock().unwrap();
        *auth_lock
    };

    if !is_authenticated {
        return Err(ValidationError::AuthenticationRequired);
    }

    let pool = {
        let db_lock = state.db.lock().unwrap();
        match &*db_lock {
            Some(pool) => pool.clone(),
            None => return Err(ValidationError::AuthenticationRequired),
        }
    };

    Ok(pool)
}

#[tauri::command]
pub async fn get_all_watch_items(state: tauri::State<'_, AppState>) -> Result<DatabaseResponse, String> {
    println!("Fetching all watch list items from database...");

    let pool = match get_authenticated_pool(&state) {
        Ok(pool) => pool,
        Err(e) => {
            return Ok(DatabaseResponse {
                success: false,
                message: e.to_string(),
                rows_affected: 0,
                data: None,
            });
        }
    };

    let query = r#"
        SELECT id, media_type, name, rating, would_watch_again
        FROM watch_list
        ORDER BY id
        LIMIT 1000
    "#;

    match sqlx::query(query).fetch_all(&pool).await {
        Ok(rows) => {
            let items: Vec<WatchListItem> = rows
                .iter()
                .map(|row| {
                    let media_type_str: String = row.get("media_type");
                    let media_type = match media_type_str.as_str() {
                        "movie" => MediaType::Movie,
                        "tv" => MediaType::Tv,
                        _ => MediaType::Movie,
                    };

                    WatchListItem {
                        id: Some(row.get("id")),
                        media_type,
                        name: sanitize_string(&row.get::<String, _>("name")),
                        rating: row.get("rating"),
                        would_watch_again: row.get("would_watch_again"),
                    }
                })
                .collect();

            println!("Successfully retrieved {} watch list items", items.len());

            Ok(DatabaseResponse {
                success: true,
                message: format!("Retrieved {} items successfully", items.len()),
                rows_affected: items.len() as u64,
                data: Some(items),
            })
        }
        Err(e) => {
            eprintln!("Failed to retrieve watch list items: {}", e);
            Ok(DatabaseResponse {
                success: false,
                message: "Failed to retrieve watch list items from database".to_string(),
                rows_affected: 0,
                data: None,
            })
        }
    }
}

#[tauri::command]
pub async fn insert_watch_item(
    state: tauri::State<'_, AppState>,
    item: WatchListItem,
) -> Result<DatabaseResponse, String> {
    println!("Inserting new watch list item: '{}' ({}) with rating: {}",
             item.name, item.media_type, item.rating);

    let pool = match get_authenticated_pool(&state) {
        Ok(pool) => pool,
        Err(e) => {
            return Ok(DatabaseResponse {
                success: false,
                message: e.to_string(),
                rows_affected: 0,
                data: None,
            });
        }
    };

    if let Err(validation_error) = validate_watch_list_item(&item) {
        println!("Validation failed: {}", validation_error);
        return Ok(DatabaseResponse {
            success: false,
            message: validation_error.to_string(),
            rows_affected: 0,
            data: None,
        });
    }

    if item.rating < MIN_RATING || item.rating > MAX_RATING {
        println!("Rating validation failed: {} is not between {} and {}",
                 item.rating, MIN_RATING, MAX_RATING);
        return Ok(DatabaseResponse {
            success: false,
            message: format!("Rating must be between {} and {}", MIN_RATING, MAX_RATING),
            rows_affected: 0,
            data: None,
        });
    }

    let sanitized_name = sanitize_string(&item.name);

    if sanitized_name.trim().is_empty() {
        println!("Sanitized name is empty");
        return Ok(DatabaseResponse {
            success: false,
            message: "Name cannot be empty".to_string(),
            rows_affected: 0,
            data: None,
        });
    }

    // Check for duplicate entries
    match check_duplicate_exists(&pool, &sanitized_name, &item.media_type).await {
        Ok(exists) => {
            if exists {
                let media_type_label = match item.media_type {
                    MediaType::Movie => "movie",
                    MediaType::Tv => "TV show",
                };
                let error = ValidationError::DuplicateEntry(media_type_label.to_string(), sanitized_name);
                println!("Duplicate check failed: {}", error);
                return Ok(DatabaseResponse {
                    success: false,
                    message: error.to_string(),
                    rows_affected: 0,
                    data: None,
                });
            }
        }
        Err(e) => {
            eprintln!("Failed to check for duplicates: {}", e);
            return Ok(DatabaseResponse {
                success: false,
                message: "Failed to verify uniqueness. Please try again.".to_string(),
                rows_affected: 0,
                data: None,
            });
        }
    }

    let query = r#"
        INSERT INTO watch_list (media_type, name, rating, would_watch_again)
        VALUES ($1, $2, $3, $4)
    "#;

    match sqlx::query(query)
        .bind(item.media_type.to_string())
        .bind(&sanitized_name)
        .bind(item.rating)
        .bind(item.would_watch_again)
        .execute(&pool)
        .await
    {
        Ok(result) => {
            let rows_affected = result.rows_affected();
            println!("Successfully inserted watch list item, rows affected: {}", rows_affected);
            Ok(DatabaseResponse {
                success: true,
                message: "Item added to watch list successfully".to_string(),
                rows_affected,
                data: None,
            })
        }
        Err(e) => {
            eprintln!("Failed to insert watch list item: {}", e);

            let error_message = if e.to_string().contains("permission denied") {
                "Database permission error: Insufficient privileges to insert data.".to_string()
            } else if e.to_string().contains("connection") {
                "Database connection error: Unable to connect to database.".to_string()
            } else {
                "Failed to add item to watch list.".to_string()
            };

            Ok(DatabaseResponse {
                success: false,
                message: error_message,
                rows_affected: 0,
                data: None,
            })
        }
    }
}

#[tauri::command]
pub async fn delete_watch_items(
    state: tauri::State<'_, AppState>,
    ids: Vec<i32>,
) -> Result<DatabaseResponse, String> {
    println!("Deleting watch list items with IDs: {:?}", ids);

    let pool = match get_authenticated_pool(&state) {
        Ok(pool) => pool,
        Err(e) => {
            return Ok(DatabaseResponse {
                success: false,
                message: e.to_string(),
                rows_affected: 0,
                data: None,
            });
        }
    };

    if let Err(validation_error) = validate_ids_for_deletion(&ids) {
        println!("Validation failed: {}", validation_error);
        return Ok(DatabaseResponse {
            success: false,
            message: validation_error.to_string(),
            rows_affected: 0,
            data: None,
        });
    }

    let mut unique_ids = ids;
    unique_ids.sort_unstable();
    unique_ids.dedup();

    let placeholders: Vec<String> = (1..=unique_ids.len()).map(|i| format!("${}", i)).collect();
    let query = format!(
        "DELETE FROM watch_list WHERE id IN ({})",
        placeholders.join(", ")
    );

    let mut query_builder = sqlx::query(&query);
    for id in &unique_ids {
        query_builder = query_builder.bind(id);
    }

    match query_builder.execute(&pool).await {
        Ok(result) => {
            let rows_affected = result.rows_affected();
            println!("Successfully deleted {} watch list item(s)", rows_affected);

            Ok(DatabaseResponse {
                success: true,
                message: format!("Successfully deleted {} item(s)", rows_affected),
                rows_affected,
                data: None,
            })
        }
        Err(e) => {
            eprintln!("Failed to delete watch list items: {}", e);
            Ok(DatabaseResponse {
                success: false,
                message: "Failed to delete items from watch list".to_string(),
                rows_affected: 0,
                data: None,
            })
        }
    }
}