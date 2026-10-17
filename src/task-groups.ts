import type { Subject, Task } from './storage';

export interface TaskGroup {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  archived: boolean;
  tasks: Task[];
}

const UNKNOWN_SORT_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * 按任务所属分组生成两端共用的展示分组。
 * 归档只影响新作业能否选择,不会隐藏历史任务;分组记录缺失时使用任务快照兜底。
 */
export function groupTasksBySubject(subjects: Subject[], tasks: Task[]): TaskGroup[] {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const groups = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const subject = subjectById.get(task.subject_id);
    let group = groups.get(task.subject_id);
    if (!group) {
      group = {
        id: task.subject_id,
        name: subject?.name ?? task.subject_name ?? '其他',
        color: subject?.color ?? task.subject_color ?? null,
        sortOrder: subject?.sort_order ?? UNKNOWN_SORT_ORDER,
        archived: subject?.archived === 1,
        tasks: [],
      };
      groups.set(task.subject_id, group);
    }
    group.tasks.push(task);
  }

  return [...groups.values()].sort((a, b) => {
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder !== 0) return byOrder;
    const byCreatedAt = (a.tasks[0]?.created_at ?? 0) - (b.tasks[0]?.created_at ?? 0);
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}
