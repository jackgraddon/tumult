use async_trait::async_trait;
use interprocess::local_socket::tokio::{LocalSocketListener, LocalSocketStream};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex};
use crate::rpc_server::transport::{RpcTransport, SocketContext};
use crate::rpc_server::RpcServer;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpcOpcode {
    Handshake = 0,
    Frame = 1,
    Close = 2,
    Ping = 3,
    Pong = 4,
}

impl IpcOpcode {
    pub fn from_u32(v: u32) -> Option<Self> {
        match v {
            0 => Some(IpcOpcode::Handshake),
            1 => Some(IpcOpcode::Frame),
            2 => Some(IpcOpcode::Close),
            3 => Some(IpcOpcode::Ping),
            4 => Some(IpcOpcode::Pong),
            _ => None,
        }
    }
}

pub struct IpcSocketTransport {
    context: Arc<SocketContext>,
    tx: mpsc::Sender<(IpcOpcode, Value)>,
}

#[async_trait]
impl RpcTransport for IpcSocketTransport {
    async fn send(&self, msg: Value) -> Result<(), Box<dyn std::error::Error>> {
        self.tx.send((IpcOpcode::Frame, msg)).await?;
        Ok(())
    }

    fn socket_id(&self) -> String {
        self.context.socket_id.clone()
    }

    fn client_id(&self) -> String {
        self.context.client_id.blocking_lock().clone()
    }

    fn set_client_id(&self, client_id: String) {
        *self.context.client_id.blocking_lock() = client_id;
    }

    fn set_metadata(&self, key: &str, value: Value) {
        self.context.metadata.blocking_lock().insert(key.to_string(), value);
    }

    fn get_metadata(&self, key: &str) -> Option<Value> {
        self.context.metadata.blocking_lock().get(key).cloned()
    }

    async fn close(&self) -> Result<(), Box<dyn std::error::Error>> {
        let _ = self.tx.send((IpcOpcode::Close, json!({}))).await;
        Ok(())
    }
}

pub async fn run_ipc_server(server: Arc<RpcServer>) -> Result<(), Box<dyn std::error::Error>> {
    let name_prefix = if cfg!(windows) {
        r"\\.\pipe\discord-ipc-"
    } else {
        "/tmp/discord-ipc-"
    };

    #[cfg(not(windows))]
    let xdg_runtime_dir = std::env::var("XDG_RUNTIME_DIR").ok();

    let mut listener = None;
    for i in 0..10 {
        let name = format!("{}{}", name_prefix, i);

        #[cfg(not(windows))]
        {
            if let Some(ref dir) = xdg_runtime_dir {
                let xdg_name = format!("{}/discord-ipc-{}", dir, i);
                let _ = std::fs::remove_file(&xdg_name);
                if let Ok(l) = LocalSocketListener::bind(xdg_name.as_str()) {
                    listener = Some(l);
                    break;
                }
            }
            let _ = std::fs::remove_file(&name);
        }

        if let Ok(l) = LocalSocketListener::bind(name.as_str()) {
            listener = Some(l);
            break;
        }
    }

    let listener = listener.ok_or("Failed to bind any IPC socket (0-9)")?;
    log::info!("[rpc-ipc] Listening for connections...");

    loop {
        match listener.accept().await {
            Ok(socket) => {
                let server = server.clone();
                tokio::spawn(async move {
                    handle_ipc_connection(server, socket).await;
                });
            }
            Err(e) => {
                log::error!("[rpc-ipc] Accept error: {}", e);
            }
        }
    }
}

async fn handle_ipc_connection(server: Arc<RpcServer>, socket: LocalSocketStream) {
    let socket_id = uuid::Uuid::new_v4().to_string();
    let (mut reader, mut writer) = socket.into_split();

    let (tx, mut rx) = mpsc::channel::<(IpcOpcode, Value)>(100);

    let context = Arc::new(SocketContext::new(socket_id.clone(), String::new()));
    let transport = Arc::new(IpcSocketTransport {
        context,
        tx: tx.clone(),
    });

    server.handle_connection(transport.clone()).await;

    let t_writer = transport.clone();
    let writer_task = tokio::spawn(async move {
        while let Some((opcode, msg)) = rx.recv().await {
            let encoded = encode_ipc(opcode, &msg);
            if let Err(e) = writer.write_all(&encoded).await {
                log::error!("[rpc-ipc] Writer error for {}: {}", t_writer.socket_id(), e);
                break;
            }
            if opcode == IpcOpcode::Close {
                break;
            }
        }
    });

    let t_reader = transport.clone();
    let t_writer_inner = transport.clone();
    let server_reader = server.clone();
    let reader_task = tokio::spawn(async move {
        loop {
            match decode_ipc(&mut reader).await {
                Ok((opcode, data)) => {
                    match opcode {
                        IpcOpcode::Handshake => {
                            if let Some(client_id) = data.get("client_id").and_then(|v| v.as_str()) {
                                t_reader.set_client_id(client_id.to_string());
                            }
                            server_reader.send_ready(t_reader.clone()).await;
                        }
                        IpcOpcode::Frame => {
                            server_reader.handle_message(t_reader.clone(), data).await;
                        }
                        IpcOpcode::Ping => {
                            let _ = t_writer_inner.tx.send((IpcOpcode::Pong, data)).await;
                        }
                        IpcOpcode::Close => break,
                        _ => {}
                    }
                }
                Err(e) => {
                    log::debug!("[rpc-ipc] Reader closed for {}: {}", t_reader.socket_id(), e);
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

fn encode_ipc(opcode: IpcOpcode, data: &Value) -> Vec<u8> {
    use byteorder::{LittleEndian, WriteBytesExt};
    let json_str = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
    let json_bytes = json_str.as_bytes();
    let data_size = json_bytes.len() as u32;

    let mut buf = Vec::with_capacity(8 + json_bytes.len());
    buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
    buf.write_u32::<LittleEndian>(data_size).unwrap();
    buf.extend_from_slice(json_bytes);
    buf
}

async fn decode_ipc<R: AsyncReadExt + Unpin>(reader: &mut R) -> Result<(IpcOpcode, Value), Box<dyn std::error::Error>> {
    use byteorder::{LittleEndian, ReadBytesExt};
    let mut header = [0u8; 8];
    reader.read_exact(&mut header).await?;

    let mut header_cursor = std::io::Cursor::new(&header);
    let opcode_u32 = header_cursor.read_u32::<LittleEndian>()?;
    let data_size = header_cursor.read_u32::<LittleEndian>()? as usize;

    let opcode = IpcOpcode::from_u32(opcode_u32).ok_or("Invalid opcode")?;

    if data_size > 10_000_000 {
        return Err("IPC payload too large".into());
    }

    let mut payload = vec![0u8; data_size];
    reader.read_exact(&mut payload).await?;

    let data: Value = serde_json::from_slice(&payload)?;
    Ok((opcode, data))
}
