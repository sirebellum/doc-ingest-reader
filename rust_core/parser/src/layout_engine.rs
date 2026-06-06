use crate::{LayoutHint, BoundingBox};

pub struct LayoutEngine;

impl LayoutEngine {
    pub fn sort_segments_reading_order(segments: Vec<LayoutHint>) -> Vec<LayoutHint> {
        if segments.is_empty() {
            return segments;
        }

        let mut sorted_by_y = segments;
        sorted_by_y.sort_by(|a, b| {
            let a_y = (a.bounding_box[1] + a.bounding_box[3]) / 2.0;
            let b_y = (b.bounding_box[1] + b.bounding_box[3]) / 2.0;
            b_y.partial_cmp(&a_y).unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut lines: Vec<Vec<LayoutHint>> = Vec::new();
        for seg in sorted_by_y {
            let seg_y = (seg.bounding_box[1] + seg.bounding_box[3]) / 2.0;
            let mut matched_index = None;
            
            for (i, line) in lines.iter().enumerate() {
                let line_y = (line[0].bounding_box[1] + line[0].bounding_box[3]) / 2.0;
                if (seg_y - line_y).abs() < 8.0 {
                    matched_index = Some(i);
                    break;
                }
            }
            
            if let Some(idx) = matched_index {
                lines[idx].push(seg);
            } else {
                lines.push(vec![seg]);
            }
        }

        for line in &mut lines {
            line.sort_by(|a, b| {
                a.bounding_box[0].partial_cmp(&b.bounding_box[0]).unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        lines.into_iter().flatten().collect()
    }

    pub fn compute_reading_order(segments: Vec<LayoutHint>, mid_x: f32) -> Vec<LayoutHint> {
        let mut sorted_segs = segments.clone();
        sorted_segs.sort_by(|a, b| b.bounding_box[1].partial_cmp(&a.bounding_box[1]).unwrap_or(std::cmp::Ordering::Equal));

        let mut lines: Vec<BoundingBox> = Vec::new();
        for seg in &sorted_segs {
            let seg_y_bottom = seg.bounding_box[1];
            let seg_y_top = seg.bounding_box[3];
            let seg_y_center = (seg_y_bottom + seg_y_top) / 2.0;

            let mut found_line = false;
            for line in &mut lines {
                let line_y_bottom = line[1];
                let line_y_top = line[3];
                let line_y_center = (line_y_bottom + line_y_top) / 2.0;

                if (seg_y_center - line_y_center).abs() < 8.0 {
                    line[0] = line[0].min(seg.bounding_box[0]);
                    line[1] = line[1].min(seg.bounding_box[1]);
                    line[2] = line[2].max(seg.bounding_box[2]);
                    line[3] = line[3].max(seg.bounding_box[3]);
                    found_line = true;
                    break;
                }
            }

            if !found_line {
                lines.push(seg.bounding_box);
            }
        }

        let mut left_lines = 0;
        let mut right_lines = 0;
        let mut spanning_lines = 0;

        for line in &lines {
            let x_min = line[0];
            let x_max = line[2];

            if x_max < mid_x {
                left_lines += 1;
            } else if x_min > mid_x {
                right_lines += 1;
            } else {
                spanning_lines += 1;
            }
        }

        let is_double_column = left_lines + right_lines > 2 * spanning_lines && (left_lines > 0 || right_lines > 0);
        
        if is_double_column {
            let mut left_col: Vec<LayoutHint> = Vec::new();
            let mut right_col: Vec<LayoutHint> = Vec::new();
            
            for seg in segments {
                let mid_seg_x = (seg.bounding_box[0] + seg.bounding_box[2]) / 2.0;
                if mid_seg_x < mid_x {
                    left_col.push(seg);
                } else {
                    right_col.push(seg);
                }
            }
            
            let mut sorted = Self::sort_segments_reading_order(left_col);
            sorted.extend(Self::sort_segments_reading_order(right_col));
            sorted
        } else {
            Self::sort_segments_reading_order(segments)
        }
    }
}
