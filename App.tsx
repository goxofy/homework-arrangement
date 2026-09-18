// 根组件:根据 身份/角色 切换 欢迎 → 加入房间 → 家长端/儿童端。

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AppProvider, useApp } from './src/AppContext';
import { colors, spacing } from './src/theme';
import { loadServerHint, saveServerHint, type Role } from './src/storage';
import WelcomeScreen from './src/screens/WelcomeScreen';
import JoinRoomScreen from './src/screens/JoinRoomScreen';
import ParentHomeScreen from './src/screens/ParentHomeScreen';
import ChildHomeScreen from './src/screens/ChildHomeScreen';
import SubjectsScreen from './src/screens/SubjectsScreen';
import SettingsScreen from './src/screens/SettingsScreen';

function Root() {
  const { ready, identity, saveIdentityAndJoin, updateIdentity, signOut } = useApp();
  const [pickedRole, setPickedRole] = useState<Role | null>(null);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 服务器地址预填值:欢迎页填写,本地记住,设置页可改
  const [serverHint, setServerHint] = useState('');

  useEffect(() => {
    loadServerHint().then(setServerHint);
  }, []);

  const changeServerHint = (v: string) => {
    setServerHint(v);
    saveServerHint(v.trim()).catch(() => {});
  };

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>加载中…</Text>
      </View>
    );
  }

  // 1. 未选身份 → 欢迎页(含服务器地址填写)
  if (!identity && !pickedRole) {
    return <WelcomeScreen onPick={setPickedRole} server={serverHint} onChangeServer={changeServerHint} />;
  }

  // 2. 已选身份但未加入房间 → 加入房间(预填欢迎页填的地址)
  if (!identity && pickedRole) {
    return (
      <JoinRoomScreen
        role={pickedRole}
        initialServer={serverHint}
        onJoined={(server, roomCode) => {
          changeServerHint(server);
          saveIdentityAndJoin({ role: pickedRole, roomCode, server }).catch(() => {});
        }}
        onBack={() => setPickedRole(null)}
      />
    );
  }

  // 3. 儿童端
  if (identity!.role === 'child') {
    return <ChildHomeScreen />;
  }

  // 4. 家长端
  return (
    <>
      <ParentHomeScreen
        onOpenSubjects={() => setSubjectsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {subjectsOpen && <SubjectsScreen onClose={() => setSubjectsOpen(false)} />}
      {settingsOpen && (
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onUpdateServer={updateIdentity}
          onSignOut={signOut}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Root />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  loadingText: { marginTop: spacing(2), color: colors.textSub, fontSize: 14 },
});
