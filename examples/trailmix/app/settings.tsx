import { useRouter } from 'expo-router';
import { Button, Switch, Text, View } from 'react-native';

export default function Settings() {
  const router = useRouter();
  return (
    <View>
      <Text>Units</Text>
      <Switch value />
      <Button title="Sign out" onPress={() => router.replace('/(auth)/welcome')} />
    </View>
  );
}
