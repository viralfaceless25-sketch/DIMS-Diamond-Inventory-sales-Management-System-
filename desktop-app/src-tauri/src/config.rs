pub const DEFAULT_WEB_URL: &str = "https://maitri-inventory-web.onrender.com";

pub fn production_url() -> tauri::Url {
    let raw = option_env!("DIAMOND_INVENTORY_WEB_URL").unwrap_or(DEFAULT_WEB_URL);
    let url = tauri::Url::parse(raw).expect("DIAMOND_INVENTORY_WEB_URL must be a URL");
    assert_eq!(
        url.scheme(),
        "https",
        "production desktop URL must use HTTPS"
    );
    assert!(
        url.host_str().is_some(),
        "production desktop URL must have a host"
    );
    url
}

pub fn is_allowed_navigation(url: &tauri::Url) -> bool {
    let production = production_url();
    url.scheme() == "https" && url.host_str() == production.host_str()
}

pub fn is_allowed_popup(url: &tauri::Url) -> bool {
    let production = production_url();
    let prefix = format!("blob:{}/", production.origin().ascii_serialization());
    url.as_str().starts_with(&prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_url_is_https() {
        assert_eq!(production_url().scheme(), "https");
    }

    #[test]
    fn navigation_stays_on_the_inventory_origin() {
        assert!(is_allowed_navigation(
            &tauri::Url::parse("https://maitri-inventory-web.onrender.com/login/").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &tauri::Url::parse("https://example.com/").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &tauri::Url::parse("http://maitri-inventory-web.onrender.com/").unwrap()
        ));
    }

    #[test]
    fn only_inventory_blob_popups_are_allowed() {
        assert!(is_allowed_popup(&tauri::Url::parse(
            "blob:https://maitri-inventory-web.onrender.com/550e8400-e29b-41d4-a716-446655440000"
        ).unwrap()));
        assert!(!is_allowed_popup(
            &tauri::Url::parse("https://example.com/").unwrap()
        ));
    }
}
