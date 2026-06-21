use pdfium_render::prelude::*;
fn assert_sync<T: Sync + Send>() {}
fn main() {
    assert_sync::<Pdfium>();
}
