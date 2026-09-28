/**
 * @fileType utility
 * @domain kody
 * @pattern task-cache
 * @ai-summary Shape-safe helpers for React Query task cache entries.
 */
import type { KodyTask, TasksResponse } from "@kody-ade/base/types";

export type TaskCacheData = KodyTask[] | TasksResponse | null | undefined;

export function getCachedTasks(data: TaskCacheData): KodyTask[] | undefined {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tasks)) return data.tasks;
  return undefined;
}

export function mapTaskCacheData(
  data: TaskCacheData,
  mapTasks: (tasks: KodyTask[]) => KodyTask[],
): TaskCacheData {
  if (Array.isArray(data)) {
    return mapTasks(data);
  }

  if (data && Array.isArray(data.tasks)) {
    return {
      ...data,
      tasks: mapTasks(data.tasks),
    };
  }

  return data;
}

export function findCachedTask(
  entries: Array<[readonly unknown[], TaskCacheData]>,
  predicate: (task: KodyTask) => boolean,
): KodyTask | undefined {
  for (const [, data] of entries) {
    const tasks = getCachedTasks(data);
    const task = tasks?.find(predicate);
    if (task) return task;
  }
  return undefined;
}
