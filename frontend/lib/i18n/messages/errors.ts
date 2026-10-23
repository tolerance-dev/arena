import { defineMessages, makeT, type Locale } from '../core'
import { ApiError } from '../../api'

// API errors: the server answers {code, message} in English; known codes are shown in the reader's language,
// anything else falls back to the server's text.
export const errorMessages = defineMessages({
  en: {
    generic: 'Something went wrong. Please try again.',
    rateLimitedIn: 'Too many requests, try again in {n}s.',
    rateLimited: 'Too many requests, try again shortly.',
    tooLarge: 'That upload is too large.',
    unauthenticated: 'Sign in required.',
    forbidden: 'You do not have access to this.',
    not_found: 'Not found.',
    internal_error: 'Internal error. Please try again.',
    state_conflict: 'That cannot be done in the current state.',
    invalid_body: 'The request is not valid.',
    runs_closed: 'New agents and runs are paused for now. Try again later.',
    blocked: 'Your account can’t upload agents or start runs.',
  },
  ru: {
    generic: 'Что-то пошло не так. Попробуйте ещё раз.',
    rateLimitedIn: 'Слишком много запросов, повторите через {n} с.',
    rateLimited: 'Слишком много запросов, повторите чуть позже.',
    tooLarge: 'Файл слишком большой.',
    unauthenticated: 'Нужно войти.',
    forbidden: 'Нет доступа.',
    not_found: 'Не найдено.',
    internal_error: 'Внутренняя ошибка. Попробуйте ещё раз.',
    state_conflict: 'Сейчас это сделать нельзя.',
    invalid_body: 'Запрос некорректен.',
    runs_closed: 'Новые агенты и запуски сейчас на паузе. Попробуйте позже.',
    blocked: 'Вашему аккаунту нельзя загружать агентов и запускать прогоны.',
  },
})

type K = keyof typeof errorMessages.en

// Any error thrown by api()/post()/upload(), in the reader's language. Validation messages (invalid_agent,
// invalid_run) come from the server in English and are shown as they are.
export function errorText(err: unknown, locale: Locale = 'en'): string {
  const t = makeT(errorMessages, locale)
  if (!(err instanceof ApiError)) return t('generic')
  const { code, message, status } = err
  if (status === 429) return err.retryAfterSec ? t('rateLimitedIn', { n: err.retryAfterSec }) : t('rateLimited')
  if (status === 413) return t('tooLarge')
  if (code.startsWith('invalid_') && code !== 'invalid_body' && message) return message
  if (code in errorMessages.en) return t(code as K)
  return message || t('generic')
}
