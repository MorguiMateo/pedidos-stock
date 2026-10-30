import React from 'react';
import { Redirect } from 'expo-router';
import { useWorkspace } from '../src/lib/workspace';
import SettingsScreen from '../src/features/settings/SettingsScreen';

export default function SettingsRoute() {
  const { data } = useWorkspace();
  return data?.profile?.role === 'admin' ? <SettingsScreen /> : <Redirect href="/" />;
}
