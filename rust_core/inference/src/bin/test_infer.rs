use inference;

fn main() {
    let model_path = "/Users/josh/gits/doc-ingest-reader/test_artifacts/gemma-3-1b-it-Q4_K_M.gguf";
    inference::initialize_inference_context(model_path).unwrap();
    let prompt = "<bos><start_of_turn>user\nHello, who are you?<end_of_turn>\n<start_of_turn>model\n";
    let output = inference::run_local_inference(prompt).unwrap();
    println!("TEST_INFER_OUTPUT: '{}'", output);
    inference::teardown_inference_context();
}
