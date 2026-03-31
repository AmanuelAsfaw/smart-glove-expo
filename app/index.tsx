import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothEventSubscription,
} from 'react-native-bluetooth-classic';

const App: React.FC = () => {
  const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]);
  const [compatibleDevices, setCompatibleDevices] = useState<BluetoothDevice[]>([]);
  const [otherDevices, setOtherDevices] = useState<BluetoothDevice[]>([]);
  const [status, setStatus] = useState<string>('Disconnected');
  const [text, setText] = useState<string>('');
  const [subscription, setSubscription] = useState<BluetoothEventSubscription | null>(null);
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);
  const [defaultDevice, setDefaultDevice] = useState<BluetoothDevice | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      subscription?.remove();

      // Wrap async calls in an IIFE
      (async () => {
        if (defaultDevice) {
          const connected = await defaultDevice.isConnected();
          if (connected) await defaultDevice.disconnect();
        }
      })();
    };
  }, [subscription, defaultDevice]);
  // Request permissions (Android 12+)
  const requestPermissions = async () => {
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
      return bonded;
    } catch (err) {
      console.warn('Failed to load paired devices:', err);
      return [];
    }
  };

  // Subscribe to incoming data
  const subscribeToData = (device: BluetoothDevice) => {
    const sub = device.onDataReceived((data) => {
      const message = data.data.trim();
      setText((prev) => prev + (prev ? '\n' : '') + message);
      Speech.speak(message, { language: 'en-US' });
    });
    setSubscription(sub);
  };

  // Connect device with retry
  const connectDeviceOld = async (device: BluetoothDevice, retries = 5, delayMs = 2000) => {
    if (connectingDevice) return;
    setConnectingDevice(device.address);
    setStatus(`Connecting to ${device.name || device.address}...`);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (!(await device.isConnected())) {
          await RNBluetoothClassic.cancelDiscovery();
          await device.connect({ delimiter: '\n' });
          subscribeToData(device);
        }
        setStatus(`Connected to ${device.name}`);
        setDefaultDevice(device);
        break; // success
      } catch (err) {
        console.warn(`Attempt ${attempt} failed:`, err);
        setStatus(`Retrying... (${attempt})`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setConnectingDevice(null);
  };
  
  const connectDevice = async (
    device: BluetoothDevice,
    retries = 5,
    delayMs = 2000
  ) => {
    if (connectingDevice) return;

    setConnectingDevice(device.address);
    setStatus(`Connecting to ${device.name || device.address}...`);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const isConnected = await RNBluetoothClassic.isDeviceConnected(
          device.address
        );

        if (!isConnected) {
          await RNBluetoothClassic.cancelDiscovery();

          const connection = await RNBluetoothClassic.connectToDevice(
            device.address,
            {
              CONNECTOR_TYPE: 'rfcomm',
              DELIMITER: '\n',
              DEVICE_CHARSET: Platform.OS === 'ios' ? 1536 : 'utf-8',
            }
          );

          if (!connection) {
            throw new Error('Connection returned null/false');
          }

          // OPTIONAL: re-fetch device instance if needed
          // const connectedDevice = await RNBluetoothClassic.getConnectedDevices()

          subscribeToData(device);
        }

        setStatus(`Connected to ${device.name || device.address}`);
        setDefaultDevice(device);
        break; // ✅ success
      } catch (err) {
        console.warn(`Attempt ${attempt} failed:`, err);

        if (attempt === retries) {
          setStatus(`Failed to connect to ${device.name}`);
        } else {
          setStatus(`Retrying... (${attempt}/${retries})`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    setConnectingDevice(null);
  };

  // Auto-connect to first HC-05
  const autoConnectDefaultDevice = async () => {
    const bonded = await loadPairedDevices();
    const hc05 = bonded.find(
      (d) => d.name?.toUpperCase().includes('HC-05') && ['CLASSIC', 'Classic'].includes(d.type)
    );
    if (hc05) connectDevice(hc05);
  };

  // Scan unpaired devices and categorize
  const scanDevices = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return console.warn('Permissions denied');

    setScanning(true);
    setCompatibleDevices([]);
    setOtherDevices([]);

    try {
      const bonded = await loadPairedDevices();
      const unpaired = await RNBluetoothClassic.startDiscovery();

      const compatible: BluetoothDevice[] = [];
      const others: BluetoothDevice[] = [];

      unpaired.forEach((d) => {
        const alreadyPaired = bonded.find((p) => p.address === d.address);
        if (!alreadyPaired) {
          if (d.name?.toUpperCase().includes('HC-05') && ['CLASSIC', 'Classic'].includes(d.type)) {
            compatible.push(d);
          } else {
            others.push(d);
          }
        }
      });

      setCompatibleDevices(compatible);
      setOtherDevices(others);
    } catch (err) {
      console.warn('Scan failed:', err);
    } finally {
      setScanning(false);
    }
  };

  // Render a device card
  const renderDevice = (device: BluetoothDevice) => {
    const isDefault = defaultDevice?.address === device.address;
    return (
      <View
        key={device.address}
        style={[styles.deviceCard, isDefault && styles.connectedDevice]}
      >
        <View>
          <Text style={styles.deviceName}>{device.name ?? device.address}</Text>
          <Text style={[styles.deviceType, { color: 'green', fontWeight: 'bold' }]}>
            {device.type}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.connectButton,
            connectingDevice === device.address && styles.connectingButton,
          ]}
          onPress={() => connectDevice(device)}
          disabled={!!connectingDevice}
        >
          <Text style={styles.buttonText}>
            {connectingDevice === device.address ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  useEffect(() => {
    autoConnectDefaultDevice();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Smart Glove</Text>

      {text ? (
        <View style={styles.incomingTextCard}>
          <Text style={styles.incomingText}>{text}</Text>
        </View>
      ) : null}
      <Text style={styles.status}>Status: {status}</Text>

      <TouchableOpacity
        style={[styles.scanButton, (scanning || connectingDevice) && styles.disabledButton]}
        onPress={scanDevices}
        disabled={!!connectingDevice || scanning}
      >
        <Text style={styles.buttonText}>{scanning ? 'Scanning...' : 'Scan Devices'}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Paired Devices</Text>
      {pairedDevices.map(renderDevice)}

      <Text style={styles.sectionTitle}>Compatible Devices (HC-05)</Text>
      {compatibleDevices.map(renderDevice)}

      <Text style={styles.sectionTitle}>Other Devices</Text>
      {otherDevices.map(renderDevice)}

      {text ? (
        <View style={styles.incomingTextCard}>
          <Text style={styles.incomingText}>{text}</Text>
        </View>
      ) : null}

      {scanning && <ActivityIndicator size="large" style={{ marginTop: 15 }} />}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 15, paddingBottom: 30 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  status: { fontSize: 14, marginBottom: 15, textAlign: 'center' },
  scanButton: { backgroundColor: '#4A90E2', paddingVertical: 10, borderRadius: 6, alignItems: 'center', marginBottom: 15 },
  disabledButton: { backgroundColor: '#9BBCE0' },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  deviceCard: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: '#f9f9f9', flexDirection: 'row', justifyContent: 'space-between' },
  connectedDevice: { borderColor: '#34A853', backgroundColor: '#e6f4ea' },
  deviceName: { fontSize: 16, fontWeight: '600' },
  deviceType: { fontSize: 12, color: '#666', marginVertical: 2 },
  connectButton: { backgroundColor: '#34A853', paddingVertical: 6, borderRadius: 5, alignItems: 'center', marginTop: 5, paddingHorizontal: 3 },
  connectingButton: { backgroundColor: '#FBC02D' },
  incomingTextCard: { marginTop: 15, borderWidth: 1, borderColor: '#4A90E2', borderRadius: 8, padding: 10 },
  incomingText: { fontSize: 14 },
});

export default App;