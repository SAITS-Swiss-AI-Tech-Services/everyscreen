import { useRouter } from 'expo-router';
import { Button, Text, View } from 'react-native';

export default function HikeSummary() {
  const router = useRouter();
  return (
    <View>
      <Text>Nice one! 8.4 km in 2:31</Text>
      <Button title="Done" onPress={() => router.dismissTo('/(tabs)')} />
    </View>
  );
}
