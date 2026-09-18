// 根组件:根据 身份/角色 切换 欢迎 → 加入房间 → 家长端/儿童端。

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/AppContext';
import { DisplayProvider } from './src/display';
import { FadeIn } from './src/ui';
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

  // 离开家长端(切换成儿童端 / 退出房间)时关掉家长端的弹层,
  // 否则以后再回到家长端会莫名其妙地弹出来
  useEffect(() => {
    if (identity?.role !== 'parent') {
      setSubjectsOpen(false);
      setSettingsOpen(false);
    }
  }, [identity?.role]);

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

  // 换页统一走 FadeIn(每次换页 key 不同 → 重新挂载 → 重新播进场动画)

  // 1. 未选身份 → 欢迎页(含服务器地址填写)
  if (!identity && !pickedRole) {
    return (
      <FadeIn key="welcome">
        <WelcomeScreen onPick={setPickedRole} server={serverHint} onChangeServer={changeServerHint} />
      </FadeIn>
    );
  }

  // 2. 已选身份但未加入房间 → 加入房间(预填欢迎页填的地址)
  if (!identity && pickedRole) {
    return (
      <FadeIn key={`join-${pickedRole}`}>
        <JoinRoomScreen
          role={pickedRole}
          initialServer={serverHint}
          onJoined={(server, roomCode) => {
            changeServerHint(server);
            saveIdentityAndJoin({ role: pickedRole, roomCode, server }).catch(() => {});
          }}
          onBack={() => setPickedRole(null)}
        />
      </FadeIn>
    );
  }

  // 3. 儿童端
  if (identity!.role === 'child') {
    return (
      <FadeIn key="child">
        <ChildHomeScreen />
      </FadeIn>
    );
  }

  // 4. 家长端(弹层常驻渲染 + visible:关闭时才能播退场动画)
  return (
    <FadeIn key="parent">
      <ParentHomeScreen
        onOpenSubjects={() => setSubjectsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SubjectsScreen visible={subjectsOpen} onClose={() => setSubjectsOpen(false)} />
      <SettingsScreen
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onUpdateServer={updateIdentity}
        onSignOut={signOut}
      />
    </FadeIn>
  );
}

export default function App() {
  return (
    // SafeAreaProvider 必须包在最外层:状态栏/刘海/手势条避让全靠它注入的 insets
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DisplayProvider>
        <AppProvider>
          <StatusBar style="dark" />
          <Root />
        </AppProvider>
      </DisplayProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  loadingText: { marginTop: spacing(2), color: colors.textSub, fontSize: 14 },
});
