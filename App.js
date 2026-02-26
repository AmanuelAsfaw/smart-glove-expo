import { useEffect, useState } from 'react';
import { Button, FlatList, Text, View } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import Tts from 'react-native-tts';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState('Disconnected');
  const [text, setText] = useState('');

  useEffect(() => {
    Tts.setDefaultLanguage('en-US');
  }, []);

  const loadDevices = async () => {
    const bonded = await RNBluetoothClassic.getBondedDevices();
    setDevices(bonded);
  };

  const connect = async device => {
    try {
      setStatus('Connecting...');
      const d = await device.connect({ delimiter: '\n' });
      setStatus('Connected');

      d.onDataReceived(data => {
        setText(data.data);
        Tts.speak(data.data);
      });
    } catch (e) {
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
        keyExtractor={item => item.address}
        renderItem={({ item }) => (
          <Button title={item.name} onPress={() => connect(item)} />
        )}
      />

      <Text style={{ marginTop: 20, fontSize: 18 }}>
        {text}
      </Text>
    </View>
  );
}