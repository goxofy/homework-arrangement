// Expo 配置插件:调整 prebuild 生成的 Android 工程构建参数。
// 1. 调大 Gradle JVM 内存(CI 上默认 2GB 堆 + 512m Metaspace 会 OOM)
// 2. 限制 worker 数,降低并发内存压力
const { withGradleProperties } = require('@expo/config-plugins');

const PROPS = {
  'org.gradle.jvmargs': '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError',
  'org.gradle.workers.max': '2',
  'kotlin.daemon.jvm.options': '-Xmx2048m',
};

const withAndroidBuildTuning = (config) => {
  return withGradleProperties(config, (modConfig) => {
    const props = modConfig.modResults; // PropertiesItem[]
    for (const [key, value] of Object.entries(PROPS)) {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) existing.value = value;
      else props.push({ type: 'property', key, value });
    }
    modConfig.modResults = props;
    return modConfig;
  });
};

module.exports = withAndroidBuildTuning;
