use printpdf::*;
use serde::{Serialize, Deserialize};
use std::fs::File;
use std::io::BufWriter;
use anyhow::{anyhow, Result};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TocItem {
    pub title: String,
    pub anchor_block_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyntheticBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyntheticSection {
    pub section_id: String,
    pub heading: String,
    pub blocks: Vec<SyntheticBlock>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyntheticInput {
    pub title: String,
    pub table_of_contents: Vec<TocItem>,
    pub sections: Vec<SyntheticSection>,
}

pub fn generate_synthetic_pdf(output_path: &str, input: &SyntheticInput) -> Result<()> {
    // 1. Initialize Document (Letter: 612 x 792 points)
    let (doc, page1, layer1) = PdfDocument::new(&input.title, Pt(612.0).into(), Pt(792.0).into(), "Layer 1");
    let current_layer = doc.get_page(page1).get_layer(layer1);
    
    // Load standard Helvetica font
    let font = doc.add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| anyhow!("Failed to load bold font: {:?}", e))?;
    let font_regular = doc.add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| anyhow!("Failed to load regular font: {:?}", e))?;

    // Draw explicit running header/footer (PostScript points)
    current_layer.set_outline_color(Color::Rgb(Rgb::new(0.7, 0.7, 0.7, None)));
    current_layer.set_outline_thickness(1.0);
    
    // Header line
    current_layer.add_line(Line {
        points: vec![
            (Point { x: Pt(50.0), y: Pt(740.0) }, false),
            (Point { x: Pt(562.0), y: Pt(740.0) }, false),
        ],
        is_closed: false,
    });

    // Write Header Text
    current_layer.use_text(&input.title, 10.0, Pt(50.0).into(), Pt(745.0).into(), &font);

    // Write Footer Text
    current_layer.use_text("Page 1", 10.0, Pt(50.0).into(), Pt(40.0).into(), &font_regular);
    
    // Footer line
    current_layer.add_line(Line {
        points: vec![
            (Point { x: Pt(50.0), y: Pt(55.0) }, false),
            (Point { x: Pt(562.0), y: Pt(55.0) }, false),
        ],
        is_closed: false,
    });

    // Write table of contents
    current_layer.use_text("Table of Contents", 14.0, Pt(50.0).into(), Pt(700.0).into(), &font);
    let mut y_offset = 680.0;
    for item in &input.table_of_contents {
        current_layer.use_text(&item.title, 11.0, Pt(60.0).into(), Pt(y_offset).into(), &font_regular);
        y_offset -= 18.0;
    }

    // Draw a section divider line before Chapter heading
    current_layer.add_line(Line {
        points: vec![
            (Point { x: Pt(50.0), y: Pt(y_offset - 10.0) }, false),
            (Point { x: Pt(562.0), y: Pt(y_offset - 10.0) }, false),
        ],
        is_closed: false,
    });
    y_offset -= 30.0;

    // Section Headings & Content blocks
    for section in &input.sections {
        current_layer.use_text(&section.heading, 14.0, Pt(50.0).into(), Pt(y_offset).into(), &font);
        y_offset -= 30.0;

        // Render multi-column blocks to stress-test PostScript parsing.
        // Left Column for paragraph, Right Column for table.
        let left_col_x = 50.0;
        let right_col_x = 320.0;

        for block in &section.blocks {
            if block.block_type == "p" {
                // Render paragraph text with basic line wrapping on left column
                let words: Vec<&str> = block.content.split_whitespace().collect();
                let mut line = String::new();
                let mut y = y_offset;
                for word in words {
                    let temp = if line.is_empty() { word.to_string() } else { format!("{} {}", line, word) };
                    // Approximate character count boundary mapping: 30 chars per line for width
                    if temp.len() > 30 {
                        current_layer.use_text(&line, 11.0, Pt(left_col_x).into(), Pt(y).into(), &font_regular);
                        y -= 15.0;
                        line = word.to_string();
                    } else {
                        line = temp;
                    }
                }
                if !line.is_empty() {
                    current_layer.use_text(&line, 11.0, Pt(left_col_x).into(), Pt(y).into(), &font_regular);
                }
            } else if block.block_type == "table" {
                // Draw table matrix lines
                let table_y_top = y_offset + 10.0;
                let cell_height = 20.0;
                let num_rows = 2;
                let num_cols = 2;
                let table_width = 200.0;
                let col_w = table_width / num_cols as f32;

                current_layer.set_outline_color(Color::Rgb(Rgb::new(0.5, 0.5, 0.5, None)));
                current_layer.set_outline_thickness(0.7);

                // Draw horizontal lines
                for row in 0..=num_rows {
                    let y = table_y_top - (row as f32 * cell_height);
                    current_layer.add_line(Line {
                        points: vec![
                            (Point { x: Pt(right_col_x), y: Pt(y) }, false),
                            (Point { x: Pt(right_col_x + table_width), y: Pt(y) }, false),
                        ],
                        is_closed: false,
                    });
                }

                // Draw vertical lines
                for col in 0..=num_cols {
                    let x = right_col_x + (col as f32 * col_w);
                    current_layer.add_line(Line {
                        points: vec![
                            (Point { x: Pt(x), y: Pt(table_y_top) }, false),
                            (Point { x: Pt(x), y: Pt(table_y_top - (num_rows as f32 * cell_height)) }, false),
                        ],
                        is_closed: false,
                    });
                }

                // Write cell text
                // Row 0 (Headers)
                current_layer.use_text("speed", 10.0, Pt(right_col_x + 10.0).into(), Pt(table_y_top - 15.0).into(), &font);
                current_layer.use_text("cost", 10.0, Pt(right_col_x + col_w + 10.0).into(), Pt(table_y_top - 15.0).into(), &font);
                // Row 1 (Values)
                current_layer.use_text("100 pages", 10.0, Pt(right_col_x + 10.0).into(), Pt(table_y_top - 35.0).into(), &font_regular);
                current_layer.use_text("$0", 10.0, Pt(right_col_x + col_w + 10.0).into(), Pt(table_y_top - 35.0).into(), &font_regular);
            }
        }
        y_offset -= 80.0;
    }

    // Save PDF output
    let file = File::create(output_path)?;
    doc.save(&mut BufWriter::new(file))
        .map_err(|e| anyhow!("Failed to save PDF: {:?}", e))?;
    
    Ok(())
}
