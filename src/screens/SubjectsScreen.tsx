// 分组配置页(家长):新增/重命名/归档分组,配置对所有日期持续生效。

import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Overlay, Screen, TopBar, TopBarAction } from '../ui';
import { colors, spacing, subjectPalette } from '../theme';
import { useApp } from '../AppContext';
import type { Subject } from '../storage';

export default function SubjectsScreen({
  visible = true,
  onClose,
}: {
  visible?: boolean;
  onClose: () => void;
}) {
  const { subjects, addSubject, editSubject, archiveSubject } = useApp();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sorted = [...subjects].sort((a, b) => a.sort_order - b.sort_order);

  const doAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await addSubject(name, subjectPalette[subjects.length % subjectPalette.length]);
      setNewName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const doRename = async (sub: Subject) => {
    const name = editName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await editSubject(sub.id, { name });
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const doArchive = (sub: Subject) =>
    Alert.alert('归档分组', `归档「${sub.name}」后,新作业不能再选它,历史作业仍会正常显示。`, [
      { text: '取消', style: 'cancel' },
      { text: '归档', style: 'destructive', onPress: () => archiveSubject(sub.id).catch(() => {}) },
    ]);

  return (
    <Overlay
      visible={visible}
      onRequestClose={onClose}
      bar={
        <TopBar flat title="作业分组" left={<TopBarAction title="完成" onPress={onClose} />} />
      }>
      <Screen>
          <Text style={s.hint}>
            分组设置好后,之后每天布置作业都可以直接使用(语文 / 数学 / 英语 / 其他 已默认创建)。
          </Text>

          <Card style={{ marginTop: spacing(1.5), gap: spacing(1) }}>
            {sorted.map((sub) => (
              <View key={sub.id} style={s.row}>
                <View style={[s.dot, { backgroundColor: sub.archived ? colors.border : sub.color ?? colors.primary }]} />
                {editingId === sub.id ? (
                  <>
                    <TextInput style={s.editInput} value={editName} onChangeText={setEditName} autoFocus />
                    <Pressable onPress={() => doRename(sub)} hitSlop={6}>
                      <Text style={s.saveBtn}>保存</Text>
                    </Pressable>
                    <Pressable onPress={() => setEditingId(null)} hitSlop={6}>
                      <Text style={s.cancelBtn}>取消</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={[s.name, !!sub.archived && { color: colors.textSub }]}>{sub.name}</Text>
                    {!!sub.archived && <Text style={s.archivedTag}>已归档</Text>}
                    <View style={{ flex: 1 }} />
                    {!sub.archived && (
                      <>
                        <Pressable
                          onPress={() => {
                            setEditingId(sub.id);
                            setEditName(sub.name);
                          }}
                          hitSlop={6}>
                          <Text style={s.editBtn}>改名</Text>
                        </Pressable>
                        <Pressable onPress={() => doArchive(sub)} hitSlop={6}>
                          <Text style={s.archiveBtn}>归档</Text>
                        </Pressable>
                      </>
                    )}
                  </>
                )}
              </View>
            ))}
          </Card>

          <Card style={{ marginTop: spacing(2), gap: spacing(1.5) }}>
            <Text style={s.label}>新增分组</Text>
            <View style={{ flexDirection: 'row', gap: spacing(1) }}>
              <TextInput
                style={[s.editInput, { flex: 1 }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="如:科学、美术…"
                placeholderTextColor={colors.textSub}
                maxLength={20}
                onSubmitEditing={doAdd}
              />
              <View>
                <Button title="添加" small onPress={doAdd} disabled={!newName.trim() || busy} loading={busy} />
              </View>
            </View>
            {error && <Text style={s.error}>{error}</Text>}
          </Card>
      </Screen>
    </Overlay>
  );
}

const s = StyleSheet.create({
  hint: { fontSize: 13, color: colors.textSub, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.2), paddingVertical: spacing(1) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { fontSize: 16, color: colors.text, fontWeight: '500' },
  archivedTag: { fontSize: 11, color: colors.textSub, marginLeft: 4 },
  editInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing(1),
    paddingVertical: 6,
    fontSize: 15,
    color: colors.text,
    minWidth: 120,
  },
  editBtn: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  archiveBtn: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  saveBtn: { color: colors.ok, fontSize: 14, fontWeight: '700' },
  cancelBtn: { color: colors.textSub, fontSize: 14 },
  error: { color: colors.danger, fontSize: 13 },
});
