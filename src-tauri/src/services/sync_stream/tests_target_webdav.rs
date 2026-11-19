//! 独立回环 WebDAV fixture：内存文件、真实 HTTP、条件 PUT 与 depth-1 PROPFIND。
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::Duration;

use super::transport::Transport;
use crate::infra::md_webdav::WebdavTarget;

#[derive(Clone, Debug)]
pub(super) struct Request {
    pub method: String,
    pub path: String,
    pub body: Vec<u8>,
    headers: BTreeMap<String, String>,
}

#[derive(Default)]
struct State {
    files: BTreeMap<String, Vec<u8>>,
    dirs: BTreeSet<String>,
    requests: Vec<Request>,
    fail_reads: bool,
    fail_read_seq: Option<u32>,
}

pub(super) struct WebdavServer {
    addr: SocketAddr,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl WebdavServer {
    pub fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        state.lock().unwrap().dirs.insert(String::new());
        let stop = Arc::new(AtomicBool::new(false));
        let (shared, stopping) = (state.clone(), stop.clone());
        let worker = std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                if stopping.load(Ordering::SeqCst) {
                    break;
                }
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let Some(request) = read_request(&mut stream) else {
                    continue;
                };
                let (status, body) = {
                    let mut state = shared.lock().unwrap();
                    state.requests.push(request.clone());
                    respond(&request, &mut state)
                };
                let header = format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nContent-Type: application/xml\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        Self {
            addr,
            state,
            stop,
            worker: Some(worker),
        }
    }

    pub fn transport(&self) -> Transport {
        Transport::Webdav(WebdavTarget::new(
            &format!("http://{}", self.addr),
            "/Timing",
            "test",
            "secret",
        ))
    }

    pub fn requests(&self) -> Vec<Request> {
        self.state.lock().unwrap().requests.clone()
    }

    pub fn fail_reads(&self, fail: bool) {
        self.state.lock().unwrap().fail_reads = fail;
    }

    pub fn fail_read_at(&self, seq: Option<u32>) {
        self.state.lock().unwrap().fail_read_seq = seq;
    }

    pub fn files(&self) -> BTreeMap<String, Vec<u8>> {
        self.state
            .lock()
            .unwrap()
            .files
            .iter()
            .map(|(path, body)| {
                (
                    path.strip_prefix("/Timing/").unwrap().to_string(),
                    body.clone(),
                )
            })
            .collect()
    }

    pub fn external_copy(&self, rel: &str, body: &[u8]) {
        let path = format!("/Timing/{rel}");
        let mut state = self.state.lock().unwrap();
        let mut dir = parent(&path);
        while !dir.is_empty() {
            state.dirs.insert(dir.to_string());
            dir = parent(dir);
        }
        state.files.insert(path, body.to_vec());
    }
}

impl Drop for WebdavServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_secs(1));
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let count = stream.read(&mut chunk).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(at) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break at + 4;
        }
        if bytes.len() > 64 * 1024 {
            return None;
        }
    };
    let text = std::str::from_utf8(&bytes[..header_end]).ok()?;
    let mut lines = text.lines();
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: BTreeMap<String, String> = lines
        .filter_map(|line| {
            line.split_once(':')
                .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    let length = headers
        .get("content-length")
        .map(|text| text.parse::<usize>())
        .transpose()
        .ok()?
        .unwrap_or(0);
    if length > 2 * 1024 * 1024 {
        return None;
    }
    while bytes.len() < header_end + length {
        let count = stream.read(&mut chunk).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    Some(Request {
        method,
        path,
        headers,
        body: bytes[header_end..header_end + length].to_vec(),
    })
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
}

fn respond(request: &Request, state: &mut State) -> (u16, Vec<u8>) {
    let path = request.path.trim_end_matches('/');
    match request.method.as_str() {
        "GET" if state.fail_reads => (503, Vec::new()),
        "GET"
            if state
                .fail_read_seq
                .is_some_and(|seq| path.ends_with(&format!("/{seq:08}.jsonl"))) =>
        {
            (429, Vec::new())
        }
        "GET" => match state.files.get(path) {
            Some(body) => (200, body.clone()),
            None => (404, Vec::new()),
        },
        "MKCOL" => {
            let status = if state.dirs.contains(path) {
                405
            } else if !state.dirs.contains(parent(path)) {
                409
            } else {
                state.dirs.insert(path.to_string());
                201
            };
            (status, Vec::new())
        }
        "PUT" => {
            if request.headers.get("if-none-match").map(String::as_str) != Some("*") {
                return (400, Vec::new());
            }
            if state.files.contains_key(path) {
                return (412, Vec::new());
            }
            if !state.dirs.contains(parent(path)) {
                return (409, Vec::new());
            }
            state.files.insert(path.to_string(), request.body.clone());
            (201, Vec::new())
        }
        "PROPFIND" => {
            if request.headers.get("depth").map(String::as_str) != Some("1") {
                return (400, Vec::new());
            }
            if !state.dirs.contains(path) {
                return (404, Vec::new());
            }
            let mut xml = String::from("<d:multistatus xmlns:d=\"DAV:\">");
            for child in state
                .dirs
                .iter()
                .chain(state.files.keys())
                .filter(|child| child.as_str() == path || parent(child) == path)
            {
                // Fixture 路径仅 ASCII 字母、数字、斜杠和点，不含 XML 保留字符。
                xml.push_str(&format!(
                    "<d:response><d:href>{child}</d:href></d:response>"
                ));
            }
            xml.push_str("</d:multistatus>");
            (207, xml.into_bytes())
        }
        _ => (405, Vec::new()),
    }
}
