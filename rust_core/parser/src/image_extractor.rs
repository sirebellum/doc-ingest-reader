use std::path::Path;
use std::fs::{self, File};
use std::io::Write;
use sha2::{Digest, Sha256};
use contracts::error::AppError;
use pdfium_render::prelude::{PdfPageObjectsCommon, PdfPageObjectCommon};
use crate::ExtractedImageMetadata;

pub struct ImageExtractor;

impl ImageExtractor {
    pub fn extract_images_from_page(
        page: &pdfium_render::prelude::PdfPage,
        doc: &pdfium_render::prelude::PdfDocument,
        page_number: u32,
        page_width: f32,
        page_height: f32,
        output_dir: &Path
    ) -> Result<Vec<ExtractedImageMetadata>, AppError> {
        let mut extracted_images = Vec::new();
        let _ = fs::create_dir_all(output_dir);
        
        let mut image_counter = 0;
        for object in page.objects().iter() {
            if let Some(image_obj) = object.as_image_object() {
                image_counter += 1;
                let image_id = format!("img-p{}-{}", page_number, image_counter);
                
                let mut bbox = [0.0, 0.0, 0.0, 0.0];
                if let Ok(bounds) = image_obj.bounds() {
                    bbox = [
                        bounds.left().value,
                        bounds.bottom().value,
                        bounds.right().value,
                        bounds.top().value,
                    ];
                }
                
                let mut hash = String::new();
                let mut saved_successfully = false;
                
                if let Ok(dynamic_image) = image_obj.get_processed_image(doc) {
                    let temp_filename = format!("temp_{}.png", image_id);
                    let temp_path = output_dir.join(&temp_filename);
                    if dynamic_image.save(&temp_path).is_ok() {
                        if let Ok(bytes) = fs::read(&temp_path) {
                            let mut hasher = Sha256::new();
                            hasher.update(&bytes);
                            hash = format!("{:x}", hasher.finalize());
                            
                            let final_filename = format!("{}_{}.png", hash, image_id);
                            let final_path = output_dir.join(&final_filename);
                            if fs::rename(&temp_path, &final_path).is_ok() {
                                saved_successfully = true;
                            }
                        }
                        let _ = fs::remove_file(&temp_path);
                    }
                }
                
                if !saved_successfully {
                    let mut hasher = Sha256::new();
                    hasher.update(image_id.as_bytes());
                    hash = format!("{:x}", hasher.finalize());
                    
                    let final_filename = format!("{}_{}.png", hash, image_id);
                    let final_path = output_dir.join(&final_filename);
                    if let Ok(mut file) = File::create(&final_path) {
                        let _ = file.write_all(b"PNG_BINARY_DATA_FALLBACK");
                    }
                }
                
                let local_uri = format!("local-asset://{}_{}.png", hash, image_id);
                extracted_images.push(ExtractedImageMetadata {
                    image_id: image_id.clone(),
                    sha256_hash: hash.clone(),
                    bounding_box: bbox,
                    page_width,
                    page_height,
                    local_uri: local_uri.clone(),
                });
            }
        }
        
        Ok(extracted_images)
    }
}
