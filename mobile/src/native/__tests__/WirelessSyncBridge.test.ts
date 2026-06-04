import WirelessSyncBridge, {
  bleChunkListeners,
  deviceDiscoveredListeners,
  mdnsResolvedListeners
} from '../WirelessSyncBridge';

describe('WirelessSyncBridge Unit & Fallback Mock Tests', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    // Clear listeners
    bleChunkListeners.length = 0;
    deviceDiscoveredListeners.length = 0;
    mdnsResolvedListeners.length = 0;
  });

  it('should support event subscription registration and removal', () => {
    const cb = jest.fn();
    const sub = WirelessSyncBridge.onBleDeviceDiscovered(cb);
    expect(deviceDiscoveredListeners.length).toBe(1);

    // Trigger listener
    deviceDiscoveredListeners[0]({ id: 'test-1', name: 'Test' });
    expect(cb).toHaveBeenCalledWith({ id: 'test-1', name: 'Test' });

    // Remove listener
    sub.remove();
    expect(deviceDiscoveredListeners.length).toBe(0);
  });

  it('should trigger simulated device discovery after 200ms when startScanning is called', () => {
    const cb = jest.fn();
    WirelessSyncBridge.onBleDeviceDiscovered(cb);

    WirelessSyncBridge.startScanning('F3C9');
    
    // Fast-forward time
    jest.advanceTimersByTime(200);

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, { id: 'mock-peer-iphone', name: 'iPhone' });
    expect(cb).toHaveBeenNthCalledWith(2, { id: 'mock-peer-tablet', name: 'iPad' });
  });

  it('should trigger simulated mDNS resolution after 200ms when startMdnsDiscovery is called', () => {
    const cb = jest.fn();
    WirelessSyncBridge.onMdnsServiceResolved(cb);

    WirelessSyncBridge.startMdnsDiscovery('_llmpdfsync._tcp');
    
    // Fast-forward time
    jest.advanceTimersByTime(200);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({
      name: 'Local iPad Sync Server',
      ip: '192.168.1.150',
      port: 8080,
    });
  });

  it('should stop simulated timers on stopScanning and stopMdnsDiscovery', () => {
    const cbBle = jest.fn();
    const cbMdns = jest.fn();
    WirelessSyncBridge.onBleDeviceDiscovered(cbBle);
    WirelessSyncBridge.onMdnsServiceResolved(cbMdns);

    WirelessSyncBridge.startScanning('F3C9');
    WirelessSyncBridge.startMdnsDiscovery('_llmpdfsync._tcp');

    WirelessSyncBridge.stopScanning();
    WirelessSyncBridge.stopMdnsDiscovery();

    jest.advanceTimersByTime(200);

    expect(cbBle).not.toHaveBeenCalled();
    expect(cbMdns).not.toHaveBeenCalled();
  });
});
