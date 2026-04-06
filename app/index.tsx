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

import { Buffer } from 'buffer';
import { BleManager } from 'react-native-ble-plx';

const bleManager = new BleManager();

// 🛠️ ENTER YOUR GLOVE'S MAC ADDRESS HERE
const DEFAULT_GLOVE_ADDRESS = '00:11:22:33:44:55'; 

const App: React.FC = () => {
  const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]);
  const [otherDevices, setOtherDevices] = useState<BluetoothDevice[]>([]);
  const [status, setStatus] = useState('Disconnected');
  const [text, setText] = useState('');
  const [subscription, setSubscription] = useState<BluetoothEventSubscription | null>(null);
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // 1. Initial Load & Auto-Connect Logic
  useEffect(() => {
    const init = async () => {
      const ok = await requestPermissions();
      if (!ok) return;

      const bonded = await loadPairedDevices();
      
      // Look for the hardcoded address in the paired list
      const defaultGlove = bonded.find(d => d.address === DEFAULT_GLOVE_ADDRESS);
      
      if (defaultGlove) {
        setStatus(`Auto-connecting to Default Glove...`);
        connectHybrid(defaultGlove);
      } else {
        setStatus('Ready (Default glove not found in paired list)');
      }
    };

    init();

    return () => {
      subscription?.remove();
      bleManager.destroy();
    };
  }, []);

  // 🔐 Permissions
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

  const getConnectedDevices = async () => {
    setStatus('Checking active connections...');
    
    try {
      // 1. Get all devices currently connected to the Android/iOS system
      const connected = await RNBluetoothClassic.getConnectedDevices();
      console.log('connected',connected);
      
      
      if (connected.length > 0) {
        // 2. Find your specific glove in the connected list
        const myGlove = connected.find(
          (d) => d.address === DEFAULT_GLOVE_ADDRESS
        );

        if (myGlove) {
          setStatus(`Found ${myGlove.name}. Initializing data...`);
          // Since it's already connected to the OS, we just need 
          // to ensure the app's internal socket and listeners are ready
          await connectClassic(myGlove); 
        } else {
          setStatus('Glove not among connected devices.');
        }
      } else {
        setStatus('No devices connected to system.');
      }
    } catch (err) {
      console.error("Error fetching connected devices:", err);
      setStatus('Error checking connections');
    }
  };

  const syncConnectedDevices = async () => {
      setStatus("Syncing active connections...");
      
      try {
        // 1. Get devices already connected to the Android/iOS system
        const connected = await RNBluetoothClassic.getBondedDevices();
        
        if (connected.length > 0) {
          setStatus("try to find from all");
          // return;
        }

        // 2. Loop through all connected devices
        for (let device of connected) {
          try {
            // Check if it's actually responding
            const isAlive = await device.isConnected();
            console.log(`check ${device.name} status ${isAlive}`, device);
            
            if (isAlive) {
              setStatus(`Syncing data from: ${device.name}`);
              
              // 3. Immediately attach the data listener
              subscribeClassic(device);
              
              // 4. Update UI state so the app knows which device is active
              // setDefaultDevice(device);
              setStatus(`Streaming from ${device.name}`);
              
              // If you only want to connect to ONE glove at a time, break here
              break; 
            }
          } catch (deviceErr) {
            console.warn(`Could not sync with ${device.name}:`, deviceErr);
          }
        }
      } catch (err) {
        console.error("Sync Error:", err);
        setStatus("Sync Failed");
      }
    };
  // 📱 Load paired (Using the logic from your snippet)
  const loadPairedDevices = async () => {
    try {
      const paired = await RNBluetoothClassic.getBondedDevices();
      setPairedDevices(paired);
      return paired;
    } catch (err) {
      setStatus('Bluetooth Error: Ensure BT is enabled');
      return [];
    }
  };

  // 🔁 HYBRID CONNECT
  const connectHybrid = async (device: BluetoothDevice) => {
    const type = device.type?.toUpperCase();
    // Logic to determine if Classic or BLE
    // const isClassic = type === 'CLASSIC' || type === 'BR_EDR' || true;
    const isClassic = type === 'LOW_ENERGY' ;

    if (isClassic) {
      connectClassic(device);
      // connectBLE(device);
    } else {
      connectBLE(device);
    }
  };

  // 🔵 CLASSIC CONNECT
  const connectClassic = async (device: BluetoothDevice) => {
    if (connectingDevice) return;
    
    setConnectingDevice(device.address);
    setStatus(`Clearing Socket...`);

    try {
      // 1. Force Discovery OFF (Essential for Android)
      await RNBluetoothClassic.cancelDiscovery();
      await new Promise(r => setTimeout(r, 1000)); 

      // 2. Clear any "Ghost" connections that cause 'read ret: -1'
      const isConnected = await device.isConnected();
      if (isConnected) {
        await device.disconnect();
        await new Promise(r => setTimeout(r, 1000));
      }

      setStatus(`Connecting to Glove...`);

      // 3. High-Timeout Connection
      // Using a 20s timeout gives the Dual-Mode chip time to switch 
      // from BLE advertising to Classic SPP mode.
      const connected = await device.connect({
        connectorType: 'rfcomm',
        connectionTimeout: 20000, // 20 seconds
        delimiter: '\n',
        deviceCharset: 'utf-8',
      });
      // const connected = await device.connect({
      //   secure: false,
      //   connectionTimeout: 20000
      // });
      console.log('connected::', connected);
      

      if (connected) {
        setStatus(`Connected!`);
        subscribeClassic(device);
      }

    } catch (err: any) {
      console.error("Connection Error:", err);
      
      if (err.message.includes('-1')) {
        setStatus('Socket Error: Toggle Bluetooth ON/OFF');
      } else {
        setStatus('Connection Failed');
      }
    } finally {
      setConnectingDevice(null);
    }
  };

  // 📡 CLASSIC DATA
  const subscribeClassic = (device: BluetoothDevice) => {
    subscription?.remove();
    const sub = device.onDataReceived((data) => {
      const msg = data.data.trim();
      if (msg) {
        setText((p) => p + '\n' + msg);
        Speech.speak(msg);
      }
    });
    setSubscription(sub);
  };

  // 🟣 BLE CONNECT
  const connectBLE = async (device: BluetoothDevice) => {
    try {
      setStatus(`Connecting BLE...`);
      const bleDevice = await bleManager.connectToDevice(device.address);
      await bleDevice.discoverAllServicesAndCharacteristics();
      setStatus(`Connected BLE: ${device.name}`);

      const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
      const CHAR_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

      bleDevice.monitorCharacteristicForService(SERVICE_UUID, CHAR_UUID, (err, char) => {
        if (err) return;
        if (char?.value) {
          const decoded = Buffer.from(char.value, 'base64').toString('utf-8');
          setText((p) => p + '\n' + decoded.trim());
          Speech.speak(decoded.trim());
        }
      })
    } catch (e) {
      setStatus('BLE Connection Failed');
    }
  };

  const scanDevices = async () => {
    setScanning(true);
    const bonded = await loadPairedDevices();
    const found = await RNBluetoothClassic.startDiscovery();
    const filtered = found.filter(d => !bonded.find(b => b.address === d.address));
    setOtherDevices(filtered);
    setScanning(false);
  };

  const renderDevice = (device: BluetoothDevice) => (
    <View key={device.address} style={styles.card}>
      <View>
        <Text style={{ fontWeight: device.address === DEFAULT_GLOVE_ADDRESS ? 'bold' : 'normal' }}>
          {device.name || device.address}
          {device.address === DEFAULT_GLOVE_ADDRESS && ' (Default)'}
        </Text>
        <Text style={{ color: 'green', fontSize: 10 }}>{device.type}</Text>
      </View>

      <TouchableOpacity
        style={styles.btn}
        onPress={() => connectHybrid(device)}
      >
        <Text style={{ color: '#fff' }}>
          {connectingDevice === device.address ? '...' : 'Connect'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Smart Glove Control</Text>
      <Text style={styles.status}>Status: {status}</Text>

      <TouchableOpacity style={styles.scan} onPress={scanDevices}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>Scan Devices</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.scan} onPress={syncConnectedDevices}>
        <Text style={{ color: '#fff', textAlign: 'center', marginTop: 10 }}>Default Device</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Paired Devices</Text>
      {pairedDevices.map(renderDevice)}

      <Text style={styles.label}>Discovery</Text>
      {otherDevices.map(renderDevice)}

      {scanning && <ActivityIndicator />}
      
      <View style={styles.terminal}>
        <Text style={styles.terminalText}>{text}</Text>
      </View>
    </ScrollView>
  );
};

export default App;

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 5 },
  status: { marginBottom: 20, color: 'blue' },
  label: { fontSize: 16, fontWeight: 'bold', marginTop: 15, marginBottom: 5 },
  scan: { backgroundColor: '#444', padding: 12, borderRadius: 5 },
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginVertical: 5,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff'
  },
  btn: { backgroundColor: 'green', padding: 10, borderRadius: 5, minWidth: 80, alignItems: 'center' },
  terminal: { marginTop: 20, padding: 10, backgroundColor: '#000', borderRadius: 5, minHeight: 100 },
  terminalText: { color: '#0f0', fontFamily: 'monospace' }
});