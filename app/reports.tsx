import React from 'react';
import { Redirect } from 'expo-router';
import { useWorkspace } from '../src/lib/workspace';
import ReportsScreen from '../src/features/reports/ReportsScreen';

export default function ReportsRoute() {
  const { data } = useWorkspace();
  return data?.profile?.role === 'admin' ? <ReportsScreen /> : <Redirect href="/" />;
}
