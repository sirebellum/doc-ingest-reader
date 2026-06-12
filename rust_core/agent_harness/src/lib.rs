use std::os::raw::c_char;
use std::ffi::c_void;


pub mod tools;
pub mod migration;
pub mod agent;
pub mod db;
pub mod prompt;
pub mod ingest;



#[no_mangle]
pub extern "C" fn agent_init_ffi(agent_path: *const c_char, content_path: *const c_char, doc_id: *const c_char) -> *mut c_void {
    if agent_path.is_null() || content_path.is_null() || doc_id.is_null() {
        return std::ptr::null_mut();
    }
    
    let agent_path_str = unsafe { std::ffi::CStr::from_ptr(agent_path).to_string_lossy().into_owned() };
    let content_path_str = unsafe { std::ffi::CStr::from_ptr(content_path).to_string_lossy().into_owned() };
    let doc_id_str = unsafe { std::ffi::CStr::from_ptr(doc_id).to_string_lossy().into_owned() };

    let content_conn = match rusqlite::Connection::open(&content_path_str) {
        Ok(c) => c,
        Err(_) => return std::ptr::null_mut(),
    };

    let agent_conn = match rusqlite::Connection::open(&agent_path_str) {
        Ok(c) => {
            if let Err(e) = db::init_agent_db(&c) {
                eprintln!("Failed to initialize agent DB schema: {}", e);
                return std::ptr::null_mut();
            }
            c
        },
        Err(_) => return std::ptr::null_mut(),
    };

    let dbs = tools::AgentDatabases {
        agent_db: agent_conn,
        content_db: content_conn,
        agent_db_path: agent_path_str,
        content_db_path: content_path_str,
        document_id: doc_id_str,
    };

    let state = Box::new(agent::AgentState::new(dbs));
    Box::into_raw(state) as *mut c_void
}

#[no_mangle]
pub extern "C" fn agent_step_ffi(agent_ptr: *mut c_void) -> i32 {
    if agent_ptr.is_null() {
        return -1;
    }
    let state = unsafe { &mut *(agent_ptr as *mut agent::AgentState) };
    match state.step() {
        Ok(agent::AgentStatus::Running) => 0,
        Ok(agent::AgentStatus::WaitingForHuman(_)) => 1,
        Ok(agent::AgentStatus::Completed) => 2,
        Ok(agent::AgentStatus::Error(_)) => -2,
        Err(_) => -3,
    }
}

#[no_mangle]
pub extern "C" fn agent_free_ffi(agent_ptr: *mut c_void) {
    if !agent_ptr.is_null() {
        let _ = unsafe { Box::from_raw(agent_ptr as *mut agent::AgentState) };
    }
}

// Ensure the FFI from ingest is available at root
pub use ingest::agent_ingest_ffi;
