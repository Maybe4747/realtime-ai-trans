fn main() {
    // screencapturekit 经 Swift 桥接(apple-cf/apple-metal),依赖 Swift 并发运行时。
    // 现代 macOS 的 libswift_Concurrency.dylib 在 dyld 缓存中,需把 /usr/lib/swift
    // 加入 rpath 才能解析 @rpath/libswift_Concurrency.dylib。
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
