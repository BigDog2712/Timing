use rfd::FileDialog;

pub fn pick_canonical_csv_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = FileDialog::new().add_filter("Patina CSV", &["csv"]);
    if let Some(directory) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(directory);
    }
    dialog
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

pub fn pick_external_data_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = FileDialog::new().add_filter("CSV or SQLite", &["csv", "db", "sqlite"]);
    if let Some(directory) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(directory);
    }
    dialog
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

fn resolve_dialog_directory(initial_path: Option<String>) -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from(initial_path?.trim());
    if path.is_dir() {
        Some(path)
    } else {
        path.parent()
            .filter(|parent| parent.is_dir())
            .map(std::path::Path::to_path_buf)
    }
}
