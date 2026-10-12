import { Button, Modal, Text } from 'react-native';

export function FilterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal visible={open} onRequestClose={onClose} transparent>
      <Text>Distance, difficulty, dogs allowed</Text>
      <Button title="Show trails" onPress={onClose} />
    </Modal>
  );
}
