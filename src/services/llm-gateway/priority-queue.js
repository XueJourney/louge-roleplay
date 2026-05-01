/**
 * @file src/services/llm-gateway/priority-queue.js
 * @description LLM 全局并发与优先级队列。
 */

const logger = require('../../lib/logger');

const DEFAULT_MAX_GLOBAL_CONCURRENCY = 5;

function createPriorityQueue({ maxConcurrency = DEFAULT_MAX_GLOBAL_CONCURRENCY, log = logger } = {}) {
  let activeCount = 0;
  const pendingQueue = [];

  function drainQueue() {
    while (activeCount < maxConcurrency && pendingQueue.length > 0) {
      const nextJob = pendingQueue.shift();
      activeCount += 1;
      log.debug('LLM job dequeued', {
        priority: nextJob.priority,
        waitMs: Date.now() - nextJob.queuedAt,
        pendingQueueLength: pendingQueue.length,
        activeCount,
      });

      Promise.resolve()
        .then(() => nextJob.task())
        .then((result) => nextJob.resolve(result))
        .catch((error) => nextJob.reject(error))
        .finally(() => {
          activeCount -= 1;
          log.debug('LLM job slot released', {
            pendingQueueLength: pendingQueue.length,
            activeCount,
          });
          drainQueue();
        });
    }
  }

  function enqueueWithPriority(task, priority) {
    return new Promise((resolve, reject) => {
      pendingQueue.push({ task, priority, resolve, reject, queuedAt: Date.now() });
      pendingQueue.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.queuedAt - b.queuedAt;
      });
      log.debug('LLM job queued', {
        priority,
        pendingQueueLength: pendingQueue.length,
        activeCount,
        maxGlobalConcurrency: maxConcurrency,
      });
      drainQueue();
    });
  }

  return {
    enqueueWithPriority,
    drainQueue,
    getState: () => ({ activeCount, pendingQueueLength: pendingQueue.length, maxConcurrency }),
  };
}

module.exports = {
  DEFAULT_MAX_GLOBAL_CONCURRENCY,
  createPriorityQueue,
};
