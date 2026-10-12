export type Trail = { id: string; name: string; km: number };

export function useTrails(): Trail[] {
  return [
    { id: 'ridge-loop', name: 'Ridge Loop', km: 8.4 },
    { id: 'lake-path', name: 'Lake Path', km: 5.1 },
  ];
}
