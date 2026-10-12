import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

const HIKES = [{ id: 'h1', trail: 'ridge-loop', date: '2026-09-14' }];

export default function HikeHistory() {
  const router = useRouter();
  return (
    <View>
      {HIKES.map((h) => (
        <Pressable key={h.id} onPress={() => router.push(`/trail/${h.trail}`)}>
          <Text>{h.date}</Text>
        </Pressable>
      ))}
    </View>
  );
}
