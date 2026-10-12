import { useRouter } from 'expo-router';
import { Button, Text, View } from 'react-native';

export default function Welcome() {
  const router = useRouter();
  return (
    <View>
      <Text>Find your next trail</Text>
      <Button title="Get started" onPress={() => router.push('/(auth)/sign-in')} />
    </View>
  );
}
