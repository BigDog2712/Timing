use super::segment::format_seq;

pub const ROOT: &str = "sync/streams";

pub fn dir(device: &str, writer: &str) -> String {
    format!("{ROOT}/{device}/{writer}")
}

pub fn path(device: &str, writer: &str, seq: u32) -> String {
    format!("{}/{}.jsonl", dir(device, writer), format_seq(seq))
}

pub(super) fn valid_writer(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_paths_separate_writers_without_changing_device_identity() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        assert_eq!(
            path("aaaaaaaaaaaa", &a, 1),
            format!("sync/streams/aaaaaaaaaaaa/{a}/00000001.jsonl")
        );
        assert_ne!(path("aaaaaaaaaaaa", &a, 1), path("aaaaaaaaaaaa", &b, 1));
        assert_ne!(
            path("aaaaaaaaaaaa", &a, 1),
            super::super::segment::segment_path("aaaaaaaaaaaa", 1)
        );
        for value in ["../", "", "a", &"A".repeat(64), &"g".repeat(64)] {
            assert!(!valid_writer(value));
        }
        assert!(valid_writer(&a));
        assert!(valid_writer(&"0123456789abcdef".repeat(4)));
    }

    #[test]
    fn ledger_keys_separate_legacy_upload_and_every_received_stream() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        let keys = [
            a.clone(),
            b.clone(),
            super::super::scope::upload(&a),
            super::super::scope::upload(&b),
            super::super::scope::download(&a, &a),
            super::super::scope::download(&a, &b),
            super::super::scope::download(&b, &a),
            super::super::scope::download(&b, &b),
        ];
        assert_eq!(
            keys.iter().collect::<std::collections::BTreeSet<_>>().len(),
            keys.len()
        );
    }
}
