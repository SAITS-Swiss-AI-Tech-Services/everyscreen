import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFound() {
  return (
    <View>
      <Text>This trail doesn't exist.</Text>
      <Link href="/">Back to trails</Link>
    </View>
  );
}
