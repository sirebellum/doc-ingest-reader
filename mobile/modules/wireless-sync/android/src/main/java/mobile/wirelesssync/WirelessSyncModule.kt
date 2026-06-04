package mobile.wirelesssync

import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanSettings
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.ScanResult
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.ParcelUuid
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.*

class WirelessSyncModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private var bluetoothManager: BluetoothManager? = null
  private var bluetoothAdapter: BluetoothAdapter? = null
  private var bluetoothGattServer: BluetoothGattServer? = null
  private var gattServerCallback: BluetoothGattServerCallback? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var scanCallback: ScanCallback? = null
  private var nsdManager: NsdManager? = null
  private var registrationListener: NsdManager.RegistrationListener? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private var resolveListener: NsdManager.ResolveListener? = null

  private val connectedDevices = mutableMapOf<String, BluetoothGatt>()
  private val writeCharacteristics = mutableMapOf<String, BluetoothGattCharacteristic>()

  private var serviceUUIDString: String = ""
  private var characteristicUUIDString: String = ""

  override fun definition() = ModuleDefinition {
    Name("WirelessSyncModule")
    Events("bleChunkReceived", "bleDeviceDiscovered", "mdnsServiceResolved")

    Function("startPeripheral") { serviceUuid: String, characteristicUuid: String ->
      startPeripheralInternal(serviceUuid, characteristicUuid)
    }

    Function("stopPeripheral") {
      stopPeripheralInternal()
    }

    Function("startScanning") { serviceUuid: String ->
      startScanningInternal(serviceUuid)
    }

    Function("stopScanning") {
      stopScanningInternal()
    }

    Function("connectToDevice") { deviceId: String ->
      connectToDeviceInternal(deviceId)
    }

    Function("disconnectDevice") { deviceId: String ->
      disconnectDeviceInternal(deviceId)
    }

    AsyncFunction("sendBleChunk") { deviceId: String, chunk: String ->
      sendBleChunkInternal(deviceId, chunk)
    }

    Function("startMdnsAdvertising") { serviceName: String, serviceType: String, port: Int ->
      startMdnsAdvertisingInternal(serviceName, serviceType, port)
    }

    Function("stopMdnsAdvertising") {
      stopMdnsAdvertisingInternal()
    }

    Function("startMdnsDiscovery") { serviceType: String ->
      startMdnsDiscoveryInternal(serviceType)
    }

    Function("stopMdnsDiscovery") {
      stopMdnsDiscoveryInternal()
    }
  }

  private fun startPeripheralInternal(serviceUuid: String, characteristicUuid: String) {
    serviceUUIDString = serviceUuid
    characteristicUUIDString = characteristicUuid
    
    bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    bluetoothAdapter = bluetoothManager?.adapter

    val service = BluetoothGattService(UUID.fromString(serviceUuid), BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val characteristic = BluetoothGattCharacteristic(
      UUID.fromString(characteristicUuid),
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE
    )
    service.addCharacteristic(characteristic)

    gattServerCallback = object : BluetoothGattServerCallback() {
      override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        offset: Int,
        value: ByteArray
      ) {
        val chunk = String(value, Charsets.UTF_8)
        sendEvent("bleChunkReceived", mapOf("deviceId" to device.address, "chunk" to chunk))
        bluetoothGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
      }
    }

    bluetoothGattServer = bluetoothManager?.openGattServer(context, gattServerCallback)
    bluetoothGattServer?.addService(service)

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .build()

    val advertiseData = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(UUID.fromString(serviceUuid)))
      .build()

    advertiseCallback = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
        // Advertising started successfully
      }
      override fun onStartFailure(errorCode: Int) {
        // Advertising failed
      }
    }

    bluetoothAdapter?.bluetoothLeAdvertiser?.startAdvertising(settings, advertiseData, advertiseCallback)
  }

  private fun stopPeripheralInternal() {
    try {
      bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
      bluetoothGattServer?.close()
    } catch (e: Exception) {}
  }

  private fun startScanningInternal(serviceUuid: String) {
    serviceUUIDString = serviceUuid
    bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    bluetoothAdapter = bluetoothManager?.adapter

    val filters = mutableListOf<ScanFilter>().apply {
      add(ScanFilter.Builder().setServiceUuid(ParcelUuid(UUID.fromString(serviceUuid))).build())
    }

    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()

    scanCallback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val device = result.device
        sendEvent("bleDeviceDiscovered", mapOf("id" to device.address, "name" to (device.name ?: "Unknown BLE Device")))
      }
    }

    bluetoothAdapter?.bluetoothLeScanner?.startScan(filters, settings, scanCallback)
  }

  private fun stopScanningInternal() {
    try {
      bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    } catch (e: Exception) {}
  }

  private fun connectToDeviceInternal(deviceId: String) {
    val device = bluetoothAdapter?.getRemoteDevice(deviceId)
    val gatt = device?.connectGatt(context, false, gattCallback)
    if (gatt != null) {
      connectedDevices[deviceId] = gatt
    }
  }

  private fun disconnectDeviceInternal(deviceId: String) {
    val gatt = connectedDevices[deviceId]
    gatt?.disconnect()
    gatt?.close()
    connectedDevices.remove(deviceId)
    writeCharacteristics.remove(deviceId)
  }

  private fun sendBleChunkInternal(deviceId: String, chunk: String): Boolean {
    val gatt = connectedDevices[deviceId]
    val characteristic = writeCharacteristics[deviceId]
    if (gatt != null && characteristic != null) {
      characteristic.value = chunk.toByteArray(Charsets.UTF_8)
      return gatt.writeCharacteristic(characteristic)
    }
    return false
  }

  private fun startMdnsAdvertisingInternal(serviceName: String, serviceType: String, port: Int) {
    nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    val serviceInfo = NsdServiceInfo().apply {
      this.serviceName = serviceName
      this.serviceType = serviceType
      this.port = port
    }

    registrationListener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(NsdServiceInfo: NsdServiceInfo) {}
      override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
      override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
      override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
    }

    nsdManager?.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
  }

  private fun stopMdnsAdvertisingInternal() {
    try {
      nsdManager?.unregisterService(registrationListener)
    } catch (e: Exception) {}
  }

  private fun startMdnsDiscoveryInternal(serviceType: String) {
    nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    resolveListener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
      override fun onServiceResolved(resolvedInfo: NsdServiceInfo) {
        sendEvent("mdnsServiceResolved", mapOf(
          "name" to resolvedInfo.serviceName,
          "ip" to resolvedInfo.host.hostAddress,
          "port" to resolvedInfo.port
        ))
      }
    }

    discoveryListener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(regType: String) {}
      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        nsdManager?.resolveService(serviceInfo, resolveListener)
      }
      override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
      override fun onDiscoveryStopped(regType: String) {}
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    }

    nsdManager?.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
  }

  private fun stopMdnsDiscoveryInternal() {
    try {
      nsdManager?.stopServiceDiscovery(discoveryListener)
    } catch (e: Exception) {}
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        gatt.discoverServices()
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val device = gatt.device
      val service = gatt.getService(UUID.fromString(serviceUUIDString))
      val char = service?.getCharacteristic(UUID.fromString(characteristicUUIDString))
      if (char != null) {
        writeCharacteristics[device.address] = char
      }
    }
  }
}
