import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

// True only once we're confident the device is offline. We treat "unknown" as
// online so a slow/ambiguous probe never flashes a false offline banner on
// launch — the screens' own request timeouts still cover genuinely dead links.
export function useIsOffline() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const apply = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => {
      // isInternetReachable is null until the first reachability probe resolves;
      // only flip to offline on an explicit false (or no connection at all).
      const off = state.isConnected === false || state.isInternetReachable === false;
      setOffline(off);
    };
    NetInfo.fetch().then(apply);
    const unsubscribe = NetInfo.addEventListener(apply);
    return unsubscribe;
  }, []);

  return offline;
}
