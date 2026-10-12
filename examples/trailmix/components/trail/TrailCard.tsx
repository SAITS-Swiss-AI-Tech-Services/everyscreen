import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import type { Trail } from './useTrails';

export function TrailCard({ trail }: { trail: Trail }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/trail/${trail.id}`)}>
      <Text>{trail.name}</Text>
      <Text>{trail.km} km</Text>
    </Pressable>
  );
}
