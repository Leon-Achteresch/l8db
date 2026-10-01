use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const NEW_WINDOW_ARG: &str = "--new-window";
const MENU_ARG: &str = "--menu=";
const DOCK_PREFIX: &str = "dock.";
const DOCK_NEW_WINDOW: &str = "dock.new-window";
const DOCK_CONNECTION_PREFIX: &str = "dock.connection:";
#[cfg(any(target_os = "macos", windows))]
const QUICK_ACTIONS: [(&str, &str); 3] = [
    (DOCK_NEW_WINDOW, "Neues Fenster"),
    ("dock.tab.newQuery", "Neue Abfrage"),
    ("dock.go.connections", "Verbindungen verwalten"),
];
#[cfg(any(target_os = "macos", windows))]
const RECENTS_TITLE: &str = "Verbindung öffnen";
const CASCADE_OFFSET: f64 = 28.0;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub struct DockEntry {
    id: String,
    name: String,
}

#[derive(Default)]
pub struct WindowConnections(Mutex<HashMap<String, String>>);

impl WindowConnections {
    fn window_with(&self, id: &str, except: Option<&str>) -> Option<String> {
        let map = self.0.lock().ok()?;
        map.iter()
            .find(|(label, active)| active.as_str() == id && Some(label.as_str()) != except)
            .map(|(label, _)| label.clone())
    }

    fn set(&self, label: &str, id: Option<String>) {
        if let Ok(mut map) = self.0.lock() {
            match id {
                Some(id) => map.insert(label.to_string(), id),
                None => map.remove(label),
            };
        }
    }
}

pub fn forget<R: Runtime>(window: &tauri::Window<R>) {
    window
        .state::<WindowConnections>()
        .set(window.label(), None);
}

pub fn connection_label(id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("conn-{safe}")
}

pub fn connection_url(id: &str) -> String {
    let encoded: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect();
    format!("/?connection={encoded}")
}

fn focus<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn focused_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

pub fn target_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    focused_window(app)
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| app.webview_windows().into_values().next())
}

pub fn open<R: Runtime>(app: &AppHandle<R>, connection: Option<&str>) -> tauri::Result<()> {
    let (label, url) = match connection {
        Some(id) => {
            let label = connection_label(id);
            let existing = app
                .state::<WindowConnections>()
                .window_with(id, None)
                .and_then(|label| app.get_webview_window(&label))
                .or_else(|| app.get_webview_window(&label));
            if let Some(existing) = existing {
                focus(&existing);
                return Ok(());
            }
            (label, connection_url(id))
        }
        None => {
            let label = (1u32..)
                .map(|index| format!("win-{index}"))
                .find(|label| app.get_webview_window(label).is_none())
                .unwrap_or_else(|| "win-0".to_string());
            (label, "/?window=1".to_string())
        }
    };
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default();
    config.label = label;
    config.url = WebviewUrl::App(url.into());
    if let Some(origin) = focused_window(app) {
        if let (Ok(position), Ok(scale)) = (origin.outer_position(), origin.scale_factor()) {
            let position = position.to_logical::<f64>(scale);
            config.x = Some(position.x + CASCADE_OFFSET);
            config.y = Some(position.y + CASCADE_OFFSET);
        }
    }
    let window = WebviewWindowBuilder::from_config(app, &config)?.build()?;
    focus(&window);
    Ok(())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == DOCK_NEW_WINDOW {
        if let Err(error) = open(app, None) {
            log::error!("new window failed: {error}");
        }
        return;
    }
    if let Some(connection) = id.strip_prefix(DOCK_CONNECTION_PREFIX) {
        if let Err(error) = open(app, Some(connection)) {
            log::error!("connection window failed: {error}");
        }
        return;
    }
    let Some(window) = target_window(app) else {
        return;
    };
    let action = match id.strip_prefix(DOCK_PREFIX) {
        Some(action) => {
            focus(&window);
            action
        }
        None => id,
    };
    let _ = app.emit_to(window.label(), "menu-action", action);
}

fn launch_actions(args: &[String], running: bool) -> Vec<&str> {
    args.iter()
        .filter_map(|arg| {
            if arg == NEW_WINDOW_ARG {
                Some(DOCK_NEW_WINDOW)
            } else {
                arg.strip_prefix(MENU_ARG)
                    .filter(|id| id.starts_with(DOCK_PREFIX))
            }
        })
        .filter(|id| running || id.starts_with(DOCK_CONNECTION_PREFIX))
        .collect()
}

pub fn handle_args<R: Runtime>(app: &AppHandle<R>, args: &[String], running: bool) -> bool {
    let actions = launch_actions(args, running);
    for id in &actions {
        handle_menu_event(app, id);
    }
    !actions.is_empty()
}

#[tauri::command]
pub async fn open_app_window(app: AppHandle, connection: Option<String>) -> Result<(), String> {
    open(&app, connection.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_window_connection(
    window: WebviewWindow,
    state: State<'_, WindowConnections>,
    id: Option<String>,
) {
    state.set(window.label(), id);
}

#[tauri::command]
pub fn connection_in_other_window(
    window: WebviewWindow,
    state: State<'_, WindowConnections>,
    id: String,
) -> bool {
    state.window_with(&id, Some(window.label())).is_some()
}

#[tauri::command]
pub fn set_dock_recents(app: AppHandle, recents: Vec<DockEntry>) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || dock::rebuild(&recents));
    #[cfg(windows)]
    let _ = app.run_on_main_thread(move || jump_list::rebuild(&recents));
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = (app, recents);
}

pub fn install_quick_menu() {
    #[cfg(target_os = "macos")]
    {
        dock::install();
        dock::rebuild(&[]);
    }
    #[cfg(windows)]
    jump_list::rebuild(&[]);
}

#[cfg(target_os = "macos")]
mod dock {
    use std::cell::RefCell;
    use std::ffi::c_void;

    use muda::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};

    use super::{DockEntry, DOCK_CONNECTION_PREFIX, QUICK_ACTIONS, RECENTS_TITLE};

    thread_local! {
        static MENU: RefCell<Option<Menu>> = const { RefCell::new(None) };
    }

    extern "C-unwind" fn dock_menu(
        _this: &AnyObject,
        _cmd: Sel,
        _sender: &AnyObject,
    ) -> *mut c_void {
        MENU.with_borrow(|menu| {
            menu.as_ref()
                .map_or(std::ptr::null_mut(), |menu| menu.ns_menu())
        })
    }

    pub fn install() {
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![app, delegate];
            let Some(delegate) = delegate.as_ref() else {
                log::warn!("dock menu unavailable: no application delegate");
                return;
            };
            let class = delegate.class() as *const AnyClass as *mut AnyClass;
            let imp: Imp = std::mem::transmute(
                dock_menu as extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> *mut c_void,
            );
            objc2::ffi::class_addMethod(class, sel!(applicationDockMenu:), imp, c"@@:@".as_ptr());
            let _: () = msg_send![app, setDelegate: delegate];
        }
    }

    pub fn rebuild(recents: &[DockEntry]) {
        let menu = Menu::new();
        for (id, label) in QUICK_ACTIONS {
            let _ = menu.append(&MenuItem::with_id(id, label, true, None));
        }
        if !recents.is_empty() {
            let _ = menu.append(&PredefinedMenuItem::separator());
            let _ = menu.append(&MenuItem::new(RECENTS_TITLE, false, None));
            for entry in recents {
                let _ = menu.append(&MenuItem::with_id(
                    format!("{DOCK_CONNECTION_PREFIX}{}", entry.id),
                    entry.name.replace('&', "&&"),
                    true,
                    None,
                ));
            }
        }
        MENU.set(Some(menu));
    }
}

#[cfg(windows)]
mod jump_list {
    use std::mem::ManuallyDrop;

    use windows::core::{Interface, Result, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::{
        PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
        SHStrDupW, ShellLink,
    };

    use super::{DockEntry, DOCK_CONNECTION_PREFIX, MENU_ARG, QUICK_ACTIONS, RECENTS_TITLE};

    fn title(text: &str) -> Result<PROPVARIANT> {
        let value = unsafe { SHStrDupW(&HSTRING::from(text))? };
        Ok(PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_LPWSTR,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 { pwszVal: value },
                }),
            },
        })
    }

    fn link(exe: &HSTRING, id: &str, label: &str) -> Result<IShellLinkW> {
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(exe)?;
            link.SetArguments(&HSTRING::from(format!("{MENU_ARG}{id}")))?;
            link.SetIconLocation(exe, 0)?;
            link.SetDescription(&HSTRING::from(label))?;
            let store: IPropertyStore = link.cast()?;
            store.SetValue(&PKEY_Title, &title(label)?)?;
            store.Commit()?;
            Ok(link)
        }
    }

    fn removed_arguments(removed: &IObjectArray) -> Vec<String> {
        let count = unsafe { removed.GetCount() }.unwrap_or(0);
        (0..count)
            .filter_map(|index| unsafe { removed.GetAt::<IShellLinkW>(index) }.ok())
            .filter_map(|link| {
                let mut buffer = [0u16; 1024];
                unsafe { link.GetArguments(&mut buffer) }.ok()?;
                let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
                Some(String::from_utf16_lossy(&buffer[..len]))
            })
            .collect()
    }

    fn update(recents: &[DockEntry]) -> Result<()> {
        let Ok(exe) = std::env::current_exe() else {
            return Ok(());
        };
        let exe = HSTRING::from(exe.as_path());
        unsafe {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            let mut slots = 0u32;
            let removed = removed_arguments(&list.BeginList::<IObjectArray>(&mut slots)?);
            let tasks: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for (id, label) in QUICK_ACTIONS {
                tasks.AddObject(&link(&exe, id, label)?)?;
            }
            list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
            let connections: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            let mut added = 0;
            for entry in recents {
                let id = format!("{DOCK_CONNECTION_PREFIX}{}", entry.id);
                if removed.contains(&format!("{MENU_ARG}{id}")) {
                    continue;
                }
                connections.AddObject(&link(&exe, &id, &entry.name)?)?;
                added += 1;
            }
            if added > 0 {
                list.AppendCategory(
                    &HSTRING::from(RECENTS_TITLE),
                    &connections.cast::<IObjectArray>()?,
                )?;
            }
            list.CommitList()
        }
    }

    pub fn rebuild(recents: &[DockEntry]) {
        if let Err(error) = update(recents) {
            log::warn!("jump list update failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_connections_track_other_windows() {
        let state = WindowConnections::default();
        state.set("main", Some("a".into()));
        state.set("win-1", Some("b".into()));
        assert_eq!(state.window_with("a", None).as_deref(), Some("main"));
        assert_eq!(state.window_with("a", Some("main")), None);
        assert_eq!(
            state.window_with("b", Some("main")).as_deref(),
            Some("win-1")
        );
        state.set("win-1", None);
        assert_eq!(state.window_with("b", None), None);
    }

    #[test]
    fn launch_arguments_map_to_quick_actions() {
        let args: Vec<String> = [
            "l8db",
            "--new-window",
            "--menu=dock.connection:abc",
            "--menu=dock.tab.newQuery",
            "--menu=query.run",
            "/tmp/a.db",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect();
        assert_eq!(
            launch_actions(&args, true),
            vec![
                "dock.new-window",
                "dock.connection:abc",
                "dock.tab.newQuery"
            ]
        );
        assert_eq!(launch_actions(&args, false), vec!["dock.connection:abc"]);
    }

    #[test]
    fn connection_windows_use_safe_labels_and_encoded_urls() {
        assert_eq!(connection_label("a1-b_2"), "conn-a1-b_2");
        assert_eq!(connection_label("a b/c?d"), "conn-a-b-c-d");
        assert_eq!(connection_url("a1-b_2"), "/?connection=a1-b_2");
        assert_eq!(connection_url("a b&c"), "/?connection=a+b%26c");
    }
}
