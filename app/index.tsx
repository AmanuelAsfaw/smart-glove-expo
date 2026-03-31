import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  PermissionsAndroid,
  Platform,
  Text,
  View,
} from 'react-native';

import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothEventSubscription,
} from 'react-native-bluetooth-classic';

import * as Speech from 'expo-speech';

const App: React.FC = () => {
  const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]);
  const [availableDevices, setAvailableDevices] = useState<BluetoothDevice[]>([]);
  const [status, setStatus] = useState<string>('Disconnected');
  const [text, setText] = useState<string>('');
  const [subscription, setSubscription] = useState<BluetoothEventSubscription | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      subscription?.remove();
    };
  }, [subscription]);

  // Request Bluetooth Permissions
  const requestBluetoothPermissions = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      return (
        granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED
      );
    }
    return true;
  };

  // Load paired devices
  const loadPairedDevices = async () => {
    try {
      const bonded = await RNBluetoothClassic.getBondedDevices();
      setPairedDevices(bonded);
    } catch (error) {
      console.warn('Failed to load paired devices', error);
    }
  };

  // Scan for nearby devices
  const scanDevices = async () => {
    try {
      setScanning(true);
      setAvailableDevices([]);

      const unpaired = await RNBluetoothClassic.startDiscovery();

      // Remove duplicates (already paired)
      const filtered = unpaired.filter(
        (d) => !pairedDevices.find((p) => p.address === d.address)
      );

      setAvailableDevices(filtered);
    } catch (error) {
      console.warn('Scan error', error);
    } finally {
      setScanning(false);
    }
  };

  // Load devices with permission
  const loadDevices = async () => {
    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) {
      console.warn('Permission denied');
      return;
    }

    await loadPairedDevices();
    await scanDevices();
  };

  // Safe connect with retries and delay
  const safeConnect = async (device: BluetoothDevice, retries = 3, delayMs = 1500) => {
    if (!device.bonded) {
      throw new Error('Device is not paired.');
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Disconnect if already connected
        if (await device.isConnected()) {
          await device.disconnect();
        }

        // Wait a bit before attempting
        await new Promise((r) => setTimeout(r, delayMs));

        const connected = await device.connect({ delimiter: '\n' });
        if (connected) return connected;
      } catch (err) {
        console.warn(`Connection attempt ${attempt} failed:`, err);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    throw new Error('Failed to connect after multiple attempts');
  };

  // Connect to a device
  const connect = async (device: BluetoothDevice) => {
    if (connectingDevice) {
      console.warn(`Already connecting to ${connectingDevice}`);
      return;
    }

    setConnectingDevice(device.address);
    setStatus(`Connecting to ${device.name || device.address}...`);

    try {
      await safeConnect(device);

      setStatus(`Connected to ${device.name}`);

      // Subscribe to incoming data
      const sub = device.onDataReceived((data) => {
        setText(data.data);
        Speech.speak(data.data, { language: 'en-US' });
      });

      setSubscription(sub);
    } catch (error) {
      console.warn('Connection error', error);
      setStatus('Connection Failed');
    } finally {
      setConnectingDevice(null);
    }
  };

  const renderDevice = (item: BluetoothDevice) => (
    <Button
      title={item.name ?? item.address}
      onPress={() => connect(item)}
      disabled={!!connectingDevice} // disable while connecting
    />
  );

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>Smart Glove</Text>
      <Text>Status: {status}</Text>

      <Button
        title="Scan Devices"
        onPress={loadDevices}
        disabled={!!connectingDevice || scanning}
      />

      {scanning && <ActivityIndicator size="large" style={{ marginVertical: 10 }} />}

      {/* Paired Devices */}
      <Text style={{ marginTop: 20, fontSize: 18, fontWeight: 'bold' }}>Paired Devices</Text>
      <FlatList
        data={pairedDevices}
        keyExtractor={(item) => item.address}
        renderItem={({ item }) => renderDevice(item)}
      />

      {/* Available Devices */}
      <Text style={{ marginTop: 20, fontSize: 18, fontWeight: 'bold' }}>Available Devices</Text>
      <FlatList
        data={availableDevices}
        keyExtractor={(item) => item.address}
        renderItem={({ item }) => renderDevice(item)}
      />

      {/* Incoming Text */}
      <Text style={{ marginTop: 20, fontSize: 18 }}>{text}</Text>
    </View>
  );
};

export default App;