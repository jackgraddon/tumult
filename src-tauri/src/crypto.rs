use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use zeroize::Zeroize;
use aes::cipher::{KeyIvInit, StreamCipher};
use sha2::{Digest, Sha256};
use base64::{Engine as _, engine::general_purpose};

type Aes256Ctr = ctr::Ctr128BE<aes::Aes256>;

#[derive(Serialize, Deserialize, Zeroize)]
#[zeroize(drop)]
pub struct EncryptionContext {
    pub key: Vec<u8>,
}

pub struct CallCryptoState {
    pub keys: HashMap<String, Vec<u8>>, // participant_id -> key
}

pub struct CryptoState {
    pub calls: Mutex<HashMap<String, CallCryptoState>>,
}

#[derive(Serialize, Deserialize)]
pub struct AttachmentKey {
    pub alg: String,
    pub key_ops: Vec<String>,
    pub kty: String,
    pub k: String,
    pub ext: bool,
}

#[derive(Serialize, Deserialize)]
pub struct AttachmentInfo {
    pub v: String,
    pub key: AttachmentKey,
    pub iv: String,
    pub hashes: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
pub struct EncryptionResult {
    pub data: Vec<u8>,
    pub info: AttachmentInfo,
}

#[tauri::command]
pub fn encrypt_attachment(data: Vec<u8>) -> Result<EncryptionResult, String> {
    use rand::RngCore;

    let mut key = [0u8; 32];
    let mut iv = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut key);
    rand::thread_rng().fill_bytes(&mut iv);
    iv[8] &= 0x7f;

    let mut ciphertext = data.clone();
    let mut cipher = Aes256Ctr::new(&key.into(), &iv.into());
    cipher.apply_keystream(&mut ciphertext);

    let mut hasher = Sha256::new();
    hasher.update(&ciphertext);
    let hash = hasher.finalize();

    let info = AttachmentInfo {
        v: "v2".to_string(),
        key: AttachmentKey {
            alg: "A256CTR".to_string(),
            key_ops: vec!["encrypt".to_string(), "decrypt".to_string()],
            kty: "oct".to_string(),
            k: general_purpose::URL_SAFE_NO_PAD.encode(key),
            ext: true,
        },
        iv: general_purpose::STANDARD.encode(iv),
        hashes: {
            let mut h = HashMap::new();
            h.insert("sha256".to_string(), general_purpose::STANDARD_NO_PAD.encode(hash));
            h
        },
    };

    Ok(EncryptionResult {
        data: ciphertext,
        info,
    })
}

#[tauri::command]
pub fn decrypt_attachment(data: Vec<u8>, info: AttachmentInfo) -> Result<Vec<u8>, String> {
    let key = general_purpose::URL_SAFE_NO_PAD.decode(&info.key.k)
        .map_err(|e| format!("Failed to decode key: {}", e))?;
    let iv = general_purpose::STANDARD.decode(&info.iv)
        .map_err(|e| format!("Failed to decode iv: {}", e))?;

    if key.len() != 32 {
        return Err("Invalid key length".to_string());
    }
    if iv.len() != 16 {
        return Err("Invalid iv length".to_string());
    }

    let mut plaintext = data;
    let mut cipher = Aes256Ctr::new(key[..32].try_into().unwrap(), iv[..16].try_into().unwrap());
    cipher.apply_keystream(&mut plaintext);

    Ok(plaintext)
}

#[tauri::command]
pub fn initialize_call_encryption(
    call_id: String,
    participant_id: String,
    encryption_context: String,
    state: State<CryptoState>,
) -> Result<(), String> {
    let context = serde_json::from_str::<EncryptionContext>(&encryption_context)
        .map_err(|e| e.to_string())?;

    let mut calls = state.calls.lock().unwrap();
    let call_state = calls.entry(call_id).or_insert_with(|| CallCryptoState {
        keys: HashMap::new(),
    });

    call_state.keys.insert(participant_id, context.key.clone());
    Ok(())
}

#[tauri::command]
pub fn encrypt_media_frame(
    call_id: String,
    participant_id: String,
    plaintext: Vec<u8>,
    iv: Vec<u8>,
    _frame_type: String,
    state: State<CryptoState>,
) -> Result<Vec<u8>, String> {
    let calls = state.calls.lock().unwrap();
    let call_state = calls.get(&call_id).ok_or("Call not found")?;
    let key = call_state.keys.get(&participant_id).ok_or("Key not found for participant")?;

    let mut ciphertext = plaintext;

    if key.len() != 32 {
         return Err(format!("Invalid key length ({}) for call encryption", key.len()));
    }
    if iv.len() != 16 {
        return Err(format!("Invalid IV length ({}) for call encryption", iv.len()));
    }

    let mut cipher = Aes256Ctr::new(key[..32].try_into().unwrap(), iv[..16].try_into().unwrap());
    cipher.apply_keystream(&mut ciphertext);

    Ok(ciphertext)
}

#[tauri::command]
pub fn decrypt_media_frame(
    call_id: String,
    participant_id: String,
    ciphertext: Vec<u8>,
    iv: Vec<u8>,
    state: State<CryptoState>,
) -> Result<Vec<u8>, String> {
    let calls = state.calls.lock().unwrap();
    let call_state = calls.get(&call_id).ok_or("Call not found")?;
    let key = call_state.keys.get(&participant_id).ok_or("Key not found for participant")?;

    let mut plaintext = ciphertext;

    if key.len() != 32 {
         return Err(format!("Invalid key length ({}) for call decryption", key.len()));
    }
    if iv.len() != 16 {
        return Err(format!("Invalid IV length ({}) for call decryption", iv.len()));
    }

    let mut cipher = Aes256Ctr::new(key[..32].try_into().unwrap(), iv[..16].try_into().unwrap());
    cipher.apply_keystream(&mut plaintext);

    Ok(plaintext)
}
