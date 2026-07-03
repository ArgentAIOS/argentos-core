use argentd::server::{bind_listener, resolve_bind_addr, resolve_expected_token, serve};
use std::env;
use std::process;
use std::time::Instant;

fn main() {
    let bind_addr = resolve_bind_addr();
    let listener = match bind_listener(&bind_addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("argentd failed to bind {}: {}", bind_addr, error);
            process::exit(1);
        }
    };

    println!(
        "argentd shadow gateway listening on http://{} (health=/health, connect=/v1/connect)",
        bind_addr
    );
    let started_at = Instant::now();
    let expected_token = resolve_expected_token();
    // Fail closed: an empty token means argentd would accept ANY token (ws.rs only
    // rejects on mismatch when the expected token is non-empty). Refuse to start
    // unless auth is explicitly disabled for a local/dev daemon.
    if expected_token.is_empty()
        && env::var("ARGENTD_ALLOW_NO_AUTH").ok().as_deref() != Some("1")
    {
        eprintln!(
            "argentd refusing to start: ARGENTD_AUTH_TOKEN is required (set it, or ARGENTD_ALLOW_NO_AUTH=1 for a local/dev daemon)"
        );
        process::exit(1);
    }

    if let Err(error) = serve(listener, started_at, &expected_token, None) {
        eprintln!("argentd server error: {}", error);
    }
}
