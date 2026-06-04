import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import type { Subscription } from 'expo-modules-core';

const NativeModule = requireNativeModule('WirelessSyncModule');

export const WirelessSync = {
  startPeripheral(serviceUuid: string, characteristicUuid: string): void {
    NativeModule.startPeripheral(serviceUuid, characteristicUuid);
  },

  stopPeripheral(): void {
    NativeModule.stopPeripheral();
  },

  startScanning(serviceUuid: string): void {
    NativeModule.startScanning(serviceUuid);
  },

  stopScanning(): void {
    NativeModule.stopScanning();
  },

  connectToDevice(deviceId: string): void {
    NativeModule.connectToDevice(deviceId);
  },

  disconnectDevice(deviceId: string): void {
    NativeModule.disconnectDevice(deviceId);
  },

  async sendBleChunk(deviceId: string, chunk: string): Promise<boolean> {
    return await NativeModule.sendBleChunk(deviceId, chunk);
  },

  startMdnsAdvertising(serviceName: string, serviceType: string, port: number): void {
    NativeModule.startMdnsAdvertising(serviceName, serviceType, port);
  },

  stopMdnsAdvertising(): void {
    NativeModule.stopMdnsAdvertising();
  },

  startMdnsDiscovery(serviceType: string): void {
    NativeModule.startMdnsDiscovery(serviceType);
  },

  stopMdnsDiscovery(): void {
    NativeModule.stopMdnsDiscovery();
  },
};

const emitter = new EventEmitter(NativeModule);

export const WirelessSyncEvents = {
  onBleChunkReceived(callback: (event: { deviceId: string; chunk: string }) => void): Subscription {
    return emitter.addListener('bleChunkReceived', callback);
  },

  onBleDeviceDiscovered(callback: (event: { id: string; name: string }) => void): Subscription {
    return emitter.addListener('bleDeviceDiscovered', callback);
  },

  onMdnsServiceResolved(callback: (event: { name: string; ip: string; port: number }) => void): Subscription {
    return emitter.addListener('mdnsServiceResolved', callback);
  },
};
