import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, TextInput, View } from 'react-native';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  return (
    <View>
      <TextInput value={email} onChangeText={setEmail} placeholder="Email" />
      <Button title="Continue" onPress={() => router.replace('/(tabs)')} />
    </View>
  );
}
