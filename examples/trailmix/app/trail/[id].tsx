import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { ShareSheet } from '../../components/trail/ShareSheet';

export default function Trail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  return (
    <View>
      <Text>Trail {id}</Text>
      <Button title="Share" onPress={() => setSharing(true)} />
      <Button title="Start hike" onPress={() => router.push({ pathname: '/hike/[id]', params: { id } })} />
      <ShareSheet open={sharing} onClose={() => setSharing(false)} />
    </View>
  );
}
