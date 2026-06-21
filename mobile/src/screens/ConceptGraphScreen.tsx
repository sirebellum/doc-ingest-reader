import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  GestureEvent,
  PanGestureHandlerEventPayload,
  PinchGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import Svg, { Circle, Line, G, Text as SvgText } from 'react-native-svg';
import { DbsBridge } from '../native/DbsBridge';
import { BLESyncCommunicator } from '../database/docSync';
import WirelessSyncBridge from '../native/WirelessSyncBridge';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface GraphNode {
  id: string;
  name: string;
  source: string;
  authorIds: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

interface FTSResultBlock {
  id: string;
  content: string;
  doc_title: string;
}

const SPRING_K = 0.04;
const REPULSION = 1200;
const REST_LENGTH = 120;
const GRAVITY = 0.03;
const FRICTION = 0.8;

// Stable HSL hue generator per author signature
function getAuthorColor(authorId: string): string {
  if (!authorId || authorId === 'local') return 'hsl(180, 85%, 55%)'; // Cyan
  if (authorId === 'peer') return 'hsl(280, 85%, 65%)'; // Purple
  let hash = 0;
  for (let i = 0; i < authorId.length; i++) {
    hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 90%, 60%)`;
}

export default function ConceptGraphScreen() {
  const { fromBookId } = useLocalSearchParams<{ fromBookId?: string }>();
  // SQLite Nodes & Links
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);

  // Selection & Sidebar
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [matchingBlocks, setMatchingBlocks] = useState<FTSResultBlock[]>([]);

  // Modals & BLE states
  const [bleModalVisible, setBleModalVisible] = useState(false);
  const [bleProgress, setBleProgress] = useState(0);
  const [bleLogs, setBleLogs] = useState<string[]>([]);

  // Conflict Resolution Split-Pane states
  const [conflictModalVisible, setConflictModalVisible] = useState(false);
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [conflictOurs, setConflictOurs] = useState('');
  const [conflictTheirs, setConflictTheirs] = useState('');
  const [resolvedText, setResolvedText] = useState('');

  // Reanimated Canvas Pan & Zoom
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  // Reanimated sliding sidebar drawer
  const drawerX = useSharedValue(screenWidth);

  useEffect(() => {
    loadGraphData();
  }, []);

  const loadGraphData = async () => {
    try {
      // 1. Fetch tags and their linked author signatures
      const tagRows = await DbsBridge.getTagsWithAuthorsAsync();

      // 2. Fetch co-occurrence connections
      const linkRows = await DbsBridge.getTagCooccurrencesAsync();

      // Map rows into graph nodes with initial circle positions
      const mappedNodes: GraphNode[] = tagRows.map((row: any, idx: number) => {
        const angle = (idx / (tagRows.length || 1)) * 2 * Math.PI;
        const radius = 150 + Math.random() * 50;
        return {
          id: row.id,
          name: row.name,
          source: row.source,
          authorIds: row.author_ids ? row.author_ids.split(',') : [],
          x: screenWidth / 2 + Math.cos(angle) * radius,
          y: screenHeight / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        };
      });

      // Run physical spring layout simulation loops (150 iterations)
      const nodeMap = new Map<string, GraphNode>();
      mappedNodes.forEach((n) => nodeMap.set(n.id, n));

      for (let step = 0; step < 150; step++) {
        // A. Node-to-Node Repulsion
        for (let i = 0; i < mappedNodes.length; i++) {
          for (let j = i + 1; j < mappedNodes.length; j++) {
            const dx = mappedNodes[j].x - mappedNodes[i].x;
            const dy = mappedNodes[j].y - mappedNodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < 300) {
              const force = REPULSION / (dist * dist);
              const fx = force * (dx / dist);
              const fy = force * (dy / dist);
              mappedNodes[i].vx -= fx;
              mappedNodes[i].vy -= fy;
              mappedNodes[j].vx += fx;
              mappedNodes[j].vy += fy;
            }
          }
        }

        // B. Link Springs Attraction
        linkRows.forEach((link: any) => {
          const sourceNode = nodeMap.get(link.source);
          const targetNode = nodeMap.get(link.target);
          if (sourceNode && targetNode) {
            const dx = targetNode.x - sourceNode.x;
            const dy = targetNode.y - sourceNode.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = SPRING_K * (dist - REST_LENGTH);
            const fx = force * (dx / dist);
            const fy = force * (dy / dist);
            sourceNode.vx += fx;
            sourceNode.vy += fy;
            targetNode.vx -= fx;
            targetNode.vy -= fy;
          }
        });

        // C. Gravity pull to center and velocity integration
        const centerX = screenWidth / 2;
        const centerY = screenHeight / 2;
        mappedNodes.forEach((node) => {
          node.vx += (centerX - node.x) * GRAVITY;
          node.vy += (centerY - node.y) * GRAVITY;

          node.x += node.vx;
          node.y += node.vy;

          node.vx *= FRICTION;
          node.vy *= FRICTION;
        });
      }

      setNodes(mappedNodes);
      setLinks(linkRows);
    } catch (err) {
      console.warn('[Graph] Failed to load SQLite Tag Graph data:', err);
    }
  };

  // Perform FTS5 plain-text query and slide in Sidebar
  const handleTagTap = async (tagName: string) => {
    setSelectedTag(tagName);
    try {
      const escaped = tagName.replace(/[^\w\s]/g, ' ').trim();
      const results = await DbsBridge.searchBlocksAsync(escaped);
      setMatchingBlocks(results);
      drawerX.value = withSpring(screenWidth * 0.25); // slide in
    } catch (err) {
      setMatchingBlocks([]);
      drawerX.value = withSpring(screenWidth * 0.25);
    }
  };

  const closeDrawer = () => {
    drawerX.value = withSpring(screenWidth);
    setSelectedTag(null);
  };

  // Pan Gestures mapping
  const onPanEvent = (event: GestureEvent<PanGestureHandlerEventPayload>) => {
    translateX.value = event.nativeEvent.translationX;
    translateY.value = event.nativeEvent.translationY;
  };

  // Pinch Gestures mapping
  const onPinchEvent = (event: GestureEvent<PinchGestureHandlerEventPayload>) => {
    scale.value = event.nativeEvent.scale;
  };

  // Animated styles for physical SVG and sliding drawers
  const animatedCanvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const animatedDrawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerX.value }],
  }));

  // BLE sync delta transmission
  const triggerBLESync = async () => {
    setBleModalVisible(true);
    setBleProgress(0);
    setBleLogs(['[BLE] Initializing local radio transceivers...', '[BLE] Scanning for proximal peer devices...']);

    let isSyncing = false;

    try {
      const communicator = new BLESyncCommunicator();

      // Find a document to synchronize
      const doc = await DbsBridge.getFirstDocumentIdAsync();
      if (!doc) {
        setBleLogs((prev) => [...prev, '[Error] No documents found to sync deltas!']);
        setBleProgress(100);
        return;
      }

      // Setup physical receiver listener for inbound chunks
      const inboundListener = communicator.setupPhysicalListener(
        undefined as any,
        (progress) => {
          setBleProgress(progress);
        },
        (syncRes) => {
          setBleLogs((prev) => [
            ...prev,
            `[BLE] Inbound packet sync complete. Applied:`,
            `  - Annotations: ${syncRes.appliedAnnotationsCount}`,
            `  - Tags: ${syncRes.appliedTagsCount}`,
            `  - Block tags: ${syncRes.appliedBlockTagsCount}`
          ]);
          loadGraphData();
        },
        (err) => {
          setBleLogs((prev) => [...prev, `[Error] Inbound write error: ${err.message}`]);
        }
      );

      // Start BLE Peripheral (so others can write to us)
      await WirelessSyncBridge.startPeripheral('F3C9-LLM-SYNC-SERVICE', 'F3C90001-LLM-SYNC-CHAR');
      setBleLogs((prev) => [...prev, '[BLE] Peripheral GATT server active. Advertising F3C9 service...']);

      // Setup device discovery listener
      const discoverySub = WirelessSyncBridge.onBleDeviceDiscovered(async (device) => {
        if (isSyncing) return;
        isSyncing = true;
        setBleLogs((prev) => [...prev, `[BLE] Found proximity peer: ${device.name} (${device.id})`]);

        try {
          setBleLogs((prev) => [...prev, `[BLE] Negotiating connection and MTU sizes...`]);
          const mtu = await WirelessSyncBridge.connectToDevice(device.id);
          setBleLogs((prev) => [...prev, `[BLE] Connected. Negotiated MTU: ${mtu}b.`]);

          setBleLogs((prev) => [...prev, `[BLE] Packaging local deltas & signing manifest...`]);
          
          // Send outbound delta physically
          await communicator.sendDeltaPhysically(
            undefined as any,
            doc.id,
            '1970-01-01T00:00:00Z',
            device.id,
            (prog) => {
              setBleProgress(prog);
              setBleLogs((prev) => [
                ...prev,
                `[BLE] Streaming outbound packets: ${prog}%`
              ]);
            }
          );

          setBleLogs((prev) => [...prev, `[BLE] Outbound packets sent successfully. Checksums verified.`]);
          
          // Cleanup connection
          await WirelessSyncBridge.disconnectDevice(device.id);
        } catch (err: any) {
          setBleLogs((prev) => [...prev, `[Error] Peer sync session failed: ${err.message}`]);
        } finally {
          isSyncing = false;
        }
      });

      // Start central scanning
      await WirelessSyncBridge.startScanning('F3C9-LLM-SYNC-SERVICE');

      // Start mDNS advertising and discovery
      await WirelessSyncBridge.startMdnsAdvertising('local-tablet-node', '_llmpdfsync._tcp', 8080);
      const mdnsSub = WirelessSyncBridge.onMdnsServiceResolved((peer) => {
        setBleLogs((prev) => [
          ...prev,
          `[mDNS] Discovered Wi-Fi peer service: ${peer.name}`,
          `[mDNS] Resolved peer socket: ${peer.ip}:${peer.port}`
        ]);
      });
      await WirelessSyncBridge.startMdnsDiscovery('_llmpdfsync._tcp');

      // Keep it active for 15 seconds then clean up scanning/discovery automatically
      setTimeout(async () => {
        await WirelessSyncBridge.stopScanning();
        await WirelessSyncBridge.stopMdnsDiscovery();
        await WirelessSyncBridge.stopPeripheral();
        await WirelessSyncBridge.stopMdnsAdvertising();
        discoverySub.remove();
        mdnsSub.remove();
        inboundListener.remove();
        setBleLogs((prev) => [...prev, '[BLE] Radio scanning window closed. Idle.']);
      }, 15000);

    } catch (err: any) {
      setBleLogs((prev) => [...prev, `[Error] Sync sequence initialization failed: ${err.message}`]);
      setBleProgress(100);
    }
  };

  // Launch split pane modal to resolve git-style inline conflict blocks
  const launchConflictEditor = async () => {
    // Look up any annotations in database containing git conflict markers
    const conflicts = await DbsBridge.getConflictingAnnotationsAsync();

    if (conflicts.length > 0) {
      const active = conflicts[0];
      setActiveConflictId(active.id);

      // Parse the conflict markers
      const oursMatch = /<<<<<<< OURS\s*([\s\S]*?)\s*=======/.exec(active.note_body);
      const theirsMatch = /=======\s*([\s\S]*?)\s*>>>>>>> THEIRS/.exec(active.note_body);

      const oursText = oursMatch ? oursMatch[1] : '';
      const theirsText = theirsMatch ? theirsMatch[1] : '';

      setConflictOurs(oursText);
      setConflictTheirs(theirsText);
      setResolvedText(active.note_body);
      setConflictModalVisible(true);
    } else {
      Alert.alert('No Conflicts', 'There are currently no notes with unresolved merge conflicts.');
    }
  };

  // Write finalized resolution back to SQLite
  const commitConflictResolution = async () => {
    if (!activeConflictId) return;

    try {
      await DbsBridge.resolveAnnotationConflictAsync(activeConflictId, resolvedText);
      setConflictModalVisible(false);
      Alert.alert('Success', 'The note conflict has been successfully resolved and saved.');
      loadGraphData();
    } catch (err: any) {
      Alert.alert('Error', `Failed to resolve conflict: ${err.message}`);
    }
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Sleek Top Panel */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity style={styles.btnBack} onPress={() => router.replace('/')}>
            <Text style={styles.btnTxt}>← Library</Text>
          </TouchableOpacity>
          {fromBookId && (
            <TouchableOpacity 
              style={[styles.btnBack, { marginLeft: 8, backgroundColor: '#0f172a', borderColor: '#10b981' }]} 
              onPress={() => router.replace(`/reader/${fromBookId}`)}
              testID="back-to-book-button"
            >
              <Text style={[styles.btnTxt, { color: '#10b981' }]}>← Back to Book</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.headerTitle}>Visual Concept Map</Text>
        <View style={styles.headerControls}>
          <TouchableOpacity style={styles.btnBle} onPress={triggerBLESync}>
            <Text style={styles.btnTxt}>BLE Sync</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnConflict} onPress={launchConflictEditor}>
            <Text style={styles.btnTxt}>Resolve Conflicts</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* SVG Zoomable Spring Layout Canvas */}
      <PanGestureHandler onGestureEvent={onPanEvent} minPointers={1} maxPointers={1}>
        <PinchGestureHandler onGestureEvent={onPinchEvent}>
          <Animated.View style={[styles.canvas, animatedCanvasStyle]}>
            <Svg width={screenWidth} height={screenHeight}>
              {/* Lines linking tags */}
              {links.map((link, idx) => {
                const src = nodes.find((n) => n.id === link.source);
                const tgt = nodes.find((n) => n.id === link.target);
                if (!src || !tgt) return null;
                return (
                  <Line
                    key={`l-${idx}`}
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke="rgba(80, 100, 250, 0.2)"
                    strokeWidth={1.5 + link.weight * 0.5}
                  />
                );
              })}

              {/* Tag circle nodes */}
              {nodes.map((node) => {
                const color = node.source === 'llm' ? '#3b82f6' : '#a855f7'; // blue for LLM, purple for user tags
                return (
                  <G key={node.id} onPress={() => handleTagTap(node.name)}>
                    {/* Ring overlays representing authors */}
                    {node.authorIds.map((auth, index) => (
                      <Circle
                        key={`ring-${auth}-${index}`}
                        cx={node.x}
                        cy={node.y}
                        r={20 + index * 4}
                        fill="none"
                        stroke={getAuthorColor(auth)}
                        strokeWidth={2}
                        strokeDasharray="4 2"
                        opacity={0.8}
                      />
                    ))}

                    <Circle cx={node.x} cy={node.y} r={14} fill={color} opacity={0.95} />

                    <SvgText
                      x={node.x}
                      y={node.y + 30}
                      fill="#e0e7ff"
                      fontSize={11}
                      fontWeight="bold"
                      textAnchor="middle"
                      opacity={0.9}
                    >
                      {node.name}
                    </SvgText>
                  </G>
                );
              })}
            </Svg>
          </Animated.View>
        </PinchGestureHandler>
      </PanGestureHandler>

      {/* Slide-out Sidebar Drawer */}
      <Animated.View style={[styles.sidebar, animatedDrawerStyle]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>#{selectedTag}</Text>
          <TouchableOpacity onPress={closeDrawer}>
            <Text style={styles.sidebarClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sidebarScroll}>
          {matchingBlocks.length === 0 ? (
            <Text style={styles.emptyText}>No matching structured blocks found for this tag.</Text>
          ) : (
            matchingBlocks.map((block) => (
              <View key={block.id} style={styles.blockCard}>
                <Text style={styles.blockDoc}>{block.doc_title}</Text>
                <Text style={styles.blockBody}>
                  {block.content.replace(/<[^>]*>/g, '')}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>

      {/* BLE Sync Modal */}
      <Modal visible={bleModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.bleContainer}>
            <Text style={styles.modalTitle}>BLE Fallback Sync Delta</Text>
            <View style={styles.progressRow}>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${bleProgress}%` }]} />
              </View>
              <Text style={styles.progressPct}>{bleProgress}%</Text>
            </View>
            <ScrollView style={styles.logBox} contentContainerStyle={styles.logContent}>
              {bleLogs.map((log, idx) => (
                <Text key={idx} style={styles.logText}>
                  {log}
                </Text>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.btnCloseBle} onPress={() => setBleModalVisible(false)}>
              <Text style={styles.btnCloseTxt}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Split Pane Conflict resolution */}
      <Modal visible={conflictModalVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.conflictContainer}>
            <Text style={styles.modalTitle}>Visual Conflict Resolution</Text>

            {/* Split view */}
            <View style={styles.splitPane}>
              <View style={styles.paneLeft}>
                <Text style={styles.paneLabel}>Ours (Local edits)</Text>
                <ScrollView style={styles.paneScroll}>
                  <Text style={styles.paneTxt}>{conflictOurs}</Text>
                </ScrollView>
              </View>
              <View style={styles.paneRight}>
                <Text style={styles.paneLabel}>Theirs (Peer imports)</Text>
                <ScrollView style={styles.paneScroll}>
                  <Text style={styles.paneTxt}>{conflictTheirs}</Text>
                </ScrollView>
              </View>
            </View>

            {/* Editing Consolidation */}
            <Text style={styles.paneLabel}>Consolidated note output</Text>
            <TextInput
              multiline
              style={styles.resolvedInput}
              value={resolvedText}
              onChangeText={setResolvedText}
            />

            <View style={styles.conflictBtnRow}>
              <TouchableOpacity style={styles.btnCancel} onPress={() => setConflictModalVisible(false)}>
                <Text style={styles.btnCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnCommit} onPress={commitConflictResolution}>
                <Text style={styles.btnCommitTxt}>Commit Merge</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05050a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 45,
    paddingHorizontal: 20,
    paddingBottom: 15,
    backgroundColor: '#0c0c16',
    borderBottomWidth: 1,
    borderBottomColor: '#1d1d2f',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e0e7ff',
  },
  headerControls: {
    flexDirection: 'row',
  },
  btnBack: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1e1e2f',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  btnBle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1d4ed8',
    marginRight: 10,
  },
  btnConflict: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#7e22ce',
  },
  btnTxt: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  canvas: {
    flex: 1,
  },
  sidebar: {
    position: 'absolute',
    top: 45,
    bottom: 0,
    right: 0,
    width: screenWidth * 0.75,
    backgroundColor: '#0c0c16',
    borderLeftWidth: 1,
    borderLeftColor: '#1d1d2f',
    padding: 15,
    zIndex: 100,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1d1d2f',
    marginBottom: 15,
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3b82f6',
  },
  sidebarClose: {
    fontSize: 20,
    color: '#94a3b8',
    paddingHorizontal: 10,
  },
  sidebarScroll: {
    flex: 1,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 40,
  },
  blockCard: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#131325',
    marginBottom: 12,
  },
  blockDoc: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
    fontWeight: 'bold',
  },
  blockBody: {
    fontSize: 14,
    color: '#e2e8f0',
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bleContainer: {
    width: screenWidth * 0.85,
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#0c0c16',
    borderWidth: 1,
    borderBottomColor: '#1d1d2f',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e2e8f0',
    marginBottom: 15,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1e1e38',
    marginRight: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
  },
  progressPct: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#e2e8f0',
  },
  logBox: {
    height: 150,
    backgroundColor: '#05050a',
    borderRadius: 6,
    padding: 10,
    marginBottom: 15,
  },
  logContent: {
    paddingBottom: 10,
  },
  logText: {
    fontSize: 12,
    color: '#34d399',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  btnCloseBle: {
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#27273f',
    alignItems: 'center',
  },
  btnCloseTxt: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#e2e8f0',
  },
  conflictContainer: {
    width: screenWidth * 0.9,
    height: screenHeight * 0.8,
    backgroundColor: '#0c0c16',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1d1d2f',
  },
  splitPane: {
    flexDirection: 'row',
    flex: 1,
    marginBottom: 15,
  },
  paneLeft: {
    flex: 1,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#131325',
    padding: 10,
  },
  paneRight: {
    flex: 1,
    marginLeft: 8,
    borderRadius: 8,
    backgroundColor: '#131325',
    padding: 10,
  },
  paneLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  paneScroll: {
    flex: 1,
  },
  paneTxt: {
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 18,
  },
  resolvedInput: {
    height: 120,
    backgroundColor: '#05050a',
    borderColor: '#1d1d2f',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: '#e2e8f0',
    textAlignVertical: 'top',
    fontSize: 14,
    marginBottom: 20,
  },
  conflictBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  btnCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#27273f',
    marginRight: 10,
  },
  btnCancelTxt: {
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  btnCommit: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#10b981',
  },
  btnCommitTxt: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});
