use gtk::prelude::*;
use parking_lot::Mutex;
use tauri::WebviewWindow;

// GTK выделяет место кнопкам с учётом системной темы. WebView получает эти
// размеры, чтобы вкладки заканчивались перед кнопками даже в узком окне.
static CAPTION_SIZE: Mutex<Option<(i32, i32)>> = Mutex::new(None);

pub(super) fn use_system_decorations() -> bool {
    // У окна без системной рамки в KWin остаются следы при перетаскивании
    // на дробном масштабе. Рамка сохраняется и при переносе между мониторами.
    std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|desktop| {
        desktop.split(':').any(|name| name.eq_ignore_ascii_case("KDE"))
    }) && gtk::gdk::Display::default()
        .is_some_and(|display| display.type_().name() == "GdkWaylandDisplay")
}

thread_local! {
    static CAPTION_STYLE: gtk::CssProvider = {
        let style = gtk::CssProvider::new();
        load_style(&style, "#7f7f7f");
        style
    };
}

// Тема GTK может заменить значки кнопок фоновыми картинками с другими
// размерами и цветом. Оставляем значки GtkHeaderBar и меняем только подсветку.
const CAPTION_CSS: &str = r#"
    .yassh-caption {
        background-color: transparent;
        background-image: none;
        border: 0;
        border-image: none;
        box-shadow: none;
        padding: 0 6px 0 0;
        min-height: 0;
    }

    window headerbar.yassh-caption button.titlebutton,
    window headerbar.yassh-caption button.titlebutton:hover,
    window headerbar.yassh-caption button.titlebutton:active,
    window headerbar.yassh-caption button.titlebutton:backdrop {
        min-width: 32px;
        min-height: 32px;
        margin: 0;
        padding: 0;
        border: 0;
        border-image: none;
        border-radius: 6px;
        box-shadow: none;
        background-color: transparent;
        background-image: none;
        background-size: 0px 0px;
        background-repeat: no-repeat;
        -gtk-icon-source: none;
        transition: none;
    }

    .yassh-caption button.titlebutton image {
        color: @yassh_caption_foreground;
        -gtk-icon-style: symbolic;
        -gtk-icon-transform: none;
        -gtk-icon-shadow: none;
    }

    .yassh-caption button.titlebutton image:backdrop {
        opacity: 0.78;
    }

    window headerbar.yassh-caption button.titlebutton:hover {
        background-color: rgba(127, 127, 127, 0.10);
    }

    window headerbar.yassh-caption button.titlebutton:active {
        background-color: rgba(127, 127, 127, 0.15);
    }
"#;

fn load_style(style: &gtk::CssProvider, color: &str) {
    let css = format!("@define-color yassh_caption_foreground {color};\n{CAPTION_CSS}");
    if let Err(error) = style.load_from_data(css.as_bytes()) {
        crate::logger::warn("Window", &format!("Cannot style GTK caption: {error}"));
    }
}

#[tauri::command]
pub(crate) fn window_set_caption_color(window: WebviewWindow, color: String) {
    if window.label() != super::MAIN_WINDOW {
        return;
    }
    let _ = window.run_on_main_thread(move || {
        if let Ok(color) = gtk::gdk::RGBA::parse(&color) {
            CAPTION_STYLE.with(|style| load_style(style, &color.to_string()));
        }
    });
}

pub(super) fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let gtk_window = window.gtk_window()?;
    let content = window.default_vbox()?;
    let overlay = gtk::Overlay::new();
    let caption = gtk::HeaderBar::builder()
        .halign(gtk::Align::End)
        .valign(gtk::Align::Start)
        .height_request(40)
        .has_subtitle(false)
        .decoration_layout(":minimize,maximize,close")
        .show_close_button(true)
        .build();
    caption.set_custom_title(Some(&gtk::Box::new(gtk::Orientation::Horizontal, 0)));

    caption.style_context().add_class("yassh-caption");
    if let Some(screen) = content.screen() {
        CAPTION_STYLE.with(|style| {
            gtk::StyleContext::add_provider_for_screen(
                &screen,
                style,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        });
    }

    let webview = window.clone();
    caption.connect_size_allocate(move |_, allocation| {
        let size = Some((allocation.width(), allocation.height()));
        let mut current = CAPTION_SIZE.lock();
        if *current == size {
            return;
        }
        *current = size;
        drop(current);
        apply_layout(&webview);
    });

    gtk_window.remove(&content);
    overlay.add(&content);
    overlay.add_overlay(&caption);
    gtk_window.add(&overlay);
    caption.show();
    overlay.show();
    Ok(())
}

pub(super) fn apply_layout(window: &WebviewWindow) {
    let size = *CAPTION_SIZE.lock();
    if let Some((width, height)) = size {
        let _ = window.eval(format!(
            "document.documentElement?.style.setProperty('--linux-caption-width', '{width}px');\n\
             document.documentElement?.style.setProperty('--linux-titlebar-height', '{height}px');"
        ));
    }
}
