import { ApiError } from './api'

// API errors: the server answers {code, message} in English; known codes get a Russian text, anything else falls
// back to the server's text.
const BY_CODE: Record<string, string> = {
  unauthenticated: 'Нужно войти.',
  forbidden: 'Нет доступа.',
  not_found: 'Не найдено.',
  internal_error: 'Внутренняя ошибка. Попробуйте ещё раз.',
  state_conflict: 'Сейчас это сделать нельзя.',
  invalid_body: 'Запрос некорректен.',
  runs_closed: 'Новые агенты и запуски сейчас на паузе. Попробуйте позже.',
  blocked: 'Вашему аккаунту нельзя загружать агентов и запускать прогоны.',
}
const GENERIC = 'Что-то пошло не так. Попробуйте ещё раз.'

// Any error thrown by api()/post()/upload(). Validation messages (invalid_agent, invalid_run) come from the server
// in English and are shown as they are.
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC
  const { code, message, status } = err
  if (status === 429) return err.retryAfterSec ? `Слишком много запросов, повторите через ${err.retryAfterSec} с.` : 'Слишком много запросов, повторите чуть позже.'
  if (status === 413) return 'Файл слишком большой.'
  if (code.startsWith('invalid_') && code !== 'invalid_body' && message) return message
  return BY_CODE[code] ?? (message || GENERIC)
}
