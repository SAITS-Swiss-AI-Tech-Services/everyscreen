import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTrails } from '../../components/trail/useTrails';

export default function Explore() {
  const router = useRouter();
  const trails = useTrails();
  return (
    <View>
      {trails.map((t) => (
        <Pressable key={t.id} onPress={() => router.push(`/trail/${t.id}`)}>
          <Text>{t.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
