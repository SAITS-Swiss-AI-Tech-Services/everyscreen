import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="trail/[id]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="hike/[id]" options={{ gestureEnabled: false }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
