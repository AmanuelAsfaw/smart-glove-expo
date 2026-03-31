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
  const [scanning, setScanning] = useState<boolean>(false);
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);

  useEffect(() => {
    return () => subscription?.remove();
  }, [subscription]);

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

  const loadPairedDevices = async () => {
    try {
      const bonded = await RNBluetoothClassic.getBondedDevices();
      setPairedDevices(bonded);
    } catch (error) {
      console.warn('Failed to load paired devices', error);
    }
  };

  const scanDevices = async () => {
    try {
      setScanning(true);
      setCompatibleDevices([]);
      setOtherDevices([]);

      const unpaired = await RNBluetoothClassic.startDiscovery();
      const compatible: BluetoothDevice[] = [];
      const others: BluetoothDevice[] = [];

      unpaired.forEach((d: any) => {
        if (!pairedDevices.find((p) => p.address === d.address)) {
          if (['CLASSIC', 'Classic'].includes(d.type)) compatible.push(d);
          others.push(d);
        }
      });

      setCompatibleDevices(compatible);
      setOtherDevices(others);
    } catch (error) {
      console.warn('Scan error', error);
    } finally {
      setScanning(false);
    }
  };

  const loadDevices = async () => {
    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) return console.warn('Permission denied');

    await loadPairedDevices();
    await scanDevices();
  };

  const safeConnect = async (device: BluetoothDevice, retries = 3, delayMs = 1200) => {
    if (!device.bonded) throw new Error('Device is not paired.');

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (await device.isConnected()) await device.disconnect();
        await RNBluetoothClassic.cancelDiscovery();
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

  const connect = async (device: BluetoothDevice) => {
    if (connectingDevice) {
      console.warn(`Already connecting to ${connectingDevice}`);
      return;
    }

    setConnectingDevice(device.address);
    setStatus(`Connecting to ${device.name || device.address}...`);

    try {
      console.log('Device::', device?.type, ' --- ',device?.id);
      // Only connect to paired, classic RFCOMM devices
      if (!device.bonded || !['Classic', 'CLASSIC'].includes(device.type)) {
        console.warn('Device not compatible for connection');
        setStatus('Device Not Compatible');
        return;
      }

      await RNBluetoothClassic.cancelDiscovery();

      if (await device.isConnected()) await device.disconnect();

      // Optional: retry loop
      const connected = await safeConnect(device, 3, 1500);
      console.log('Device::', device?.type, ' --- ',device?.id);
      
      if (connected) {
        setStatus(`Connected to ${device.name}`);
        const sub = device.onDataReceived((data) => {
          setText(data.data);
          Speech.speak(data.data, { language: 'en-US' });
        });
        setSubscription(sub);
      }
    } catch (error) {
      console.warn('Connection error', error);
      setStatus('Connection Failed');
    } finally {
      setConnectingDevice(null);
    }
  };

  const renderDevice = (item: BluetoothDevice) => (
    <View
      style={[
        styles.deviceCard,
        connectingDevice === item.address && styles.connectedDevice,
      ]}
      key={`renderdevice-${item?.id}`}
    >
      <View>

      <Text style={styles.deviceName}>{item.name ?? item.address}</Text>
      <Text style={[styles.deviceType, ['CLASSIC', 'Classic', 'classic'].includes(item.type) ?{color: 'green', fontWeight: 'bold'} :{}]}>{item.type}</Text>
      </View>
      <TouchableOpacity
        style={[
          styles.connectButton,
          connectingDevice === item.address && styles.connectingButton,
        ]}
        onPress={() => connect(item)}
        disabled={!!connectingDevice}
      >
        <Text style={styles.buttonText}>
          {connectingDevice === item.address ? 'Connecting...' : 'Connect'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Smart Glove</Text>
      <Text style={styles.status}>Status: {status}</Text>

      <TouchableOpacity
        style={[styles.scanButton, (scanning || connectingDevice) && styles.disabledButton]}
        onPress={loadDevices}
        disabled={!!connectingDevice || scanning}
      >
        <Text style={styles.buttonText}>{scanning ? 'Scanning...' : 'Scan Devices'}</Text>
      </TouchableOpacity>

      {scanning && <ActivityIndicator size="large" style={{ marginVertical: 15 }} />}

      <Text style={styles.sectionTitle}>Paired Devices</Text>
      {pairedDevices.map(renderDevice)}

      <Text style={styles.sectionTitle}>Compatible Devices</Text>
      {compatibleDevices.map(renderDevice)}

      <Text style={styles.sectionTitle}>Other Devices</Text>
      {otherDevices.map(renderDevice)}

      {text ? (
        <View style={styles.incomingTextCard}>
          <Text style={styles.incomingText}>{text}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 15,
    paddingBottom: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  status: {
    fontSize: 14,
    marginBottom: 15,
    textAlign: 'center',
  },
  scanButton: {
    backgroundColor: '#4A90E2',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 15,
  },
  disabledButton: {
    backgroundColor: '#9BBCE0',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginVertical: 8,
  },
  deviceCard: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#f9f9f9',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  connectedDevice: {
    borderColor: '#34A853',
    backgroundColor: '#e6f4ea',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
  },
  deviceType: {
    fontSize: 12,
    color: '#666',
    marginVertical: 2,
  },
  connectButton: {
    backgroundColor: '#34A853',
    paddingVertical: 6,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 5,
    paddingHorizontal: 3
  },
  connectingButton: {
    backgroundColor: '#FBC02D',
  },
  incomingTextCard: {
    marginTop: 15,
    borderWidth: 1,
    borderColor: '#4A90E2',
    borderRadius: 8,
    padding: 10,
  },
  incomingText: {
    fontSize: 14,
  },
});

export default App;