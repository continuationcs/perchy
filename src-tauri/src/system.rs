//! OS signals the runner reacts to:
//!   - `fullscreen_app_on(rect)`: another app is fullscreen on the display we
//!     live on → hide the pet (games, videos, presentations);
//!   - `on_battery()`: running on battery → lower the frame rate.
//!
//! `rect` is our window in logical points (x, y, w, h), desktop coordinates.

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::display::CGDisplay;
    use core_graphics::window::{copy_window_info, kCGWindowListOptionOnScreenOnly};
    use std::ffi::c_void;

    const EXCLUDE_DESKTOP: u32 = 1 << 4; // kCGWindowListExcludeDesktopElements

    type Dict = CFDictionary<CFString, CFType>;

    fn num(dict: &Dict, key: &str) -> Option<f64> {
        dict.find(CFString::new(key))?.downcast::<CFNumber>()?.to_f64()
    }

    fn rect(dict: &Dict) -> Option<(f64, f64, f64, f64)> {
        let bounds = dict.find(CFString::new("kCGWindowBounds"))?.downcast::<CFDictionary>()?;
        let bounds: Dict = unsafe { CFDictionary::wrap_under_get_rule(bounds.as_concrete_TypeRef()) };
        Some((num(&bounds, "X")?, num(&bounds, "Y")?, num(&bounds, "Width")?, num(&bounds, "Height")?))
    }

    /// Display (CG points) containing the centre of `ours`.
    fn display_of(ours: (f64, f64, f64, f64)) -> Option<(f64, f64, f64, f64)> {
        let (cx, cy) = (ours.0 + ours.2 / 2.0, ours.1 + ours.3 / 2.0);
        CGDisplay::active_displays().ok()?.into_iter().find_map(|id| {
            let b = CGDisplay::new(id).bounds();
            let r = (b.origin.x, b.origin.y, b.size.width, b.size.height);
            (cx >= r.0 && cx < r.0 + r.2 && cy >= r.1 && cy < r.1 + r.3).then_some(r)
        })
    }

    /// The front-most normal (layer 0) window of another app on our display
    /// covers the entire display, menu bar included → it is fullscreen.
    /// Window bounds and owner PIDs need no screen-recording permission.
    pub fn fullscreen_app_on(ours: (f64, f64, f64, f64)) -> bool {
        let Some(display) = display_of(ours) else { return false };
        let Some(list) = copy_window_info(kCGWindowListOptionOnScreenOnly | EXCLUDE_DESKTOP, 0) else {
            return false;
        };
        let list: CFArray<*const c_void> = list;
        let me = std::process::id() as f64;
        for item in list.iter() {
            let dict: Dict = unsafe { CFDictionary::wrap_under_get_rule(*item as _) };
            if num(&dict, "kCGWindowLayer") != Some(0.0)
                || num(&dict, "kCGWindowOwnerPID") == Some(me)
                || num(&dict, "kCGWindowAlpha").unwrap_or(1.0) < 0.05
            {
                continue;
            }
            let Some(w) = rect(&dict) else { continue };
            let overlaps = w.0 < display.0 + display.2
                && w.0 + w.2 > display.0
                && w.1 < display.1 + display.3
                && w.1 + w.3 > display.1;
            if !overlaps {
                continue;
            }
            // Front-most window on our display decides.
            let covers = (w.0 - display.0).abs() < 1.0
                && (w.1 - display.1).abs() < 1.0
                && (w.2 - display.2).abs() < 1.0
                && (w.3 - display.3).abs() < 1.0;
            return covers;
        }
        false
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPSCopyPowerSourcesInfo() -> *const c_void;
        fn IOPSGetProvidingPowerSourceType(snapshot: *const c_void) -> CFStringRef;
    }

    pub fn on_battery() -> bool {
        unsafe {
            let snapshot = IOPSCopyPowerSourcesInfo();
            if snapshot.is_null() {
                return false;
            }
            let _owner = CFType::wrap_under_create_rule(snapshot as _); // releases snapshot
            let kind = IOPSGetProvidingPowerSourceType(snapshot);
            !kind.is_null() && CFString::wrap_under_get_rule(kind).to_string() == "Battery Power"
        }
    }
}

#[cfg(windows)]
mod imp {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };

    /// Windows reports this globally (the shell's "quiet" signal used for
    /// notifications), so the rect is unused.
    pub fn fullscreen_app_on(_ours: (f64, f64, f64, f64)) -> bool {
        match unsafe { SHQueryUserNotificationState() } {
            Ok(state) => {
                state == QUNS_BUSY || state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE
            }
            Err(_) => false,
        }
    }

    pub fn on_battery() -> bool {
        let mut status = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut status).is_ok() && status.ACLineStatus == 0 }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    pub fn fullscreen_app_on(_ours: (f64, f64, f64, f64)) -> bool {
        false
    }
    pub fn on_battery() -> bool {
        false
    }
}

pub use imp::{fullscreen_app_on, on_battery};
