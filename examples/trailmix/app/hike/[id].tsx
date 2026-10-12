import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Text, View } from 'react-native';

export default function ActiveHike() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return (
    <View>
      <Text>Hiking {id}: 3.2 km · 01:04</Text>
      <Button title="Finish" onPress={() => router.replace('/hike/summary')} />
    </View>
  );
}
