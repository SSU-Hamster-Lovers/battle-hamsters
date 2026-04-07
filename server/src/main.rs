use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok".to_string(),
        version: "0.1.0".to_string(),
    })
}

#[derive(Deserialize)]
struct UserQuery {
    username: Option<String>,
}

async fn hello(query: web::Query<UserQuery>) -> impl Responder {
    let name = query.username.as_deref().unwrap_or("World");
    HttpResponse::Ok().json(serde_json::json!({
        "message": format!("Hello, {}!", name)
    }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let api_port: u16 = std::env::var("API_PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse()
        .expect("API_PORT must be a number");

    log::info!("Starting Battle Hamsters Server on port {}", api_port);

    HttpServer::new(|| {
        App::new()
            .route("/health", web::get().to(health))
            .route("/hello", web::get().to(hello))
    })
    .bind(("0.0.0.0", api_port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, App};

    #[actix_rt::test]
    async fn test_health() {
        let app = test::init_service(
            App::new().route("/health", web::get().to(health))
        ).await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());
    }
}
