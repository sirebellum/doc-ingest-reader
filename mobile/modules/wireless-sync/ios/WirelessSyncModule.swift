import ExpoModulesCore
import CoreBluetooth
import Foundation

public class WirelessSyncModule: Module, CBPeripheralManagerDelegate, CBCentralManagerDelegate, CBPeripheralDelegate, NetServiceDelegate, NetServiceBrowserDelegate {
    private var peripheralManager: CBPeripheralManager?
    private var centralManager: CBCentralManager?
    private var discoveredPeripherals: [String: CBPeripheral] = [:]
    private var connectedPeripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?
    
    private var serviceUUIDString: String = ""
    private var characteristicUUIDString: String = ""
    
    private var netService: NetService?
    private var netServiceBrowser: NetServiceBrowser?
    
    public override func definition() -> ModuleDefinition {
        Name("WirelessSyncModule")
        
        Events("bleChunkReceived", "bleDeviceDiscovered", "mdnsServiceResolved")
        
        Function("startPeripheral") { (serviceUuid: String, characteristicUuid: String) in
            self.serviceUUIDString = serviceUuid
            self.characteristicUUIDString = characteristicUuid
            if self.peripheralManager == nil {
                self.peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
            } else {
                self.setupPeripheralService()
            }
        }
        
        Function("stopPeripheral") {
            self.peripheralManager?.stopAdvertising()
        }
        
        Function("startScanning") { (serviceUuid: String) in
            self.serviceUUIDString = serviceUuid
            if self.centralManager == nil {
                self.centralManager = CBCentralManager(delegate: self, queue: nil)
            } else {
                self.startScanningInternal()
            }
        }
        
        Function("stopScanning") {
            self.centralManager?.stopScan()
        }
        
        Function("connectToDevice") { (deviceId: String) in
            guard let peripheral = self.discoveredPeripherals[deviceId] else { return }
            self.connectedPeripheral = peripheral
            self.centralManager?.connect(peripheral, options: nil)
        }
        
        Function("disconnectDevice") { (deviceId: String) in
            if let peripheral = self.connectedPeripheral, peripheral.identifier.uuidString == deviceId {
                self.centralManager?.cancelPeripheralConnection(peripheral)
            }
        }
        
        AsyncFunction("sendBleChunk") { (deviceId: String, chunk: String) -> Bool in
            guard let peripheral = self.connectedPeripheral, peripheral.identifier.uuidString == deviceId else {
                return false
            }
            guard let char = self.writeChar else {
                return false
            }
            if let data = chunk.data(using: .utf8) {
                peripheral.writeValue(data, for: char, type: .withResponse)
                return true
            }
            return false
        }
        
        Function("startMdnsAdvertising") { (serviceName: String, serviceType: String, port: Int) in
            self.netService = NetService(domain: "local.", type: serviceType, name: serviceName, port: Int32(port))
            self.netService?.delegate = self
            self.netService?.publish()
        }
        
        Function("stopMdnsAdvertising") {
            self.netService?.stop()
            self.netService = nil
        }
        
        Function("startMdnsDiscovery") { (serviceType: String) in
            self.netServiceBrowser = NetServiceBrowser()
            self.netServiceBrowser?.delegate = self
            self.netServiceBrowser?.searchForServices(ofType: serviceType, domain: "local.")
        }
        
        Function("stopMdnsDiscovery") {
            self.netServiceBrowser?.stop()
            self.netServiceBrowser = nil
        }
    }
    
    private func setupPeripheralService() {
        guard let pm = peripheralManager, pm.state == .poweredOn else { return }
        pm.removeAllServices()
        
        let cUuid = CBUUID(string: characteristicUUIDString)
        let sUuid = CBUUID(string: serviceUUIDString)
        
        let characteristic = CBMutableCharacteristic(
            uuid: cUuid,
            properties: [.write, .writeWithoutResponse],
            value: nil,
            permissions: [.writeable]
        )
        
        let service = CBMutableService(uuid: sUuid, primary: true)
        service.characteristics = [characteristic]
        
        pm.add(service)
        pm.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [sUuid]])
    }
    
    private func startScanningInternal() {
        guard let cm = centralManager, cm.state == .poweredOn else { return }
        let sUuid = CBUUID(string: serviceUUIDString)
        cm.scanForPeripherals(withServices: [sUuid], options: nil)
    }
    
    // MARK: - CBPeripheralManagerDelegate
    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn {
            setupPeripheralService()
        }
    }
    
    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            if let data = request.value, let chunkStr = String(data: data, encoding: .utf8) {
                sendEvent("bleChunkReceived", [
                    "deviceId": request.central.identifier.uuidString,
                    "chunk": chunkStr
                ])
            }
            peripheral.respond(to: request, withResult: .success)
        }
    }
    
    // MARK: - CBCentralManagerDelegate
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            startScanningInternal()
        }
    }
    
    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi: NSNumber) {
        let uuid = peripheral.identifier.uuidString
        discoveredPeripherals[uuid] = peripheral
        let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "Unknown BLE Device"
        sendEvent("bleDeviceDiscovered", [
            "id": uuid,
            "name": name
        ])
    }
    
    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([CBUUID(string: serviceUUIDString)])
    }
    
    // MARK: - CBPeripheralDelegate
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services else { return }
        for service in services {
            if service.uuid == CBUUID(string: serviceUUIDString) {
                peripheral.discoverCharacteristics([CBUUID(string: characteristicUUIDString)], for: service)
            }
        }
    }
    
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let characteristics = service.characteristics else { return }
        for char in characteristics {
            if char.uuid == CBUUID(string: characteristicUUIDString) {
                self.writeChar = char
            }
        }
    }
    
    // MARK: - NetServiceDelegate
    public func netServiceDidPublish(_ sender: NetService) {
        print("Bonjour net service published: \(sender.name)")
    }
    
    // MARK: - NetServiceBrowserDelegate
    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        service.resolve(withTimeout: 10.0)
    }
    
    public func netService(_ sender: NetService, didResolveAddress addresses: [Data]) {
        guard let address = addresses.first else { return }
        var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let success = address.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Bool in
            guard let sockaddrPtr = ptr.baseAddress?.assumingMemoryBound(to: sockaddr.self) else { return false }
            let status = getnameinfo(sockaddrPtr, socklen_t(address.count), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST)
            return status == 0
        }
        if success {
            let ip = String(cString: hostname)
            sendEvent("mdnsServiceResolved", [
                "name": sender.name,
                "ip": ip,
                "port": sender.port
            ])
        }
    }
}
