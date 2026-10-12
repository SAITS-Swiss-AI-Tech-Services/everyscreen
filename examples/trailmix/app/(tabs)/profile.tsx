import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function Profile() {
  return (
    <View>
      <Text>12 hikes · 148 km</Text>
      <Link href="/hike/history">Past hikes</Link>
      <Link href="/settings">Settings</Link>
    </View>
  );
}
