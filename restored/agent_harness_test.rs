import json
import os

def extract_file_from_transcript(transcript_path, file_target_string, output_path):
    print(f"Searching for {file_target_string} in {transcript_path}")
    if not os.path.exists(transcript_path):
        print(f"Not found: {transcript_path}")
        return
        
    found_content = None
    with open(transcript_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                data = json.loads(line)
                if data.get('type') == 'TOOL_RESPONSE':
                    content = data.get('content', '')
                    if file_target_string in content and "File Path:" in content:
                        # Extract the lines of the file.
                        # The view_file output format is:
                        # File Path: `file:///...`
                        # Total Lines: ...
                        # ...
                        # 1: ...
                        # 2: ...
                        lines = content.split('\n')
                        file_lines = []
                        is_code = False
                        for l in lines:
                            if l.startswith('1: '):
                                is_code = True
                            if is_code:
                                if l == 'The above content shows the entire, complete file contents of the requested file.' or l.startswith('The above content shows'):
                                    break
                                # Remove line number
                                idx = l.find(': ')
                                if idx != -1:
                                    file_lines.append(l[idx+2:])
                        if file_lines:
                            found_content = '\n'.join(file_lines)
            except Exception as e:
                pass
                
    if found_content:
        # Save to output_path
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(found_content)
        print(f"Successfully recovered {output_path}")
    else:
        print(f"Could not find {file_target_string}")

# Recover lib.rs from current conversation where it was viewed
extract_file_from_transcript(
    r"C:\Users\blued\.gemini\antigravity\brain\7e386818-8f15-4d76-a222-fc887e8cf9c5\.system_generated\logs\transcript_full.jsonl",
    "lib.rs",
    r"c:\Users\blued\gits\llm-pdf-ingest\rust_core\agent_harness\src\lib.rs"
)

# Recover agent_harness_test.rs from previous conversation where it was viewed or written
extract_file_from_transcript(
    r"C:\Users\blued\.gemini\antigravity\brain\1754ece8-b686-49e6-8070-2481d3fa2fda\.system_generated\logs\transcript_full.jsonl",
    "agent_harness_test.rs",
    r"c:\Users\blued\gits\llm-pdf-ingest\rust_core\agent_harness\tests\agent_harness_test.rs"
)

# Wait, in the previous conversation, it might have been named `tests/delineator_test.rs` which got renamed?
extract_file_from_transcript(
    r"C:\Users\blued\.gemini\antigravity\brain\1754ece8-b686-49e6-8070-2481d3fa2fda\.system_generated\logs\transcript_full.jsonl",
    "delineator_test.rs",
    r"c:\Users\blued\gits\llm-pdf-ingest\rust_core\agent_harness\tests\agent_harness_test.rs"
)
