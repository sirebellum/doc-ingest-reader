use std::env;
use std::path::Path;

fn main() {
    // Only run static linking logic if the `llama_native` feature is enabled
    if !cfg!(feature = "llama_native") {
        return;
    }

    // Determine the target architecture and OS
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    // Determine the target-specific directory name
    let target_dir = match (target_arch.as_str(), target_os.as_str()) {
        ("x86_64", "windows") => "x86_64-pc-windows-msvc",
        ("aarch64", "windows") => "aarch64-pc-windows-msvc",
        ("x86_64", "macos") => "x86_64-apple-darwin",
        ("aarch64", "macos") => "aarch64-apple-darwin",
        ("x86_64", "linux") => "x86_64-unknown-linux-gnu",
        ("aarch64", "linux") => "aarch64-unknown-linux-gnu",
        ("x86_64", "android") => "x86_64-linux-android",
        ("aarch64", "android") => "aarch64-linux-android",
        ("x86_64", "ios") => "x86_64-apple-ios",
        ("aarch64", "ios") => "aarch64-apple-ios",
        _ => {
            eprintln!("cargo:warning=Unsupported target architecture or OS: {}-{}", target_arch, target_os);
            return;
        }
    };

    // Try to get the library path from the environment variable
    let lib_path = env::var("LLAMA_LIB_PATH")
        .unwrap_or_else(|_| format!("libs/{}", target_dir));

    // Check if the library directory exists
    if !Path::new(&lib_path).exists() {
        eprintln!("cargo:warning=Library directory not found: {}", lib_path);
        return;
    }

    // Emit cargo instructions for linking
    println!("cargo:rustc-link-search=native={}", lib_path);
    println!("cargo:rustc-link-lib=static=llama");

    // Handle platform-specific requirements
    match target_os.as_str() {
        "windows" => {
            // Windows requires additional system libraries
            println!("cargo:rustc-link-lib=kernel32");
            println!("cargo:rustc-link-lib=user32");
            println!("cargo:rustc-link-lib=advapi32");
        }
        "macos" | "ios" => {
            // macOS/iOS require standard framework headers or performance shaders
            println!("cargo:rustc-link-lib=framework=Foundation");
            if target_os == "macos" {
                println!("cargo:rustc-link-lib=framework=AppKit");
            }
        }
        _ => {}
    }
}
