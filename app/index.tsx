import React, { useEffect, useState } from 'react';
import { Button, FlatList, Text, View } from 'react-native';
import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothEventSubscription,
} from 'react-native-bluetooth-classic';
// import Tts from 'react-native-tts';
import * as Speech from 'expo-speech';

const App: React.FC = () => {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [status, setStatus] = useState<string>('Disconnected');
  const [text, setText] = useState<string>('');
  const [subscription, setSubscription] = useState<BluetoothEventSubscription | null>(null);
  
  // useEffect(() => {
  //   if (Tts) {
  //     Tts.setDefaultLanguage('en-US');
  //   } else {
  //     console.warn('Tts is not available.');
  //   }

  //   return () => {
  //     subscription?.remove();
  //   };
  // }, [subscription]);
  useEffect(() => {
    return () => {
      subscription?.remove();
    };
  }, [subscription]);

  const loadDevices = async (): Promise<void> => {
    try {
      const bonded: BluetoothDevice[] =
        await RNBluetoothClassic.getBondedDevices();
      setDevices(bonded);
    } catch (error) {
      console.warn('Failed to load devices', error);
    }
  };

  const connect = async (device: BluetoothDevice): Promise<void> => {
    try {
      setStatus('Connecting...');
      const isConnected = await device.connect({
        delimiter: '\n', // IMPORTANT for Arduino println()
      });

      if (isConnected) {
        setStatus('Connected');

        // Now that the device is connected, listen for incoming data
        // const sub = device.onDataReceived((data) => {
        //   setText(data.data);
        //   Tts.speak(data.data);
        // });
        const sub = device.onDataReceived((data) => {
          setText(data.data);
          Speech.speak(data.data, { language: 'en-US' });
        });
        setSubscription(sub);  // Save the subscription for cleanup
      } else {
        console.warn('Connection failed');
        setStatus('Connection Failed');
      }
    } catch (error) {
      console.warn('Connection error', error);
      setStatus('Connection Failed');
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
        Smart Glove
      </Text>

      <Text>Status: {status}</Text>

      <Button title="Connect Bluetooth" onPress={loadDevices} />

      <FlatList
        data={devices}
        keyExtractor={(item) => item.address}
        renderItem={({ item }) => (
          <Button
            title={item.name ?? item.address}
            onPress={() => connect(item)}
          />
        )}
      />

      <Text style={{ marginTop: 20, fontSize: 18 }}>
        {text}
      </Text>
    </View>
  );
};

export default App;