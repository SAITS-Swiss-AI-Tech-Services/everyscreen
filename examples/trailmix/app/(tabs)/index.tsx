import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { FilterSheet } from '../../components/FilterSheet';
import { TrailCard } from '../../components/trail/TrailCard';
import { useTrails } from '../../components/trail/useTrails';

export default function Trails() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const trails = useTrails();
  return (
    <View>
      <Pressable onPress={() => setFiltersOpen(true)}>
        <Text>Filters</Text>
      </Pressable>
      <FlatList data={trails} renderItem={({ item }) => <TrailCard trail={item} />} />
      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} />
    </View>
  );
}
