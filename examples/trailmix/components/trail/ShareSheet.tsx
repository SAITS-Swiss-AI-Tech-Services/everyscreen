import { Button, Modal, Text } from 'react-native';

export function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal visible={open} onRequestClose={onClose} transparent>
      <Text>Share this trail</Text>
      <Button title="Copy link" onPress={onClose} />
    </Modal>
  );
}
