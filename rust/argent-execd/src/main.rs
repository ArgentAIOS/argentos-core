use argent_execd::server::{
    bind_listener, bootstrap_runtime, resolve_bind_addr, serve, start_tick_loop, ShutdownSignal,
};
use std::process;
use std::sync::Arc;

fn main() {
    let bind_addr = resolve_bind_addr();
    let runtime = match bootstrap_runtime(&bind_addr) {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("argent-execd failed to initialize runtime: {}", error);
            process::exit(1);
        }
    };
    let listener = match bind_listener(&bind_addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("argent-execd failed to bind {}: {}", bind_addr, error);
            process::exit(1);
        }
    };

    println!(
        "argent-execd shadow executive listening on http://{} (health=/health, state=/v1/executive/state)",
        bind_addr
    );

    let shutdown = Arc::new(ShutdownSignal::new());
    start_tick_loop(runtime.clone(), shutdown.clone());
    if let Err(error) = serve(listener, runtime, shutdown) {
        eprintln!("argent-execd server error: {}", error);
    }
}
