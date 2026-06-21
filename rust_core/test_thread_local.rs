use std::cell::RefCell;
use pdfium_render::prelude::*;

thread_local! {
    pub static PDFIUM: RefCell<Option<Pdfium>> = RefCell::new(None);
}

fn main() {}
