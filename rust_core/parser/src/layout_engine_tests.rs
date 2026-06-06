#[cfg(test)]
mod tests {
    use crate::layout_engine::LayoutEngine;
    use crate::contracts::LayoutHint;

    #[test]
    fn test_sort_segments_reading_order_single_line() {
        let segments = vec![
            LayoutHint {
                bounding_box: [100.0, 10.0, 150.0, 20.0],
                font_size: 12.0,
                text_snippet: "World".to_string(),
            },
            LayoutHint {
                bounding_box: [10.0, 10.0, 50.0, 20.0],
                font_size: 12.0,
                text_snippet: "Hello".to_string(),
            },
        ];

        let result = LayoutEngine::compute_reading_order(segments, 300.0);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].text_snippet, "Hello");
        assert_eq!(result[1].text_snippet, "World");
    }

    #[test]
    fn test_compute_reading_order_double_column() {
        let segments = vec![
            // Right column (x > 300)
            LayoutHint {
                bounding_box: [310.0, 10.0, 350.0, 20.0],
                font_size: 12.0,
                text_snippet: "Col2".to_string(),
            },
            // Left column (x < 300)
            LayoutHint {
                bounding_box: [10.0, 10.0, 50.0, 20.0],
                font_size: 12.0,
                text_snippet: "Col1".to_string(),
            },
            // Left column bottom
            LayoutHint {
                bounding_box: [10.0, 5.0, 50.0, 15.0],
                font_size: 12.0,
                text_snippet: "Col1Bottom".to_string(),
            },
        ];

        let result = LayoutEngine::compute_reading_order(segments, 300.0);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].text_snippet, "Col1");
        assert_eq!(result[1].text_snippet, "Col1Bottom");
        assert_eq!(result[2].text_snippet, "Col2");
    }
}
