//! `web_links.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;

#[test]
fn automatic_groups_without_configuration_and_respects_exact_exceptions() {
    let rules = BTreeMap::new();
    assert_eq!(
        resolve_owner("chat.deepseek.com", &rules),
        r#"{"kind":"group","domain":"deepseek.com"}"#
    );
    assert_eq!(resolve_owner("127.0.0.1", &rules), "127.0.0.1");
    let rules = BTreeMap::from([(
        "deepseek.com".into(),
        serde_json::from_str::<WebLinkRule>(
            r#"{"version":2,"exceptions":["chat.deepseek.com"]}"#,
        )
        .unwrap(),
    )]);
    assert_eq!(
        resolve_owner("chat.deepseek.com", &rules),
        "chat.deepseek.com"
    );
    assert_eq!(
        resolve_owner("new.deepseek.com", &rules),
        r#"{"kind":"group","domain":"deepseek.com"}"#
    );
    assert_eq!(
        resolve_owner("a.chat.deepseek.com", &rules),
        r#"{"kind":"group","domain":"deepseek.com"}"#
    );
}

#[test]
fn public_private_unknown_and_exception_boundaries() {
    for (host, expected) in [
        ("www.example.com.cn", Some("example.com.cn")),
        ("a.b.example.com", Some("example.com")),
        ("a.github.io", Some("a.github.io")),
        ("b.github.io", Some("b.github.io")),
        ("www.city.kawasaki.jp", Some("city.kawasaki.jp")),
        ("a.b.ck", Some("a.b.ck")),
        ("www.ck", Some("www.ck")),
        ("WWW.Example.COM.", Some("example.com")),
        ("com.cn", None),
        ("localhost", None),
        ("127.0.0.1", None),
        ("[::1]", None),
        ("a.invalid", None),
        ("a..com", None),
    ] {
        assert_eq!(registrable_domain(host).as_deref(), expected, "{host}");
    }
}

#[test]
fn automatic_rules_reject_cross_site_exceptions_and_future_formats() {
    for json in [
        r#"{"version":2,"exceptions":["other.com"]}"#,
        r#"{"version":2,"members":["www.example.com"]}"#,
        r#"{"version":3}"#,
    ] {
        let rule = serde_json::from_str(json).unwrap();
        assert!(validate_rule("example.com", &rule).is_err());
    }
    assert!(serde_json::from_str::<WebLinkRule>(
        r#"{"version":2,"exceptions":["example.com","example.com"]}"#
    )
    .is_err());
    assert_eq!(
        registrable_domain("www.食狮.com.cn"),
        registrable_domain("www.xn--85x722f.com.cn")
    );
    let rule = serde_json::from_str(r#"{"version":2,"exceptions":["example.com"]}"#).unwrap();
    validate_rule("example.com", &rule).unwrap();
    assert_ne!(group_key("example.com"), "example.com");
    assert_eq!(
        group_domain(&group_key("example.com")).as_deref(),
        Some("example.com")
    );
    assert!(group_domain(r#"{"kind":"other","domain":"example.com"}"#).is_none());
}
