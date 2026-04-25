use argentd::server::{bind_listener, resolve_bind_addr, resolve_expected_token, serve};
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

    if let Err(error) = serve(listener, started_at, &expected_token, None) {
        eprintln!("argentd server error: {}", error);
    }
}
