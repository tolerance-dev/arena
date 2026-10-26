import { ApiError } from './api'

// API errors: the server answers {code, message} in English; known codes get a Russian text, anything else falls
// back to the server's text.
const BY_CODE: Record<string, string> = {
  network: 'Нет связи с сервером.',
  unauthenticated: 'Нужно войти.',
  forbidden: 'Нет доступа.',
  not_found: 'Не найдено.',
  internal_error: 'Внутренняя ошибка. Попробуйте ещё раз.',
  state_conflict: 'Сейчас это сделать нельзя.',
  invalid_body: 'Запрос некорректен.',
  runs_closed: 'Новые агенты и запуски сейчас на паузе. Попробуйте позже.',
  blocked: 'Вашему аккаунту нельзя загружать агентов и запускать прогоны.',
  too_many_runs: 'Достигнут лимит запусков: дождитесь, пока закончатся идущие прогоны, или попробуйте завтра.',
  too_many_agents: 'Достигнут лимит агентов: удалите одного, чтобы добавить нового.',
  key_rejected: 'Провайдер не принял ключ: проверьте, что он скопирован целиком, не отозван и подходит выбранному провайдеру.',
  key_blocked: 'Google не пускает этот ключ к Gemini API: создайте ключ в AI Studio (aistudio.google.com/apikey) или разрешите ему Generative Language API в Google Cloud Console.',
  key_is_subscription: 'Это токен подписки Claude: выберите провайдера «Подписка Claude».',
  tournament_running: 'Прошлый турнир ещё идёт: новый можно запустить, когда закончатся его прогоны.',
  tournament_no_agents: 'У владельца сайта нет готовых агентов: добавьте их в «Мои агенты».',
  not_owner: 'Турниром управляет только владелец сайта.',
  key_is_api_key: 'Это API-ключ Anthropic: выберите провайдера «Anthropic».',
}
const GENERIC = 'Что-то пошло не так. Попробуйте ещё раз.'

// Any error thrown by api()/post()/upload(). Validation messages (invalid_agent, invalid_run) come from the server
// in English and are shown as they are.
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC
  const { code, message, status } = err
  // Per-user limits answer 429 too, but they are not rate limiting.
  if (code === 'too_many_runs' || code === 'too_many_agents') return BY_CODE[code]
  if (status === 429) return err.retryAfterSec ? `Слишком много запросов, повторите через ${err.retryAfterSec} с.` : 'Слишком много запросов, повторите чуть позже.'
  if (status === 413) return 'Файл слишком большой.'
  if (status >= 500 && !BY_CODE[code]) return BY_CODE.internal_error
  if (code.startsWith('invalid_') && code !== 'invalid_body' && message) return message
  return BY_CODE[code] ?? (message || GENERIC)
}
