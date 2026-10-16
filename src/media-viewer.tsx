// 全屏查看器:点开作业里的图片/视频时用(黑底、可放大看细节、右上角关闭)。
//
// 为什么放在 App 根节点(Provider)而不是弹层里:
// 详情弹层内部是 ScrollView,把「绝对定位的全屏层」放进滚动内容里会跟着一起滚;
// 而且这里用到的只是本地文件 URI,和「读取本机缓存」的媒体模块解耦,谁都能调。

import React, { createContext, useContext, useMemo, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

interface ViewRequest {
  kind: 'image' | 'video';
  /** 本机文件 URI(已下载到本机) */
  uri: string;
  title?: string;
}

interface MediaViewerValue {
  openImage: (uri: string, title?: string) => void;
  openVideo: (uri: string, title?: string) => void;
  close: () => void;
}

const MediaViewerContext = createContext<MediaViewerValue | null>(null);

export function useMediaViewer(): MediaViewerValue {
  const ctx = useContext(MediaViewerContext);
  if (!ctx) throw new Error('useMediaViewer must be used within MediaViewerProvider');
  return ctx;
}

export function MediaViewerProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ViewRequest | null>(null);

  const value = useMemo<MediaViewerValue>(
    () => ({
      openImage: (uri, title) => setRequest({ kind: 'image', uri, title }),
      openVideo: (uri, title) => setRequest({ kind: 'video', uri, title }),
      close: () => setRequest(null),
    }),
    []
  );

  return (
    <MediaViewerContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {request && <FullscreenViewer request={request} onClose={value.close} />}
      </View>
    </MediaViewerContext.Provider>
  );
}

function FullscreenViewer({ request, onClose }: { request: ViewRequest; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(0));

  React.useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  // 视频单独抽成子组件:player 是 hook,不能在条件分支里创建
  return (
    <Animated.View style={[styles.backdrop, { opacity: fade }]}>
      {request.kind === 'image' ? (
        <Image source={{ uri: request.uri }} style={styles.image} resizeMode="contain" />
      ) : (
        <VideoStage uri={request.uri} />
      )}
      <Pressable
        onPress={onClose}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="关闭"
        style={[
          styles.close,
          { top: insets.top + 8, right: insets.right + 12 },
        ]}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
      {!!request.title && (
        <Text
          style={[styles.title, { bottom: insets.bottom + 16 }]}
          numberOfLines={2}>
          {request.title}
        </Text>
      )}
    </Animated.View>
  );
}

function VideoStage({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 100,
    elevation: 100,
  },
  image: { width: '100%', height: '100%' },
  video: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  title: {
    position: 'absolute',
    left: 24,
    right: 24,
    textAlign: 'center',
    color: '#E9ECF5',
    fontSize: 13,
  },
});
