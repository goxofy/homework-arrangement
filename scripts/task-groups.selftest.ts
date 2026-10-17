import { groupTasksBySubject } from '../src/task-groups';
import type { Subject, Task } from '../src/storage';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
}

const subjects: Subject[] = [
  { id: 'active', name: '数学', color: '#3B82F6', sort_order: 1, archived: 0 },
  { id: 'archived', name: '旧语文', color: '#E5484D', sort_order: 0, archived: 1 },
];

function task(
  id: string,
  subjectId: string,
  subjectName: string | null,
  subjectColor: string | null,
  createdAt: number
): Task {
  return {
    id,
    for_date: '2026-10-17',
    subject_id: subjectId,
    subject_name: subjectName,
    subject_color: subjectColor,
    content: id,
    done: false,
    has_audio: false,
    audio_url: null,
    audio_mime: null,
    audio_size: null,
    media: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const groups = groupTasksBySubject(subjects, [
  task('active-task', 'active', '旧数学名', '#000000', 2),
  task('archived-task', 'archived', '快照语文', '#111111', 1),
  task('missing-task', 'missing', '历史科学', '#10B981', 3),
]);

assert(groups.length === 3, '只返回有任务的三个分组');
assert(groups[0]?.id === 'archived', '按原 sort_order 保留归档分组顺序');
assert(groups[0]?.name === '旧语文', '归档分组使用当前分组名称');
assert(groups[0]?.color === '#E5484D', '归档分组使用当前分组颜色');
assert(groups[0]?.archived === true, '归档分组保留 archived 标记');
assert(groups[1]?.id === 'active' && groups[1]?.archived === false, '活动分组保持正常展示');
assert(groups[2]?.name === '历史科学', '缺失分组使用任务中的历史名称快照');
assert(groups[2]?.color === '#10B981', '缺失分组使用任务中的历史颜色快照');

console.log('\n任务分组自测全部通过 ✅');
