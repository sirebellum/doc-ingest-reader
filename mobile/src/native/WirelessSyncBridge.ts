// Simulated mock data
const MOCK_DEVICES = [
  { id: 'mock-peer-iphone', name: 'iPhone' },
  { id: 'mock-peer-tablet', name: 'iPad' },
];

const MOCK_MDNS_SERVICES = [
  {
    name: 'Local iPad Sync Server',
    ip: '192.168.1.150',
    port: 8080,
  },
];

// Simulated event listeners
const bleChunkListeners: Array<(event: { deviceId: string; chunk: string }) => void> = [];
const deviceDiscoveredListeners: Array<(event: { id: string; name: string }) => void> = [];
const mdnsResolvedListeners: Array<(event: { name: string; ip: string; port: number }) => void> = [];

// Simulated timeouts
let scanningTimeouts: Array<NodeJS.Timeout> = [];
let mdnsDiscoveryTimeouts: Array<NodeJS.Timeout> = [];

// Simulated MTU
const DEFAULT_MTU = 512;

// Try to import native modules
let WirelessSync: any = null;
let WirelessSyncEvents: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ws = require('../../modules/wireless-sync/src');
  WirelessSync = ws.WirelessSync;
  WirelessSyncEvents = ws.WirelessSyncEvents;
} catch (error) {
  // Fall back to mock behavior
}

// Fallback mock implementation
const mockStartPeripheral = async (): Promise<void> => {
  // Simulate peripheral start
};

const mockStopPeripheral = async (): Promise<void> => {
  // Simulate peripheral stop
};

const mockStartScanning = async (serviceUuid: string): Promise<void> => {
  // Clear previous timeouts
  scanningTimeouts.forEach((timeout) => clearTimeout(timeout));
  scanningTimeouts = [];

  // Schedule mock device discoveries
  const timeout = setTimeout(() => {
    MOCK_DEVICES.forEach((device) => {
      deviceDiscoveredListeners.forEach((listener) => listener(device));
    });
  }, 200);

  scanningTimeouts.push(timeout);
};

const mockStopScanning = async (): Promise<void> => {
  scanningTimeouts.forEach((timeout) => clearTimeout(timeout));
  scanningTimeouts = [];
};

const mockStartMdnsAdvertising = async (serviceName: string, serviceType: string, port: number): Promise<void> => {
  // Simulate advertising start
};

const mockStopMdnsAdvertising = async (): Promise<void> => {
  // Simulate advertising stop
};

const mockStartMdnsDiscovery = async (serviceType: string): Promise<void> => {
  // Clear previous timeouts
  mdnsDiscoveryTimeouts.forEach((timeout) => clearTimeout(timeout));
  mdnsDiscoveryTimeouts = [];

  // Schedule mock service resolutions
  const timeout = setTimeout(() => {
    MOCK_MDNS_SERVICES.forEach((service) => {
      mdnsResolvedListeners.forEach((listener) => listener(service));
    });
  }, 200);

  mdnsDiscoveryTimeouts.push(timeout);
};

const mockStopMdnsDiscovery = async (): Promise<void> => {
  mdnsDiscoveryTimeouts.forEach((timeout) => clearTimeout(timeout));
  mdnsDiscoveryTimeouts = [];
};

const mockConnectToDevice = async (deviceId: string): Promise<number> => {
  return DEFAULT_MTU;
};

const mockDisconnectDevice = async (deviceId: string): Promise<void> => {
  // Simulate disconnect
};

const mockSendBleChunk = async (deviceId: string, chunk: string): Promise<boolean> => {
  // Simulate sending chunk
  return true;
};

// Unified bridge
const WirelessSyncBridge = {
  startPeripheral: WirelessSync?.startPeripheral || mockStartPeripheral,
  stopPeripheral: WirelessSync?.stopPeripheral || mockStopPeripheral,
  startScanning: WirelessSync?.startScanning || mockStartScanning,
  stopScanning: WirelessSync?.stopScanning || mockStopScanning,
  connectToDevice: WirelessSync?.connectToDevice || mockConnectToDevice,
  disconnectDevice: WirelessSync?.disconnectDevice || mockDisconnectDevice,
  sendBleChunk: WirelessSync?.sendBleChunk || mockSendBleChunk,
  startMdnsAdvertising: WirelessSync?.startMdnsAdvertising || mockStartMdnsAdvertising,
  stopMdnsAdvertising: WirelessSync?.stopMdnsAdvertising || mockStopMdnsAdvertising,
  startMdnsDiscovery: WirelessSync?.startMdnsDiscovery || mockStartMdnsDiscovery,
  stopMdnsDiscovery: WirelessSync?.stopMdnsDiscovery || mockStopMdnsDiscovery,

  onBleChunkReceived: (callback: (event: { deviceId: string; chunk: string }) => void) => {
    bleChunkListeners.push(callback);
    return {
      remove: () => {
        const index = bleChunkListeners.indexOf(callback);
        if (index !== -1) {
          bleChunkListeners.splice(index, 1);
        }
      },
    };
  },

  onBleDeviceDiscovered: (callback: (event: { id: string; name: string }) => void) => {
    deviceDiscoveredListeners.push(callback);
    return {
      remove: () => {
        const index = deviceDiscoveredListeners.indexOf(callback);
        if (index !== -1) {
          deviceDiscoveredListeners.splice(index, 1);
        }
      },
    };
  },

  onMdnsServiceResolved: (callback: (event: { name: string; ip: string; port: number }) => void) => {
    mdnsResolvedListeners.push(callback);
    return {
      remove: () => {
        const index = mdnsResolvedListeners.indexOf(callback);
        if (index !== -1) {
          mdnsResolvedListeners.splice(index, 1);
        }
      },
    };
  },
};

// Setup event listeners if available
if (WirelessSyncEvents) {
  WirelessSyncEvents.onBleChunkReceived((event: { deviceId: string; chunk: string }) => {
    bleChunkListeners.forEach((listener) => listener(event));
  });

  WirelessSyncEvents.onBleDeviceDiscovered((event: { id: string; name: string }) => {
    deviceDiscoveredListeners.forEach((listener) => listener(event));
  });

  WirelessSyncEvents.onMdnsServiceResolved((event: { name: string; ip: string; port: number }) => {
    mdnsResolvedListeners.forEach((listener) => listener(event));
  });
}

export default WirelessSyncBridge;
export {
  bleChunkListeners,
  deviceDiscoveredListeners,
  mdnsResolvedListeners,
};
