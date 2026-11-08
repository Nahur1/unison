//! The libmpv functions Unison calls.
//!
//! On Linux the library is opened at startup instead of being linked, so one
//! package runs with either libmpv.so.2 (Debian 13, Ubuntu 24.04+) or
//! libmpv.so.1 (Ubuntu 22.04). Every function used here has the same C ABI in
//! both. Windows and macOS ship their own libmpv and keep linking it directly.

use std::ffi::{c_char, c_int, c_void};

use crate::mpv::{MpvHandle, RawEvent};
use crate::video::{RenderContext, RenderParam};

type UpdateCallback = Option<unsafe extern "C" fn(*mut c_void)>;

macro_rules! libmpv {
    ($(fn $name:ident($($arg:ident: $ty:ty),* $(,)?) $(-> $ret:ty)?;)*) => {
        #[cfg(not(target_os = "linux"))]
        #[link(name = "mpv")]
        unsafe extern "C" {
            $(pub(crate) fn $name($($arg: $ty),*) $(-> $ret)?;)*
        }

        #[cfg(not(target_os = "linux"))]
        pub(crate) fn load() -> anyhow::Result<()> {
            Ok(())
        }

        #[cfg(target_os = "linux")]
        #[allow(non_snake_case)]
        struct Api {
            _lib: libloading::Library,
            $($name: unsafe extern "C" fn($($ty),*) $(-> $ret)?,)*
        }

        #[cfg(target_os = "linux")]
        impl Api {
            fn open() -> Result<Self, String> {
                let mut errors = Vec::new();
                for file in LIBRARY_FILES {
                    // SAFETY: libmpv runs no unsafe initialisers when opened.
                    match unsafe { libloading::Library::new(file) } {
                        Ok(lib) => {
                            // SAFETY: the signatures match mpv/client.h and mpv/render.h.
                            return unsafe {
                                Ok(Api {
                                    $($name: *lib
                                        .get(concat!(stringify!($name), "\0").as_bytes())
                                        .map_err(|e| format!("{file}: {e}"))?,)*
                                    _lib: lib,
                                })
                            };
                        }
                        Err(e) => errors.push(e.to_string()),
                    }
                }
                Err(format!(
                    "libmpv not found; install libmpv2 (or libmpv1) ({})",
                    errors.join("; ")
                ))
            }
        }

        $(
            #[cfg(target_os = "linux")]
            pub(crate) unsafe fn $name($($arg: $ty),*) $(-> $ret)? {
                unsafe { (api().$name)($($arg),*) }
            }
        )*
    };
}

#[cfg(target_os = "linux")]
const LIBRARY_FILES: [&str; 3] = ["libmpv.so.2", "libmpv.so.1", "libmpv.so"];

#[cfg(target_os = "linux")]
static API: std::sync::OnceLock<Result<Api, String>> = std::sync::OnceLock::new();

/// Opens libmpv. Call once before any other function here.
#[cfg(target_os = "linux")]
pub(crate) fn load() -> anyhow::Result<()> {
    match API.get_or_init(Api::open) {
        Ok(_) => Ok(()),
        Err(e) => anyhow::bail!("{e}"),
    }
}

#[cfg(target_os = "linux")]
fn api() -> &'static Api {
    match API.get() {
        Some(Ok(api)) => api,
        _ => panic!("libmpv used before libmpv::load() succeeded"),
    }
}

libmpv! {
    fn mpv_create() -> *mut MpvHandle;
    fn mpv_initialize(ctx: *mut MpvHandle) -> c_int;
    fn mpv_terminate_destroy(ctx: *mut MpvHandle);
    fn mpv_set_option_string(ctx: *mut MpvHandle, name: *const c_char, data: *const c_char) -> c_int;
    fn mpv_command(ctx: *mut MpvHandle, args: *mut *const c_char) -> c_int;
    fn mpv_set_property(ctx: *mut MpvHandle, name: *const c_char, format: c_int, data: *mut c_void) -> c_int;
    fn mpv_set_property_string(ctx: *mut MpvHandle, name: *const c_char, data: *const c_char) -> c_int;
    fn mpv_free(data: *mut c_void);
    fn mpv_get_property(ctx: *mut MpvHandle, name: *const c_char, format: c_int, data: *mut c_void) -> c_int;
    fn mpv_observe_property(ctx: *mut MpvHandle, userdata: u64, name: *const c_char, format: c_int) -> c_int;
    fn mpv_wait_event(ctx: *mut MpvHandle, timeout: f64) -> *mut RawEvent;
    fn mpv_error_string(error: c_int) -> *const c_char;
    fn mpv_render_context_create(res: *mut *mut RenderContext, mpv: *mut MpvHandle, params: *mut RenderParam) -> c_int;
    fn mpv_render_context_set_update_callback(ctx: *mut RenderContext, callback: UpdateCallback, data: *mut c_void);
    fn mpv_render_context_update(ctx: *mut RenderContext) -> u64;
    fn mpv_render_context_render(ctx: *mut RenderContext, params: *mut RenderParam) -> c_int;
    fn mpv_render_context_report_swap(ctx: *mut RenderContext);
    fn mpv_render_context_free(ctx: *mut RenderContext);
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    #[test]
    fn installed_libmpv_loads_with_every_function() {
        super::load().unwrap();
    }
}
