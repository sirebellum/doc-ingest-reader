import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  KeyboardAvoidingView, 
  Platform 
} from 'react-native';

export interface NoteEditorProps {
  annotationId?: string;
  initialColor?: string;
  initialNote?: string;
  initialTags?: string[];
  initialHighlightedText?: string;
  onSearchTags: (query: string) => Promise<string[]>;
  onSave: (color: string, note: string, tags: string[], highlightedText: string) => void;
  onDelete?: () => void;
  onClose?: () => void;
  containerStyle?: any;
}

const HIGHLIGHT_COLORS = [
  'hsl(48, 100%, 65%)',   // Sunburst Yellow
  'hsl(120, 75%, 70%)',   // Neon Lime Green
  'hsl(330, 95%, 75%)',   // Sunset Pink
  'hsl(195, 100%, 75%)',  // Sky Blue
];

/**
 * Premium Contextual Note & Autocomplete Tag Editor.
 * Includes markdown text entries, circular color pickers, and normalized tag badges.
 */
export function NoteEditor({
  annotationId,
  initialColor = HIGHLIGHT_COLORS[0],
  initialNote = '',
  initialTags = [],
  initialHighlightedText = '',
  onSearchTags,
  onSave,
  onDelete,
  onClose,
  containerStyle,
}: NoteEditorProps) {
  const [selectedColor, setSelectedColor] = useState(initialColor);
  const [noteBody, setNoteBody] = useState(initialNote);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [highlightedText, setHighlightedText] = useState(initialHighlightedText);
  const [tagInput, setTagInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Query SQLite tags in real-time as user types into tag inputs
  useEffect(() => {
    const fetchSuggestions = async () => {
      const trimmed = tagInput.trim();
      if (trimmed.length === 0) {
        setSuggestions([]);
        return;
      }
      try {
        const results = await onSearchTags(trimmed);
        // Exclude tags already associated
        const filtered = results.filter(t => !tags.includes(t));
        setSuggestions(filtered.slice(0, 5)); // Limit 5 matching badges
      } catch (err) {
        console.error('[NoteEditor] Failed to search tags:', err);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      fetchSuggestions();
    }, 150);

    return () => clearTimeout(delayDebounceFn);
  }, [tagInput, tags, onSearchTags]);

  const handleAddTag = (rawTag: string) => {
    // SQLite Normalization: lowercase, whitespace-stripped tag name
    const normalized = rawTag.toLowerCase().replace(/\s+/g, '').trim();
    if (normalized && !tags.includes(normalized)) {
      setTags([...tags, normalized]);
    }
    setTagInput('');
    setSuggestions([]);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSave = () => {
    onSave(selectedColor, noteBody.trim(), tags, highlightedText.trim());
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, containerStyle]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          {annotationId ? 'Edit Annotation' : 'New Annotation'}
        </Text>
        {onClose && (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Color Palette Selector */}
        <Text style={styles.sectionTitle}>Highlight Color</Text>
        <View style={styles.colorRow}>
          {HIGHLIGHT_COLORS.map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => setSelectedColor(color)}
              style={[
                styles.colorCircle,
                { backgroundColor: color },
                selectedColor === color && styles.colorCircleSelected,
              ]}
              testID={`color-badge-${color}`}
            />
          ))}
        </View>
 
        {/* Highlighted Text Preview/Editor */}
        <Text style={styles.sectionTitle}>Selected Text to Highlight</Text>
        <TextInput
          placeholder="Text snippet to highlight..."
          placeholderTextColor="hsl(0, 0%, 50%)"
          value={highlightedText}
          onChangeText={setHighlightedText}
          style={styles.highlightedTextInput}
          testID="highlighted-text-input"
        />

        {/* Markdown Notes Area */}
        <Text style={styles.sectionTitle}>Personal Notes (Markdown)</Text>
        <TextInput
          multiline
          placeholder="Write your markdown annotations..."
          placeholderTextColor="hsl(0, 0%, 50%)"
          value={noteBody}
          onChangeText={setNoteBody}
          style={styles.notesInput}
          testID="note-body-input"
        />

        {/* Tags Autocomplete Input */}
        <Text style={styles.sectionTitle}>Tags</Text>
        <View style={styles.tagInputRow}>
          <TextInput
            placeholder="Type tag name..."
            placeholderTextColor="hsl(0, 0%, 50%)"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={() => handleAddTag(tagInput)}
            style={styles.tagInput}
            testID="tag-autocomplete-input"
          />
          <TouchableOpacity
            onPress={() => handleAddTag(tagInput)}
            style={styles.addTagButton}
            testID="tag-add-button"
          >
            <Text style={styles.addTagText}>Add</Text>
          </TouchableOpacity>
        </View>

        {/* Suggestions List */}
        {suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {suggestions.map((suggestion) => (
              <TouchableOpacity
                key={suggestion}
                onPress={() => handleAddTag(suggestion)}
                style={styles.suggestionPill}
                testID={`tag-suggestion-${suggestion}`}
              >
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Active Tag Badge Capsules */}
        <View style={styles.tagsContainer}>
          {tags.map((tag) => (
            <View key={tag} style={styles.tagBadge} testID={`tag-badge-${tag}`}>
              <Text style={styles.tagText}>#{tag}</Text>
              <TouchableOpacity onPress={() => handleRemoveTag(tag)} style={styles.removeTagBadge}>
                <Text style={styles.removeTagText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Actions Button Panel */}
        <View style={styles.actionRow}>
          {onDelete && (
            <TouchableOpacity onPress={onDelete} style={styles.deleteButton} testID="delete-annotation-button">
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleSave} style={styles.saveButton} testID="save-annotation-button">
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'hsl(220, 12%, 14%)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'hsl(220, 12%, 20%)',
    paddingBottom: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'hsl(210, 100%, 75%)',
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 18,
    color: 'hsl(0, 0%, 70%)',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'hsl(0, 0%, 75%)',
    marginTop: 14,
    marginBottom: 8,
  },
  colorRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorCircleSelected: {
    borderColor: '#ffffff',
    transform: [{ scale: 1.1 }],
  },
  notesInput: {
    backgroundColor: 'hsl(220, 15%, 8%)',
    borderColor: 'hsl(220, 12%, 24%)',
    borderWidth: 1,
    borderRadius: 8,
    color: 'hsl(0, 0%, 90%)',
    padding: 12,
    fontSize: 15,
    height: 120,
    textAlignVertical: 'top',
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagInput: {
    flex: 1,
    backgroundColor: 'hsl(220, 15%, 8%)',
    borderColor: 'hsl(220, 12%, 24%)',
    borderWidth: 1,
    borderRadius: 8,
    color: 'hsl(0, 0%, 90%)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addTagButton: {
    backgroundColor: 'hsl(210, 100%, 75%)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginLeft: 8,
  },
  addTagText: {
    color: 'hsl(220, 15%, 8%)',
    fontWeight: 'bold',
    fontSize: 14,
  },
  suggestionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: 'hsl(220, 15%, 10%)',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderColor: 'hsl(220, 12%, 20%)',
    borderWidth: 1,
  },
  suggestionPill: {
    backgroundColor: 'hsl(220, 12%, 22%)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    margin: 4,
  },
  suggestionText: {
    color: 'hsl(210, 100%, 80%)',
    fontSize: 13,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    marginBottom: 20,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'hsl(220, 12%, 24%)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: 'hsl(210, 100%, 75%)',
    fontSize: 13,
    fontWeight: '600',
  },
  removeTagBadge: {
    marginLeft: 6,
    padding: 2,
  },
  removeTagText: {
    fontSize: 10,
    color: 'hsl(0, 0%, 60%)',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'hsl(220, 12%, 20%)',
    paddingTop: 16,
    marginTop: 12,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: 'hsl(350, 80%, 35%)',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  saveButton: {
    flex: 1,
    backgroundColor: 'hsl(210, 100%, 75%)',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: 'hsl(220, 15%, 8%)',
    fontWeight: 'bold',
    fontSize: 14,
  },
  highlightedTextInput: {
    backgroundColor: 'hsl(220, 15%, 8%)',
    borderColor: 'hsl(220, 12%, 24%)',
    borderWidth: 1,
    borderRadius: 8,
    color: 'hsl(0, 0%, 90%)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 8,
  },
});
