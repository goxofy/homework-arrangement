// 语音识别 hook:封装 expo-speech-recognition(原生麦克风 + 系统语音转文字)。
// iOS 使用 SFSpeechRecognizer(系统听写);Android 使用 SpeechRecognizer(谷歌服务或厂商服务)。

import { useCallback, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export interface UseSpeechOptions {
  /** 识别语言,默认中国大陆中文 */
  lang?: string;
  onFinal?: (transcript: string) => void;
}

export function useSpeechRecognition({ lang = 'zh-CN', onFinal }: UseSpeechOptions = {}) {
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 累积已确定的分段(Android 连续模式下会产生多个 final 分段)
  const finalizedRef = useRef('');

  useSpeechRecognitionEvent('start', () => {
    setRecognizing(true);
    setError(null);
    finalizedRef.current = '';
    setTranscript('');
  });

  useSpeechRecognitionEvent('end', () => setRecognizing(false));

  useSpeechRecognitionEvent('result', (event) => {
    const finalParts: string[] = [];
    let interim = '';
    for (const r of event.results) {
      if (event.isFinal) finalParts.push(r.transcript);
      else interim += r.transcript;
    }
    if (finalParts.length > 0) {
      finalizedRef.current = (finalizedRef.current + ' ' + finalParts.join(' ')).trim();
      setTranscript(finalizedRef.current);
      onFinal?.(finalizedRef.current);
    } else if (interim) {
      setTranscript((finalizedRef.current + ' ' + interim).trim());
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    const messages: Record<string, string> = {
      'not-allowed': '麦克风或语音识别权限未授权,请到系统设置中开启',
      'network': '语音识别需要网络,请检查网络连接',
      'no-speech': '没有听到说话内容',
      'speech-timeout': '没有检测到语音输入',
      'service-not-allowed': '此设备不支持语音识别服务',
      'language-not-supported': '不支持当前识别语言',
    };
    setError(messages[event.error] ?? `语音识别出错: ${event.error}`);
    setRecognizing(false);
  });

  const start = useCallback(async () => {
    setError(null);
    setTranscript('');
    finalizedRef.current = '';
    const perms = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perms.granted) {
      setError('麦克风或语音识别权限未授权,请到系统设置中开启');
      return false;
    }
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      continuous: true,
      iosTaskHint: 'dictation',
      addsPunctuation: true,
    });
    return true;
  }, [lang]);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const cancel = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    setRecognizing(false);
    setTranscript('');
    finalizedRef.current = '';
  }, []);

  return { recognizing, transcript, error, start, stop, cancel, setTranscript };
}
