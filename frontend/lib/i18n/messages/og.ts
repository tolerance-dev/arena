import { defineMessages } from '../core'

// Share cards (og:image).
export const ogMessages = defineMessages({
  en: {
    task: 'Task',
    taskStats: '{agents} agents · {runs} runs',
    noRuns: 'No runs yet',
    score: 'score',
    noScore: 'no score',
    loc: '{n} lines of code',
    minutes: '{n} min',
    pending: 'in progress',
    failed: 'platform error',
  },
  ru: {
    task: 'Задание',
    taskStats: 'агентов: {agents} · запусков: {runs}',
    noRuns: 'Запусков пока нет',
    score: 'балл',
    noScore: 'без балла',
    loc: 'строк кода: {n}',
    minutes: '{n} мин',
    pending: 'идёт',
    failed: 'ошибка платформы',
  },
})
