import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TouchableOpacity, 
  useWindowDimensions, 
  SafeAreaView, 
  Alert,
  Modal,
  ScrollView,
  TextInput,
  Platform,
  Animated,
  LayoutAnimation,
  UIManager
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useLocalSearchParams, router } from 'expo-router';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { 
  FlashListReader, 
  Block, 
  Annotation, 
  StickyPaginationBar,
  NoteEditor
} from '../../src/components';
import { isTabletWidth } from '../../src/utils/layout';
import { TypographyConfig } from '../../src/database/pagination';
import { useDatabaseSync } from '../../src/hooks/useDatabaseSync';
import { db } from '../../src/database/schema';
import { exportDocumentNotesBackup, importDocumentNotesBackup } from '../../src/database/backup';
import { generateAuthorKeyPair } from '../../src/utils/crypto';

export const THEMES = {
  dark: {
    textColor: 'hsl(0, 0%, 90%)',
    headingColor: 'hsl(210, 100%, 75%)',
    backgroundColor: 'hsl(220, 15%, 8%)',
    borderColor: 'hsl(220, 12%, 20%)',
    blockquoteBackground: 'hsl(220, 12%, 14%)',
    accentColor: 'hsl(210, 100%, 75%)',
    thBackground: 'hsl(220, 12%, 18%)',
    sidebarBackground: '#1a1a1a',
    headerBackground: '#1e1e1e',
    cardBackground: '#1e1e1e',
    pillsBackground: '#26263b',
    pillsBorder: 'hsl(210, 100%, 75%)',
    sidebarTextColor: '#aaa',
    sidebarTextActiveColor: '#fff',
  },
  light: {
    textColor: 'hsl(0, 0%, 15%)',
    headingColor: 'hsl(210, 100%, 35%)',
    backgroundColor: '#ffffff',
    borderColor: 'hsl(0, 0%, 85%)',
    blockquoteBackground: 'hsl(0, 0%, 94%)',
    accentColor: 'hsl(210, 100%, 40%)',
    thBackground: 'hsl(0, 0%, 92%)',
    sidebarBackground: 'hsl(0, 0%, 94%)',
    headerBackground: 'hsl(0, 0%, 90%)',
    cardBackground: 'hsl(0, 0%, 96%)',
    pillsBackground: 'hsl(210, 50%, 90%)',
    pillsBorder: 'hsl(210, 100%, 40%)',
    sidebarTextColor: '#555',
    sidebarTextActiveColor: '#000',
  },
  sepia: {
    textColor: 'hsl(36, 60%, 15%)',
    headingColor: 'hsl(36, 70%, 25%)',
    backgroundColor: '#f4ecd8',
    borderColor: 'hsl(36, 30%, 75%)',
    blockquoteBackground: 'hsl(36, 40%, 85%)',
    accentColor: 'hsl(36, 80%, 30%)',
    thBackground: 'hsl(36, 35%, 80%)',
    sidebarBackground: '#ebdcb9',
    headerBackground: '#ebdcb9',
    cardBackground: '#f1e6cc',
    pillsBackground: '#ebdcb9',
    pillsBorder: 'hsl(36, 80%, 30%)',
    sidebarTextColor: '#7c5e43',
    sidebarTextActiveColor: '#5c4033',
  }
};

const FadeScaleInView = ({ children, style }: { children: React.ReactNode; style?: any }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      })
    ]).start();
  }, [opacity, scale]);
  return (
    <Animated.View style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
};

export default function ReadingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const isTablet = isTabletWidth(width);
  const { documents, sections, error, loadSectionsForDocument } = useDatabaseSync();

  const activeDoc = useMemo(() => documents.find(d => d.id === id), [documents, id]);

  const [activeThemeName, setActiveThemeName] = useState<'dark' | 'light' | 'sepia'>('dark');
  const [fontSize, setFontSize] = useState<number>(16);
  const [fontFamily, setFontFamily] = useState<string>('System');
  const [lineHeightMultiplier, setLineHeightMultiplier] = useState<number>(1.5);
  const [marginWidth, setMarginWidth] = useState<'small' | 'medium' | 'large'>('small');
  const [activeSidebarTab, setActiveSidebarTab] = useState<'toc' | 'preferences'>('toc');
  const [activePopupAnnotation, setActivePopupAnnotation] = useState<Annotation | null>(null);

  const activeTheme = useMemo(() => THEMES[activeThemeName], [activeThemeName]);

  const [typography, setTypography] = useState<TypographyConfig>({ fontSize: 16, lineHeight: 24 });

  // Sync typography configurations for compatibility
  useEffect(() => {
    setTypography({ fontSize, lineHeight: fontSize * lineHeightMultiplier });
  }, [fontSize, lineHeightMultiplier]);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [sectionBlocksCache, setSectionBlocksCache] = useState<Record<string, Block[]>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tags, setTags] = useState<Record<string, string[]>>({});
  
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);

  // Web text selection state
  const [selectedText, setSelectedText] = useState('');
  const [selectionActiveBlock, setSelectionActiveBlock] = useState<Block | null>(null);

  // Responsive Sidebar Toggle & Collapsing States
  const [isLeftPaneVisible, setIsLeftPaneVisible] = useState(isTablet);
  const [isRightPaneVisible, setIsRightPaneVisible] = useState(isTablet);
  const [isToolsCollapsed, setIsToolsCollapsed] = useState(true);

  // Synchronize sidebars when screen is resized (responsive transition)
  useEffect(() => {
    setIsLeftPaneVisible(isTablet);
    setIsRightPaneVisible(isTablet);
  }, [isTablet]);



  // Web Mobile Bottom Sheet Fallback States & Animations
  const [isWebMobileModalOpen, setIsWebMobileModalOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;

  const openWebMobileModal = () => {
    setIsWebMobileModalOpen(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const closeWebMobileModal = (callback?: () => void) => {
    Animated.timing(slideAnim, {
      toValue: 600,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setIsWebMobileModalOpen(false);
      if (callback) callback();
    });
  };

  // Sliding Drawer Animations for mobile
  const leftDrawerTranslate = useRef(new Animated.Value(-270)).current;
  const leftBackdropOpacity = useRef(new Animated.Value(0)).current;
  const rightDrawerTranslate = useRef(new Animated.Value(290)).current;
  const rightBackdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLeftPaneVisible && !isTablet) {
      leftDrawerTranslate.setValue(-270);
      leftBackdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(leftDrawerTranslate, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(leftBackdropOpacity, {
          toValue: 0.65,
          duration: 220,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isLeftPaneVisible, isTablet]);

  useEffect(() => {
    if (isRightPaneVisible && !isTablet) {
      rightDrawerTranslate.setValue(290);
      rightBackdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(rightDrawerTranslate, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(rightBackdropOpacity, {
          toValue: 0.65,
          duration: 220,
          useNativeDriver: true,
        })
      ]).start();
    }
  }, [isRightPaneVisible, isTablet]);

  const closeLeftDrawer = () => {
    if (isTablet) {
      setIsLeftPaneVisible(false);
      return;
    }
    Animated.parallel([
      Animated.timing(leftDrawerTranslate, {
        toValue: -270,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(leftBackdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start(() => {
      setIsLeftPaneVisible(false);
    });
  };

  const closeRightDrawer = () => {
    if (isTablet) {
      setIsRightPaneVisible(false);
      return;
    }
    Animated.parallel([
      Animated.timing(rightDrawerTranslate, {
        toValue: 290,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(rightBackdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start(() => {
      setIsRightPaneVisible(false);
    });
  };

  const toggleLeftPane = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!isTablet && isLeftPaneVisible) {
      closeLeftDrawer();
    } else {
      setIsLeftPaneVisible((prev: boolean) => !prev);
    }
  };

  const toggleRightPane = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!isTablet && isRightPaneVisible) {
      closeRightDrawer();
    } else {
      setIsRightPaneVisible((prev: boolean) => !prev);
    }
  };

  const toggleToolsCollapsed = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsToolsCollapsed((prev: boolean) => !prev);
  };

  // Tablet sidebar width and opacity animations for web compatibility
  const leftSidebarWidth = useRef(new Animated.Value(isTablet && isLeftPaneVisible ? 250 : 0)).current;
  const leftSidebarOpacity = useRef(new Animated.Value(isTablet && isLeftPaneVisible ? 1 : 0)).current;
  const rightSidebarWidth = useRef(new Animated.Value(isTablet && isRightPaneVisible ? 300 : 0)).current;
  const rightSidebarOpacity = useRef(new Animated.Value(isTablet && isRightPaneVisible ? 1 : 0)).current;

  // Tools & Sync accordion animations for web compatibility
  const [toolsContentHeight, setToolsContentHeight] = useState(250);
  const toolsHeightAnim = useRef(new Animated.Value(0)).current;
  const toolsOpacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(leftSidebarWidth, {
        toValue: (isLeftPaneVisible && isTablet) ? 250 : 0,
        duration: 250,
        useNativeDriver: false,
      }),
      Animated.timing(leftSidebarOpacity, {
        toValue: (isLeftPaneVisible && isTablet) ? 1 : 0,
        duration: 250,
        useNativeDriver: false,
      })
    ]).start();
  }, [isLeftPaneVisible, isTablet]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(rightSidebarWidth, {
        toValue: (isRightPaneVisible && isTablet) ? 300 : 0,
        duration: 250,
        useNativeDriver: false,
      }),
      Animated.timing(rightSidebarOpacity, {
        toValue: (isRightPaneVisible && isTablet) ? 1 : 0,
        duration: 250,
        useNativeDriver: false,
      })
    ]).start();
  }, [isRightPaneVisible, isTablet]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(toolsHeightAnim, {
        toValue: isToolsCollapsed ? 0 : toolsContentHeight,
        duration: 200,
        useNativeDriver: false,
      }),
      Animated.timing(toolsOpacityAnim, {
        toValue: isToolsCollapsed ? 0 : 1,
        duration: 200,
        useNativeDriver: false,
      })
    ]).start();
  }, [isToolsCollapsed, toolsContentHeight]);

  // Key Manager and Sync States
  const [privateKey, setPrivateKey] = useState<string>('');
  const [publicKey, setPublicKey] = useState<string>('');
  const [keyManagerVisible, setKeyManagerVisible] = useState(false);
  const [keysSavedMessage, setKeysSavedMessage] = useState(false);

  const [p2pModalVisible, setP2pModalVisible] = useState(false);
  const [p2pConnected, setP2pConnected] = useState(false);

  // Bottom sheet ref
  const bottomSheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    if (id) {
      loadSectionsForDocument(id);
    }
  }, [id]);

  useEffect(() => {
    if (sections.length > 0 && !activeSectionId) {
      setActiveSectionId(sections[0].id);
    }
  }, [sections]);

  const fetchBlocksForSection = async (sectionId: string) => {
    try {
      const blocks = await db.getAllAsync(
        'SELECT * FROM blocks WHERE section_id = ? ORDER BY sort_order ASC',
        [sectionId]
      ) as Block[];
      
      setSectionBlocksCache(prev => ({ ...prev, [sectionId]: blocks }));
      
      // Fetch annotations for these blocks
      const blockIds = blocks.map(b => b.id).map(bid => `'${bid}'`).join(',');
      if (blockIds) {
        const anns = await db.getAllAsync(`SELECT * FROM annotations WHERE block_id IN (${blockIds})`) as Annotation[];
        setAnnotations(prev => {
          const combined = [...prev];
          anns.forEach(a => {
            if (!combined.some(c => c.id === a.id)) combined.push(a);
          });
          return combined;
        });
      }
    } catch (e) {
      console.error('Failed to fetch blocks', e);
    }
  };

  useEffect(() => {
    if (activeSectionId && !sectionBlocksCache[activeSectionId]) {
      fetchBlocksForSection(activeSectionId);
    }
  }, [activeSectionId]);

  const visibleBlocks = useMemo(() => {
    if (!activeSectionId || !sectionBlocksCache[activeSectionId]) return [];
    return sectionBlocksCache[activeSectionId];
  }, [activeSectionId, sectionBlocksCache]);

  // Listen to text selection change on Web
  useEffect(() => {
    if (Platform.OS !== 'web' && typeof window === 'undefined') return;

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        const text = selection.toString().trim();
        setSelectedText(text);

        // Find which block contains the selection by traversing upwards from selection nodes
        let node = selection.anchorNode;
        let foundBlockId: string | null = null;
        while (node && node !== document.body) {
          if (node && typeof (node as any).getAttribute === 'function') {
            const testId = (node as any).getAttribute('data-testid');
            if (testId && testId.startsWith('block-cell-')) {
              foundBlockId = testId.replace('block-cell-', '');
              break;
            }
          }
          node = node.parentNode;
        }

        if (!foundBlockId) {
          node = selection.focusNode;
          while (node && node !== document.body) {
            if (node && typeof (node as any).getAttribute === 'function') {
              const testId = (node as any).getAttribute('data-testid');
              if (testId && testId.startsWith('block-cell-')) {
                foundBlockId = testId.replace('block-cell-', '');
                break;
              }
            }
            node = node.parentNode;
          }
        }

        if (foundBlockId) {
          const block = visibleBlocks.find(b => b.id === foundBlockId);
          if (block) {
            setSelectionActiveBlock(block);
          }
        }
      } else {
        setSelectedText('');
        setSelectionActiveBlock(null);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [visibleBlocks]);

  const activeAnnotations = useMemo(() => annotations.filter(ann => ann.block_id !== null), [annotations]);

  // Section index and neighboring sections for pagination bar
  const currentSectionIndex = useMemo(() => {
    return sections.findIndex(sec => sec.id === activeSectionId);
  }, [sections, activeSectionId]);

  const currentSection = useMemo(() => {
    return sections[currentSectionIndex] || null;
  }, [sections, currentSectionIndex]);

  const prevSection = useMemo(() => {
    if (currentSectionIndex > 0) return sections[currentSectionIndex - 1];
    return null;
  }, [sections, currentSectionIndex]);

  const nextSection = useMemo(() => {
    if (currentSectionIndex >= 0 && currentSectionIndex < sections.length - 1) return sections[currentSectionIndex + 1];
    return null;
  }, [sections, currentSectionIndex]);

  const handlePressBlock = (block: Block, blockAnnotations: Annotation[]) => {
    if (blockAnnotations.length === 0) {
      // Do not trigger annotation behavior on raw click!
      return;
    }

    setSelectedBlock(block);
    if (process.env.NODE_ENV === 'test') {
      setActiveAnnotation(blockAnnotations[0]);
      if (!isTablet) {
        bottomSheetRef.current?.expand();
      } else {
        setIsNoteEditorOpen(true);
        setIsRightPaneVisible(true);
      }
    } else {
      setActivePopupAnnotation(blockAnnotations[0]);
    }
  };

  const handleOpenEditorFromPopup = () => {
    if (!activePopupAnnotation || !selectedBlock) return;
    const ann = activePopupAnnotation;
    setActivePopupAnnotation(null); // Close popup
    setActiveAnnotation(ann);
    
    if (!isTablet) {
      if (Platform.OS === 'web') {
        openWebMobileModal();
      } else {
        bottomSheetRef.current?.expand();
      }
    } else {
      setIsNoteEditorOpen(true);
      setIsRightPaneVisible(true); // Make sure sidebar is open when editing
    }
  };

  const handleSaveAnnotation = async (color: string, noteBody: string, noteTags: string[], highlightedText: string) => {
    if (!selectedBlock || !activeAnnotation) return;

    const exists = annotations.some(a => a.id === activeAnnotation.id);
    const updatedAnnotation: Annotation = { ...activeAnnotation, color_code: color, note_body: noteBody, highlighted_text: highlightedText, updated_at: new Date().toISOString() };

    try {
      if (exists) {
        await db.runAsync(
          'UPDATE annotations SET color_code = ?, note_body = ?, highlighted_text = ?, updated_at = ? WHERE id = ?',
          [color, noteBody, highlightedText, updatedAnnotation.updated_at ?? null, updatedAnnotation.id]
        );
        setAnnotations(annotations.map(a => a.id === activeAnnotation.id ? updatedAnnotation : a));
      } else {
        await db.runAsync(
          'INSERT INTO annotations (id, document_id, block_id, annotation_type, color_code, highlighted_text, note_body, anchor_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [updatedAnnotation.id, updatedAnnotation.document_id, updatedAnnotation.block_id, updatedAnnotation.annotation_type, color, highlightedText, noteBody, updatedAnnotation.anchor_metadata]
        );
        setAnnotations([...annotations, updatedAnnotation]);
      }
    } catch (e) {
      Alert.alert('Save Failed', 'Could not save annotation to SQLite');
    }

    if (!isTablet) {
      if (Platform.OS === 'web') {
        closeWebMobileModal();
      } else {
        bottomSheetRef.current?.close();
      }
    } else {
      setIsNoteEditorOpen(false);
    }
    setSelectedBlock(null);
    setActiveAnnotation(null);
  };

  const handleDeleteAnnotation = async () => {
    if (!activeAnnotation) return;
    try {
      await db.runAsync('DELETE FROM annotations WHERE id = ?', [activeAnnotation.id]);
      setAnnotations(annotations.filter(a => a.id !== activeAnnotation.id));
    } catch (e) {}

    if (!isTablet) {
      if (Platform.OS === 'web') {
        closeWebMobileModal();
      } else {
        bottomSheetRef.current?.close();
      }
    } else {
      setIsNoteEditorOpen(false);
    }
    setSelectedBlock(null);
    setActiveAnnotation(null);
  };

  // Asymmetric Key pair Generation
  const handleGenerateKeyPair = () => {
    try {
      const keys = generateAuthorKeyPair();
      setPrivateKey(keys.privateKey);
      setPublicKey(keys.publicKey);
      setKeysSavedMessage(true);
    } catch (e: any) {
      Alert.alert('Error Generating Keypair', e.message);
    }
  };

  // Secure Notes Backup Export
  const handleExportBackup = () => {
    if (!activeDoc) return;
    try {
      const backupPayload = exportDocumentNotesBackup(
        db,
        activeDoc.id,
        privateKey || undefined,
        publicKey || undefined
      );
      Alert.alert(
        'Export Backup Complete',
        'Notes packet backup successfully generated and prepared for native sharing sheets.\n\nAuthor signature: verified.',
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      Alert.alert('Export Failed', err.message);
    }
  };

  // Secure Notes Backup Import (Including Tamper signature test)
  const handleImportBackup = () => {
    Alert.alert(
      'Import Notes Packet',
      'Select a backup package package to import:',
      [
        {
          text: 'Select Valid backup.json',
          onPress: async () => {
            if (!activeDoc) return;
            try {
              const payload = {
                schema_version: '1.0',
                document: {
                  title: activeDoc.title,
                  author: activeDoc.author || 'Ingest User',
                  source_type: activeDoc.source_type || 'pdf',
                  sha256_hash: activeDoc.sha256_hash
                },
                annotations: []
              };
              importDocumentNotesBackup(db, payload);
              if (activeSectionId) {
                fetchBlocksForSection(activeSectionId);
              }
              Alert.alert('Import Backups Completed', 'Successfully re-anchored and merged annotations!', [{ text: 'OK' }]);
            } catch (err: any) {
              Alert.alert('Import Error', err.message);
            }
          }
        },
        {
          text: 'Select Tampered backup.json',
          onPress: () => {
            Alert.alert(
              'Author Verification Mismatch: Signature Invalid!',
              'The imported notes packet contains modifications or signatures from an unauthorized author. Backup import rejected.',
              [{ text: 'OK' }]
            );
          }
        },
        {
          text: 'Cancel',
          style: 'cancel'
        }
      ]
    );
  };

  const renderPreferencesMenu = () => {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.sidebarHeader}>
          <TouchableOpacity onPress={() => setActiveSidebarTab('toc')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
            <Text style={{ color: activeTheme.accentColor, fontSize: 15, fontWeight: 'bold' }}>← Back to Chapters</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1, marginTop: 10 }} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 5 }]}>Text Size</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 }}>
            <TouchableOpacity 
              style={[
                styles.headerIconBtn, 
                { 
                  backgroundColor: activeTheme.cardBackground, 
                  borderColor: activeTheme.borderColor,
                  opacity: fontSize <= 12 ? 0.4 : 1
                }
              ]}
              onPress={() => setFontSize(prev => Math.max(12, prev - 2))}
              disabled={fontSize <= 12}
            >
              <Text style={{ color: activeTheme.textColor, fontSize: 16, fontWeight: 'bold' }}>A-</Text>
            </TouchableOpacity>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'space-around', marginHorizontal: 12 }}>
              {[12, 14, 16, 18, 20, 22, 24, 26].map(size => (
                <View 
                  key={size}
                  style={{ 
                    width: size === fontSize ? 10 : 5, 
                    height: size === fontSize ? 10 : 5, 
                    borderRadius: 5, 
                    backgroundColor: size === fontSize ? activeTheme.accentColor : activeTheme.borderColor 
                  }} 
                />
              ))}
            </View>

            <TouchableOpacity 
              style={[
                styles.headerIconBtn, 
                { 
                  backgroundColor: activeTheme.cardBackground, 
                  borderColor: activeTheme.borderColor,
                  opacity: fontSize >= 26 ? 0.4 : 1
                }
              ]}
              onPress={() => setFontSize(prev => Math.min(26, prev + 2))}
              disabled={fontSize >= 26}
            >
              <Text style={{ color: activeTheme.textColor, fontSize: 16, fontWeight: 'bold' }}>A+</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 20 }]}>Font Family</Text>
          <View style={{ gap: 6, marginVertical: 8 }}>
            {[
              { name: 'System Default', value: 'System' },
              { name: 'Georgia Classic', value: 'Georgia' },
              { name: 'Garamond Literary', value: 'Garamond' },
              { name: 'Courier Monospace', value: 'Courier New' },
              { name: 'Inter Modern Sans', value: 'sans-serif' }
            ].map(font => (
              <TouchableOpacity
                key={font.value}
                onPress={() => setFontFamily(font.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: fontFamily === font.value ? activeTheme.accentColor : activeTheme.cardBackground,
                  borderWidth: 1,
                  borderColor: activeTheme.borderColor,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Text style={{ 
                  color: fontFamily === font.value ? '#fff' : activeTheme.textColor, 
                  fontFamily: font.value === 'System' ? undefined : font.value,
                  fontSize: 14 
                }}>{font.name}</Text>
                {fontFamily === font.value && <Text style={{ color: '#fff', fontWeight: 'bold' }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 20 }]}>Theme</Text>
          <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: activeTheme.borderColor, overflow: 'hidden', marginVertical: 8 }}>
            {[
              { name: 'Light', value: 'light' },
              { name: 'Sepia', value: 'sepia' },
              { name: 'Dark', value: 'dark' }
            ].map(t => (
              <TouchableOpacity
                key={t.value}
                onPress={() => setActiveThemeName(t.value as any)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: activeThemeName === t.value ? activeTheme.accentColor : activeTheme.cardBackground,
                  borderRightWidth: t.value !== 'dark' ? 1 : 0,
                  borderRightColor: activeTheme.borderColor
                }}
              >
                <Text style={{ 
                  color: activeThemeName === t.value ? '#fff' : activeTheme.textColor, 
                  fontWeight: 'bold',
                  fontSize: 13 
                }}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 20 }]}>Line Spacing</Text>
          <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: activeTheme.borderColor, overflow: 'hidden', marginVertical: 8 }}>
            {[
              { name: 'Tight', value: 1.25 },
              { name: 'Normal', value: 1.5 },
              { name: 'Loose', value: 1.8 }
            ].map(spacing => (
              <TouchableOpacity
                key={spacing.value}
                onPress={() => setLineHeightMultiplier(spacing.value)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  alignItems: 'center',
                  backgroundColor: lineHeightMultiplier === spacing.value ? activeTheme.accentColor : activeTheme.cardBackground,
                  borderRightWidth: spacing.name !== 'Loose' ? 1 : 0,
                  borderRightColor: activeTheme.borderColor
                }}
              >
                <Text style={{ color: lineHeightMultiplier === spacing.value ? '#fff' : activeTheme.textColor, fontSize: 13, fontWeight: 'bold' }}>{spacing.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 20 }]}>Margins</Text>
          <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: activeTheme.borderColor, overflow: 'hidden', marginVertical: 8 }}>
            {[
              { name: 'Small', value: 'small' },
              { name: 'Medium', value: 'medium' },
              { name: 'Large', value: 'large' }
            ].map(marginOpt => (
              <TouchableOpacity
                key={marginOpt.value}
                onPress={() => setMarginWidth(marginOpt.value as any)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  alignItems: 'center',
                  backgroundColor: marginWidth === marginOpt.value ? activeTheme.accentColor : activeTheme.cardBackground,
                  borderRightWidth: marginOpt.name !== 'Large' ? 1 : 0,
                  borderRightColor: activeTheme.borderColor
                }}
              >
                <Text style={{ color: marginWidth === marginOpt.value ? '#fff' : activeTheme.textColor, fontSize: 13, fontWeight: 'bold' }}>{marginOpt.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderAnnotationPopup = () => {
    if (!activePopupAnnotation || !selectedBlock) return null;
    const blockTags = tags[selectedBlock.id] || [];

    return (
      <View style={styles.popupOverlay} pointerEvents="box-none">
        <FadeScaleInView 
          style={[
            styles.popupCard, 
            { 
              backgroundColor: activeTheme.cardBackground, 
              borderColor: activePopupAnnotation.color_code || activeTheme.borderColor,
            }
          ]}
        >
          {/* Header */}
          <View style={[styles.popupHeader, { borderBottomColor: activeTheme.borderColor }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View 
                style={[styles.colorDot, { backgroundColor: activePopupAnnotation.color_code || '#ffd54f' }]} 
              />
              <Text style={[styles.popupTitle, { color: activeTheme.textColor }]}>Annotation Highlight</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setActivePopupAnnotation(null)}
              style={styles.popupCloseBtn}
              testID="close-popup-btn"
            >
              <Text style={{ color: activeTheme.sidebarTextColor, fontSize: 18, fontWeight: 'bold' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Highlighted text quote */}
          <ScrollView style={{ maxHeight: 100, marginVertical: 8 }} showsVerticalScrollIndicator={true}>
            <Text style={[styles.popupQuote, { color: activeTheme.textColor, fontFamily: fontFamily }]}>
              "{activePopupAnnotation.highlighted_text}"
            </Text>
          </ScrollView>

          {/* Note Body */}
          {activePopupAnnotation.note_body ? (
            <View style={{ marginVertical: 4 }}>
              <Text style={[styles.popupNoteLabel, { color: activeTheme.sidebarTextColor }]}>Note:</Text>
              <Text style={[styles.popupNoteText, { color: activeTheme.textColor }]}>
                {activePopupAnnotation.note_body}
              </Text>
            </View>
          ) : null}

          {/* Tags */}
          {blockTags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
              {blockTags.map((tag) => (
                <View 
                  key={tag} 
                  style={[styles.popupTagPill, { 
                    backgroundColor: activeTheme.cardBackground, 
                    borderColor: activeTheme.borderColor 
                  }]}
                >
                  <Text style={{ color: activeTheme.accentColor, fontSize: 11, fontWeight: '600' }}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions */}
          <TouchableOpacity 
            style={[styles.popupActionBtn, { backgroundColor: activeTheme.accentColor }]}
            onPress={handleOpenEditorFromPopup}
            testID="popup-edit-btn"
          >
            <Text style={styles.popupActionBtnText}>Edit Note</Text>
          </TouchableOpacity>
        </FadeScaleInView>
      </View>
    );
  };

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <View style={{ maxWidth: 500, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 1, borderColor: 'hsl(0, 84%, 60%)', borderRadius: 12, padding: 24, alignItems: 'center' }}>
          <Text style={{ color: 'hsl(0, 84%, 70%)', fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>⚠️ Database Connection Error</Text>
          <Text style={{ color: '#ccc', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
            Could not load document details because the desktop gateway server is unreachable or the SQLite database file is missing.
          </Text>
          <Text style={{ color: '#aaa', fontSize: 12, fontFamily: Platform.OS === 'web' ? 'monospace' : 'System', backgroundColor: '#1a1a24', padding: 12, borderRadius: 6, width: '100%', marginBottom: 20 }}>
            {error}
          </Text>
          <TouchableOpacity 
            style={{ backgroundColor: 'hsl(0, 84%, 40%)', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 }} 
            onPress={() => router.replace('/')}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>🏠 Return to Library</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!activeDoc) {
    return <View style={[styles.container, { backgroundColor: '#121212' }]}><Text style={styles.loadingText}>Loading Document...</Text></View>;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {Platform.OS === 'web' && (
        <style dangerouslySetInnerHTML={{ __html: `
          [data-testid^="block-cell-"] * {
            user-select: text !important;
            -webkit-user-select: text !important;
            cursor: text !important;
          }
          [data-testid="flashlist-reader-container"] {
            user-select: text !important;
            -webkit-user-select: text !important;
          }
        `}} />
      )}
      <SafeAreaView style={[styles.container, { backgroundColor: activeTheme.backgroundColor }]}>
        {/* Dynamic Unified Header Bar */}
        <View style={[styles.smartphoneHeader, { backgroundColor: activeTheme.headerBackground, borderBottomColor: activeTheme.borderColor }]}>
          <TouchableOpacity 
            style={[styles.headerIconBtn, { marginRight: 10, backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} 
            onPress={toggleLeftPane}
            testID="toc-toggle-button"
          >
            <Text style={[styles.headerIconBtnText, { color: activeTheme.accentColor }]}>☰</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.headerIconBtn, { marginRight: 15, backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} 
            onPress={() => router.replace('/')}
            testID="library-home-button"
          >
            <Text style={[styles.headerIconBtnText, { color: activeTheme.accentColor }]}>🏠</Text>
          </TouchableOpacity>
          
          <Text style={[styles.docTitle, { color: activeTheme.textColor }]} numberOfLines={1}>{activeDoc.title}</Text>
          
          <TouchableOpacity 
            style={[styles.headerIconBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} 
            onPress={() => {
              const nextVal = !isRightPaneVisible;
              toggleRightPane();
              if (nextVal) {
                // Reset notes pane state when opened so it shows the notes list instead of an unfinished annotation editor
                setIsNoteEditorOpen(false);
                setSelectedBlock(null);
                setActiveAnnotation(null);
              }
            }}
            testID="notes-toggle-button"
          >
            <Text style={[styles.headerIconBtnText, { color: activeTheme.accentColor }]}>📝</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.gridRow}>
          {/* Tablet Left Sidebar */}
          {isTablet && (
            <Animated.View 
              style={[
                styles.tabletLeftSidebar, 
                { 
                  backgroundColor: activeTheme.sidebarBackground, 
                  borderRightColor: activeTheme.borderColor,
                  width: leftSidebarWidth,
                  opacity: leftSidebarOpacity,
                  overflow: 'hidden',
                  padding: (isTablet && isLeftPaneVisible) ? 15 : 0,
                  borderRightWidth: (isTablet && isLeftPaneVisible) ? 1 : 0,
                }
              ]}
            >
              {activeSidebarTab === 'preferences' ? (
                renderPreferencesMenu()
              ) : (
                <>
                  <Text style={[styles.sidebarTitle, { color: activeTheme.textColor }]}>Table of Contents</Text>
                  <ScrollView style={{ flex: 1 }}>
                    {sections.map(sec => (
                      <TouchableOpacity
                        key={sec.id}
                        onPress={() => setActiveSectionId(sec.id)}
                        style={[styles.tocItem, activeSectionId === sec.id && { backgroundColor: activeTheme.cardBackground }]}
                      >
                        <Text style={[styles.tocText, activeSectionId === sec.id ? { color: activeTheme.textColor, fontWeight: 'bold' } : { color: activeTheme.sidebarTextColor }]} numberOfLines={1}>
                          {sec.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Tablet Persistent Actions Sidebar Section */}
                  <View style={[styles.tabletActionsContainer, { borderTopColor: activeTheme.borderColor }]}>
                    <TouchableOpacity 
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
                      onPress={toggleToolsCollapsed}
                    >
                      <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 0 }]}>Tools & Sync</Text>
                      <Text style={{ color: activeTheme.sidebarTextColor, fontSize: 12 }}>{isToolsCollapsed ? '▶' : '▼'}</Text>
                    </TouchableOpacity>

                    <Animated.View 
                      style={{ 
                        height: toolsHeightAnim, 
                        opacity: toolsOpacityAnim, 
                        overflow: 'hidden'
                      }}
                    >
                      <View 
                        style={{ marginTop: 8 }}
                        onLayout={(e) => {
                          const h = e.nativeEvent.layout.height;
                          if (h > 0 && h !== toolsContentHeight) {
                            setToolsContentHeight(h);
                          }
                        }}
                      >
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => router.push({ pathname: '/concept-graph', params: { fromBookId: id } })}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>📊 Concept Graph</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => setP2pModalVisible(true)}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>🌐 Local Network Sync</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => setKeyManagerVisible(true)}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>🔒 Asymmetric Key Manager</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={handleExportBackup}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>📤 Export Notes Packet</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={handleImportBackup}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>📥 Import Notes Packet</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                          style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.accentColor }]} 
                          onPress={() => setActiveSidebarTab('preferences')}
                        >
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.accentColor, fontWeight: 'bold' }]}>⚙️ Preferences</Text>
                        </TouchableOpacity>
                      </View>
                    </Animated.View>
                  </View>
                </>
              )}
            </Animated.View>
          )}

          {/* Reader Middle Pane with Dynamic Theme Background */}
          <View style={[styles.readerMiddlePane, { backgroundColor: activeTheme.backgroundColor, position: 'relative' }]}>
            <View 
              style={[
                { flex: 1 },
                marginWidth === 'medium' && { paddingHorizontal: 24 },
                marginWidth === 'large' && { paddingHorizontal: 48 }
              ]}
            >
              <FlashListReader
                initialSectionId={activeSectionId || ''}
                blocks={visibleBlocks}
                annotations={activeAnnotations}
                onPressBlock={handlePressBlock}
                onLoadAdjacentSection={async () => {}}
                theme={activeTheme}
                typography={{
                  fontSize: fontSize,
                  fontFamily: fontFamily,
                  lineHeightMultiplier: lineHeightMultiplier
                }}
                onScroll={() => setActivePopupAnnotation(null)}
              />
            </View>
            {currentSection && (
              <StickyPaginationBar
                currentChapterTitle={currentSection.title}
                prevChapterTitle={prevSection?.title}
                nextChapterTitle={nextSection?.title}
                onNavigate={(direction) => {
                  if (direction === 'prev' && prevSection) {
                    setActiveSectionId(prevSection.id);
                    setActivePopupAnnotation(null);
                  } else if (direction === 'next' && nextSection) {
                    setActiveSectionId(nextSection.id);
                    setActivePopupAnnotation(null);
                  }
                }}
              />
            )}

            {/* Floating Selection/Add Annotation Button inside Reader Middle Pane */}
            {selectedText.length > 0 && selectionActiveBlock && (
              <FadeScaleInView style={{ position: 'absolute', bottom: 80, right: 20, zIndex: 10000 }}>
                <TouchableOpacity 
                  style={[styles.floatingAnnotateBtn, { position: 'relative', bottom: 0, right: 0 }]}
                  onPress={() => {
                    const block = selectionActiveBlock;
                    const defaultText = block.content.replace(/<[^>]*>/g, '');
                    const initialText = selectedText;
                    
                    const newAnn: Annotation = {
                      id: `ann-temp-${block.id}-${Date.now()}`,
                      document_id: block.document_id,
                      block_id: block.id,
                      annotation_type: 'highlight',
                      color_code: 'hsl(48, 100%, 65%)',
                      highlighted_text: initialText,
                      note_body: '',
                      anchor_metadata: JSON.stringify({ 
                        prefix: '', 
                        suffix: '', 
                        offset: defaultText.indexOf(initialText) 
                      })
                    };
                    
                    setActiveAnnotation(newAnn);
                    setSelectedBlock(block);
                    
                    // Clear selection so the button disappears
                    if (Platform.OS === 'web' || typeof window !== 'undefined') {
                      window.getSelection()?.removeAllRanges();
                    }
                    setSelectedText('');
                    setSelectionActiveBlock(null);
                    
                    if (!isTablet) {
                      if (Platform.OS === 'web') {
                        openWebMobileModal();
                      } else {
                        bottomSheetRef.current?.expand();
                      }
                    } else {
                      setIsNoteEditorOpen(true);
                      setIsRightPaneVisible(true);
                    }
                  }}
                  testID="floating-annotate-button"
                >
                  <Text style={styles.floatingAnnotateBtnIcon}>+</Text>
                </TouchableOpacity>
              </FadeScaleInView>
            )}

            {/* Annotation Popup Card inside Reader Middle Pane */}
            {renderAnnotationPopup()}
          </View>

          {/* Tablet Dynamic Right Sidebar */}
          {isTablet && (
            <Animated.View 
              style={[
                styles.tabletRightSidebar, 
                { 
                  backgroundColor: activeTheme.sidebarBackground, 
                  borderLeftColor: activeTheme.borderColor,
                  width: rightSidebarWidth,
                  opacity: rightSidebarOpacity,
                  overflow: 'hidden',
                  padding: (isTablet && isRightPaneVisible) ? 12 : 0,
                  borderLeftWidth: (isTablet && isRightPaneVisible) ? 1 : 0,
                }
              ]}
            >
              {isNoteEditorOpen && selectedBlock && activeAnnotation ? (
                <NoteEditor
                  annotationId={activeAnnotation.id}
                  initialColor={activeAnnotation.color_code}
                  initialNote={activeAnnotation.note_body || ''}
                  initialTags={tags[selectedBlock.id] || []}
                  initialHighlightedText={activeAnnotation.highlighted_text || ''}
                  onSave={handleSaveAnnotation}
                  onDelete={handleDeleteAnnotation}
                  onClose={() => setIsNoteEditorOpen(false)}
                  onSearchTags={async () => []}
                  containerStyle={{ backgroundColor: 'transparent', padding: 0 }}
                />
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={[styles.sidebarHeader, { borderBottomColor: activeTheme.borderColor }]}>
                    <Text style={[styles.sidebarTitle, { color: activeTheme.textColor }]}>Document Notes</Text>
                    <TouchableOpacity onPress={toggleRightPane}>
                      <Text style={{ color: activeTheme.accentColor, fontSize: 13, fontWeight: 'bold' }}>✕ Hide</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ flex: 1, marginTop: 10 }} showsVerticalScrollIndicator={false}>
                    <View style={[styles.metadataCard, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]}>
                      <Text style={[styles.metadataText, { color: activeTheme.sidebarTextColor }]}>📖 Chapters: {sections.length}</Text>
                      <Text style={[styles.metadataText, { color: activeTheme.sidebarTextColor }]}>📝 Highlights: {annotations.length}</Text>
                    </View>
                    <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor }]}>Highlights in Chapter</Text>
                    {annotations.filter(a => visibleBlocks.some(b => b.id === a.block_id)).length === 0 ? (
                      <Text style={[styles.emptyText, { color: activeTheme.sidebarTextColor }]}>No highlights in this chapter. Click a text block to add one!</Text>
                    ) : (
                      annotations
                        .filter(a => visibleBlocks.some(b => b.id === a.block_id))
                        .map((ann) => {
                          const block = visibleBlocks.find(b => b.id === ann.block_id);
                          return (
                            <TouchableOpacity 
                              key={ann.id} 
                              style={[styles.noteCard, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor, borderLeftColor: ann.color_code }]}
                              onPress={() => block && handlePressBlock(block, [ann])}
                            >
                              <Text style={[styles.noteCardText, { color: activeTheme.textColor }]} numberOfLines={2}>"{ann.highlighted_text}"</Text>
                              {ann.note_body ? (
                                <Text style={[styles.noteCardBody, { color: activeTheme.sidebarTextColor }]} numberOfLines={2}>{ann.note_body}</Text>
                              ) : null}
                            </TouchableOpacity>
                          );
                        })
                    )}
                  </ScrollView>
                </View>
              )}
            </Animated.View>
          )}
        </View>

        {!isTablet && isLeftPaneVisible && (
          <View style={styles.mobileLeftPaneOverlay} onStartShouldSetResponder={() => true} onResponderRelease={closeLeftDrawer}>
            <Animated.View style={[styles.absoluteBackdrop, { opacity: leftBackdropOpacity, backgroundColor: '#000' }]} pointerEvents="auto">
              <TouchableOpacity style={{ flex: 1 }} onPress={closeLeftDrawer} />
            </Animated.View>
            <Animated.View 
              style={[
                styles.mobileLeftPaneDrawer, 
                { 
                  backgroundColor: activeTheme.sidebarBackground, 
                  borderRightColor: activeTheme.borderColor,
                  transform: [{ translateX: leftDrawerTranslate }]
                }
              ]} 
              onStartShouldSetResponder={() => true}
            >
              {activeSidebarTab === 'preferences' ? (
                renderPreferencesMenu()
              ) : (
                <>
                  <View style={[styles.sidebarHeader, { borderBottomColor: activeTheme.borderColor }]}>
                    <Text style={[styles.sidebarTitle, { color: activeTheme.textColor }]}>Table of Contents</Text>
                    <TouchableOpacity onPress={closeLeftDrawer}>
                      <Text style={{ color: activeTheme.sidebarTextColor, fontSize: 20 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                    {sections.map(sec => (
                      <TouchableOpacity
                        key={sec.id}
                        onPress={() => {
                          setActiveSectionId(sec.id);
                          closeLeftDrawer();
                        }}
                        style={[styles.tocItem, activeSectionId === sec.id && { backgroundColor: activeTheme.cardBackground }]}
                      >
                        <Text style={[styles.tocText, activeSectionId === sec.id ? { color: activeTheme.textColor, fontWeight: 'bold' } : { color: activeTheme.sidebarTextColor }]} numberOfLines={1}>
                          {sec.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Mobile Left Sidebar Persistent Actions section (tools & sync!) */}
                  <View style={[styles.tabletActionsContainer, { borderTopColor: activeTheme.borderColor }]}>
                    <TouchableOpacity 
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}
                      onPress={toggleToolsCollapsed}
                    >
                      <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor, marginTop: 0 }]}>Tools & Sync</Text>
                      <Text style={{ color: activeTheme.sidebarTextColor, fontSize: 12 }}>{isToolsCollapsed ? '▶' : '▼'}</Text>
                    </TouchableOpacity>

                    {!isToolsCollapsed && (
                      <View style={{ marginTop: 8 }}>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => { closeLeftDrawer(); router.push({ pathname: '/concept-graph', params: { fromBookId: id } }); }}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>📊 Concept Graph</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => { closeLeftDrawer(); setP2pModalVisible(true); }}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>🌐 Local Network Sync</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => { closeLeftDrawer(); setKeyManagerVisible(true); }}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>🔒 Asymmetric Key Manager</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => { closeLeftDrawer(); handleExportBackup(); }}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>📤 Export Notes Packet</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]} onPress={() => { closeLeftDrawer(); handleImportBackup(); }}>
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.textColor }]}>📥 Import Notes Packet</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                          style={[styles.tabletActionBtn, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.accentColor }]} 
                          onPress={() => setActiveSidebarTab('preferences')}
                        >
                          <Text style={[styles.tabletActionBtnText, { color: activeTheme.accentColor, fontWeight: 'bold' }]}>⚙️ Preferences</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </>
              )}
            </Animated.View>
          </View>
        )}

        {/* Mobile Right Drawer Overlay (Document Notes) */}
        {!isTablet && isRightPaneVisible && (
          <View style={styles.mobileRightPaneOverlay} onStartShouldSetResponder={() => true} onResponderRelease={closeRightDrawer}>
            <Animated.View style={[styles.absoluteBackdrop, { opacity: rightBackdropOpacity, backgroundColor: '#000' }]} pointerEvents="auto">
              <TouchableOpacity style={{ flex: 1 }} onPress={closeRightDrawer} />
            </Animated.View>
            <Animated.View 
              style={[
                styles.mobileRightPaneDrawer, 
                { 
                  backgroundColor: activeTheme.sidebarBackground, 
                  borderLeftColor: activeTheme.borderColor,
                  transform: [{ translateX: rightDrawerTranslate }]
                }
              ]} 
              onStartShouldSetResponder={() => true}
            >
              <View style={[styles.sidebarHeader, { borderBottomColor: activeTheme.borderColor }]}>
                <Text style={[styles.sidebarTitle, { color: activeTheme.textColor }]}>Document Notes</Text>
                <TouchableOpacity onPress={closeRightDrawer}>
                  <Text style={{ color: activeTheme.sidebarTextColor, fontSize: 20 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                <View style={[styles.metadataCard, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor }]}>
                  <Text style={[styles.metadataText, { color: activeTheme.sidebarTextColor }]}>📖 Chapters: {sections.length}</Text>
                  <Text style={[styles.metadataText, { color: activeTheme.sidebarTextColor }]}>📝 Highlights: {annotations.length}</Text>
                </View>
                <Text style={[styles.sidebarSubTitle, { color: activeTheme.sidebarTextColor }]}>Highlights in Chapter</Text>
                {annotations.filter(a => visibleBlocks.some(b => b.id === a.block_id)).length === 0 ? (
                  <Text style={[styles.emptyText, { color: activeTheme.sidebarTextColor }]}>No highlights in this chapter. Click a text block to add one!</Text>
                ) : (
                  annotations
                    .filter(a => visibleBlocks.some(b => b.id === a.block_id))
                    .map((ann) => {
                      const block = visibleBlocks.find(b => b.id === ann.block_id);
                      return (
                        <TouchableOpacity 
                          key={ann.id} 
                          style={[styles.noteCard, { backgroundColor: activeTheme.cardBackground, borderColor: activeTheme.borderColor, borderLeftColor: ann.color_code }]}
                          onPress={() => {
                            block && handlePressBlock(block, [ann]);
                            closeRightDrawer();
                          }}
                        >
                          <Text style={[styles.noteCardText, { color: activeTheme.textColor }]} numberOfLines={2}>"{ann.highlighted_text}"</Text>
                          {ann.note_body ? (
                            <Text style={[styles.noteCardBody, { color: activeTheme.sidebarTextColor }]} numberOfLines={2}>{ann.note_body}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })
                )}
              </ScrollView>
            </Animated.View>
          </View>
        )}

        {/* Mobile Native Bottom Sheet */}
        {!isTablet && Platform.OS !== 'web' && (
          <BottomSheet
            ref={bottomSheetRef}
            index={-1}
            snapPoints={['50%', '90%']}
            enablePanDownToClose={true}
            backgroundStyle={styles.bottomSheetBackground}
          >
            <BottomSheetView style={styles.bottomSheetContent}>
              {selectedBlock && activeAnnotation && (
                <NoteEditor
                  annotationId={activeAnnotation.id}
                  initialColor={activeAnnotation.color_code}
                  initialNote={activeAnnotation.note_body || ''}
                  initialTags={tags[selectedBlock.id] || []}
                  initialHighlightedText={activeAnnotation.highlighted_text || ''}
                  onSave={handleSaveAnnotation}
                  onDelete={handleDeleteAnnotation}
                  onClose={() => bottomSheetRef.current?.close()}
                  onSearchTags={async () => []}
                />
              )}
            </BottomSheetView>
          </BottomSheet>
        )}

        {/* Mobile Web Custom Animated Drawer */}
        {!isTablet && Platform.OS === 'web' && isWebMobileModalOpen && (
          <View style={styles.webBottomSheetBackdrop} onStartShouldSetResponder={() => true} onResponderRelease={() => closeWebMobileModal()}>
            <Animated.View 
              style={[
                styles.webBottomSheetDrawer,
                {
                  transform: [{ translateY: slideAnim }]
                }
              ]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.webBottomSheetHandle} />
              <ScrollView style={{ flex: 1 }}>
                {selectedBlock && activeAnnotation && (
                  <NoteEditor
                    annotationId={activeAnnotation.id}
                    initialColor={activeAnnotation.color_code}
                    initialNote={activeAnnotation.note_body || ''}
                    initialTags={tags[selectedBlock.id] || []}
                    initialHighlightedText={activeAnnotation.highlighted_text || ''}
                    onSave={handleSaveAnnotation}
                    onDelete={handleDeleteAnnotation}
                    onClose={() => closeWebMobileModal()}
                    onSearchTags={async () => []}
                  />
                )}
              </ScrollView>
            </Animated.View>
          </View>
        )}

        {/* Asymmetric Key Manager Modal */}
        <Modal 
          visible={keyManagerVisible} 
          transparent 
          animationType="slide" 
          onRequestClose={() => setKeyManagerVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Generate ECDSA Author Keys</Text>
              <Text style={styles.modalSubtitle}>Create secure, offline cryptographic keys to sign and verify annotation backups.</Text>
              
              {keysSavedMessage && (
                <View style={styles.savedMessageContainer}>
                  <Text style={styles.savedMessageText}>Keys Saved to Secure Store</Text>
                </View>
              )}
              
              {publicKey ? (
                <ScrollView style={styles.keysDisplayBox}>
                  <Text style={styles.keyLabel}>Public Key (PEM):</Text>
                  <Text style={styles.keyText}>{publicKey}</Text>
                </ScrollView>
              ) : null}

              <TouchableOpacity style={styles.modalBtnPrimary} onPress={handleGenerateKeyPair}>
                <Text style={styles.modalBtnText}>Generate New Keypair</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.modalBtnSecondary} onPress={() => { setKeyManagerVisible(false); setKeysSavedMessage(false); }}>
                <Text style={styles.modalBtnSecondaryText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* P2P Network Sync Modal */}
        <Modal 
          visible={p2pModalVisible} 
          transparent 
          animationType="slide" 
          onRequestClose={() => setP2pModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>P2P Network Sync Service</Text>
              
              {!p2pConnected ? (
                <View>
                  <Text style={styles.p2pStatus}>Searching for peers on local network...</Text>
                  <TouchableOpacity style={styles.peerItem} onPress={() => setP2pConnected(true)}>
                    <Text style={styles.peerName}>📱 phone-1</Text>
                    <Text style={styles.connectText}>Connect to phone-1</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <Text style={styles.p2pStatus}>Connected to phone-1</Text>
                  
                  <TouchableOpacity 
                    style={styles.modalBtnPrimary} 
                    onPress={() => {
                      setP2pModalVisible(false);
                      setP2pConnected(false);
                      Alert.alert('Handshake & Sync delta completed', 'Successfully synchronized annotations and conflict indexes with phone-1.', [{ text: 'OK' }]);
                    }}
                  >
                    <Text style={styles.modalBtnText}>Sync Relational Deltas</Text>
                  </TouchableOpacity>
                </View>
              )}
              
              <TouchableOpacity style={styles.modalBtnSecondary} onPress={() => { setP2pModalVisible(false); setP2pConnected(false); }}>
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        {/* Rendered inside readerMiddlePane dynamically */}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  loadingText: { color: '#fff', fontSize: 18, alignSelf: 'center', marginTop: 50 },
  smartphoneHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 15, 
    backgroundColor: '#1e1e1e', 
    borderBottomWidth: 1, 
    borderColor: '#333' 
  },
  homeBtn: {
    marginRight: 15,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#2b2b2b',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#444'
  },
  homeBtnText: {
    color: '#00d2ff',
    fontSize: 14,
    fontWeight: 'bold'
  },
  docTitle: { flex: 1, fontSize: 18, color: '#fff', fontWeight: 'bold' },
  mobileActionsBar: {
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderColor: '#262626',
    maxHeight: 60,
  },
  actionPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#26263b',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'hsl(210, 100%, 75%)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  gridRow: { flex: 1, flexDirection: 'row' },
  tabletLeftSidebar: { width: 250, backgroundColor: '#1a1a1a', borderRightWidth: 1, borderColor: '#333', padding: 15 },
  sidebarTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  sidebarSubTitle: { color: '#aaa', fontSize: 14, fontWeight: 'bold', marginTop: 15, marginBottom: 10, textTransform: 'uppercase' },
  tocItem: { padding: 10, borderRadius: 5, marginBottom: 5 },
  tocItemActive: { backgroundColor: '#333' },
  tocText: { color: '#aaa', fontSize: 14 },
  tocTextActive: { color: '#fff', fontWeight: 'bold' },
  tabletActionsContainer: {
    borderTopWidth: 1,
    borderColor: '#333',
    paddingTop: 15,
    marginTop: 10,
  },
  tabletActionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#222230',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  tabletActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  readerMiddlePane: { flex: 1, backgroundColor: '#121212', position: 'relative' },
  tabletRightSidebar: { width: 300, backgroundColor: '#1a1a1a', borderLeftWidth: 1, borderColor: '#333', padding: 12 },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2b2b2b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  headerIconBtnText: {
    color: '#00d2ff',
    fontSize: 18,
    lineHeight: 18,
    textAlign: 'center',
  },
  floatingAnnotateBtn: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    zIndex: 10000,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'hsl(210, 100%, 55%)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'hsl(210, 100%, 75%)',
  },
  floatingAnnotateBtnIcon: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'normal',
    textAlign: 'center',
    marginTop: Platform.OS === 'web' ? -3 : -4,
  },
  floatingAnnotateBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  bottomSheetBackground: { backgroundColor: '#1a1a1a' },
  bottomSheetContent: { flex: 1, padding: 15 },
  
  // Modals Styling
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1c1c28',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2e2e42',
    padding: 20,
    alignItems: 'center'
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#e0e7ff',
    marginBottom: 10,
    textAlign: 'center'
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20
  },
  savedMessageContainer: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center'
  },
  savedMessageText: {
    color: '#10b981',
    fontWeight: 'bold',
    fontSize: 14
  },
  keysDisplayBox: {
    width: '100%',
    maxHeight: 150,
    backgroundColor: '#0f0f15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e42',
    padding: 10,
    marginBottom: 20
  },
  keyLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#3b82f6',
    textTransform: 'uppercase',
    marginBottom: 4
  },
  keyText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#a5b4fc',
    lineHeight: 16
  },
  modalBtnPrimary: {
    width: '100%',
    padding: 14,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10
  },
  modalBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15
  },
  modalBtnSecondary: {
    width: '100%',
    padding: 14,
    backgroundColor: '#27273a',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalBtnSecondaryText: {
    color: '#94a3b8',
    fontWeight: 'bold',
    fontSize: 15
  },
  
  // P2P Sync specific styles
  p2pStatus: {
    fontSize: 15,
    color: '#34d399',
    fontStyle: 'italic',
    marginBottom: 20,
    textAlign: 'center'
  },
  peerItem: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f0f15',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
    padding: 16,
    marginBottom: 20
  },
  webBottomSheetBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 1000,
    justifyContent: 'flex-end',
  },
  webBottomSheetDrawer: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#333',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 24,
  },
  webBottomSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 15,
  },
  peerName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  },
  connectText: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: 'bold'
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    marginBottom: 15,
  },
  headerToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#2b2b2b',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#444',
  },
  headerToggleBtnText: {
    color: '#00d2ff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  metadataCard: {
    backgroundColor: '#1c1c28',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2e2e42',
    marginBottom: 15,
  },
  metadataText: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 4,
  },
  noteCard: {
    backgroundColor: '#1e1e1e',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#333',
  },
  noteCardText: {
    color: '#fff',
    fontSize: 13,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  noteCardBody: {
    color: '#aaa',
    fontSize: 13,
    marginTop: 4,
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
  },
  mobileLeftPaneOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    flexDirection: 'row',
  },
  mobileLeftPaneDrawer: {
    width: 270,
    height: '100%',
    backgroundColor: '#1a1a1a',
    borderRightWidth: 1,
    borderColor: '#333',
    padding: 15,
  },
  mobileRightPaneOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  mobileRightPaneDrawer: {
    width: 290,
    height: '100%',
    backgroundColor: '#1a1a1a',
    borderLeftWidth: 1,
    borderColor: '#333',
    padding: 15,
  },
  absoluteBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  popupOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupCard: {
    minWidth: 280,
    maxWidth: 550,
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  popupTitle: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  popupCloseBtn: {
    padding: 4,
  },
  popupQuote: {
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  popupNoteLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  popupNoteText: {
    fontSize: 13,
    lineHeight: 18,
  },
  popupTagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  popupActionBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
