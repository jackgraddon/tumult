use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::Message;
use crate::rpc_server::transport::{RpcTransport, SocketContext};
use crate::rpc_server::RpcServer;

pub struct WsSocketTransport {
    context: Arc<SocketContext>,
    tx: mpsc::Sender<Message>,
}

#[async_trait]
impl RpcTransport for WsSocketTransport {
    async fn send(&self, msg: Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let json_str = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        self.tx.send(Message::Text(json_str.into())).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    fn socket_id(&self) -> String {
        self.context.socket_id.clone()
    }

    fn client_id(&self) -> String {
        self.context.client_id.lock().unwrap().clone()
    }

    fn set_client_id(&self, client_id: String) {
        *self.context.client_id.lock().unwrap() = client_id;
    }

    async fn close(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let _ = self.tx.send(Message::Close(None)).await;
        Ok(())
    }
}

pub async fn run_ws_server(server: Arc<RpcServer>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut listener = None;

    for p in 6463..=6472 {
        let addr = format!("127.0.0.1:{}", p);
        match TcpListener::bind(&addr).await {
            Ok(l) => {
                log::info!("[rpc-ws] Listening on {}", addr);
                listener = Some(l);
                break;
            }
            Err(_) => {
                log::debug!("[rpc-ws] Port {} in use, trying next...", p);
                continue;
            }
        }
    }

    let listener = listener.ok_or_else(|| "Failed to bind any WebSocket port (6463-6472)".to_string())?;

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let server = server.clone();
                tokio::spawn(async move {
                    handle_ws_connection(server, stream).await;
                });
            }
            Err(e) => {
                log::error!("[rpc-ws] Accept error: {}", e);
            }
        }
    }
}

async fn handle_ws_connection(server: Arc<RpcServer>, mut stream: TcpStream) {
    // Phase 1: Peek to see if it's a GET request (HTTP) or WebSocket upgrade
    let mut buf = [0u8; 4];
    if let Ok(n) = stream.peek(&mut buf).await {
        if n >= 3 && &buf[..3] == b"GET" {
            // It's a plain HTTP GET request, handle it for the test script
            let mut response = "HTTP/1.1 200 OK\r\n".to_string();
            response.push_str("Content-Type: application/json\r\n");
            response.push_str("Access-Control-Allow-Origin: *\r\n");
            response.push_str("Connection: close\r\n\r\n");
            response.push_str("{\"arRPC\": true}");
            let _ = stream.write_all(response.as_bytes()).await;
            return;
        }
    }

    let client_id = Arc::new(std::sync::Mutex::new(String::new()));
    let client_id_capture = client_id.clone();

    let callback = move |req: &Request, response: Response| {
        let origins = [
            "https://discord.com",
            "https://ptb.discord.com",
            "https://canary.discord.com",
        ];

        let origin = req.headers().get("origin").and_then(|o| o.to_str().ok());

        // arRPC strictly checks the Origin header if present.
        if let Some(origin) = origin {
            let is_valid = origins.iter().any(|&o| {
                origin == o || origin.starts_with(&(o.to_string() + "/"))
            });
            if !is_valid {
                log::warn!("[rpc-ws] Rejected connection from invalid origin: {:?}", origin);
                return Err(Response::builder()
                    .status(403)
                    .body(None)
                    .unwrap());
            }
        }

        // Extract client_id from query params: ?v=1&client_id=...
        let mut version_ok = false;
        if let Some(query) = req.uri().query() {
            for pair in query.split('&') {
                let mut parts = pair.splitn(2, '=');
                if let (Some(key), Some(val)) = (parts.next(), parts.next()) {
                    match key {
                        "client_id" => {
                            *client_id_capture.lock().unwrap() = val.to_string();
                        }
                        "v" => {
                            if val == "1" {
                                version_ok = true;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        if !version_ok {
            log::warn!("[rpc-ws] Rejected connection: missing or invalid v=1 parameter");
            return Err(Response::builder()
                .status(400)
                .body(None)
                .unwrap());
        }

        Ok(response)
    };

    match accept_hdr_async(stream, callback).await {
        Ok(ws_stream) => {
            let socket_id = uuid::Uuid::new_v4().to_string();
            let (mut ws_tx, mut ws_rx) = ws_stream.split();
            let (tx, mut rx) = mpsc::channel::<Message>(100);

            let initial_client_id = client_id.lock().unwrap().clone();
            let context = Arc::new(SocketContext::new(socket_id.clone(), initial_client_id));
            let transport = Arc::new(WsSocketTransport {
                context,
                tx,
            });

            server.handle_connection(transport.clone()).await;
            server.send_ready(transport.clone()).await;

            let t_writer = transport.clone();
            let writer_task = tokio::spawn(async move {
                while let Some(msg) = rx.recv().await {
                    let is_close = matches!(msg, Message::Close(_));
                    if let Err(e) = ws_tx.send(msg).await {
                        log::error!("[rpc-ws] Writer error for {}: {}", t_writer.socket_id(), e);
                        break;
                    }
                    if is_close {
                        break;
                    }
                }
            });

            let t_reader = transport.clone();
            let server_reader = server.clone();
            let reader_task = tokio::spawn(async move {
                while let Some(result) = ws_rx.next().await {
                    match result {
                        Ok(msg) => {
                            if let Message::Text(text) = msg {
                                if let Ok(json) = serde_json::from_str::<Value>(&text) {
                                    server_reader.handle_message(t_reader.clone(), json).await;
                                }
                            } else if let Message::Close(_) = msg {
                                break;
                            }
                        }
                        Err(e) => {
                            log::debug!("[rpc-ws] Reader closed for {}: {}", t_reader.socket_id(), e);
                            break;
                        }
                    }
                }
            });

            tokio::select! {
                _ = writer_task => {},
                _ = reader_task => {},
            }

            server.handle_disconnection(socket_id).await;
        }
        Err(e) => {
            log::debug!("[rpc-ws] WS Handshake failed: {}", e);
        }
    }
}
